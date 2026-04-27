// plugin.js — DSLFlow Telemetry sidebar plugin.
//
// Two views, selectable via a top-of-pane toggle:
//   • History — persistent aggregates + recent events from disk, scoped to
//               a selectable time range (Today / 7d / 30d).
//   • Usage   — current-flow node placement merged with runtime executions
//               for the same time range.
//
// Separation from the Files plugin: own scoped stylesheet (.dsft-*), own
// sidebar id, own HTTP admin namespace (/dslflow/telemetry/*). No shared code.

RED.plugins.registerPlugin("dslflow-telemetry", {
  onadd: function () {

    // ── Constants ─────────────────────────────────────────────────────────────
    var RANGES       = [
      { id: "today", label: "Today" },
      { id: "7d",    label: "Last 7 days" },
      { id: "30d",   label: "Last 30 days" },
    ];

    // ── State ─────────────────────────────────────────────────────────────────
    var view         = "history";     // "history" | "usage"  (default = History)
    var histRange    = "today";
    var histFlowFilter = null;       // null = "All flows", or a flowId
    var selected     = null;          // { kind, id, label, deleted } — drives right panel
    var tabShown     = false;
    // "User explicitly closed the detail" flags. While true, refresh paths
    // skip the top-of-list auto-selection so the user can sit in single-column
    // overview after collapsing. Reset on onshow so a fresh sidebar visit
    // returns to the split-view default.
    var closedHist   = false;
    var closedUsage  = false;

    // Shared across all DSLFlow plugins. `initialNarrow` is captured ONCE
    // (the first observed non-expanded width) and never updated. Collapse
    // always restores to it, so dragging past intermediate widths doesn't
    // corrupt the restore target.
    window.__dslflowSidebar = window.__dslflowSidebar || { initialNarrow: 0 };
    var sidebarState = window.__dslflowSidebar;

    // ── Common helpers ────────────────────────────────────────────────────────
    function fmtTs(ts) {
      var d = new Date(ts);
      var p = function (n) { return String(n).padStart(2, "0"); };
      return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    }
    function shortId(id) { return id ? "#" + id.slice(-6) : ""; }
    function api(method, path) {
      return $.ajax({
        method:    method,
        url:       path,
        headers:   { "Node-RED-API-Version": "v2" },
        xhrFields: { withCredentials: true },
      });
    }

    // ── DOM: outer shell ──────────────────────────────────────────────────────
    var $root    = $('<div class="dsft-root">');
    var $topbar  = $('<div class="dsft-hdr">');
    var $nav     = $('<div class="dsft-nav">');
    var $btnHist  = $('<button class="dsft-nav-btn dsft-nav-btn-active">Issues</button>');
    var $btnUsage = $('<button class="dsft-nav-btn">Usage</button>');
    $nav.append($btnHist, $btnUsage);
    var $btnRefresh  = $('<button class="red-ui-button" title="Refresh"><i class="fa fa-refresh"></i></button>');
    var $btnClear    = $('<button class="red-ui-button" title="Clear all collected telemetry"><i class="fa fa-eraser"></i></button>');
    // Collapse / Expand sidebar — mutually exclusive. Collapse appears when
    // we've expanded the sidebar (via tryExpandSidebar); Expand appears
    // when the sidebar is at its normal width. Both are styled identically
    // so the position of the "wide-or-narrow" control stays predictable.
    var $btnCollapse = $('<button class="red-ui-button dsft-btn-collapse" title="Collapse sidebar"><i class="fa fa-chevron-right"></i></button>');
    var $btnExpand   = $('<button class="red-ui-button dsft-btn-expand"   title="Expand sidebar"><i class="fa fa-chevron-left"></i></button>');
    $topbar.append($nav, $btnRefresh, $btnClear, $btnCollapse, $btnExpand);

    // ── DOM: history pane ─────────────────────────────────────────────────────
    // Visible from creation since History is the default view — avoids
    // jQuery's display-restore quirk on flex containers when toggling from
    // an initially hidden state.
    var $hist = $('<div class="dsft-history">');

    var $rangeBar = $('<div class="dsft-ranges">');
    var $rangeBtns = {};
    RANGES.forEach(function (r) {
      var $b = $('<button class="dsft-range-btn">').text(r.label);
      if (r.id === histRange) $b.addClass("dsft-range-btn-active");
      $b.on("click", function () {
        histRange = r.id;
        Object.keys($rangeBtns).forEach(function (k) {
          $rangeBtns[k].toggleClass("dsft-range-btn-active", k === r.id);
        });
        refreshHistory();
      });
      $rangeBtns[r.id] = $b;
      $rangeBar.append($b);
    });

    // Deleted nodes/flows are always excluded from rankings — there is no
    // user-facing toggle for this. Backend receives activeOnly=1 unconditionally.

    // Flow scope selector — replaces the old "Top failing flows" section.
    // Picks one flow and scopes the entire Issues view to it. "All flows"
    // is the default (no filter). Includes deleted flows with a badge.
    // Flow scope lives in its own dedicated row (Row 3) so it never competes
    // with the time range buttons (Row 2) for horizontal space in the
    // collapsed sidebar.
    var $flowScopeBar   = $('<div class="dsft-flow-scope-bar">');
    var $flowFilter     = $('<div class="dsft-flow-filter">');
    var $flowFilterBtn  = $('<button class="dsft-flow-filter-btn" type="button">');
    var $flowFilterIcon = $('<i class="fa fa-folder-o">');
    var $flowFilterLbl  = $('<span class="dsft-flow-filter-label">All flows</span>');
    var $flowFilterCaret = $('<i class="fa fa-caret-down">');
    $flowFilterBtn.append($flowFilterIcon, " ", $flowFilterLbl, " ", $flowFilterCaret);
    var $flowFilterMenu = $('<div class="dsft-flow-filter-menu">').hide();
    $flowFilter.append($flowFilterBtn, $flowFilterMenu);
    $flowScopeBar.append($flowFilter);

    var lastFlowList = [];

    function updateFlowFilterLabel() {
      if (!histFlowFilter) {
        $flowFilterLbl.text("All flows");
        $flowFilterBtn.removeClass("dsft-flow-filter-btn-active");
        return;
      }
      var f = lastFlowList.find(function (x) { return x.flowId === histFlowFilter; });
      var name = f && (f.flowName || ("flow " + shortId(f.flowId))) || "flow " + shortId(histFlowFilter);
      $flowFilterLbl.text("Flow: " + name);
      $flowFilterBtn.addClass("dsft-flow-filter-btn-active");
    }

    function closeFlowFilterMenu() {
      $flowFilterMenu.hide();
      $(document).off("mousedown.dsft-flow-filter");
    }

    function renderFlowFilterMenu() {
      $flowFilterMenu.empty();
      var $allItem = $('<div class="dsft-flow-filter-item">').text("All flows");
      if (!histFlowFilter) $allItem.addClass("dsft-flow-filter-item-active");
      $allItem.on("click", function () {
        applyFlowFilter(null);
        closeFlowFilterMenu();
      });
      $flowFilterMenu.append($allItem);

      if (!lastFlowList.length) {
        $flowFilterMenu.append($('<div class="dsft-flow-filter-empty">')
          .text("No flow activity in this range."));
        return;
      }
      lastFlowList.forEach(function (f) {
        var $item = $('<div class="dsft-flow-filter-item">');
        if (f.flowId === histFlowFilter) $item.addClass("dsft-flow-filter-item-active");
        var $name = $('<span class="dsft-flow-filter-item-name">');
        $name.text(f.flowName || ("flow " + shortId(f.flowId)));
        $item.append($name);
        if (f.deleted) {
          $item.append($('<span class="dsft-deleted-badge">').text("deleted"));
        }
        $item.append($('<span class="dsft-flow-filter-item-count">').text(
          (f.errors || 0) + " err"
        ));
        $item.on("click", function () {
          applyFlowFilter(f.flowId);
          closeFlowFilterMenu();
        });
        $flowFilterMenu.append($item);
      });
    }

    function applyFlowFilter(flowId) {
      if (histFlowFilter === flowId) return;
      histFlowFilter = flowId;
      // Switching scope invalidates the current node detail (it may not even
      // belong to the new flow). Clear it; auto-select picks the top node
      // within the new scope on refresh.
      selected = null;
      closedHist = false;
      updateFlowFilterLabel();
      refreshHistory();
    }

    $flowFilterBtn.on("click", function (ev) {
      ev.stopPropagation();
      if ($flowFilterMenu.is(":visible")) { closeFlowFilterMenu(); return; }
      renderFlowFilterMenu();
      $flowFilterMenu.show();
      // Close on outside click.
      setTimeout(function () {
        $(document).on("mousedown.dsft-flow-filter", function (e) {
          if (!$(e.target).closest($flowFilter).length) closeFlowFilterMenu();
        });
      }, 0);
    });

    // Period summary — same card shape as the Live summary
    var $histSummary = $('<div class="dsft-summary">');
    var $hSumErrors  = $('<div class="dsft-stat dsft-stat-err"><span class="dsft-stat-val">0</span><span class="dsft-stat-label">Errors in period</span></div>');
    var $hSumWarns   = $('<div class="dsft-stat dsft-stat-warn"><span class="dsft-stat-val">0</span><span class="dsft-stat-label">Warnings / slow</span></div>');
    var $hSumNodes   = $('<div class="dsft-stat"><span class="dsft-stat-val">0</span><span class="dsft-stat-label">Nodes affected</span></div>');
    var $hSumFlows   = $('<div class="dsft-stat"><span class="dsft-stat-val">0</span><span class="dsft-stat-label">Flows affected</span></div>');
    $histSummary.append($hSumErrors, $hSumWarns, $hSumNodes, $hSumFlows);

    // Activity by time — readable chronological list, one row per bucket
    var $activitySection = $('<div class="dsft-history-section">');
    var $activityTitle = $('<h4>Activity by hour</h4>');
    $activitySection.append($activityTitle);
    var $activityBody = $('<div class="dsft-period-list">');
    $activitySection.append($activityBody);

    function $rankHeading(label) {
      var $h = $('<h4 class="dsft-rank-heading">');
      $h.append($('<span>').text(label));
      $h.append($('<span class="dsft-rank-hidden">'));
      return $h;
    }

    var $topNodesSection = $('<div class="dsft-history-section">');
    var $topNodesHeading = $rankHeading("Top failing nodes");
    $topNodesSection.append($topNodesHeading);
    var $topNodes = $('<div>');
    $topNodesSection.append($topNodes);
    // "Top failing flows" section removed — flows are now a scope selector
    // in the range bar, not a competing ranked list.

    // Events section — always shown in history; title flips between
    // "Recent issues in this period" and "Related recent events" based on
    // whether a drill-down filter is active.
    var $eventsSection = $('<div class="dsft-history-section">');
    var $eventsTitle = $('<h4>Recent issues in this period</h4>');
    $eventsSection.append($eventsTitle);
    var $eventsBody = $('<div class="dsft-issues">');
    $eventsSection.append($eventsBody);

    // Split-view containers: left = overview (everything above), right =
    // detail panel for the selected node/flow. The right panel is hidden
    // whenever `selected` is null; the parent gets a `.dsft-split-open`
    // class that flips the layout from single-column to two-column.
    var $histLeft  = $('<div class="dsft-hist-left">');
    var $histRight = $('<div class="dsft-hist-right">').hide();

    $histLeft.append($rangeBar, $flowScopeBar, $histSummary, $activitySection, $topNodesSection, $eventsSection);
    $hist.append($histLeft, $histRight);

    // ── Usage view (third top-level tab) ─────────────────────────────────────
    // Mirrors the History split-view layout: left = lists (summary, top
    // used types, rare/unused), right = detail for the selected type.
    var $usage      = $('<div class="dsft-history">').hide();
    var $usageLeft  = $('<div class="dsft-hist-left">');
    var $usageRight = $('<div class="dsft-hist-right">').hide();

    // Range bar — same time model as History (Today / 7d / 30d). Applies to
    // runtime metrics (executions/errors); structural metrics are always now.
    var $uRangeBar  = $('<div class="dsft-ranges">');
    var $uRangeBtns = {};
    RANGES.forEach(function (r) {
      var $b = $('<button class="dsft-range-btn">').text(r.label);
      if (r.id === usageRange) $b.addClass("dsft-range-btn-active");
      $b.on("click", function () {
        usageRange = r.id;
        Object.keys($uRangeBtns).forEach(function (k) {
          $uRangeBtns[k].toggleClass("dsft-range-btn-active", k === r.id);
        });
        refreshUsage();
      });
      $uRangeBtns[r.id] = $b;
      $uRangeBar.append($b);
    });

    var $usageSummary = $('<div class="dsft-summary">');
    var $uSumNodes    = $('<div class="dsft-stat dsft-stat-info"><span class="dsft-stat-val">0</span><span class="dsft-stat-label">Nodes in use</span></div>');
    var $uSumTypes    = $('<div class="dsft-stat dsft-stat-info"><span class="dsft-stat-val">0</span><span class="dsft-stat-label">Distinct types</span></div>');
    var $uSumCustom   = $('<div class="dsft-stat dsft-stat-info"><span class="dsft-stat-val">0</span><span class="dsft-stat-label">Custom in use</span></div>');
    var $uSumUnused   = $('<div class="dsft-stat dsft-stat-info"><span class="dsft-stat-val">0</span><span class="dsft-stat-label">Custom not used</span></div>');
    $usageSummary.append($uSumNodes, $uSumTypes, $uSumCustom, $uSumUnused);

    var $uTopSection = $('<div class="dsft-history-section">');
    var $uTopHeader  = $('<div class="dsft-usage-section-head">');
    $uTopHeader.append('<h4>Most used nodes</h4>');

    // "+N built-in hidden" hint — populated by rerenderUsageLeft when the
    // toggle is OFF and the data set contains built-in entries.
    var $uBuiltInHint = $('<span class="dsft-built-in-hint">');
    $uTopHeader.append($uBuiltInHint);

    // Built-in toggle — same icon-toggle pattern as the History "Active only"
    // button. Default OFF (built-in types hidden from the list).
    var $uBuiltInBtn = $('<button class="dsft-icon-toggle dsft-built-in-btn" type="button">');
    $uBuiltInBtn.append('<i class="fa fa-cube"></i>');
    function syncBuiltInBtn() {
      $uBuiltInBtn
        .toggleClass("dsft-icon-toggle-active", usageShowBuiltIn)
        .attr("title", usageShowBuiltIn
          ? "Hide built-in node types"
          : "Show built-in nodes");
    }
    $uBuiltInBtn.on("click", function () {
      usageShowBuiltIn = !usageShowBuiltIn;
      syncBuiltInBtn();
      // If a built-in type is currently open in the detail panel and we're
      // about to hide built-ins, close the detail to keep state consistent.
      if (!usageShowBuiltIn && usageSelected && lastUsageData) {
        var hit = (lastUsageData.topNodes || []).find(function (it) {
          return it.type === usageSelected.type;
        });
        if (hit && !hit.isCustom) closeUsageDetail();
      }
      rerenderUsageLeft();
    });
    syncBuiltInBtn();
    $uTopHeader.append($uBuiltInBtn);
    $uTopSection.append($uTopHeader);
    var $uTopList = $('<div>');
    $uTopSection.append($uTopList);

    var $uUnusedSection = $('<div class="dsft-history-section">');
    $uUnusedSection.append('<h4>Custom nodes installed but not used</h4>');
    var $uUnusedList = $('<div>');
    $uUnusedSection.append($uUnusedList);

    $usageLeft.append($uRangeBar, $usageSummary, $uTopSection, $uUnusedSection);

    // Detail panel for a selected type
    var $uDetailHeader = $('<div class="dsft-detail-header">');
    var $uDetailClose  = $('<button class="dsft-detail-close" title="Close detail" type="button">&times;</button>');
    var $uDetailKind   = $('<span class="dsft-detail-kind">');
    var $uDetailTitle  = $('<h3 class="dsft-detail-title">');
    var $uDetailSub    = $('<div class="dsft-detail-sub">');
    var $uDetailBadge  = $('<span class="dsft-detail-status">');
    $uDetailHeader.append($uDetailClose, $uDetailKind, $uDetailTitle, $uDetailBadge, $uDetailSub);

    var $uDetailSummary = $('<div class="dsft-detail-summary">');
    var $uDSumExec      = $('<div class="dsft-detail-stat"><span class="dsft-detail-stat-val">0</span><span class="dsft-detail-stat-label">Executions in range</span></div>');
    var $uDSumErrors    = $('<div class="dsft-detail-stat"><span class="dsft-detail-stat-val">0</span><span class="dsft-detail-stat-label">Errors in range</span></div>');
    var $uDSumCount     = $('<div class="dsft-detail-stat"><span class="dsft-detail-stat-val">0</span><span class="dsft-detail-stat-label">Instances</span></div>');
    var $uDSumFlows     = $('<div class="dsft-detail-stat"><span class="dsft-detail-stat-val">0</span><span class="dsft-detail-stat-label">Flows using it</span></div>');
    $uDetailSummary.append($uDSumExec, $uDSumErrors, $uDSumCount, $uDSumFlows);

    var $uDetailInstSection = $('<div class="dsft-history-section">');
    $uDetailInstSection.append('<h4>Instances of this node</h4>');
    var $uDetailInstances = $('<div>');
    $uDetailInstSection.append($uDetailInstances);

    $usageRight.append($uDetailHeader, $uDetailSummary, $uDetailInstSection);
    $uDetailClose.on("click", function () { closeUsageDetail(); });

    $usage.append($usageLeft, $usageRight);

    // ── Status footer ─────────────────────────────────────────────────────────
    var $status     = $('<div class="dsft-status">');
    var $statusText = $('<span class="dsft-status-text">Loading…</span>');
    $status.append($statusText);

    $root.append($topbar, $hist, $usage, $status);

    // Render a list of grouped incidents. Each card collapses repeated
    // occurrences of the same failure into one row — scannable by default,
    // expandable to show the individual timestamps / variant messages.
    function renderGroupedIssues($into, groups, emptyText, opts) {
      opts = opts || {};
      $into.empty();
      if (!groups || !groups.length) {
        $into.append($('<div class="dsft-empty">').text(emptyText || "No issues to show."));
        return;
      }
      groups.forEach(function (g) {
        var $card = $('<div class="dsft-group">').addClass("dsft-sev-" + (g.severity || "info"));
        if (selected && (
          (selected.kind === "node" && g.nodeId === selected.id) ||
          (selected.kind === "flow" && g.flowId === selected.id)
        )) {
          $card.addClass("dsft-selected");
        }

        var $head = $('<div class="dsft-group-head">');
        $head.append($('<span class="dsft-group-count" title="Occurrences in this range">').text(g.count));
        var entityLabel = g.nodeType || "event";
        if (g.nodeName) entityLabel += " · " + g.nodeName;
        $head.append($('<span class="dsft-issue-type">').text(entityLabel));
        if (g.nodeId) $head.append($('<span class="dsft-issue-id">').text(shortId(g.nodeId)));
        if (g.deletedNode) $head.append($('<span class="dsft-deleted-badge">').text("deleted"));
        $head.append($('<span class="dsft-group-time">').text(fmtTs(g.lastTs)));
        $card.append($head);

        $card.append($('<div class="dsft-group-label">').text(g.label || ""));

        // Progressive disclosure: show occurrences on demand.
        if (g.occurrences && g.occurrences.length) {
          var hasMore  = g.count > 1;
          var occCount = g.occurrences.length;
          var totalN   = g.count;
          var $toggle  = $('<button class="dsft-group-toggle" type="button">');
          var toggleText = function (open) {
            if (!hasMore) return open ? "Hide detail ▲" : "Show detail ▼";
            if (totalN > occCount) {
              return open
                ? "Hide " + occCount + " of " + totalN + " occurrences ▲"
                : "Show " + occCount + " of " + totalN + " occurrences ▼";
            }
            return open ? "Hide occurrences ▲" : "Show " + occCount + " occurrences ▼";
          };
          $toggle.text(toggleText(false));

          var $occlist = $('<div class="dsft-group-occurrences">').hide();
          g.occurrences.forEach(function (occ) {
            var $occ = $('<div class="dsft-group-occ">');
            $occ.append($('<span class="dsft-group-occ-ts">').text(fmtTs(occ.ts)));
            if (occ.message) $occ.append($('<span class="dsft-group-occ-msg">').text(occ.message));
            $occlist.append($occ);
          });
          $toggle.on("click", function (ev) {
            ev.stopPropagation();
            var opening = !$occlist.is(":visible");
            $occlist.toggle(opening);
            $toggle.text(toggleText(opening));
          });
          $card.append($toggle, $occlist);
        }

        // Outside Live view, card click opens the detail panel.
        if (opts.clickable && (g.nodeId || g.flowId)) {
          $card.addClass("dsft-issue-clickable");
          $card.on("click", function (ev) {
            if ($(ev.target).closest(".dsft-group-toggle, .dsft-group-occurrences").length) return;
            if (g.nodeId) {
              var l = (g.nodeName || g.nodeType || "node") + " " + shortId(g.nodeId);
              selectEntity("node", g.nodeId, l, !!g.deletedNode);
            } else {
              selectEntity("flow", g.flowId, "flow " + shortId(g.flowId), !!g.deletedFlow);
            }
          });
        }

        $into.append($card);
      });
    }

    // Earlier iterations had a flat `renderIssues` helper and a Live-only
    // hotspots renderer; both have been retired. All issue rendering now
    // flows through `renderGroupedIssues` (History) or `renderTimeline`
    // (detail chronology).

    // ── History rendering ─────────────────────────────────────────────────────
    // Detail (right-panel) rendering and lifecycle are defined further down;
    // the functions `selectEntity(kind, id, label, deleted)` and `closeDetail()`
    // are referenced by the click handlers below.

    function fmtPeriodLabel(ts, gran) {
      var d = new Date(ts);
      var p = function (n) { return String(n).padStart(2, "0"); };
      if (gran === "hour") return p(d.getHours()) + ":00";
      // day — include short day-of-week when the range is ≤ 7 days so the
      // user can map weekdays quickly ("Mon 14"). For 30 days, MM/DD suffices.
      var dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
      if (histRange === "7d") return dow + " " + p(d.getDate());
      return p(d.getMonth() + 1) + "/" + p(d.getDate());
    }

    // Readable chronological "Activity by period" list — one row per bucket,
    // with the time label, a segmented bar (errors red + warnings amber), and
    // explicit numeric counts on the right. Empty buckets are kept in place so
    // the full timeline is visible, but styled subdued so the eye is drawn to
    // activity. This replaces the previous undifferentiated bar-chart.
    function renderActivity(series, gran) {
      $activityTitle.text(gran === "hour" ? "Activity by hour" : "Activity by day");
      $activityBody.empty();

      if (!series || !series.length) {
        $activityBody.append($('<div class="dsft-empty">').text("No history yet for this range."));
        return;
      }
      var max = 0;
      series.forEach(function (s) {
        var sum = (s.errors || 0) + (s.warnings || 0);
        if (sum > max) max = sum;
      });
      if (max === 0) {
        $activityBody.append($('<div class="dsft-empty">').text("No issues recorded in this period."));
        return;
      }

      series.forEach(function (s) {
        var total = (s.errors || 0) + (s.warnings || 0);
        var $row  = $('<div class="dsft-period-row">');
        if (!total) $row.addClass("dsft-period-row-empty");

        $row.append($('<span class="dsft-period-label">').text(fmtPeriodLabel(s.t, gran)));

        var $bar = $('<div class="dsft-period-bar">');
        if (total > 0) {
          var widthPct = (total / max * 100).toFixed(1);
          var errPct   = (s.errors / total * 100).toFixed(1);
          // One container sized by total; inside, an errors segment followed
          // by an implicit warnings segment (remainder).
          $bar.css("width", widthPct + "%");
          $bar.append($('<div class="dsft-period-bar-seg-err">').css("width", errPct + "%"));
          $bar.append($('<div class="dsft-period-bar-seg-warn">').css("width", (100 - errPct) + "%"));
        }
        $row.append($bar);

        var $counts = $('<span class="dsft-period-counts">');
        if (total === 0) {
          $counts.append($('<span class="dsft-period-counts-none">').text("—"));
        } else {
          if (s.errors) $counts.append($('<span class="dsft-period-counts-err">').text(s.errors + " err"));
          if (s.errors && s.warnings) $counts.append($('<span class="dsft-period-counts-sep">').text(" · "));
          if (s.warnings) $counts.append($('<span class="dsft-period-counts-warn">').text(s.warnings + " warn"));
        }
        $row.append($counts);

        $activityBody.append($row);
      });
    }

    function renderRanking($into, items, kind, emptyText) {
      $into.empty();
      if (!items || !items.length) {
        $into.append($('<div class="dsft-empty">').text(emptyText));
        return;
      }
      items.forEach(function (it) {
        var $row = $('<div class="dsft-rank-row">');
        if (it.deleted) $row.addClass("dsft-rank-row-deleted");
        var rowKind, rowId, rowLabel;
        var $label = $('<div class="dsft-rank-label">');
        if (kind === "node") {
          var primary = it.name || it.type || "unknown";
          $label.append($('<span class="dsft-rank-primary">').text(primary));
          if (it.name && it.type) {
            $label.append($('<span class="dsft-rank-sub">').text(it.type));
          }
          $label.append($('<span class="dsft-rank-id">').text(shortId(it.nodeId)));
          rowKind  = "node";
          rowId    = it.nodeId;
          rowLabel = primary + " " + shortId(it.nodeId);
        } else {
          $label.append($('<span class="dsft-rank-primary">').text("flow"));
          $label.append($('<span class="dsft-rank-id">').text(shortId(it.flowId)));
          rowKind  = "flow";
          rowId    = it.flowId;
          rowLabel = "flow " + shortId(it.flowId);
        }
        if (it.deleted) {
          $label.append($('<span class="dsft-deleted-badge">').text("deleted"));
        }
        $row.append($label);
        $row.append($('<span class="dsft-rank-metric">').text(
          it.errors + " err" + (it.warnings ? " · " + it.warnings + " warn" : "")
        ));
        if (selected && selected.kind === rowKind && selected.id === rowId) {
          $row.addClass("dsft-selected");
        }
        $row.on("click", function () {
          selectEntity(rowKind, rowId, rowLabel, !!it.deleted);
        });
        $into.append($row);
      });
    }

    // Left-panel fetch — always unfiltered (overview). The detail panel fetches
    // its own scoped data through refreshDetail(); the two never share a call.
    function refreshHistory() {
      $statusText.text("Loading history…");
      var q = "range=" + encodeURIComponent(histRange);
      // Always exclude deleted nodes/flows from rankings.
      q += "&activeOnly=1";
      if (histFlowFilter) q += "&flowId=" + encodeURIComponent(histFlowFilter);
      var p = api("GET", "dslflow/telemetry/history?" + q).then(function (r) {
        // Summary cards
        var s = r.summary || {};
        $hSumErrors.find(".dsft-stat-val").text(s.errors   || 0);
        $hSumWarns .find(".dsft-stat-val").text(s.warnings || 0);
        $hSumNodes .find(".dsft-stat-val").text(s.nodesAffected || 0);
        $hSumFlows .find(".dsft-stat-val").text(s.flowsAffected || 0);

        renderActivity(r.series || [], r.granularity);

        // Deleted-hidden hint removed — the filter is always on, so showing
        // the count would be noise.

        // Cache so we can re-render left rows locally when selection changes
        // without issuing another server call.
        lastLeftTopNodes = r.topNodes || [];
        lastLeftGroups   = r.groups   || [];
        lastFlowList     = r.flowList || [];

        // Update the flow scope label with the latest server-side metadata
        // (flow may have been renamed / deleted since the last response).
        updateFlowFilterLabel();

        renderRanking($topNodes, lastLeftTopNodes, "node",
          histFlowFilter
            ? "No failing nodes in this flow."
            : "No failing nodes in this range.");

        $eventsTitle.text(histFlowFilter
          ? "Recent issues in this flow"
          : "Recent issues in this period");
        renderGroupedIssues($eventsBody, lastLeftGroups,
          histFlowFilter
            ? "No issues recorded in this flow."
            : "No issues recorded in this period.",
          { clickable: true });

        var rangeLabel = "";
        for (var i = 0; i < RANGES.length; i++) {
          if (RANGES[i].id === histRange) { rangeLabel = RANGES[i].label; break; }
        }
        // Auto-select the top failing node (within the current flow scope)
        // so the split view always has something to show.
        if (!selected && !closedHist) {
          var firstNode = (r.topNodes || [])[0];
          if (firstNode) {
            var nLabel = (firstNode.name || firstNode.type || "node") + " " + shortId(firstNode.nodeId);
            selectEntity("node", firstNode.nodeId, nLabel, !!firstNode.deleted);
          }
        }

        $statusText.text("Issues · " + rangeLabel +
          (histFlowFilter ? " · scoped to flow" : "") +
          (selected ? " · viewing " + selected.kind : ""));
      }).catch(function (xhr) {
        var err = (xhr && xhr.responseJSON && xhr.responseJSON.error) ||
                  (xhr && xhr.statusText) || "error";
        $statusText.text("History load failed: " + err);
      });
      // If a detail panel is open, refresh it in parallel so both panes stay
      // consistent with the current range / activeOnly.
      if (selected) refreshDetail();
      return p;
    }

    // ── Right-panel detail view ───────────────────────────────────────────────
    // DOM for the detail pane. Populated on selectEntity(); hidden on closeDetail().
    var $dHeader       = $('<div class="dsft-detail-header">');
    var $dClose        = $('<button class="dsft-detail-close" title="Close detail" type="button">&times;</button>');
    var $dKind         = $('<span class="dsft-detail-kind">');
    var $dTitle        = $('<h3 class="dsft-detail-title">');
    var $dSub          = $('<div class="dsft-detail-sub">');
    var $dStatusBadge  = $('<span class="dsft-detail-status">');
    $dHeader.append($dClose, $dKind, $dTitle, $dStatusBadge, $dSub);

    var $dSummary = $('<div class="dsft-detail-summary">');
    var $dSumErrors  = $('<div class="dsft-detail-stat"><span class="dsft-detail-stat-val">0</span><span class="dsft-detail-stat-label">Errors in range</span></div>');
    var $dSumWarns   = $('<div class="dsft-detail-stat"><span class="dsft-detail-stat-val">0</span><span class="dsft-detail-stat-label">Warnings / slow</span></div>');
    var $dSumNodes   = $('<div class="dsft-detail-stat"><span class="dsft-detail-stat-val">0</span><span class="dsft-detail-stat-label">Nodes affected</span></div>');
    var $dSumFirst   = $('<div class="dsft-detail-stat"><span class="dsft-detail-stat-val">—</span><span class="dsft-detail-stat-label">First occurrence</span></div>');
    var $dSumLast    = $('<div class="dsft-detail-stat"><span class="dsft-detail-stat-val">—</span><span class="dsft-detail-stat-label">Last event</span></div>');
    $dSummary.append($dSumErrors, $dSumWarns, $dSumNodes, $dSumFirst, $dSumLast);

    var $dDeletedNote = $('<div class="dsft-deleted-note">').hide();

    var $dTimelineSection = $('<div class="dsft-history-section">');
    $dTimelineSection.append('<h4>Timeline</h4>');
    var $dTimeline = $('<div class="dsft-timeline">');
    $dTimelineSection.append($dTimeline);

    var $dEventsSection = $('<div class="dsft-history-section">');
    $dEventsSection.append('<h4>Issue types</h4>');
    var $dEvents = $('<div class="dsft-issues">');
    $dEventsSection.append($dEvents);

    $histRight.append($dHeader, $dDeletedNote, $dSummary, $dTimelineSection, $dEventsSection);

    $dClose.on("click", function () { closeDetail(); });

    function fmtFull(ts) {
      if (!ts) return "—";
      var d = new Date(ts);
      var p = function (n) { return String(n).padStart(2, "0"); };
      return p(d.getMonth() + 1) + "/" + p(d.getDate()) + " " +
             p(d.getHours()) + ":" + p(d.getMinutes());
    }
    function dayKey(ts) {
      var d = new Date(ts);
      return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    }
    function dayLabel(ts) {
      var d = new Date(ts);
      var today = new Date();
      var p = function (n) { return String(n).padStart(2, "0"); };
      if (dayKey(ts) === dayKey(today.getTime())) return "Today";
      var yest = new Date(today.getTime() - 86400000);
      if (dayKey(ts) === dayKey(yest.getTime())) return "Yesterday";
      return p(d.getMonth() + 1) + "/" + p(d.getDate());
    }

    // Render a compact day-grouped timeline of events (errors first). Shows
    // each event as a single line: HH:MM · severity label. The related-events
    // list below carries the full card presentation — this timeline is the
    // scannable "when" view.
    function renderTimeline(events) {
      $dTimeline.empty();
      var errs = (events || []).filter(function (e) { return e.severity === "error"; });
      if (!errs.length) {
        $dTimeline.append($('<div class="dsft-empty">').text("No errors recorded for this entity in range."));
        return;
      }
      // events is newest-first from backend; reverse to chronological for the
      // timeline (earliest at top), grouped by day.
      var chrono = errs.slice().reverse();
      var lastDay = null;
      chrono.forEach(function (e) {
        var k = dayKey(e.ts);
        if (k !== lastDay) {
          lastDay = k;
          $dTimeline.append($('<div class="dsft-timeline-day">').text(dayLabel(e.ts)));
        }
        var $row = $('<div class="dsft-timeline-row">');
        var d = new Date(e.ts);
        var p = function (n) { return String(n).padStart(2, "0"); };
        $row.append($('<span class="dsft-timeline-time">').text(
          p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
        ));
        var msg = e.message || "error";
        if (msg.length > 90) msg = msg.slice(0, 90) + "…";
        $row.append($('<span class="dsft-timeline-msg">').text(msg));
        $dTimeline.append($row);
      });
    }

    function refreshDetail() {
      if (!selected) return;
      var q = "range=" + encodeURIComponent(histRange) +
              (selected.kind === "node" ? "&nodeId=" : "&flowId=") +
              encodeURIComponent(selected.id);
      api("GET", "dslflow/telemetry/history?" + q).then(function (r) {
        // Refresh deletion state from server — the entity may have been
        // deleted between clicks.
        if (r.filter) selected.deleted = !!r.filter.deleted;

        var s = r.summary || {};
        $dKind.text(selected.kind === "node" ? "NODE" : "FLOW");

        // Header — title / subtitle / status
        if (selected.kind === "node") {
          var nodeInfo = (r.topNodes && r.topNodes[0]) || {};
          $dTitle.text(nodeInfo.name || nodeInfo.type || selected.label);
          var sub = [];
          if (nodeInfo.name && nodeInfo.type) sub.push(nodeInfo.type);
          sub.push(shortId(selected.id));
          if (nodeInfo.flowId) sub.push("flow " + shortId(nodeInfo.flowId));
          $dSub.text(sub.join(" · "));
        } else {
          $dTitle.text("flow " + shortId(selected.id));
          $dSub.text("");
        }
        if (selected.deleted) {
          $dStatusBadge.removeClass("dsft-detail-status-active")
                       .addClass("dsft-detail-status-deleted").text("deleted");
          $dDeletedNote.text("This " + selected.kind +
            " no longer exists in the current flows. Historical data preserved.").show();
        } else {
          $dStatusBadge.removeClass("dsft-detail-status-deleted")
                       .addClass("dsft-detail-status-active").text("active");
          $dDeletedNote.hide();
        }

        // Summary tiles. "Nodes affected" is only meaningful for flows.
        $dSumErrors.find(".dsft-detail-stat-val").text(s.errors || 0);
        $dSumWarns .find(".dsft-detail-stat-val").text(s.warnings || 0);
        $dSumNodes .toggle(selected.kind === "flow");
        if (selected.kind === "flow") {
          $dSumNodes.find(".dsft-detail-stat-val").text(s.nodesAffected || 0);
        }
        $dSumFirst.find(".dsft-detail-stat-val").text(fmtFull(s.firstTs));
        $dSumLast .find(".dsft-detail-stat-val").text(fmtFull(s.lastErrorTs || s.lastTs));

        renderTimeline(r.events || []);
        renderGroupedIssues($dEvents, r.groups || [],
          "No related events in this range.", { clickable: false });

        // Re-render left panel rows so the selected row picks up the highlight.
        rerenderLeft();
      }).catch(function (xhr) {
        var err = (xhr && xhr.responseJSON && xhr.responseJSON.error) ||
                  (xhr && xhr.statusText) || "error";
        $statusText.text("Detail load failed: " + err);
      });
    }

    // Sidebar expand / collapse — mirrors the Project Files pattern so the
    // two-column detail view gets enough horizontal room. Each plugin tracks
    // its own original width, so Files and Telemetry don't stomp on each other.
    function getSidebar() {
      var $s = $("#red-ui-sidebar");
      return $s.length ? $s : $(".red-ui-sidebar").first();
    }
    function setSidebarWidth($sidebar, width) {
      var sep  = document.getElementById("red-ui-sidebar-separator");
      var sepW = sep ? (sep.offsetWidth || 7) : 7;
      $sidebar[0].style.width = width + "px";
      var ws = document.getElementById("red-ui-workspace");
      var es = document.getElementById("red-ui-editor-stack");
      if (ws) ws.style.right = (width + sepW) + "px";
      if (es) es.style.right = (width + sepW + 1) + "px";
      RED.events.emit("sidebar:resize");
      requestAnimationFrame(function () {
        var $parent = $sidebar.parent();
        var newLeft = ($parent.outerWidth() || window.innerWidth) - width;
        $parent.children().each(function () {
          var cs = window.getComputedStyle(this);
          if (cs.position === "absolute" &&
              (cs.cursor === "col-resize" || cs.cursor === "ew-resize")) {
            this.style.left = (newLeft - this.offsetWidth / 2) + "px";
          }
        });
        $parent.children(".red-ui-panels-separator").each(function () {
          this.style.left = (newLeft - this.offsetWidth / 2) + "px";
        });
      });
    }
    function tryExpandSidebar() {
      var $sidebar = getSidebar();
      if (!$sidebar.length) return;
      var currentW = $sidebar.outerWidth() || 0;
      var canvasW  = (window.innerWidth || 1400) - currentW;
      var targetW  = Math.min(Math.floor(canvasW / 2), Math.floor(window.innerWidth * 0.85));
      if (targetW <= currentW) { syncSidebarExpansionClass(); return; }
      if (!sidebarState.initialNarrow) sidebarState.initialNarrow = currentW;
      setSidebarWidth($sidebar, targetW);
      syncSidebarExpansionClass();
    }
    function collapseSidebar() {
      var $sidebar = getSidebar();
      if (!$sidebar.length) return;
      var restoreW = sidebarState.initialNarrow ||
        Math.min(380, Math.floor((window.innerWidth || 1400) * 0.25));
      setSidebarWidth($sidebar, restoreW);
      syncSidebarExpansionClass();
    }

    // Width-driven button visibility. Threshold heuristic (≥ 40% of window,
    // 500 px floor). `initialNarrow` is captured ONCE, the first observed
    // non-expanded width, so collapse always restores to the sidebar's
    // original default — not to whatever intermediate drag width happened
    // to be the last "narrow" before crossing the threshold.
    function syncSidebarExpansionClass() {
      var $sidebar = getSidebar();
      if (!$sidebar.length) {
        $root.removeClass("dsft-sidebar-expanded");
        return;
      }
      var w = $sidebar.outerWidth() || 0;
      var threshold = Math.max(500, window.innerWidth * 0.4);
      var expanded = w >= threshold;
      if (!sidebarState.initialNarrow && w > 0 && !expanded) {
        sidebarState.initialNarrow = w;
      }
      $root.toggleClass("dsft-sidebar-expanded", expanded);
    }
    var _resizeObserverAttached = false;
    function ensureSidebarResizeObserver() {
      if (_resizeObserverAttached) return;
      var $sidebar = getSidebar();
      if (!$sidebar.length || typeof ResizeObserver === "undefined") return;
      _resizeObserverAttached = true;
      new ResizeObserver(function () { syncSidebarExpansionClass(); }).observe($sidebar[0]);
    }
    // Cross-plugin sync: NR emits "sidebar:resize" whenever the sidebar
    // width changes — including from the OTHER plugin's setSidebarWidth or
    // from the user dragging the divider. Listening here (regardless of
    // whether THIS tab is currently shown) keeps our class correct even
    // while we're hidden, so on tab switch the buttons are already accurate.
    RED.events.on("sidebar:resize", function () { syncSidebarExpansionClass(); });

    // Collapse button: close any open detail and shrink the sidebar back to
    // its original width. The user wanted a clean overview in the small
    // sidebar — not a stacked layout trying to cram the detail in too.
    $btnCollapse.on("click", function () {
      if (selected)           closeDetail();
      else if (usageSelected) closeUsageDetail();
      else                    collapseSidebar();
    });

    // Expand button: re-open the split view by selecting the top entry of
    // the current view. Uses cached data when available so the click feels
    // instant; falls back to a refresh if the cache is empty.
    $btnExpand.on("click", function () {
      if (view === "history") {
        closedHist = false;
        var n = lastLeftTopNodes && lastLeftTopNodes[0];
        if (n) {
          var nLabel = (n.name || n.type || "node") + " " + shortId(n.nodeId);
          selectEntity("node", n.nodeId, nLabel, !!n.deleted);
        } else {
          refreshHistory();
        }
      } else if (view === "usage") {
        closedUsage = false;
        var sorted = sortTopNodes((lastUsageData && lastUsageData.topNodes) || []);
        if (sorted.length) {
          selectUsageType(sorted[0].type);
        } else {
          refreshUsage();
        }
      }
    });

    // Watch the pane width so the split layout auto-stacks when the sidebar
    // is narrow — used both when the user manually collapses and when the
    // pane was never expanded in the first place.
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(function () {
        var w = $root.width() || 0;
        $hist.toggleClass("dsft-split-narrow", w < 560);
      }).observe($root[0]);
    }

    // Caches so we can re-render left rows with updated highlights without a
    // server round-trip when the selection changes.
    var lastLeftTopNodes = [];
    var lastLeftGroups   = [];

    function rerenderLeft() {
      renderRanking($topNodes, lastLeftTopNodes, "node",  "No failing nodes in this range.");
      renderGroupedIssues($eventsBody, lastLeftGroups,
        "No issues recorded in this period.", { clickable: true });
    }

    function selectEntity(kind, id, label, deleted) {
      closedHist = false;
      selected = { kind: kind, id: id, label: label, deleted: !!deleted };
      $hist.addClass("dsft-split-open");
      $histRight.show();
      tryExpandSidebar();
      refreshDetail();
      rerenderLeft();
    }
    function closeDetail() {
      closedHist = true;
      selected = null;
      $hist.removeClass("dsft-split-open");
      $histRight.hide();
      collapseSidebar();
      rerenderLeft();
    }

    // ── Usage view: state + render + select + close ──────────────────────────
    var usageSelected    = null;        // { type } when a row is selected
    var lastUsageData    = null;
    var usageRange       = "today";    // shared time-model with History
    var usageShowAllInst = false;      // progressive disclosure for instances
    var usageShowBuiltIn = false;      // hide built-in types from rankings (default)
    var INSTANCE_TOP_N   = 5;

    function fmtNumber(n) {
      n = n || 0;
      if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
      if (n >= 10000)   return (n / 1000).toFixed(0) + "k";
      if (n >= 1000)    return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
      return String(n);
    }

    // Row used in "Most used" and "Used in only one flow" sections. Vertical
    // layout: top line is type + execution count (the prominent metric), a
    // proportional intensity bar is the second line, and a small footer
    // surfaces structural counts + error count as secondary context.
    //
    // `maxExec` lets the renderer scale the intensity bar relative to the
    // largest executions value in the list (passed by the caller).
    function renderUsageRow(it, kind, maxExec) {
      var $row = $('<div class="dsft-usage-card">');
      if (usageSelected && usageSelected.type === it.type) $row.addClass("dsft-selected");
      // Built-in entries get reduced emphasis so the eye favours custom nodes
      // when the user opens the mixed view.
      if (it.isCustom === false) $row.addClass("dsft-usage-card-builtin");

      // Header line: type + custom/built-in badge ……… execution count
      var $head = $('<div class="dsft-usage-card-head">');
      var $title = $('<div class="dsft-usage-card-title">');
      $title.append($('<span class="dsft-usage-card-type">').text(it.type));
      if (it.isCustom) {
        $title.append($('<span class="dsft-usage-badge">').text("custom"));
      } else {
        $title.append($('<span class="dsft-usage-badge dsft-usage-badge-builtin">').text("built-in"));
      }
      $head.append($title);

      if (kind === "unused") {
        $head.append($('<span class="dsft-usage-card-exec dsft-usage-card-exec-muted">').text("not used"));
      } else {
        var $exec = $('<span class="dsft-usage-card-exec">');
        $exec.append($('<span class="dsft-usage-card-exec-val">').text(fmtNumber(it.executions || 0)));
        $exec.append($('<span class="dsft-usage-card-exec-label">').text(" exec"));
        $head.append($exec);
      }
      $row.append($head);

      // Module (subtitle) — small secondary text
      if (it.module) {
        $row.append($('<div class="dsft-usage-card-module">').text(it.module));
      }

      // Intensity bar — proportional to executions / maxExec. Skipped for
      // unused rows since there's nothing to show.
      if (kind !== "unused") {
        var pct = (maxExec > 0) ? Math.max(2, Math.round((it.executions || 0) / maxExec * 100)) : 0;
        var $barWrap = $('<div class="dsft-usage-bar-wrap">');
        var $bar     = $('<div class="dsft-usage-bar">').css("width", pct + "%");
        $barWrap.append($bar);
        $row.append($barWrap);
      }

      // Secondary counts — small footer
      var foot = [];
      foot.push((it.count || 0) + " inst");
      foot.push((it.flows || 0) + " flow" + ((it.flows === 1) ? "" : "s"));
      if (it.errors) foot.push(it.errors + " err");
      $row.append($('<div class="dsft-usage-card-foot">').text(foot.join(" · ")));

      $row.on("click", function () { selectUsageType(it.type); });
      return $row;
    }

    function sortTopNodes(arr) {
      // Built-in filter applied before sorting so ranking is computed only
      // over the visible subset. Ranking is fixed: executions desc, instances
      // as tiebreaker. Instances and flows remain visible per row but no
      // longer compete as top-level sort modes.
      var filtered = usageShowBuiltIn ? arr : arr.filter(function (it) {
        return it.isCustom;
      });
      return filtered.slice().sort(function (a, b) {
        return (b.executions || 0) - (a.executions || 0) ||
               (b.count || 0) - (a.count || 0);
      });
    }

    function rerenderUsageLeft() {
      var d = lastUsageData;
      if (!d) return;
      var s = d.summary || {};
      $uSumNodes.find(".dsft-stat-val").text(s.nodesInUse || 0);
      $uSumTypes.find(".dsft-stat-val").text(s.distinctTypes || 0);
      $uSumCustom.find(".dsft-stat-val").text(s.customTypesInUse || 0);
      $uSumUnused.find(".dsft-stat-val").text(s.customTypesUnused || 0);

      var allTop = d.topNodes || [];
      // Hidden-count hint — only relevant when the toggle is OFF.
      var builtInCount = 0;
      if (!usageShowBuiltIn) {
        for (var i = 0; i < allTop.length; i++) {
          if (!allTop[i].isCustom) builtInCount++;
        }
        $uBuiltInHint.text(builtInCount
          ? ("+" + builtInCount + " built-in hidden") : "");
      } else {
        $uBuiltInHint.text("");
      }
      // Self-heal: stale selection on a built-in entry while the toggle is
      // OFF should not leave a detail panel open for an inaccessible item.
      if (usageSelected && !usageShowBuiltIn) {
        var sel = allTop.find(function (it) { return it.type === usageSelected.type; });
        if (sel && !sel.isCustom) closeUsageDetail();
      }

      var topSorted = sortTopNodes(allTop);
      var maxExecTop = topSorted.reduce(function (m, it) {
        return Math.max(m, it.executions || 0);
      }, 0);

      $uTopList.empty();
      if (!topSorted.length) {
        $uTopList.append($('<div class="dsft-empty">').text("No nodes deployed yet."));
      } else {
        topSorted.forEach(function (it) {
          $uTopList.append(renderUsageRow(it, "top", maxExecTop));
        });
      }

      if (!d.registryAvailable) {
        $uUnusedSection.hide();
      } else {
        $uUnusedSection.show();
        $uUnusedList.empty();
        if (!d.unusedCustom || !d.unusedCustom.length) {
          $uUnusedList.append($('<div class="dsft-empty">').text("All installed custom nodes are in use."));
        } else {
          d.unusedCustom.forEach(function (it) {
            $uUnusedList.append(renderUsageRow(it, "unused", 0));
          });
        }
      }
    }

    function refreshUsage() {
      $statusText.text("Loading usage…");
      api("GET", "dslflow/telemetry/usage?range=" + encodeURIComponent(usageRange)).then(function (r) {
        lastUsageData = r;
        rerenderUsageLeft();
        var rangeLabel = "";
        for (var i = 0; i < RANGES.length; i++) {
          if (RANGES[i].id === usageRange) { rangeLabel = RANGES[i].label; break; }
        }
        $statusText.text("Usage · structural snapshot · runtime " + rangeLabel.toLowerCase());

        // Auto-select the top entry so the split view is always populated.
        // Uses the same client-side sort the rendered list applies. Skipped
        // when the user explicitly closed (closedUsage), so collapse stays
        // sticky until the next sidebar visit or a manual click.
        if (!usageSelected && !closedUsage) {
          var topSorted = sortTopNodes(r.topNodes || []);
          if (topSorted.length) selectUsageType(topSorted[0].type);
        } else if (usageSelected) {
          refreshUsageDetail();
        }
      }).catch(function (xhr) {
        var err = (xhr && xhr.responseJSON && xhr.responseJSON.error) ||
                  (xhr && xhr.statusText) || "error";
        $statusText.text("Usage load failed: " + err);
      });
    }

    // Clicking an instance jumps the editor to that node. RED.view.reveal
    // switches to the flow tab and flashes the node; the telemetry sidebar
    // stays open, preserving usageSelected / usageRange / sort state.
    function revealNode(nodeId) {
      try {
        if (RED.view && typeof RED.view.reveal === "function") {
          RED.view.reveal(nodeId);
        }
      } catch (e) { /* non-fatal */ }
    }

    function renderInstanceCard(inst) {
      var $row = $('<div class="dsft-instance-card">');
      var $head = $('<div class="dsft-instance-head">');
      var $left = $('<div class="dsft-instance-names">');
      $left.append($('<div class="dsft-instance-label">')
        .text(inst.name || shortId(inst.id)));
      $left.append($('<div class="dsft-instance-flow">')
        .text(inst.flowName ? inst.flowName : ("flow " + shortId(inst.flowId))));
      $head.append($left);

      var $metrics = $('<div class="dsft-instance-metrics">');
      var $err = $('<div class="dsft-instance-err">');
      $err.append($('<span class="dsft-instance-err-val">').text(inst.errors || 0));
      $err.append($('<span class="dsft-instance-err-label">').text(" err"));
      if (!inst.errors) $err.addClass("dsft-instance-err-zero");
      var $exec = $('<div class="dsft-instance-exec">');
      $exec.append($('<span class="dsft-instance-exec-val">').text(fmtNumber(inst.executions || 0)));
      $exec.append($('<span class="dsft-instance-exec-label">').text(" exec"));
      $metrics.append($err, $exec);
      $head.append($metrics);
      $row.append($head);

      $row.attr("title", "Click to locate this node in the editor");
      $row.on("click", function () { revealNode(inst.id); });
      return $row;
    }

    function renderInstances(list) {
      $uDetailInstances.empty();
      if (!list || !list.length) {
        $uDetailInstances.append($('<div class="dsft-empty">')
          .text("No instances of this type are currently deployed."));
        return;
      }
      var visible = usageShowAllInst ? list : list.slice(0, INSTANCE_TOP_N);
      visible.forEach(function (inst) {
        $uDetailInstances.append(renderInstanceCard(inst));
      });
      if (list.length > INSTANCE_TOP_N) {
        var $more = $('<button class="dsft-instance-showall" type="button">');
        $more.text(usageShowAllInst
          ? "Show top " + INSTANCE_TOP_N + " only"
          : "Show all " + list.length + " instances");
        $more.on("click", function () {
          usageShowAllInst = !usageShowAllInst;
          renderInstances(list);
        });
        $uDetailInstances.append($more);
      }
    }

    function refreshUsageDetail() {
      if (!usageSelected) return;
      var q = "type=" + encodeURIComponent(usageSelected.type) +
              "&range=" + encodeURIComponent(usageRange);
      api("GET", "dslflow/telemetry/usage?" + q).then(function (r) {
        $uDetailKind.text("NODE TYPE");
        $uDetailTitle.text(r.type || "");
        $uDetailSub.text(r.module || "");
        if (r.isCustom) {
          $uDetailBadge.removeClass("dsft-detail-status-active")
                       .addClass("dsft-detail-status-custom").text("custom");
        } else {
          $uDetailBadge.removeClass("dsft-detail-status-custom")
                       .addClass("dsft-detail-status-active").text("built-in");
        }
        $uDSumExec  .find(".dsft-detail-stat-val").text(fmtNumber(r.executions || 0));
        $uDSumErrors.find(".dsft-detail-stat-val").text(r.errors || 0);
        $uDSumCount .find(".dsft-detail-stat-val").text(r.count || 0);
        $uDSumFlows .find(".dsft-detail-stat-val").text(r.flowsUsing || 0);

        renderInstances(r.instances || []);
      }).catch(function (xhr) {
        var err = (xhr && xhr.responseJSON && xhr.responseJSON.error) ||
                  (xhr && xhr.statusText) || "error";
        $statusText.text("Usage detail failed: " + err);
      });
    }

    function selectUsageType(type) {
      closedUsage      = false;
      usageSelected    = { type: type };
      usageShowAllInst = false;      // each new type starts collapsed
      $usage.addClass("dsft-split-open");
      $usageRight.show();
      tryExpandSidebar();
      refreshUsageDetail();
      rerenderUsageLeft();
    }
    function closeUsageDetail() {
      closedUsage = true;
      usageSelected = null;
      $usage.removeClass("dsft-split-open");
      $usageRight.hide();
      collapseSidebar();
      rerenderUsageLeft();
    }

    // ── View switching ────────────────────────────────────────────────────────
    // Both views are split-view capable, so switching between them preserves
    // any open detail panel and the expanded sidebar width. Each view drives
    // its own data fetch on activation.
    function setView(v) {
      view = v;
      $btnHist .toggleClass("dsft-nav-btn-active", v === "history");
      $btnUsage.toggleClass("dsft-nav-btn-active", v === "usage");
      // Explicit display values — both panes use display:flex when visible,
      // so we set it directly rather than relying on jQuery's stored
      // pre-hide display state (which was unreliable across reloads).
      $hist .css("display", v === "history" ? "flex" : "none");
      $usage.css("display", v === "usage"   ? "flex" : "none");
      if (!tabShown) return;
      if (v === "history") refreshHistory();
      else if (v === "usage") refreshUsage();
    }

    // ── Event wiring ──────────────────────────────────────────────────────────
    $btnHist .on("click", function () { setView("history"); });
    $btnUsage.on("click", function () { setView("usage"); });

    $btnRefresh.on("click", function () {
      // Refresh both data sources so switching views after a click shows
      // up-to-date data without a second refresh.
      refreshHistory();
      refreshUsage();
    });
    $btnClear.on("click", function () {
      if (!window.confirm("Clear all persisted telemetry data?")) return;
      api("POST", "dslflow/telemetry/clear").done(function () {
        refreshHistory();
        if (view === "usage") refreshUsage();
      }).fail(function (xhr) {
        $statusText.text("Clear failed: " +
          ((xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText));
      });
    });

    // ── Sidebar registration ──────────────────────────────────────────────────
    RED.actions.add("dslflow-telemetry:show", function () {
      RED.sidebar.show("dslflow-telemetry");
    });

    RED.sidebar.addTab({
      id:           "dslflow-telemetry",
      name:         "Telemetry",
      label:        "Telemetry",
      iconClass:    "fa fa-heartbeat",
      content:      $root,
      action:       "dslflow-telemetry:show",
      enableOnEdit: true,
      onshow: function () {
        tabShown = true;
        // Reset "user closed" flags on every sidebar visit so a fresh open
        // returns to the split-view default. Within a session, an explicit
        // close stays sticky.
        closedHist = false;
        closedUsage = false;
        // Width-driven expand/collapse button sync — accurate regardless
        // of which plugin manipulated the sidebar.
        ensureSidebarResizeObserver();
        syncSidebarExpansionClass();
        setView(view); // resume whichever view was active
      },
      onhide: function () {
        tabShown = false;
        if (selected)      closeDetail();
        if (usageSelected) closeUsageDetail();
      },
    });
  },
});
