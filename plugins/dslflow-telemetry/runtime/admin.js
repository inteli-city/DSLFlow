// DSLFlow Telemetry — runtime admin module.
//
// Persistent state (on disk under $USER_DIR/.dslflow-telemetry/):
//   • events.json  — recent events across restarts (bounded by time and count)
//   • hourly.json  — hourly aggregate buckets (short-to-medium retention)
//   • daily.json   — daily aggregate buckets (long retention)
//
// In-memory hot-path:
//   • pending — in-flight deliveries, used by postDeliver to compute sync
//               duration before bumping the per-node execution counter.
//
// History reads from events + buckets; Usage merges current flow config
// (RED.nodes.eachNode) with bucket-derived runtime totals.
//
// Design constraints:
//   • No new dependencies — plain fs/JSON only.
//   • Aggregation is O(1) per event (hash lookup into the current bucket).
//   • Writes are deferred: events mark `dirty=true`, a 30 s timer flushes.
//   • Retention pruning is bounded and periodic; no unbounded growth.
//   • No raw payload storage — events carry only the fields the UI renders.

const { EventEmitter } = require("events");
const fs   = require("fs");
const fsp  = require("fs").promises;
const path = require("path");

module.exports = function (RED) {
  const cfg        = RED.settings.get("dslflowTelemetry") || {};
  const SLOW_THRESHOLD_MS = cfg.slowThresholdMs  || 250;

  const persistCfg = cfg.persistence || {};
  const EVENTS_RETENTION_MS = (persistCfg.eventsRetentionHours || 24)      * 3600 * 1000;
  const HOURLY_RETENTION_MS = (persistCfg.hourlyRetentionDays  || 7)   * 24 * 3600 * 1000;
  const DAILY_RETENTION_MS  = (persistCfg.dailyRetentionDays   || 90)  * 24 * 3600 * 1000;
  const MAX_PERSISTED_EVENTS = persistCfg.maxPersistedEvents || 2000;
  const FLUSH_INTERVAL_MS    = (persistCfg.flushIntervalSeconds || 30) * 1000;

  // ── Storage paths ──────────────────────────────────────────────────────────
  // Telemetry is runtime data, not repository data — always lives in userDir.
  const USER_DIR  = RED.settings.userDir || process.cwd();
  const STORE_DIR = path.join(USER_DIR, ".dslflow-telemetry");
  const EVENTS_FILE = path.join(STORE_DIR, "events.json");
  const HOURLY_FILE = path.join(STORE_DIR, "hourly.json");
  const DAILY_FILE  = path.join(STORE_DIR, "daily.json");

  try { fs.mkdirSync(STORE_DIR, { recursive: true }); } catch (e) { /* non-fatal */ }

  // ── Hot-path state (in-memory) ─────────────────────────────────────────────
  // Only `pending` survives — it's the per-message timing map used by the
  // postDeliver hook to compute sync delivery duration. All Live-tab state
  // (issues ring, per-node session counters) was removed when the Live view
  // was retired; History reads from persistent buckets and Usage from the
  // current flow configuration.
  const pending = new Map();

  // ── Persistent state (loaded at startup, flushed on interval) ──────────────
  let eventsLog     = loadJson(EVENTS_FILE, []);
  let hourlyBuckets = loadJson(HOURLY_FILE, []);
  let dailyBuckets  = loadJson(DAILY_FILE,  []);
  let dirty = false;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function loadJson(file, fallback) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const val = JSON.parse(raw);
      return Array.isArray(val) ? val : fallback;
    } catch (e) { return fallback; }
  }

  async function atomicWrite(file, obj) {
    const tmp = file + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(obj));
    await fsp.rename(tmp, file);
  }

  function hourStart(ms) {
    const d = new Date(ms);
    d.setUTCMinutes(0, 0, 0);
    return d.getTime();
  }
  function dayStart(ms) {
    const d = new Date(ms);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  let _nextId = 1;
  function genId() { return "t" + (_nextId++).toString(36); }

  // ── Issue grouping ─────────────────────────────────────────────────────────
  // Group identity = (entity) + (severity) + (fingerprint). Fingerprint
  // normalises numbers, hex-looking ids, and absolute paths so that variants
  // of the same failure ("/tmp/tmp-24-abc123: …" vs "/tmp/tmp-24-xyz789: …")
  // collapse into one group. This is deliberately opinionated — not exposed
  // as configuration.
  const MAX_OCCURRENCES_PER_GROUP = 5;
  const MAX_GROUPS = 30;

  function fingerprint(msg) {
    if (!msg) return "";
    return String(msg)
      .toLowerCase()
      .replace(/\/\S+/g, "/*")
      .replace(/\b\d+\b/g, "N")
      .replace(/\b[a-f0-9]{8,}\b/g, "H")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  }

  // Short human-readable title for a group — prefers the last colon-delimited
  // segment of the raw message, which for shell-style errors is usually the
  // punchline ("command not found", "permission denied", "ENOENT …").
  function issueLabel(msg) {
    if (!msg) return "(no message)";
    const parts = String(msg).split(/:\s*/).filter(Boolean);
    const last  = parts.length ? parts[parts.length - 1] : String(msg);
    const clean = last.replace(/\s+/g, " ").trim();
    return clean.length > 120 ? clean.slice(0, 120) + "…" : clean;
  }

  // Build groups from an events array ordered oldest→newest. Walks backwards
  // so the first occurrence pushed into each group is the most recent one.
  // `active` is optional — when provided, groups gain deletedNode/deletedFlow
  // flags so the UI can label history-only entities.
  function buildGroups(events, cutoffMs, active) {
    const groups = new Map();
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.ts < cutoffMs) break;
      const fp  = fingerprint(e.message);
      const sev = e.severity || "info";
      const entity = e.nodeId || e.flowId || "runtime";
      const key = entity + "::" + sev + "::" + fp;
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          nodeId:   e.nodeId   || null,
          nodeType: e.nodeType || null,
          nodeName: e.nodeName || null,
          flowId:   e.flowId   || null,
          severity: sev,
          fingerprint: fp,
          label:    issueLabel(e.message),
          count:    0,
          firstTs:  e.ts,
          lastTs:   e.ts,              // set once from newest; don't update
          occurrences: [],
          deletedNode: !!(active && e.nodeId && !active.nodes.has(e.nodeId)),
          deletedFlow: !!(active && e.flowId && !active.flows.has(e.flowId)),
        };
        groups.set(key, g);
      }
      g.count++;
      if (e.ts < g.firstTs) g.firstTs = e.ts;
      if (g.occurrences.length < MAX_OCCURRENCES_PER_GROUP) g.occurrences.push(e);
      if (!g.nodeType && e.nodeType) g.nodeType = e.nodeType;
      if (!g.nodeName && e.nodeName) g.nodeName = e.nodeName;
      if (!g.flowId   && e.flowId)   g.flowId   = e.flowId;
    }
    return Array.from(groups.values())
      .sort((a, b) => b.lastTs - a.lastTs)
      .slice(0, MAX_GROUPS);
  }

  function safeString(v, max) {
    const lim = max || 2000;
    try {
      if (v == null) return "";
      if (typeof v === "string") return v.length > lim ? v.slice(0, lim) + "…" : v;
      const s = JSON.stringify(v);
      return s && s.length > lim ? s.slice(0, lim) + "…" : s;
    } catch (e) { return String(v).slice(0, lim); }
  }

  // Get-or-create a bucket in a sorted array, preserving time order.
  function getBucket(arr, t) {
    // Fast path: latest bucket matches
    if (arr.length) {
      const last = arr[arr.length - 1];
      if (last.t === t) return last;
      if (last.t < t) {
        const b = emptyBucket(t);
        arr.push(b);
        return b;
      }
    }
    // Slow path: out-of-order event (rare). Binary scan from end.
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].t === t) return arr[i];
      if (arr[i].t < t) {
        const b = emptyBucket(t);
        arr.splice(i + 1, 0, b);
        return b;
      }
    }
    const b = emptyBucket(t);
    arr.unshift(b);
    return b;
  }
  function emptyBucket(t) {
    return { t, errors: 0, warnings: 0, byNode: {}, byFlow: {} };
  }

  // Increment a per-node execution counter inside the current hourly + daily
  // bucket. Called from postDeliver for every delivery; O(1) hot-path with
  // the latest-bucket fast path inside getBucket(). The new `executions`
  // field is additive to legacy bucket data — old entries default to 0.
  function bumpExecInBucket(nodeId, nodeType, nodeName, flowId) {
    const now = Date.now();
    bumpExecBucket(hourlyBuckets, hourStart(now), nodeId, nodeType, nodeName, flowId);
    bumpExecBucket(dailyBuckets,  dayStart(now),  nodeId, nodeType, nodeName, flowId);
    dirty = true;
  }
  function bumpExecBucket(arr, tStart, nodeId, type, name, flowId) {
    const b = getBucket(arr, tStart);
    let n = b.byNode[nodeId];
    if (!n) {
      n = { type: type || null, name: name || null, z: flowId || null,
            errors: 0, warnings: 0, executions: 0 };
      b.byNode[nodeId] = n;
    }
    if (!n.type && type)   n.type = type;
    if (!n.name && name)   n.name = name;
    if (!n.z    && flowId) n.z    = flowId;
    n.executions = (n.executions || 0) + 1;
  }

  function bumpBucket(arr, tStart, rec) {
    const b = getBucket(arr, tStart);
    if (rec.severity === "error")      b.errors++;
    else if (rec.severity === "warn")  b.warnings++;
    if (rec.nodeId) {
      let n = b.byNode[rec.nodeId];
      if (!n) {
        n = { type: rec.nodeType || null, name: rec.nodeName || null,
              z: rec.flowId || null, errors: 0, warnings: 0 };
        b.byNode[rec.nodeId] = n;
      }
      // Upgrade missing fields if a later event has richer metadata. We never
      // overwrite existing values — historical truth is preserved.
      if (!n.type && rec.nodeType) n.type = rec.nodeType;
      if (!n.name && rec.nodeName) n.name = rec.nodeName;
      if (!n.z    && rec.flowId)   n.z    = rec.flowId;
      if (rec.severity === "error")      n.errors++;
      else if (rec.severity === "warn")  n.warnings++;
    }
    if (rec.flowId) {
      let f = b.byFlow[rec.flowId];
      if (!f) { f = { errors: 0, warnings: 0 }; b.byFlow[rec.flowId] = f; }
      if (rec.severity === "error")      f.errors++;
      else if (rec.severity === "warn")  f.warnings++;
    }
  }

  // Central recorder — appends to the persistent event log and updates
  // hourly/daily aggregates. History reads from these; Usage reads its own
  // execution buckets.
  function recordEvent(rec) {
    eventsLog.push(rec);
    if (eventsLog.length > MAX_PERSISTED_EVENTS) eventsLog.shift();
    bumpBucket(hourlyBuckets, hourStart(rec.ts), rec);
    bumpBucket(dailyBuckets,  dayStart(rec.ts),  rec);
    dirty = true;
  }

  // ── Collector 1: log handler for errors and warnings ───────────────────────
  const logHandler = new EventEmitter();
  logHandler.on("log", function (evt) {
    if (!evt) return;
    const lvl = evt.level;
    if (lvl !== RED.log.ERROR && lvl !== RED.log.WARN) return;
    if (!evt.id) return; // only track events attributed to a node

    const severity = lvl === RED.log.ERROR ? "error" : "warn";
    const rec = {
      id:       genId(),
      ts:      (evt.timestamp || Date.now()),
      severity,
      source:   "node",
      nodeId:   evt.id,
      nodeType: evt.type || null,
      nodeName: evt.name || null,
      flowId:   evt.z    || null,
      message:  safeString(evt.msg),
    };
    recordEvent(rec);
  });
  RED.log.addHandler(logHandler);

  // ── Collector 2: hooks for sync delivery duration ──────────────────────────
  RED.hooks.add("preDeliver.dslflow-telemetry", function (event) {
    if (!event || !event.msg || !event.destination) return;
    const msgid = event.msg._msgid;
    const nodeid = event.destination.id;
    if (!msgid || !nodeid) return;
    pending.set(msgid + ":" + nodeid, process.hrtime.bigint());
  });

  RED.hooks.add("postDeliver.dslflow-telemetry", function (event) {
    if (!event || !event.msg || !event.destination) return;
    const msgid  = event.msg._msgid;
    const nodeid = event.destination.id;
    if (!msgid || !nodeid) return;
    const key   = msgid + ":" + nodeid;
    const start = pending.get(key);
    if (start === undefined) return;
    pending.delete(key);

    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    const node  = event.destination.node;
    const type  = node && node.type;
    const name  = node && node.name;
    const flow  = node && node.z;
    // Persistent per-node execution counter for the Usage view's runtime
    // metric — one increment per delivery, bucketed by time.
    bumpExecInBucket(nodeid, type, name, flow);

    if (durMs >= SLOW_THRESHOLD_MS) {
      recordEvent({
        id:         genId(),
        ts:         Date.now(),
        severity:   "warn",
        source:     "perf",
        nodeId:     nodeid,
        nodeType:   type || null,
        nodeName:   name || null,
        flowId:     flow || null,
        durationMs: Math.round(durMs),
        message:    "Slow synchronous delivery (" + Math.round(durMs) + " ms, threshold " + SLOW_THRESHOLD_MS + " ms).",
      });
    }
  });

  // Safety net for unbounded `pending` growth.
  setInterval(function () {
    if (pending.size > 10000) pending.clear();
  }, 60 * 1000).unref();

  // ── Persistence: periodic flush + shutdown flush + retention pruning ───────
  function pruneRetention() {
    const now = Date.now();
    const ec  = now - EVENTS_RETENTION_MS;
    const hc  = now - HOURLY_RETENTION_MS;
    const dc  = now - DAILY_RETENTION_MS;
    const e0 = eventsLog.length, h0 = hourlyBuckets.length, d0 = dailyBuckets.length;
    eventsLog     = eventsLog.filter(e => e.ts >= ec);
    hourlyBuckets = hourlyBuckets.filter(b => b.t  >= hc);
    dailyBuckets  = dailyBuckets.filter(b  => b.t  >= dc);
    if (eventsLog.length !== e0 || hourlyBuckets.length !== h0 || dailyBuckets.length !== d0) {
      dirty = true;
    }
  }
  pruneRetention();

  async function flush() {
    if (!dirty) return;
    dirty = false; // clear early so new events during flush re-set it
    try {
      await atomicWrite(EVENTS_FILE, eventsLog);
      await atomicWrite(HOURLY_FILE, hourlyBuckets);
      await atomicWrite(DAILY_FILE,  dailyBuckets);
    } catch (e) {
      RED.log.warn("[dslflow-telemetry] flush failed: " + (e.message || e));
      dirty = true; // try again next tick
    }
  }

  setInterval(flush, FLUSH_INTERVAL_MS).unref();
  setInterval(pruneRetention, 30 * 60 * 1000).unref();

  function flushSync() {
    if (!dirty) return;
    dirty = false;
    try {
      fs.writeFileSync(EVENTS_FILE, JSON.stringify(eventsLog));
      fs.writeFileSync(HOURLY_FILE, JSON.stringify(hourlyBuckets));
      fs.writeFileSync(DAILY_FILE,  JSON.stringify(dailyBuckets));
    } catch (e) { /* best-effort */ }
  }
  process.once("beforeExit", flushSync);
  process.once("SIGTERM", flushSync);
  process.once("SIGINT",  flushSync);

  // ── Route helpers ──────────────────────────────────────────────────────────
  const canRead  = RED.auth.needsPermission("dslflow.telemetry.read");
  const canWrite = RED.auth.needsPermission("dslflow.telemetry.write");

  // Present-vs-deleted detection. A node is considered "active" if it still
  // exists in the deployed flow configuration. Disabled flows and config nodes
  // are treated as active — the test is "is it in the config", not "is it
  // currently running". Computed once per request to keep cost predictable.
  function buildActiveSets() {
    const nodes = new Set();
    const flows = new Set();
    // eachNode walks `allNodes`, which includes flow tabs (`type: "tab"`),
    // subflows, config nodes, and regular nodes. We collect non-tab ids as
    // the active node set, and tab ids as the active flow set.
    try {
      RED.nodes.eachNode((n) => {
        if (!n || !n.id) return;
        if (n.type === "tab") flows.add(n.id);
        else                   nodes.add(n.id);
      });
    } catch (e) {}
    return { nodes, flows };
  }

  function rangeSpec(range) {
    // Returns { granularity, cutoff, buckets } — which bucket set to read.
    const now = Date.now();
    if (range === "7d") {
      return { granularity: "day", cutoff: now - 7  * 86400 * 1000, source: dailyBuckets };
    }
    if (range === "30d") {
      return { granularity: "day", cutoff: now - 30 * 86400 * 1000, source: dailyBuckets };
    }
    // default "today" = last 24 hours, hourly
    return { granularity: "hour", cutoff: now - 24 * 3600 * 1000, source: hourlyBuckets };
  }

  function topEntries(map, limit) {
    // map :: { id: { ...stats } } or { id: { errors, warnings } }
    const out = [];
    for (const id of Object.keys(map)) out.push({ id, ...map[id] });
    out.sort((a, b) => (b.errors || 0) - (a.errors || 0));
    return out.slice(0, limit || 10);
  }

  function collectAcrossBuckets(buckets, cutoff) {
    const nodes = {};
    for (const b of buckets) {
      if (b.t < cutoff) continue;
      for (const id of Object.keys(b.byNode)) {
        const src = b.byNode[id];
        let dst = nodes[id];
        if (!dst) {
          dst = { type: src.type, name: src.name || null, z: src.z, errors: 0, warnings: 0 };
          nodes[id] = dst;
        }
        if (!dst.type && src.type) dst.type = src.type;
        if (!dst.name && src.name) dst.name = src.name;
        if (!dst.z    && src.z)    dst.z    = src.z;
        dst.errors   += src.errors;
        dst.warnings += src.warnings;
      }
    }
    // Flows are DERIVED from nodes — single source of truth. A flow is
    // failing iff at least one of its nodes has errors in the range; its
    // counts are the sum of contributing nodes' counts. The bucket's
    // `byFlow` block is no longer consulted at read time.
    const flows = {};
    for (const id of Object.keys(nodes)) {
      const n = nodes[id];
      if (!n.z) continue;
      let dst = flows[n.z];
      if (!dst) { dst = { errors: 0, warnings: 0 }; flows[n.z] = dst; }
      dst.errors   += n.errors;
      dst.warnings += n.warnings;
    }
    return { nodes, flows };
  }

  // ── Routes ─────────────────────────────────────────────────────────────────

  // History view: time-bucketed series + ranked nodes/flows. Optional
  // nodeId/flowId filter scopes the series and returns related recent events.
  // `activeOnly=1` excludes deleted nodes/flows from the ranking sections
  // only — summary, series, and events are always the full historical truth.
  RED.httpAdmin.get("/dslflow/telemetry/history", canRead, (req, res) => {
    const range      = String(req.query.range || "today");
    const nodeId     = req.query.nodeId || null;
    const flowId     = req.query.flowId || null;
    const activeOnly = req.query.activeOnly === "1" || req.query.activeOnly === "true";
    const spec       = rangeSpec(range);

    // Series
    const series = [];
    for (const b of spec.source) {
      if (b.t < spec.cutoff) continue;
      let errors = 0, warnings = 0;
      if (nodeId) {
        const n = b.byNode[nodeId];
        if (n) { errors = n.errors; warnings = n.warnings; }
      } else if (flowId) {
        // Derived from nodes in this flow within this bucket (single source
        // of truth — `b.byFlow` is no longer read).
        for (const id of Object.keys(b.byNode)) {
          const n = b.byNode[id];
          if (n.z !== flowId) continue;
          errors   += n.errors;
          warnings += n.warnings;
        }
      } else {
        errors   = b.errors;
        warnings = b.warnings;
      }
      series.push({ t: b.t, errors, warnings });
    }

    // Rankings — scope matches the filter. Each entry is annotated with
    // `deleted: true|false` so the UI can flag items whose node/flow no
    // longer exists in the current deployment. The data itself is untouched.
    const active = buildActiveSets();
    const tagNode = (id, e) => ({
      nodeId:   id,
      type:     e.type,
      name:     e.name || null,
      flowId:   e.z,
      errors:   e.errors,
      warnings: e.warnings,
      deleted:  !active.nodes.has(id),
    });
    const tagFlow = (id, e) => ({
      flowId:   id,
      errors:   e.errors,
      warnings: e.warnings,
      deleted:  !active.flows.has(id),
    });
    const agg = collectAcrossBuckets(spec.source, spec.cutoff);

    // When activeOnly is set, filter rankings at the SOURCE (before top-N
    // selection) so the top-10 represents the true top-10 active, not the
    // remnants of a top-10 after post-hoc removal.
    function nodeActivityOnly(src) {
      const out = {};
      for (const id of Object.keys(src)) {
        if (active.nodes.has(id)) out[id] = src[id];
      }
      return out;
    }
    function flowActivityOnly(src) {
      const out = {};
      for (const id of Object.keys(src)) {
        if (active.flows.has(id)) out[id] = src[id];
      }
      return out;
    }

    // Transparency hint — count how many non-zero entries were excluded.
    let topNodesHidden = 0, topFlowsHidden = 0;
    if (activeOnly) {
      for (const id of Object.keys(agg.nodes)) {
        const n = agg.nodes[id];
        if (!active.nodes.has(id) && (n.errors + n.warnings) > 0) topNodesHidden++;
      }
      for (const id of Object.keys(agg.flows)) {
        const f = agg.flows[id];
        if (!active.flows.has(id) && (f.errors + f.warnings) > 0) topFlowsHidden++;
      }
    }

    let topNodes = [];
    let topFlows = [];
    if (nodeId) {
      const n = agg.nodes[nodeId];
      if (n) topNodes = [tagNode(nodeId, n)];
    } else if (flowId) {
      const flowNodes = {};
      for (const id of Object.keys(agg.nodes)) {
        if (agg.nodes[id].z === flowId) flowNodes[id] = agg.nodes[id];
      }
      const src = activeOnly ? nodeActivityOnly(flowNodes) : flowNodes;
      topNodes = topEntries(src, 10).map(e => tagNode(e.id, e));
      const f = agg.flows[flowId];
      if (f) topFlows = [tagFlow(flowId, f)];
    } else {
      const nodeSrc = activeOnly ? nodeActivityOnly(agg.nodes) : agg.nodes;
      const flowSrc = activeOnly ? flowActivityOnly(agg.flows) : agg.flows;
      topNodes = topEntries(nodeSrc, 10).map(e => tagNode(e.id, e));
      topFlows = topEntries(flowSrc, 10).map(e => tagFlow(e.id, e));
    }

    // Recent events inside the period — always returned. Two shapes:
    //   events[]  — flat, newest-first, up to 30. Used by the detail
    //               timeline where chronology matters.
    //   groups[]  — grouped by (entity + fingerprint + severity). Used by
    //               the "Recent issues" feed and the "Issue types" drill-down
    //               so repeated failures collapse into one readable card.
    // Both are derived from the same events-log scan; each event is tagged
    // with deletion flags for history-only context.
    const events   = [];
    const scoped   = [];
    for (const e of eventsLog) {
      if (e.ts < spec.cutoff) continue;
      if (nodeId && e.nodeId !== nodeId) continue;
      if (flowId && e.flowId !== flowId) continue;
      const tagged = {
        ...e,
        deletedNode: !!(e.nodeId && !active.nodes.has(e.nodeId)),
        deletedFlow: !!(e.flowId && !active.flows.has(e.flowId)),
      };
      scoped.push(tagged);
    }
    // Newest-first, capped at 30, for the flat timeline.
    for (let i = scoped.length - 1; i >= 0 && events.length < 30; i--) events.push(scoped[i]);
    const groups = buildGroups(scoped, spec.cutoff, active);

    // Period summary — same shape as the Live summary so the UI renders it
    // with the exact same card components. Scoped to the filter when active.
    // When filtered, also include first/last event timestamps (drives the
    // right-panel detail view).
    const summary = { errors: 0, warnings: 0, nodesAffected: 0, flowsAffected: 0 };
    if (nodeId || flowId) {
      let firstTs = Infinity, lastTs = 0, lastErrorTs = 0;
      for (const e of eventsLog) {
        if (e.ts < spec.cutoff) continue;
        if (nodeId && e.nodeId !== nodeId) continue;
        if (flowId && e.flowId !== flowId) continue;
        if (e.ts < firstTs) firstTs = e.ts;
        if (e.ts > lastTs)  lastTs  = e.ts;
        if (e.severity === "error" && e.ts > lastErrorTs) lastErrorTs = e.ts;
      }
      if (firstTs !== Infinity)  summary.firstTs = firstTs;
      if (lastTs    > 0)         summary.lastTs  = lastTs;
      if (lastErrorTs > 0)       summary.lastErrorTs = lastErrorTs;
    }
    if (nodeId) {
      for (const b of spec.source) {
        if (b.t < spec.cutoff) continue;
        const n = b.byNode[nodeId];
        if (n) { summary.errors += n.errors; summary.warnings += n.warnings; }
      }
      summary.nodesAffected = (summary.errors + summary.warnings) > 0 ? 1 : 0;
      const n = agg.nodes[nodeId];
      summary.flowsAffected = (n && n.z) ? 1 : 0;
    } else if (flowId) {
      // Read directly from the derived flow aggregate so the summary cannot
      // disagree with the rankings.
      const f = agg.flows[flowId];
      if (f) { summary.errors = f.errors; summary.warnings = f.warnings; }
      const scopedNodes = new Set();
      for (const id of Object.keys(agg.nodes)) {
        if (agg.nodes[id].z === flowId && (agg.nodes[id].errors + agg.nodes[id].warnings) > 0) {
          scopedNodes.add(id);
        }
      }
      summary.nodesAffected = scopedNodes.size;
      summary.flowsAffected = (summary.errors + summary.warnings) > 0 ? 1 : 0;
    } else {
      for (const b of spec.source) {
        if (b.t < spec.cutoff) continue;
        summary.errors   += b.errors;
        summary.warnings += b.warnings;
      }
      summary.nodesAffected = Object.values(agg.nodes)
        .filter(n => (n.errors + n.warnings) > 0).length;
      summary.flowsAffected = Object.values(agg.flows)
        .filter(f => (f.errors + f.warnings) > 0).length;
    }

    // Filter metadata — useful when the filtered entity is itself deleted,
    // so the chip can display the "(deleted)" marker.
    let filter = null;
    if (nodeId) filter = { kind: "node", id: nodeId, deleted: !active.nodes.has(nodeId) };
    else if (flowId) filter = { kind: "flow", id: flowId, deleted: !active.flows.has(flowId) };

    // Flow scope selector list — always returned regardless of the filter
    // currently applied. Includes deleted flows (with deleted: true) so the
    // dropdown can mark them. Sorted by error count desc.
    const flowNames = new Map();
    try {
      RED.nodes.eachNode((n) => {
        if (n && n.type === "tab" && n.id) flowNames.set(n.id, n.label || null);
      });
    } catch (e) {}
    const flowList = Object.keys(agg.flows).map((id) => ({
      flowId:   id,
      flowName: flowNames.get(id) || null,
      errors:   agg.flows[id].errors,
      warnings: agg.flows[id].warnings,
      deleted:  !active.flows.has(id),
    })).sort((a, b) => (b.errors - a.errors) || (b.warnings - a.warnings));

    res.json({
      range,
      granularity: spec.granularity,
      periodStart: spec.cutoff,
      summary,
      series, topNodes, topFlows, flowList, events, groups, filter,
      activeOnly,
      topNodesHidden,
      topFlowsHidden,
    });
  });

  // Reset all persistent telemetry state. Useful when testing a fix.
  RED.httpAdmin.post("/dslflow/telemetry/clear", canWrite, async (req, res) => {
    pending.clear();
    eventsLog     = [];
    hourlyBuckets = [];
    dailyBuckets  = [];
    dirty = true;
    try { await flush(); } catch (e) { /* best-effort */ }
    res.json({ ok: true });
  });

  // ── Usage (node-adoption introspection) ────────────────────────────────────
  // Computes which node types are deployed and how often, plus which custom
  // types are installed but unused. Snapshot only — reflects current flow
  // configuration, no time series, no event log involvement.
  const NON_USAGE_TYPES = new Set([
    "tab", "subflow", "subflow-input-tab", "comment", "unknown",
    "link in", "link out", "link call",
  ]);

  function getRegistryNodeList() {
    try {
      if (RED.nodes && RED.nodes.registry &&
          typeof RED.nodes.registry.getNodeList === "function") {
        return RED.nodes.registry.getNodeList() || [];
      }
    } catch (e) {}
    return [];
  }

  // typeName → { module, isCustom }
  function buildTypeRegistry() {
    const map = new Map();
    const list = getRegistryNodeList();
    for (const entry of list) {
      if (!entry || !entry.enabled) continue;
      const types = entry.types || [];
      const mod   = entry.module || "unknown";
      const isCustom = mod !== "node-red";
      for (const t of types) map.set(t, { module: mod, isCustom });
    }
    return map;
  }

  // Heuristic when the registry isn't introspectable — built-in node-red
  // types are short single/space-separated lowercase words; everything else
  // (slashes, dots, scopes) is treated as custom.
  function heuristicIsCustom(type) {
    return /[\/.@-]/.test(type);
  }

  function buildUsage() {
    const reg = buildTypeRegistry();
    // typeName → { count, flows: Set<flowId>, instances: [{nodeId, flowId, name}] }
    const typeStats = new Map();
    const flowNames = new Map();
    try {
      RED.nodes.eachNode((n) => {
        if (n && n.type === "tab" && n.id) flowNames.set(n.id, n.label || n.id);
      });
    } catch (e) {}

    try {
      RED.nodes.eachNode((n) => {
        if (!n || !n.type) return;
        if (NON_USAGE_TYPES.has(n.type)) return;
        let s = typeStats.get(n.type);
        if (!s) {
          s = { count: 0, flows: new Set(), instances: [] };
          typeStats.set(n.type, s);
        }
        s.count++;
        if (n.z) s.flows.add(n.z);
        s.instances.push({ id: n.id, flowId: n.z || null, name: n.name || null });
      });
    } catch (e) {}

    return { reg, typeStats, flowNames };
  }

  function classifyType(typeName, reg) {
    const r = reg.get(typeName);
    if (r) return { module: r.module, isCustom: r.isCustom };
    return { module: null, isCustom: heuristicIsCustom(typeName) };
  }

  // Aggregate persistent buckets in `range` into per-type and per-(flow,type)
  // executions / errors. Used by the Usage view to score runtime activity
  // alongside structural placement.
  //
  // Usage reflects CURRENT system state — runtime counters from deleted
  // nodes/flows are excluded so the per-type totals match the per-instance
  // list (which is also current-only). History keeps the deleted-node story
  // through its own collectAcrossBuckets path; this filter is Usage-specific.
  function aggregateRuntimeByType(range) {
    const spec   = rangeSpec(range || "today");
    const active = buildActiveSets();
    const byType = new Map();
    const byTypeFlow = new Map();
    for (const b of spec.source) {
      if (b.t < spec.cutoff) continue;
      for (const id of Object.keys(b.byNode)) {
        if (!active.nodes.has(id)) continue; // skip deleted instances
        const n  = b.byNode[id];
        const t  = n.type || "unknown";
        const fz = n.z || null;
        const ex = n.executions || 0;
        const er = n.errors || 0;
        if (!ex && !er) continue;
        let agg = byType.get(t);
        if (!agg) { agg = { executions: 0, errors: 0 }; byType.set(t, agg); }
        agg.executions += ex;
        agg.errors     += er;
        let perFlow = byTypeFlow.get(t);
        if (!perFlow) { perFlow = new Map(); byTypeFlow.set(t, perFlow); }
        const key = fz || "(no flow)";
        let pf = perFlow.get(key);
        if (!pf) { pf = { flowId: fz, executions: 0, errors: 0 }; perFlow.set(key, pf); }
        pf.executions += ex;
        pf.errors     += er;
      }
    }
    return { byType, byTypeFlow, spec, active };
  }

  // GET /dslflow/telemetry/usage[?range=...]  → summary + rankings + unused
  // GET /dslflow/telemetry/usage?type=<t>[&range=...] → per-flow breakdown
  RED.httpAdmin.get("/dslflow/telemetry/usage", canRead, (req, res) => {
    const filterType = req.query.type || null;
    const range      = req.query.range || "today";
    const u  = buildUsage();
    const rt = aggregateRuntimeByType(range);

    if (filterType) {
      const s   = u.typeStats.get(filterType);
      const cls = classifyType(filterType, u.reg);
      const rtTotals = rt.byType.get(filterType) || { executions: 0, errors: 0 };

      // Per-instance runtime aggregation for this type. Filters deleted
      // instances at the source so totals here match the per-type summary
      // tiles, both of which now exclude removed nodes.
      const rtByInstance = new Map();
      for (const b of rt.spec.source) {
        if (b.t < rt.spec.cutoff) continue;
        for (const id of Object.keys(b.byNode)) {
          if (!rt.active.nodes.has(id)) continue;
          const n = b.byNode[id];
          if (n.type !== filterType) continue;
          let e = rtByInstance.get(id);
          if (!e) { e = { executions: 0, errors: 0 }; rtByInstance.set(id, e); }
          e.executions += n.executions || 0;
          e.errors     += n.errors     || 0;
        }
      }

      // Structural instance list → merged with runtime counters. Only
      // currently-deployed instances are surfaced — "navigate to" requires
      // the instance to actually exist in the flows. Historical counters for
      // already-deleted instances remain available via the History tab.
      const instances = [];
      if (s) {
        for (const inst of s.instances) {
          const rti = rtByInstance.get(inst.id) || { executions: 0, errors: 0 };
          instances.push({
            id:         inst.id,
            name:       inst.name || null,
            flowId:     inst.flowId || null,
            flowName:   u.flowNames.get(inst.flowId) || null,
            executions: rti.executions,
            errors:     rti.errors,
          });
        }
      }
      instances.sort(function (a, b) {
        return (b.errors - a.errors) || (b.executions - a.executions);
      });

      return res.json({
        type:       filterType,
        module:     cls.module,
        isCustom:   cls.isCustom,
        range,
        count:      s ? s.count : 0,
        flowsUsing: s ? s.flows.size : 0,
        executions: rtTotals.executions,
        errors:     rtTotals.errors,
        instances,
      });
    }

    // List view — merge structural with runtime per type.
    let nodesInUse = 0;
    const distinctTypes = new Set();
    const customTypesInUse = new Set();
    const topNodes = [];
    for (const [type, s] of u.typeStats) {
      nodesInUse += s.count;
      distinctTypes.add(type);
      const cls = classifyType(type, u.reg);
      if (cls.isCustom) customTypesInUse.add(type);
      const rtt = rt.byType.get(type) || { executions: 0, errors: 0 };
      topNodes.push({
        type,
        module:    cls.module,
        isCustom:  cls.isCustom,
        count:     s.count,
        flows:     s.flows.size,
        executions: rtt.executions,
        errors:     rtt.errors,
      });
    }
    // Default sort by executions desc, then instances desc — runtime activity
    // is the more decision-relevant signal per the spec. Frontend may re-sort
    // client-side without another server call.
    topNodes.sort((a, b) =>
      (b.executions - a.executions) || (b.count - a.count));

    const unusedCustom = [];
    for (const [type, info] of u.reg) {
      if (NON_USAGE_TYPES.has(type)) continue;
      if (!info.isCustom) continue;
      if (u.typeStats.has(type)) continue;
      unusedCustom.push({ type, module: info.module });
    }
    unusedCustom.sort((a, b) => a.type.localeCompare(b.type));

    res.json({
      range,
      summary: {
        nodesInUse,
        distinctTypes:    distinctTypes.size,
        customTypesInUse: customTypesInUse.size,
        customTypesUnused: unusedCustom.length,
      },
      topNodes:     topNodes.slice(0, 25),
      unusedCustom: unusedCustom.slice(0, 25),
      registryAvailable: u.reg.size > 0,
    });
  });

  RED.log.info(
    "[dslflow-telemetry] ready — slow=" + SLOW_THRESHOLD_MS + "ms" +
    " · persist(" + STORE_DIR + "," +
    " events=" + eventsLog.length +
    ", hourly=" + hourlyBuckets.length +
    ", daily=" + dailyBuckets.length + ")"
  );
};
