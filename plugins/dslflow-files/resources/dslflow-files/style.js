(function () {
  if (document.getElementById("dsff-style")) return;
  const css = `

    /* ── Tree rows ───────────────────────────────────────────────────────────── */
    .dsff-row {
      display: flex;
      align-items: center;
      padding: 4px 6px;
      cursor: pointer;
      user-select: none;
      border-radius: 3px;
      min-width: 0;
    }
    .dsff-row:hover    { background: var(--red-ui-secondary-background-alt, #f0f0f0); }
    .dsff-row-selected { background: var(--red-ui-secondary-background-alt, #e5e5e5); }
    .dsff-row-hidden        { opacity: 0.58; font-style: italic; }
    .dsff-row-protected-dir { cursor: not-allowed; }
    .dsff-row-name {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .dsff-mtime {
      flex: 0 0 auto;
      font-size: 0.78em;
      opacity: 0.55;
      white-space: nowrap;
      margin-left: 8px;
    }

    /* ── Tree sort header ────────────────────────────────────────────────────── */
    .dsff-tree-header {
      display: flex;
      align-items: center;
      padding: 3px 6px;
      font-size: 0.72em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.6;
      border-bottom: 1px solid var(--red-ui-secondary-background);
      user-select: none;
    }
    .dsff-tree-header span         { cursor: pointer; white-space: nowrap; }
    .dsff-tree-header span:hover   { opacity: 1; }
    .dsff-tree-header-name         { flex: 1 1 auto; }
    .dsff-tree-header-mod          { flex: 0 0 auto; text-align: right; padding-left: 8px; }

    /* ── Collapse-sidebar button (hidden until sidebar is expanded by us) ───── */
    .dsff-btn-collapse                         { display: none !important; }
    .dsff-sidebar-expanded .dsff-btn-collapse  { display: inline-block !important; }
    .dsff-btn-expand                           { display: inline-block !important; }
    .dsff-sidebar-expanded .dsff-btn-expand    { display: none !important; }

    /* ── Compact-only elements (hidden by default, shown by mode classes) ────── */
    .dsff-compact-folder,
    .dsff-btn-new-compact,
    .dsff-btn-back,
    .dsff-compact-filename,
    .dsff-editor-empty             { display: none; }

    /* ── Compact folder label ────────────────────────────────────────────────── */
    .dsff-compact-folder {
      flex: 1 1 auto;
      font-size: 0.88em;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.85;
    }

    /* ── Compact filename in editor toolbar ──────────────────────────────────── */
    .dsff-compact-filename {
      flex: 1 1 auto;
      font-size: 0.85em;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      opacity: 0.85;
    }

    /* ── Empty states ────────────────────────────────────────────────────────── */
    .dsff-tree-empty {
      padding: 24px 16px;
      text-align: center;
      font-size: 0.82em;
      opacity: 0.42;
      font-style: italic;
      user-select: none;
    }
    .dsff-editor-empty {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 12px;
      font-size: 0.88em;
      opacity: 0.38;
      pointer-events: none;
      user-select: none;
      text-align: center;
      padding: 24px;
    }
    .dsff-editor-empty i { font-size: 2.2em; }

    /* ── Compact "+" dropdown ────────────────────────────────────────────────── */
    .dsff-compact-menu {
      position: fixed;
      z-index: 10000;
      background: var(--red-ui-secondary-background, #fff);
      border: 1px solid var(--red-ui-secondary-border-color, #ccc);
      border-radius: 5px;
      min-width: 148px;
      box-shadow: 0 4px 18px rgba(0,0,0,.18);
      padding: 4px 0;
      font-size: 13px;
    }
    .dsff-compact-menu-item {
      padding: 7px 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 9px;
      white-space: nowrap;
    }
    .dsff-compact-menu-item:hover {
      background: var(--red-ui-primary-background, #e8f0fe);
    }
    .dsff-compact-menu-item .fa { width: 14px; text-align: center; opacity: 0.75; }

    /* ── Context menu (right-click on file/folder) ──────────────────────────── */
    .dsff-ctx-menu {
      position: fixed;
      z-index: 10000;
      background: var(--red-ui-secondary-background, #fff);
      border: 1px solid var(--red-ui-secondary-border-color, #ccc);
      border-radius: 5px;
      min-width: 160px;
      box-shadow: 0 4px 18px rgba(0,0,0,.18);
      padding: 4px 0;
      font-size: 13px;
    }
    .dsff-ctx-menu-label {
      padding: 5px 12px 4px;
      font-size: 0.8em;
      opacity: 0.5;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 200px;
      border-bottom: 1px solid var(--red-ui-secondary-border-color, #ddd);
      margin-bottom: 3px;
      cursor: default;
    }
    .dsff-ctx-menu-item {
      padding: 7px 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 9px;
      white-space: nowrap;
      font-weight: normal;
    }
    .dsff-ctx-menu-item:hover   { background: var(--red-ui-secondary-background-alt, #e8f0fe); }
    .dsff-ctx-menu-sep {
      height: 1px;
      background: var(--red-ui-secondary-border-color, #e0e0e0);
      margin: 3px 0;
    }
    .dsff-ctx-menu-item.dsff-ctx-danger       { color: #c0392b; }
    .dsff-ctx-menu-item.dsff-ctx-danger:hover { background: #fdf2f2; }
    .dsff-ctx-menu-item.dsff-ctx-disabled     { opacity: 0.38; cursor: not-allowed; }
    .dsff-ctx-menu-item.dsff-ctx-disabled:hover { background: none; }
    .dsff-ctx-menu-item .fa { width: 14px; text-align: center; opacity: 0.75; }

    /* ── Read-only file banner ───────────────────────────────────────────────── */
    .dsff-readonly-banner {
      display: none;
      align-items: center;
      gap: 7px;
      padding: 5px 10px;
      background: #fff8e1;
      border-bottom: 1px solid #ffe082;
      font-size: 0.82em;
      color: #6d4c00;
      flex-shrink: 0;
      user-select: none;
    }
    .dsff-readonly-banner .fa { opacity: 0.7; }
    .dsff-readonly-open .dsff-readonly-banner { display: flex; }

    /* ── Protected file indicator ────────────────────────────────────────────── */
    .dsff-protected-icon {
      font-size: 0.68em;
      opacity: 0.38;
      margin-left: 5px;
      flex-shrink: 0;
    }

    /* ── Drag-and-drop file move ─────────────────────────────────────────────── */
    .dsff-row[draggable="true"]         { cursor: grab; }
    .dsff-row[draggable="true"]:active  { cursor: grabbing; }
    .dsff-row-dragging                  { opacity: 0.4; }
    .dsff-row-drag-over {
      background: var(--red-ui-secondary-background-alt, #e8f0fe) !important;
      outline: 2px solid var(--red-ui-primary-background, #4285f4);
      outline-offset: -2px;
    }

    /* ── Drag-and-drop upload ────────────────────────────────────────────────── */
    .dsff-drop-overlay {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;
      background: rgba(66,133,244,0.10);
      border: 2px dashed var(--red-ui-primary-background, #4285f4);
      border-radius: 4px;
      z-index: 100;
      pointer-events: none;
      font-size: 0.88em;
      font-weight: 600;
      color: var(--red-ui-primary-background, #4285f4);
      text-align: center;
      padding: 16px;
    }
    .dsff-drop-overlay i { font-size: 2em; margin-bottom: 4px; }
    .dsff-drop-active .dsff-drop-overlay { display: flex; }

    /* ── Python venv bar ─────────────────────────────────────────────────────── */
    .dsff-venv-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      font-size: 0.76em;
      opacity: 0.8;
      border-bottom: 1px solid var(--red-ui-secondary-background);
      user-select: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dsff-venv-bar .fa-cube { opacity: 0.55; font-size: 0.95em; }
    .dsff-venv-bar.dsff-venv-ready .fa-cube { color: var(--red-ui-primary-background, #6e4db2); opacity: 0.8; }
    .dsff-venv-status {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dsff-venv-action {
      color: var(--red-ui-primary-background, #6e4db2);
      cursor: pointer;
      text-decoration: underline;
      flex: 0 0 auto;
    }
    .dsff-venv-action:hover { opacity: 0.85; }

    /* ── Split drag handle ───────────────────────────────────────────────────── */
    .dsff-split-handle {
      width: 8px;
      flex-shrink: 0;
      cursor: col-resize;
      background: var(--red-ui-secondary-background);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dsff-split-handle::before {
      content: "";
      width: 2px;
      height: 32px;
      border-radius: 999px;
      background: rgba(0,0,0,0.18);
    }
    .dsff-split-handle:hover::before { background: rgba(0,0,0,0.38); }
    .dsff-root-splitting             { cursor: col-resize; }
    .dsff-root-splitting .dsff-split-handle { background: var(--red-ui-secondary-background-alt, #dcdcdc); }

    /* ── Toggle-active button (e.g. show hidden files) ──────────────────────── */
    .red-ui-button.dsff-btn-active {
      background-color: var(--red-ui-secondary-background-alt, #e0e0e0) !important;
      box-shadow: inset 0 1px 3px rgba(0,0,0,0.15);
    }

    /* ── Dirty save button ───────────────────────────────────────────────────── */
    .red-ui-button.dsff-dirty:not(.disabled) {
      background-color: #d9534f;
      color: #fff !important;
      border-color: #b52b27;
      font-weight: 600;
    }
    .red-ui-button.dsff-dirty:not(.disabled):hover { filter: brightness(0.93); }

    /* ── Dirty compact filename marker ──────────────────────────────────────── */
    .dsff-compact-filename.dsff-name-dirty::before {
      content: "● ";
      color: #d9534f;
    }

    /* ── Unified modal dialog ────────────────────────────────────────────────── */
    .dsff-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 20000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dsff-modal {
      background: var(--red-ui-secondary-background, #fff);
      border: 1px solid var(--red-ui-secondary-border-color, #ccc);
      border-radius: 6px;
      padding: 20px 24px 18px;
      max-width: 420px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.22);
    }
    .dsff-modal-title {
      font-weight: 600;
      font-size: 0.95em;
      margin: 0 0 10px;
    }
    .dsff-modal-body {
      font-size: 0.88em;
      line-height: 1.5;
      margin: 0 0 16px;
      opacity: 0.85;
    }
    .dsff-modal-body strong { font-weight: 700; }
    /* Two-paragraph variant used by the unsaved-changes dialog */
    .dsff-modal-msg1 {
      font-size: 0.92em;
      font-weight: 500;
      margin: 0 0 8px;
      line-height: 1.5;
    }
    .dsff-modal-msg2 {
      font-size: 0.88em;
      opacity: 0.72;
      margin: 0 0 20px;
      line-height: 1.5;
    }
    .dsff-modal-msg1 strong,
    .dsff-modal-msg2 strong { font-weight: 700; }
    .dsff-modal-input {
      width: 100%;
      box-sizing: border-box;
      margin: 0 0 16px;
      padding: 6px 9px;
      border: 1px solid var(--red-ui-secondary-border-color, #ccc);
      border-radius: 3px;
      background: var(--red-ui-secondary-background, #fff);
      color: var(--red-ui-primary-text, #222);
      font-size: 0.92em;
      display: block;
    }
    .dsff-modal-input:focus {
      outline: none;
      border-color: var(--red-ui-primary-background, #6e4db2);
    }
    .dsff-modal-btns {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .dsff-modal-btns .red-ui-button { margin: 0; }
    .dsff-modal-btn-primary {
      color: var(--red-ui-primary-background, #6e4db2) !important;
      border-color: var(--red-ui-primary-background, #6e4db2) !important;
      font-weight: 600;
    }
    .dsff-modal-btn-primary:hover { background: var(--red-ui-secondary-background-alt, #f0f0f0) !important; }
    .dsff-modal-btn-danger {
      color: #c0392b;
      border-color: #c0392b;
    }
    .dsff-modal-btn-danger:hover { background: #fdf2f2; }

    /* ══════════════════════════════════════════════════════════════════════════
       Mode-based visibility
       Exactly one of dsff-compact / dsff-expanded is always on $root.
       dsff-browser-view / dsff-editor-view apply only in compact mode.
       dsff-file-open is set whenever a file has been loaded.
       ══════════════════════════════════════════════════════════════════════════ */

    /* ── COMPACT mode ────────────────────────────────────────────────────────── */

    /* Show compact-specific chrome */
    .dsff-compact .dsff-compact-folder  { display: block; }
    .dsff-compact .dsff-btn-new-compact { display: inline-block; }

    /* Hide modified column — free up horizontal space */
    .dsff-compact .dsff-mtime,
    .dsff-compact .dsff-tree-header-mod { display: none !important; }

    /* Hide all expanded-only toolbar elements */
    .dsff-compact .dsff-base-label,
    .dsff-compact .dsff-btn-new,
    .dsff-compact .dsff-btn-wrap,
    .dsff-compact .dsff-crumb           { display: none !important; }

    /* compact browser view: save lives in hidden $right — nothing to hide here */

    /* compact editor view: show back button, filename, and save */
    .dsff-compact.dsff-editor-view .dsff-btn-back          { display: inline-block; }
    .dsff-compact.dsff-editor-view .dsff-compact-filename  { display: block; }
    /* dsff-btn-save is naturally visible (no hide rule in compact mode) */

    /* ── EXPANDED mode ───────────────────────────────────────────────────────── */

    /* Hide compact-only elements */
    .dsff-expanded .dsff-btn-back,
    .dsff-expanded .dsff-compact-folder,
    .dsff-expanded .dsff-btn-new-compact,
    .dsff-expanded .dsff-compact-filename { display: none !important; }

    /* Editor controls default hidden in expanded mode; visibility is width-driven.
       The .dsff-wide class is toggled on $root by applyMode() when the available
       width is >= TOOLBAR_WIDE_THRESHOLD (see plugin.js). File-open state is
       deliberately NOT consulted here. */
    .dsff-expanded .dsff-btn-save,
    .dsff-expanded .dsff-btn-wrap,
    .dsff-expanded .dsff-crumb            { display: none; }

    .dsff-wide .dsff-btn-save  { display: inline-block; }
    .dsff-wide .dsff-btn-wrap  { display: inline-block; }
    .dsff-wide .dsff-crumb     { display: block; }

    /* Editor empty state: show only in expanded mode with no file open */
    .dsff-expanded:not(.dsff-file-open) .dsff-editor-empty { display: flex; }

  `;
  const el = document.createElement("style");
  el.id = "dsff-style";
  el.textContent = css;
  document.head.appendChild(el);
})();
