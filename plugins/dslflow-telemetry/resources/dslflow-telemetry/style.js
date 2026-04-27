// style.js — CSS for the DSLFlow Telemetry sidebar. All selectors are in the
// .dsft-* namespace so they cannot collide with the Files plugin (.dsff-*) or
// with Node-RED's own styles.
(function () {
  if (document.getElementById("dsft-style")) return;
  const css = `
    /* ── Root layout ─────────────────────────────────────────────────────────── */
    .dsft-root {
      /* Scoped brand color — Node-RED's --red-ui-primary-background is the pane
         background, NOT the brand accent, so we reference our own token here. */
      --dsft-brand:       #6D28D9;
      --dsft-brand-hover: #5B21B6;
      --dsft-brand-ink:   #fff;

      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      height: 100%;
      overflow-y: auto;
      font-size: 13px;
      box-sizing: border-box;
    }

    /* ── Header (title + refresh) ────────────────────────────────────────────── */
    .dsft-hdr {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dsft-hdr-title {
      flex: 1 1 auto;
      font-weight: 600;
      font-size: 14px;
    }

    /* ── Summary grid ────────────────────────────────────────────────────────── */
    .dsft-summary {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }
    .dsft-stat {
      background: var(--red-ui-secondary-background-alt, #f0f0f0);
      padding: 8px 10px;
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      border-left: 3px solid transparent;
    }
    .dsft-stat-val {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.1;
    }
    .dsft-stat-label {
      font-size: 0.78em;
      opacity: 0.7;
      margin-top: 2px;
    }
    .dsft-stat-err  { border-left-color: #c0392b; }
    .dsft-stat-warn { border-left-color: #c68e17; }
    .dsft-stat-info { border-left-color: var(--dsft-brand); }

    /* ── Section headings ────────────────────────────────────────────────────── */
    .dsft-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .dsft-section h4 {
      margin: 0;
      font-size: 0.78em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.65;
    }
    .dsft-empty {
      padding: 14px;
      text-align: center;
      font-size: 0.85em;
      opacity: 0.5;
      font-style: italic;
    }

    /* ── Grouped-issue cards ─────────────────────────────────────────────────
       Collapses repeated occurrences of the same failure into one scannable
       card. Used in Live "Recent issues", History "Recent issues in this
       period", and the detail panel's "Issue types" section. */
    .dsft-group {
      padding: 6px 8px;
      background: var(--red-ui-secondary-background-alt, #f7f7f7);
      border-radius: 3px;
      border-left: 3px solid #999;
      margin-bottom: 4px;
    }
    .dsft-group.dsft-sev-error { border-left-color: #c0392b; }
    .dsft-group.dsft-sev-warn  { border-left-color: #c68e17; }
    .dsft-group.dsft-sev-info  { border-left-color: #2980b9; }
    .dsft-group.dsft-selected {
      background: var(--red-ui-secondary-background-alt, #f0ecf7);
      box-shadow: inset 3px 0 0 var(--dsft-brand);
    }
    .dsft-group-head {
      display: flex;
      gap: 8px;
      align-items: center;
      font-size: 0.78em;
      opacity: 0.85;
      flex-wrap: wrap;
    }
    .dsft-group-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 20px;
      padding: 0 6px;
      font-size: 0.95em;
      font-weight: 700;
      background: #c0392b;
      color: #fff;
      border-radius: 10px;
      font-family: monospace;
      flex-shrink: 0;
    }
    .dsft-group.dsft-sev-warn  .dsft-group-count { background: #c68e17; }
    .dsft-group.dsft-sev-info  .dsft-group-count { background: #2980b9; }
    .dsft-group-time {
      margin-left: auto;
      font-family: monospace;
      opacity: 0.7;
    }
    .dsft-group-label {
      margin-top: 4px;
      font-family: monospace;
      font-size: 0.88em;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .dsft-group-toggle {
      display: inline-block;
      margin-top: 4px;
      background: none;
      border: none;
      padding: 2px 0;
      font-size: 0.78em;
      color: var(--dsft-brand);
      cursor: pointer;
      font-family: inherit;
    }
    .dsft-group-toggle:hover { text-decoration: underline; }
    .dsft-group-occurrences {
      margin-top: 4px;
      padding-left: 8px;
      border-left: 2px solid var(--red-ui-secondary-background, #eee);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .dsft-group-occ {
      display: grid;
      grid-template-columns: 68px 1fr;
      gap: 6px;
      font-size: 0.78em;
      font-family: monospace;
      line-height: 1.35;
    }
    .dsft-group-occ-ts  { opacity: 0.6; }
    .dsft-group-occ-msg { word-break: break-word; }

    /* ── Recent issues list (flat, legacy) ───────────────────────────────── */
    .dsft-issues {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 280px;
      overflow-y: auto;
    }
    .dsft-issue {
      background: var(--red-ui-secondary-background-alt, #f7f7f7);
      padding: 6px 8px;
      border-radius: 3px;
      border-left: 3px solid #999;
    }
    .dsft-sev-error { border-left-color: #c0392b; }
    .dsft-sev-warn  { border-left-color: #c68e17; }
    .dsft-sev-info  { border-left-color: #2980b9; }
    .dsft-issue-head {
      display: flex;
      gap: 8px;
      align-items: center;
      font-size: 0.78em;
      opacity: 0.8;
      flex-wrap: wrap;
    }
    .dsft-issue-ts   { font-family: monospace; opacity: 0.75; }
    .dsft-issue-type { font-weight: 600; }
    .dsft-issue-id   { font-family: monospace; opacity: 0.55; }
    .dsft-issue-msg {
      margin-top: 3px;
      font-family: monospace;
      font-size: 0.85em;
      word-break: break-word;
      white-space: pre-wrap;
      max-height: 5.5em;
      overflow: hidden;
    }
    .dsft-issue-dur {
      display: inline-block;
      margin-left: auto;
      font-size: 0.78em;
      font-weight: 600;
      color: #c68e17;
    }

    /* ── Status footer ───────────────────────────────────────────────────────── */
    .dsft-status {
      margin-top: auto;
      padding-top: 4px;
      border-top: 1px solid var(--red-ui-secondary-background, #eee);
      font-size: 0.75em;
      opacity: 0.55;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .dsft-status-text { flex: 1 1 auto; }

    /* ── Top-level nav (Live / History) — segmented-control pattern ──────────── */
    .dsft-nav {
      display: inline-flex;
      gap: 2px;
      padding: 2px;
      background: var(--red-ui-secondary-background-alt, #eaeaea);
      border-radius: 6px;
    }
    .dsft-nav-btn {
      background: transparent;
      border: none;
      padding: 4px 14px;
      font-size: 0.88em;
      font-weight: 600;
      cursor: pointer;
      color: inherit;
      border-radius: 4px;
      line-height: 1.4;
    }
    .dsft-nav-btn:hover { background: rgba(0, 0, 0, 0.06); }
    .dsft-nav-btn-active,
    .dsft-nav-btn-active:hover {
      background: var(--dsft-brand);
      color: var(--dsft-brand-ink);
    }

    /* ── History view ────────────────────────────────────────────────────────── */
    .dsft-history {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .dsft-ranges {
      display: flex;
      gap: 4px;
    }
    .dsft-range-btn {
      background: transparent;
      border: 1px solid var(--red-ui-secondary-border-color, #ccc);
      padding: 4px 10px;
      font-size: 0.82em;
      cursor: pointer;
      border-radius: 3px;
      color: inherit;
    }
    .dsft-range-btn:hover { background: var(--red-ui-secondary-background-alt, #eee); }
    .dsft-range-btn-active,
    .dsft-range-btn-active:hover {
      background: var(--dsft-brand);
      color: var(--dsft-brand-ink);
      border-color: var(--dsft-brand);
    }

    /* ── Flow scope row (Row 3) ──────────────────────────────────────────────
       Dedicated row for the flow scope selector — separated from the time
       range row so the collapsed sidebar never crowds them together. */
    .dsft-flow-scope-bar {
      display: flex;
      align-items: stretch;
    }

    /* ── Flow scope selector ─────────────────────────────────────────────────
       Replaces the old "Top failing flows" section. A button shows the
       current scope; clicking opens a dropdown with all flows that had
       activity in the selected range, sorted by error count. */
    .dsft-flow-filter {
      position: relative;
      flex: 1 1 auto;
      min-width: 0;
    }
    .dsft-flow-filter-btn {
      background: transparent;
      border: 1px solid var(--red-ui-secondary-border-color, #ccc);
      padding: 4px 10px;
      font-size: 0.82em;
      cursor: pointer;
      border-radius: 3px;
      color: inherit;
      line-height: 1.4;
      width: 100%;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .dsft-flow-filter-btn .dsft-flow-filter-label {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dsft-flow-filter-btn:hover { background: var(--red-ui-secondary-background-alt, #eee); }
    .dsft-flow-filter-btn-active,
    .dsft-flow-filter-btn-active:hover {
      background: var(--dsft-brand);
      color: var(--dsft-brand-ink);
      border-color: var(--dsft-brand);
    }
    .dsft-flow-filter-label { font-weight: 600; }

    .dsft-flow-filter-menu {
      position: absolute;
      top: calc(100% + 2px);
      left: 0;
      z-index: 100;
      background: var(--red-ui-secondary-background, #fff);
      border: 1px solid var(--red-ui-secondary-border-color, #ccc);
      border-radius: 4px;
      min-width: 240px;
      max-width: 360px;
      max-height: 320px;
      overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
      padding: 4px 0;
    }
    .dsft-flow-filter-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 0.85em;
    }
    .dsft-flow-filter-item:hover {
      background: var(--red-ui-secondary-background-alt, #f0ecf7);
    }
    .dsft-flow-filter-item-active {
      background: #f0ecf7;
      box-shadow: inset 3px 0 0 var(--dsft-brand);
    }
    .dsft-flow-filter-item-name {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dsft-flow-filter-item-count {
      flex: 0 0 auto;
      font-family: monospace;
      font-size: 0.85em;
      color: #c0392b;
      font-weight: 600;
      white-space: nowrap;
    }
    .dsft-flow-filter-empty {
      padding: 12px;
      text-align: center;
      font-size: 0.82em;
      opacity: 0.5;
      font-style: italic;
    }

    /* Icon-sized toggle used historically — kept for any other consumers. */
    .dsft-icon-toggle {
      background: transparent;
      border: 1px solid var(--red-ui-secondary-border-color, #ccc);
      padding: 4px 8px;
      font-size: 0.82em;
      line-height: 1;
      cursor: pointer;
      border-radius: 3px;
      color: inherit;
    }
    .dsft-icon-toggle:hover { background: var(--red-ui-secondary-background-alt, #eee); }
    .dsft-icon-toggle-active,
    .dsft-icon-toggle-active:hover {
      background: var(--dsft-brand);
      color: var(--dsft-brand-ink);
      border-color: var(--dsft-brand);
    }

    /* Ranking section headings — space for the "+N deleted hidden" note. */
    .dsft-rank-heading {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .dsft-rank-hidden {
      font-size: 0.88em;
      font-weight: 500;
      text-transform: none;
      letter-spacing: 0;
      opacity: 0.6;
    }
    .dsft-rank-hidden:empty { display: none; }

    /* ── Collapse / Expand sidebar buttons — mutually exclusive.
         Collapse appears when this plugin has expanded the Node-RED sidebar;
         Expand appears when the sidebar is at its normal width. */
    .dsft-btn-collapse { display: none !important; }
    .dsft-root.dsft-sidebar-expanded .dsft-btn-collapse { display: inline-block !important; }
    .dsft-btn-expand { display: inline-block !important; }
    .dsft-root.dsft-sidebar-expanded .dsft-btn-expand { display: none !important; }

    /* ── Split view: left = overview, right = selected-entity detail ─────── */
    .dsft-history {
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex: 1 1 auto;
      min-height: 0;
    }
    .dsft-history.dsft-split-open {
      display: flex;
      flex-direction: row;
      gap: 14px;
      align-items: flex-start;
      /* takes the available height of the sidebar pane */
      flex: 1 1 auto;
      min-height: 0;
    }
    .dsft-history.dsft-split-open .dsft-hist-left {
      flex: 0 1 380px;
      min-width: 0;
      max-height: 100%;
      overflow-y: auto;
      padding-right: 4px;
    }
    .dsft-history.dsft-split-open .dsft-hist-right {
      flex: 1 1 auto;
      min-width: 280px;
      max-height: 100%;
      overflow-y: auto;
      padding-left: 14px;
      border-left: 1px solid var(--red-ui-secondary-border-color, #ddd);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    /* Default (collapsed) — left occupies everything; right is display:none */
    .dsft-hist-left { display: flex; flex-direction: column; gap: 12px; }
    .dsft-hist-right { display: none; }

    /* Narrow container: when the pane width is below the threshold, stack the
       two columns vertically so the split view keeps reading even when the
       user has collapsed the sidebar back to its original width. */
    .dsft-history.dsft-split-open.dsft-split-narrow {
      flex-direction: column;
      align-items: stretch;
    }
    .dsft-history.dsft-split-open.dsft-split-narrow .dsft-hist-left {
      flex: 0 0 auto;
      max-height: none;
      overflow-y: visible;
      padding-right: 0;
    }
    .dsft-history.dsft-split-open.dsft-split-narrow .dsft-hist-right {
      flex: 0 0 auto;
      max-height: none;
      overflow-y: visible;
      padding-left: 0;
      padding-top: 12px;
      border-left: none;
      border-top: 1px solid var(--red-ui-secondary-border-color, #ddd);
      min-width: 0;
    }

    /* Selection highlighting: applied to rows in rankings and the events list
       when they correspond to the currently-open detail entity. */
    .dsft-rank-row.dsft-selected,
    .dsft-issue.dsft-selected {
      background: var(--red-ui-secondary-background-alt, #f0ecf7);
      box-shadow: inset 3px 0 0 var(--dsft-brand);
    }

    /* Events in the left pane are clickable to open the detail view. */
    .dsft-issue-clickable { cursor: pointer; }
    .dsft-issue-clickable:hover { background: var(--red-ui-secondary-background-alt, #f0ecf7); }

    /* ── Detail pane ─────────────────────────────────────────────────────── */
    .dsft-detail-header {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-areas:
        "kind  close"
        "title close"
        "sub   sub";
      column-gap: 8px;
      row-gap: 2px;
      align-items: center;
    }
    .dsft-detail-kind {
      grid-area: kind;
      font-size: 0.72em;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--dsft-brand);
    }
    .dsft-detail-title {
      grid-area: title;
      margin: 0;
      font-size: 1.02em;
      font-weight: 700;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dsft-detail-sub {
      grid-area: sub;
      font-size: 0.82em;
      opacity: 0.65;
      font-family: monospace;
    }
    .dsft-detail-close {
      grid-area: close;
      background: transparent;
      border: none;
      font-size: 1.4em;
      line-height: 1;
      width: 24px; height: 24px;
      cursor: pointer;
      color: inherit;
      opacity: 0.55;
      border-radius: 3px;
      align-self: start;
    }
    .dsft-detail-close:hover {
      opacity: 1;
      background: var(--red-ui-secondary-background-alt, #eee);
    }
    .dsft-detail-status {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 7px;
      font-size: 0.7em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-radius: 9px;
      white-space: nowrap;
    }
    .dsft-detail-status-active  { background: #e0ead7; color: #426c1d; }
    .dsft-detail-status-deleted { background: #e7e3ee; color: #6D28D9; }
    .dsft-detail-status-custom  { background: #e7e3ee; color: #6D28D9; }

    .dsft-detail-summary {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
    }
    .dsft-detail-stat {
      background: var(--red-ui-secondary-background-alt, #f3f1f8);
      padding: 6px 8px;
      border-radius: 3px;
      display: flex;
      flex-direction: column;
    }
    .dsft-detail-stat-val {
      font-weight: 700;
      font-size: 0.98em;
      line-height: 1.1;
      font-family: monospace;
    }
    .dsft-detail-stat-label {
      font-size: 0.72em;
      opacity: 0.7;
      margin-top: 1px;
    }

    /* Compact day-grouped timeline */
    .dsft-timeline { display: flex; flex-direction: column; gap: 1px; }
    .dsft-timeline-day {
      margin-top: 6px;
      padding: 2px 4px;
      font-size: 0.72em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.55;
      border-bottom: 1px solid var(--red-ui-secondary-background, #eee);
    }
    .dsft-timeline-day:first-child { margin-top: 0; }
    .dsft-timeline-row {
      display: grid;
      grid-template-columns: 66px 1fr;
      gap: 8px;
      padding: 2px 4px;
      font-size: 0.82em;
    }
    .dsft-timeline-row:hover { background: var(--red-ui-secondary-background-alt, #f4f0fa); }
    .dsft-timeline-time { font-family: monospace; opacity: 0.7; }
    .dsft-timeline-msg  { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* ── Usage view ───────────────────────────────────────────────────────────
       Visually neutral / informational — no red alarm colors. The metric
       column uses violet to distinguish it from the error-red metric used
       in the History rankings. */
    .dsft-usage-row { cursor: pointer; }
    .dsft-rank-row-static { cursor: default; }
    .dsft-rank-row-static:hover { background: transparent; }
    .dsft-usage-metric {
      color: var(--dsft-brand);
      font-weight: 600;
      white-space: nowrap;
      justify-self: end;
      font-size: 0.85em;
    }
    .dsft-usage-badge {
      display: inline-block;
      padding: 1px 6px;
      font-size: 0.72em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-radius: 9px;
      background: #e7e3ee;
      color: var(--dsft-brand);
      white-space: nowrap;
    }

    /* Section header: title + sort selector inline */
    .dsft-usage-section-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      flex-wrap: wrap;
    }
    .dsft-usage-section-head h4 { margin: 0; }
    .dsft-built-in-hint {
      font-size: 0.74em;
      opacity: 0.55;
      font-weight: 500;
    }
    .dsft-built-in-hint:empty { display: none; }
    .dsft-built-in-btn { margin-left: auto; }
    .dsft-sort-bar {
      display: inline-flex;
      gap: 2px;
    }
    .dsft-sort-btn {
      background: transparent;
      border: 1px solid var(--red-ui-secondary-border-color, #ccc);
      padding: 2px 8px;
      font-size: 0.74em;
      cursor: pointer;
      border-radius: 3px;
      color: inherit;
      line-height: 1.4;
    }
    .dsft-sort-btn:hover { background: var(--red-ui-secondary-background-alt, #eee); }
    .dsft-sort-btn-active,
    .dsft-sort-btn-active:hover {
      background: var(--dsft-brand);
      color: var(--dsft-brand-ink);
      border-color: var(--dsft-brand);
    }

    /* Usage card — vertical layout: title row, intensity bar, footer counts.
       Execution count on the right of the title row is the prominent metric;
       structural counts in the small footer are the secondary signal. */
    .dsft-usage-card {
      padding: 6px 8px;
      background: var(--red-ui-secondary-background-alt, #f7f7f7);
      border-radius: 3px;
      border-left: 3px solid var(--dsft-brand);
      margin-bottom: 4px;
      cursor: pointer;
    }
    .dsft-usage-card:hover { background: #f0ecf7; }
    .dsft-usage-card.dsft-selected {
      box-shadow: inset 3px 0 0 var(--dsft-brand);
      background: #f0ecf7;
    }
    /* Built-in entries are de-emphasised so custom (DSL) nodes remain the
       visual focus when the user opts into the mixed view. */
    .dsft-usage-card-builtin { opacity: 0.65; border-left-color: #bbb; }
    .dsft-usage-card-builtin:hover { opacity: 1; }
    .dsft-usage-card-builtin .dsft-usage-card-exec-val { color: inherit; }
    .dsft-usage-badge-builtin {
      background: #e2e2e2;
      color: #555;
    }
    .dsft-usage-card-static { cursor: default; }
    .dsft-usage-card-static:hover { background: var(--red-ui-secondary-background-alt, #f7f7f7); }

    .dsft-usage-card-head {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .dsft-usage-card-title {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      gap: 8px;
      align-items: baseline;
      overflow: hidden;
    }
    .dsft-usage-card-type {
      font-weight: 700;
      font-size: 0.95em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dsft-usage-card-exec {
      flex: 0 0 auto;
      white-space: nowrap;
      font-family: monospace;
    }
    .dsft-usage-card-exec-val {
      font-size: 1.2em;
      font-weight: 700;
      color: var(--dsft-brand);
    }
    .dsft-usage-card-exec-label {
      font-size: 0.78em;
      opacity: 0.6;
      margin-left: 2px;
    }
    .dsft-usage-card-exec-muted .dsft-usage-card-exec-val,
    .dsft-usage-card-exec-muted {
      color: inherit;
      opacity: 0.55;
      font-size: 0.85em;
      font-weight: 500;
      font-style: italic;
    }
    .dsft-usage-card-module {
      font-family: monospace;
      font-size: 0.78em;
      opacity: 0.55;
      margin-top: 1px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Intensity bar — minimal, not a chart. Width proportional to executions
       relative to the largest entry in the visible list. */
    .dsft-usage-bar-wrap {
      margin-top: 5px;
      height: 4px;
      background: var(--red-ui-secondary-background, #eee);
      border-radius: 2px;
      overflow: hidden;
    }
    .dsft-usage-bar {
      height: 100%;
      background: var(--dsft-brand);
      border-radius: 2px;
      min-width: 1px;
    }

    .dsft-usage-card-foot {
      margin-top: 4px;
      font-size: 0.78em;
      opacity: 0.7;
      font-family: monospace;
    }

    /* ── Instance list (Usage detail panel) ──────────────────────────────────
       One card per node instance of the selected type. Left side: node label
       (primary) above the flow name (secondary). Right side: error count
       (prominent, red) above execution count (secondary). Clickable → jumps
       the editor to the instance via RED.view.reveal. */
    .dsft-instance-card {
      padding: 6px 8px;
      background: var(--red-ui-secondary-background-alt, #f7f7f7);
      border-radius: 3px;
      border-left: 3px solid var(--red-ui-secondary-border-color, #ccc);
      margin-bottom: 4px;
      cursor: pointer;
      transition: background 0.1s ease;
    }
    .dsft-instance-card:hover {
      background: #f0ecf7;
      border-left-color: var(--dsft-brand);
    }
    .dsft-instance-head {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .dsft-instance-names {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
    }
    .dsft-instance-label {
      font-weight: 600;
      font-size: 0.92em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dsft-instance-flow {
      font-size: 0.78em;
      opacity: 0.6;
      font-family: monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 1px;
    }
    .dsft-instance-metrics {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      white-space: nowrap;
    }
    .dsft-instance-err {
      font-family: monospace;
      line-height: 1.1;
    }
    .dsft-instance-err-val {
      font-size: 1.15em;
      font-weight: 700;
      color: #c0392b;
    }
    .dsft-instance-err-label {
      font-size: 0.72em;
      opacity: 0.7;
      margin-left: 2px;
    }
    .dsft-instance-err-zero .dsft-instance-err-val {
      color: inherit;
      opacity: 0.35;
      font-weight: 500;
    }
    .dsft-instance-exec {
      font-family: monospace;
      line-height: 1.1;
      margin-top: 1px;
      font-size: 0.82em;
      opacity: 0.75;
    }
    .dsft-instance-exec-val { font-weight: 600; }
    .dsft-instance-exec-label { margin-left: 2px; opacity: 0.75; }

    .dsft-instance-showall {
      margin-top: 6px;
      background: transparent;
      border: none;
      padding: 4px 6px;
      font-size: 0.82em;
      color: var(--dsft-brand);
      cursor: pointer;
      font-family: inherit;
    }
    .dsft-instance-showall:hover { text-decoration: underline; }

    /* Chronological "Activity by period" list — one row per bucket.
       Grid columns: [time label] [proportional bar] [counts]. Rows with no
       activity are subdued so the timeline is readable at a glance. */
    .dsft-period-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 240px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .dsft-period-row {
      display: grid;
      grid-template-columns: 56px 1fr auto;
      gap: 10px;
      align-items: center;
      padding: 3px 4px;
      font-size: 0.84em;
      border-radius: 3px;
    }
    .dsft-period-row:hover { background: var(--red-ui-secondary-background-alt, #f4f0fa); }
    .dsft-period-row-empty { opacity: 0.38; }
    .dsft-period-row-empty:hover { background: transparent; }

    .dsft-period-label {
      font-family: monospace;
      font-size: 0.92em;
      opacity: 0.78;
      white-space: nowrap;
    }

    /* Bar container is sized by total; segments are proportioned errors vs
       warnings inside it. Rounded ends keep short bars from looking stubby. */
    .dsft-period-bar {
      height: 8px;
      display: flex;
      border-radius: 4px;
      overflow: hidden;
      min-width: 2px;
    }
    .dsft-period-bar-seg-err  { background: #c0392b; height: 100%; }
    .dsft-period-bar-seg-warn { background: #c68e17; height: 100%; }

    .dsft-period-counts {
      display: flex;
      gap: 0;
      align-items: baseline;
      white-space: nowrap;
      font-size: 0.88em;
      justify-self: end;
    }
    .dsft-period-counts-err  { color: #c0392b; font-weight: 600; }
    .dsft-period-counts-warn { color: #c68e17; font-weight: 600; }
    .dsft-period-counts-sep  { opacity: 0.45; padding: 0 4px; }
    .dsft-period-counts-none { opacity: 0.35; }

    /* Clickable rows in the history ranking lists */
    .dsft-rank-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      padding: 5px 6px;
      font-size: 0.85em;
      align-items: baseline;
      border-bottom: 1px solid var(--red-ui-secondary-background, #eee);
      cursor: pointer;
    }
    .dsft-rank-row:hover { background: var(--red-ui-secondary-background-alt, #f0ecf7); }
    .dsft-rank-row-deleted { opacity: 0.75; }
    .dsft-rank-label {
      display: flex;
      gap: 6px;
      align-items: baseline;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dsft-rank-primary { font-weight: 600; }
    .dsft-rank-sub     { opacity: 0.6; font-size: 0.9em; }
    .dsft-rank-id      { font-family: monospace; opacity: 0.5; font-size: 0.85em; }
    .dsft-rank-metric {
      color: #c0392b;
      font-weight: 600;
      white-space: nowrap;
    }

    /* Deleted-node marker used in history rankings, drill-down events,
       and (via text) the filter chip. Flat pill style; no hover. */
    .dsft-deleted-badge {
      display: inline-block;
      padding: 1px 6px;
      font-size: 0.72em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-radius: 9px;
      background: #e7e3ee;
      color: #6D28D9;
      white-space: nowrap;
    }

    /* One-line explanation shown above the events list in the drill-down
       when the filtered node/flow no longer exists. */
    .dsft-deleted-note {
      padding: 6px 8px;
      margin-bottom: 6px;
      font-size: 0.82em;
      background: #f4f0fa;
      border-left: 3px solid #6D28D9;
      border-radius: 2px;
    }

    .dsft-history-section h4 {
      margin: 0 0 4px;
      font-size: 0.78em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.65;
    }
  `;
  const el = document.createElement("style");
  el.id = "dsft-style";
  el.textContent = css;
  document.head.appendChild(el);
})();
