// plugin.js — Main file for the DSLFlow Project Files sidebar plugin.
//
// What lives here:  plugin bootstrap, DOM, state, layout, editor, tree, event wiring.
// What lives in rules.js:   isProtected / isProtectedDir / isReadOnly / langFromName
// What lives in dialogs.js: dsffModal / dsffPrompt / dsffConfirm
//
// Where future changes go:
//   new protected/read-only rule   → rules.js
//   new language extension         → rules.js → EXT_LANG
//   new modal variant              → dialogs.js
//   new sidebar layout tweak       → Section 5 (layout)
//   Monaco options / editor quirk  → Section 6 (editor)
//   new context menu item          → Section 7 (tree) + Section 8 (event wiring)
//   new backend route              → runtime/admin.js

RED.plugins.registerPlugin("dslflow-files", {
  onadd: function () {

    // ── 1. Constants ─────────────────────────────────────────────────────────
    var COMPACT_BREAKPOINT      = 480;   // <  this px → compact single-panel layout
    var TOOLBAR_WIDE_THRESHOLD  = 480;   // >= this px → width-gated toolbar buttons visible
    var VS_PREFIX               = "dsff-vs::";

    // ── 2. Plugin state ──────────────────────────────────────────────────────
    // View-state restore
    var restoreGuardUntil = 0;
    var posDebounceTimer  = null;

    // Hidden-file visibility — session-only, always OFF on page load.
    var showHidden = false;

    // Navigation
    var baseDir      = "";
    var projectRoot  = null; // locked navigation root (active project dir)
    var currentDir   = ".";
    var currentFile  = null;
    var selectedPath = null;

    // Tree display
    var sortField = "name";
    var sortDir   = "asc";
    var lastList  = null;

    // Layout
    var isCompact      = false;
    var isWide         = false;          // width-based toolbar visibility flag
    var compactView    = "browser";
    var savedLeftWidth = "38%";
    // Shared across all DSLFlow plugins. `initialNarrow` is captured ONCE
    // (the very first time we observe the sidebar in its non-expanded state)
    // and is the canonical restore target — so collapse always returns to
    // the sidebar's original default, not to whatever intermediate width
    // the user dragged through.
    window.__dslflowSidebar = window.__dslflowSidebar || { initialNarrow: 0 };
    var sidebarState   = window.__dslflowSidebar;

    // Context menu current target
    var ctxTarget = null; // { path, type, name }

    // Editor
    var dirty            = false;
    var fileReadOnly     = false; // true while a read-only file is open
    var savedText        = "";   // content at last open/save — dirty-check baseline
    var editorKind       = "none";
    var monacoEditor     = null;
    var editorModel      = null;
    var editorModelUri   = null;
    var suppressDirty    = false;
    var currentTextCache = "";
    var $textarea        = null;
    var hotkeyInstalled  = false;

    // Disk-change polling
    var lastDisk      = { mtime: null, size: null };
    var statTimer     = null;
    var onDiskChanged = false;

    // Internal drag (file row → folder row)
    var isDraggingSplit = false;
    var splitDrag       = {};
    var draggedFile     = null; // { path, name } while an internal drag is active

    // Python venv state — refreshed on project load / change.
    var hasVenv = false;

    // ── 3. DOM construction ──────────────────────────────────────────────────
    var $root = $("<div>").css({
      position: "relative", height: "100%",
      display: "flex", gap: "0",
    }).addClass("dsff-expanded");

    // Left panel — directory tree
    var $left = $("<div>").css({
      width: "38%", minWidth: "220px", height: "100%",
      display: "flex", flexDirection: "column",
      borderRight: "1px solid var(--red-ui-secondary-background)",
      flexShrink: 0,
    });

    var $leftHdr = $("<div>").css({
      padding: "6px", display: "flex", gap: "6px",
      alignItems: "center",
      borderBottom: "1px solid var(--red-ui-secondary-background)",
    });

    var $baseLabel = $("<span>").addClass("dsff-base-label").css({
      fontSize: "0.78em", opacity: 0.65,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      flex: "1 1 auto", minWidth: 0,
    });
    var $compactFolderLabel = $('<span class="dsff-compact-folder">');
    var $btnRefresh    = $('<button class="red-ui-button" title="Refresh"><i class="fa fa-refresh"></i></button>');
    var $btnHidden     = $('<button class="red-ui-button dsff-btn-hidden"><i class="fa"></i></button>');
    var $btnNewCompact = $('<button class="red-ui-button dsff-btn-new-compact" title="New…"><i class="fa fa-plus"></i></button>');
    var $btnCollapse   = $('<button class="red-ui-button dsff-btn-collapse" title="Collapse sidebar"><i class="fa fa-chevron-right"></i></button>');
    var $btnExpand     = $('<button class="red-ui-button dsff-btn-expand"   title="Expand sidebar"><i class="fa fa-chevron-left"></i></button>');
    $leftHdr.append($baseLabel, $compactFolderLabel, $btnRefresh, $btnHidden, $btnNewCompact, $btnCollapse, $btnExpand);

    // Python venv bar — one row under the header, shown only when a project is active.
    var $venvBar    = $('<div class="dsff-venv-bar">').hide();
    var $venvIcon   = $('<i class="fa fa-cube">');
    var $venvStatus = $('<span class="dsff-venv-status">');
    var $venvAction = $('<a href="#" class="dsff-venv-action">').hide();
    $venvBar.append($venvIcon, $venvStatus, $venvAction);

    var $treeHeader = $("<div>").addClass("dsff-tree-header");
    var $hdrName    = $('<span class="dsff-tree-header-name">Name</span>');
    var $hdrMod     = $('<span class="dsff-tree-header-mod">Modified</span>');
    $treeHeader.append($hdrName, $hdrMod);

    var $treeWrap    = $("<div>").css({ flex: "1 1 auto", overflow: "auto", position: "relative" });
    var $tree        = $("<div>").css({ padding: "4px" });
    var $treeEmpty   = $('<div class="dsff-tree-empty">No files here</div>');
    var $dropOverlay = $('<div class="dsff-drop-overlay"><i class="fa fa-cloud-upload"></i><span>Drop files to upload</span></div>');
    $treeWrap.append($tree, $treeEmpty, $dropOverlay);
    $left.append($leftHdr, $venvBar, $treeHeader, $treeWrap);

    var $split = $("<div>").addClass("dsff-split-handle");

    // Right panel — editor
    var $right = $("<div>").css({
      flex: "1 1 auto", height: "100%",
      display: "flex", flexDirection: "column", minWidth: 0,
    });

    var $toolbar = $("<div>").css({
      padding: "6px", display: "flex", gap: "6px",
      alignItems: "center", flexWrap: "wrap",
      borderBottom: "1px solid var(--red-ui-secondary-background)",
    });

    var $btnBack         = $('<button class="red-ui-button dsff-btn-back" title="Back to files"><i class="fa fa-arrow-left"></i></button>');
    var $compactFileName = $('<span class="dsff-compact-filename">');
    var $btnNew  = $('<button class="red-ui-button dsff-btn-new" title="New file or folder"><i class="fa fa-plus"></i> New <i class="fa fa-caret-down" style="font-size:0.8em;opacity:0.7"></i></button>');
    var $btnSave = $('<button class="red-ui-button dsff-btn-save" disabled><i class="fa fa-save"></i> Save</button>');
    var $btnWrap = $('<button class="red-ui-button dsff-btn-wrap" title="Toggle word wrap"><i class="fa fa-align-left"></i> Wrap</button>');
    var $crumb   = $("<div>").addClass("dsff-crumb").css({
      fontSize: "0.85em", opacity: 0.75,
      flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    });
    $toolbar.append($btnBack, $compactFileName, $btnNew, $btnSave, $crumb, $btnWrap);

    var $readOnlyBanner = $('<div class="dsff-readonly-banner"><i class="fa fa-lock"></i><span>This file is managed by Node-RED and cannot be edited here.</span></div>');
    var $editorHost     = $("<div>").css({ flex: "1 1 auto", position: "relative", minHeight: "200px" });
    var $editorEmpty    = $('<div class="dsff-editor-empty"><i class="fa fa-file-text-o"></i><span>Select a file to edit</span></div>');
    $editorHost.append($editorEmpty);

    var $statusBar = $("<div>").css({
      padding: "3px 8px",
      borderTop: "1px solid var(--red-ui-secondary-background)",
      fontSize: "0.82em", opacity: 0.75, whiteSpace: "nowrap",
      overflow: "hidden", textOverflow: "ellipsis",
    });
    $right.append($toolbar, $readOnlyBanner, $editorHost, $statusBar);
    $root.append($left, $split, $right);

    // Context menus (appended to body so they escape overflow:hidden containers)
    var $ctxMenu     = $('<div class="dsff-ctx-menu">').hide().appendTo(document.body);
    var $ctxLabel    = $('<div class="dsff-ctx-menu-label">');
    var $ctxCopyPath    = $('<div class="dsff-ctx-menu-item"><i class="fa fa-clipboard"></i> Copy path</div>');
    var $ctxDownload    = $('<div class="dsff-ctx-menu-item"><i class="fa fa-download"></i> Download</div>');
    var $ctxInstallPy   = $('<div class="dsff-ctx-menu-item"><i class="fa fa-cube"></i> Install Python libraries</div>');
    var $ctxInstallNode = $('<div class="dsff-ctx-menu-item"><i class="fa fa-cubes"></i> Install Node libraries</div>');
    var $ctxRename      = $('<div class="dsff-ctx-menu-item"><i class="fa fa-pencil"></i> Rename</div>');
    var $ctxSep         = $('<div class="dsff-ctx-menu-sep">');
    var $ctxDelete      = $('<div class="dsff-ctx-menu-item dsff-ctx-danger"><i class="fa fa-trash-o"></i> Delete</div>');
    $ctxMenu.append($ctxLabel, $ctxCopyPath, $ctxDownload, $ctxInstallPy, $ctxInstallNode, $ctxRename, $ctxSep, $ctxDelete);

    var $bgCtxMenu    = $('<div class="dsff-ctx-menu">').hide().appendTo(document.body);
    var $bgCtxNewFile = $('<div class="dsff-ctx-menu-item"><i class="fa fa-file-o"></i> New file</div>');
    var $bgCtxNewDir  = $('<div class="dsff-ctx-menu-item"><i class="fa fa-folder-o"></i> New folder</div>');
    $bgCtxMenu.append($bgCtxNewFile, $bgCtxNewDir);

    var $compactMenu = $('<div class="dsff-compact-menu">').hide().appendTo(document.body);
    var $menuNewFile = $('<div class="dsff-compact-menu-item"><i class="fa fa-file-o"></i> New file</div>');
    var $menuNewDir  = $('<div class="dsff-compact-menu-item"><i class="fa fa-folder-o"></i> New folder</div>');
    $compactMenu.append($menuNewFile, $menuNewDir);

    // ── 4. Small utilities ───────────────────────────────────────────────────
    function toast(msg, type) {
      try { RED.notify(msg, { type: type || "success", timeout: 1800 }); }
      catch (e) { RED.notify(msg, type || "success"); }
    }
    function notifyErr(msg) {
      try { RED.notify(msg, { type: "error", timeout: 2500 }); }
      catch (e) { RED.notify(msg, "error"); }
    }
    function setStatus(t) { $statusBar.text(t || ""); }
    function layoutEditorSoon() {
      if (editorKind === "monaco" && monacoEditor) {
        requestAnimationFrame(function () { try { monacoEditor.layout(); } catch (e) {} });
      }
    }

    // ── 5. Layout behavior ───────────────────────────────────────────────────
    function applyMode(force) {
      var width      = $root.width() || 0;
      var nowCompact = width > 0 && width < COMPACT_BREAKPOINT;
      var nowWide    = width > 0 && width >= TOOLBAR_WIDE_THRESHOLD;
      if (!force && nowCompact === isCompact && nowWide === isWide) return;
      isCompact = nowCompact;
      isWide    = nowWide;
      $root.toggleClass("dsff-compact",  isCompact)
           .toggleClass("dsff-expanded", !isCompact)
           .toggleClass("dsff-wide",     isWide);
      if (isCompact) {
        $root.removeClass("dsff-sidebar-expanded");
        sidebarState.expanded      = false;
        sidebarState.originalWidth = 0;
        sidebarState.targetWidth   = 0;
        applyCompactLayout();
      } else {
        $left.css({ display: "flex", width: savedLeftWidth, minWidth: "220px" });
        $split.css("display", "");
        $right.css({ display: "flex", width: "" });
        $root.removeClass("dsff-browser-view dsff-editor-view");
      }
      layoutEditorSoon();
    }

    function applyCompactLayout() {
      if (compactView === "editor" && currentFile) showEditorPanel();
      else showBrowserPanel();
    }

    function showBrowserPanel() {
      compactView = "browser";
      $left.css({ display: "flex", width: "100%", minWidth: "0" });
      $split.css("display", "none");
      $right.css("display", "none");
      $root.addClass("dsff-browser-view").removeClass("dsff-editor-view");
    }

    function showEditorPanel() {
      compactView = "editor";
      $left.css("display", "none");
      $split.css("display", "none");
      $right.css({ display: "flex", width: "100%" });
      $root.addClass("dsff-editor-view").removeClass("dsff-browser-view");
      updateCompactFileName();
      layoutEditorSoon();
    }

    function updateCompactFolderLabel() {
      var parts = (currentDir === "." ? [] : currentDir.split("/").filter(Boolean));
      $compactFolderLabel.text(
        parts.length ? parts[parts.length - 1] :
        (baseDir.split("/").filter(Boolean).pop() || "Project Files")
      );
    }

    function updateCompactFileName() {
      if (!currentFile) { $compactFileName.text("").removeClass("dsff-name-dirty"); return; }
      var parts = currentFile.split("/");
      $compactFileName.text(parts[parts.length - 1] || currentFile)
                      .toggleClass("dsff-name-dirty", dirty);
    }

    function showCompactMenu(ev) {
      hideCompactMenu();
      var btn  = $(ev.currentTarget);
      var off  = btn.offset();
      $compactMenu.css({ top: 0, left: 0 }).show();
      var menuW = $compactMenu.outerWidth();
      var menuH = $compactMenu.outerHeight();
      var x = off.left;
      var y = off.top + btn.outerHeight() + 2;
      if (x + menuW > window.innerWidth)  x = window.innerWidth  - menuW - 4;
      if (y + menuH > window.innerHeight) y = off.top - menuH - 2;
      $compactMenu.css({ top: y + "px", left: x + "px" }).show();
      setTimeout(function () { $(document).one("click.dsff-menu", hideCompactMenu); }, 0);
    }

    function hideCompactMenu() {
      $compactMenu.hide();
      $(document).off("click.dsff-menu");
    }

    function getSidebar() {
      var $s = $("#red-ui-sidebar");
      return $s.length ? $s : $(".red-ui-sidebar").first();
    }

    function setSidebarWidth($sidebar, width) {
      // Mirror NR's layout formulas: workspace.right = sidebarW + sepW,
      // editorStack.right = sidebarW + sepW + 1.
      var sep  = document.getElementById("red-ui-sidebar-separator");
      var sepW = sep ? (sep.offsetWidth || 7) : 7;

      $sidebar[0].style.width = width + "px";

      var ws = document.getElementById("red-ui-workspace");
      var es = document.getElementById("red-ui-editor-stack");
      if (ws) ws.style.right = (width + sepW) + "px";
      if (es) es.style.right = (width + sepW + 1) + "px";

      // "sidebar:resize" triggers handleWindowResize() in NR's tray.js.
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
        applyMode(false);
        layoutEditorSoon();
      });
    }

    // Re-applies the stored sidebar width. No-op when not expanded by us.
    function enforceLayout() {
      if (!sidebarState.expanded || !sidebarState.targetWidth) return;
      var $sidebar = getSidebar();
      if ($sidebar.length) setSidebarWidth($sidebar, sidebarState.targetWidth);
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

    // Width-driven button visibility. Threshold is a heuristic (≥ 40% of
    // window, 500 px floor). `initialNarrow` is captured ONCE — the first
    // narrow width observed — so collapse always restores to the original
    // default, not to whatever intermediate width the user dragged past
    // before crossing the "expanded" threshold.
    function syncSidebarExpansionClass() {
      var $sidebar = getSidebar();
      if (!$sidebar.length) {
        $root.removeClass("dsff-sidebar-expanded");
        return;
      }
      var w = $sidebar.outerWidth() || 0;
      var threshold = Math.max(500, window.innerWidth * 0.4);
      var expanded = w >= threshold;
      if (!sidebarState.initialNarrow && w > 0 && !expanded) {
        sidebarState.initialNarrow = w;
      }
      $root.toggleClass("dsff-sidebar-expanded", expanded);
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
    // from the user dragging the divider. By listening here (regardless of
    // whether THIS tab is currently shown), our class stays correct even
    // while we're hidden, so when the user switches to us the buttons are
    // already accurate.
    RED.events.on("sidebar:resize", function () { syncSidebarExpansionClass(); });

    // ── 6. Editor behavior ───────────────────────────────────────────────────

    // View-state persistence (scroll position + cursor per file)
    function vsKey(rel) { return VS_PREFIX + (rel || ""); }
    function vsGet(k)   { try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
    function vsSet(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

    function ignoreChanges() { return Date.now() < restoreGuardUntil; }
    function startGuard(ms)  { restoreGuardUntil = Date.now() + (ms || 800); }

    function saveViewState() {
      if (!currentFile || ignoreChanges()) return;
      if (editorKind === "monaco" && monacoEditor) {
        try {
          var top = monacoEditor.getScrollTop();
          if (typeof top !== "number" || top < 0) return;
          vsSet(vsKey(currentFile), {
            kind:       "monaco",
            viewState:  monacoEditor.saveViewState() || null,
            scrollTop:  top,
            scrollLeft: monacoEditor.getScrollLeft(),
          });
        } catch (e) {}
      } else if (editorKind === "textarea" && $textarea) {
        var el = $textarea[0];
        if (!el) return;
        vsSet(vsKey(currentFile), {
          kind:           "textarea",
          scrollTop:      el.scrollTop || 0,
          selectionStart: el.selectionStart || 0,
          selectionEnd:   el.selectionEnd   || 0,
        });
      }
    }

    function scheduleRemember() {
      if (posDebounceTimer) clearTimeout(posDebounceTimer);
      posDebounceTimer = setTimeout(saveViewState, 160);
    }

    function restorePositionFor(relPath, opts) {
      if (!relPath) return;
      var st      = vsGet(vsKey(relPath));
      if (!st) return;
      var retries = (opts && opts.retries) || 12;
      var delay   = (opts && opts.delay)   || 60;
      var attempt = 0;
      startGuard((opts && opts.guardMs) || 800);
      (function tryApply() {
        attempt++;
        var ok = false;
        try {
          if (st.kind === "monaco" && editorKind === "monaco" && monacoEditor) {
            if (st.viewState) {
              monacoEditor.restoreViewState(st.viewState);
              monacoEditor.focus();
            } else {
              if (typeof st.scrollTop  === "number" && st.scrollTop  >= 0) monacoEditor.setScrollTop(st.scrollTop);
              if (typeof st.scrollLeft === "number" && st.scrollLeft >= 0) monacoEditor.setScrollLeft(st.scrollLeft);
            }
            ok = true;
          } else if (st.kind === "textarea" && editorKind === "textarea" && $textarea) {
            var el = $textarea[0];
            if (el) {
              el.scrollTop = st.scrollTop || 0;
              if (typeof st.selectionStart === "number") {
                el.selectionStart = st.selectionStart;
                el.selectionEnd   = st.selectionEnd || st.selectionStart;
              }
              ok = true;
            }
          }
        } catch (e) {}
        if (!ok && attempt < retries) setTimeout(tryApply, delay);
      })();
    }

    // Monaco loader
    function monacoReady() {
      return new Promise(function (resolve, reject) {
        if (window.monaco && window.monaco.editor) { resolve(window.monaco); return; }
        if (!window.require) { reject(new Error("AMD loader not available")); return; }
        try {
          window.require(["vs/editor/editor.main"], function () {
            window.monaco && window.monaco.editor
              ? resolve(window.monaco)
              : reject(new Error("Monaco did not initialise"));
          });
        } catch (e) { reject(e); }
      });
    }

    function installHotkey() {
      if (hotkeyInstalled) return;
      hotkeyInstalled = true;
      $editorHost[0].addEventListener("keydown", function (ev) {
        var isS = ev.key === "s" || ev.key === "S" || ev.keyCode === 83;
        if ((ev.ctrlKey || ev.metaKey) && isS) {
          if (!currentFile) return;
          ev.preventDefault();
          ev.stopPropagation();
          doSave();
        }
      }, true);
    }

    async function ensureEditorReady() {
      if (editorKind === "monaco"   && monacoEditor) return "monaco";
      if (editorKind === "textarea" && $textarea)    return "textarea";

      try {
        await monacoReady();
        monacoEditor = window.monaco.editor.create($editorHost[0], {
          value: "", language: "plaintext",
          automaticLayout: true,
          minimap: { enabled: false },
          wordWrap: dsffWrapEnabled() ? "on" : "off",
        });
        editorModelUri = window.monaco.Uri.parse("inmemory://dsff/current");
        editorModel    = window.monaco.editor.createModel("", "plaintext", editorModelUri);
        monacoEditor.setModel(editorModel);
        installHotkey();

        monacoEditor.onDidChangeModelContent(function () {
          if (suppressDirty) { try { currentTextCache = monacoEditor.getValue(); } catch (e) {} return; }
          try { currentTextCache = monacoEditor.getValue(); } catch (e) {}
          syncDirty();
        });
        if (typeof monacoEditor.onDidScrollChange === "function") {
          monacoEditor.onDidScrollChange(function () { if (!ignoreChanges()) scheduleRemember(); });
        }
        if (typeof monacoEditor.onDidChangeCursorPosition === "function") {
          monacoEditor.onDidChangeCursorPosition(function () { if (!ignoreChanges()) scheduleRemember(); });
        }
        editorKind = "monaco";
        layoutEditorSoon();
        return "monaco";
      } catch (_) {
        $textarea = $("<textarea>").css({
          position: "absolute", inset: "0", width: "100%", height: "100%",
          fontFamily: "monospace", fontSize: "12px",
          padding: "8px", boxSizing: "border-box", resize: "none",
          wrap: dsffWrapEnabled() ? "soft" : "off",
        });
        $editorHost.css("position", "relative").empty().append($textarea);
        installHotkey();
        $textarea.on("input",  function () { syncDirty(); if (!ignoreChanges()) scheduleRemember(); });
        $textarea.on("scroll", function () { if (!ignoreChanges()) scheduleRemember(); });
        editorKind = "textarea";
        return "textarea";
      }
    }

    function setEditorContent(text, filename) {
      if (editorKind === "monaco" && monacoEditor && window.monaco) {
        var lang = langFromName(filename || "");
        if (!editorModel || editorModel.isDisposed()) {
          editorModel = window.monaco.editor.createModel(text || "", lang, editorModelUri);
          monacoEditor.setModel(editorModel);
        } else {
          window.monaco.editor.setModelLanguage(editorModel, lang);
        }
        suppressDirty = true;
        try { editorModel.setValue(String(text || "")); } finally { suppressDirty = false; }
        currentTextCache = String(text || "");
        layoutEditorSoon();
        restorePositionFor(currentFile || filename, { retries: 14, delay: 60, guardMs: 900 });
      } else if (editorKind === "textarea" && $textarea) {
        $textarea.val(text || "");
        restorePositionFor(currentFile || filename, { retries: 10, delay: 60, guardMs: 700 });
      }
    }

    function getEditorContent() {
      if (editorKind === "monaco"   && monacoEditor) return monacoEditor.getValue();
      if (editorKind === "textarea" && $textarea)    return $textarea.val();
      return "";
    }

    function applyWrap() {
      var on = dsffWrapEnabled();
      if (editorKind === "monaco" && monacoEditor) {
        try { monacoEditor.updateOptions({ wordWrap: on ? "on" : "off" }); } catch (e) {}
        layoutEditorSoon();
      } else if (editorKind === "textarea" && $textarea) {
        $textarea.attr("wrap", on ? "soft" : "off")
                 .css("whiteSpace", on ? "pre-wrap" : "pre");
      }
    }

    function applyReadOnly() {
      if (editorKind === "monaco" && monacoEditor) {
        monacoEditor.updateOptions({ readOnly: fileReadOnly });
      } else if (editorKind === "textarea" && $textarea) {
        $textarea.prop("readonly", fileReadOnly);
      }
      if (fileReadOnly) {
        dirty = false;
        $btnSave.prop("disabled", true).removeClass("dsff-dirty");
        updateCompactFileName();
      }
    }

    function markDirty(val) {
      if (val && fileReadOnly) return;
      dirty = !!val;
      $btnSave.prop("disabled", !dirty).toggleClass("dsff-dirty", dirty);
      updateCompactFileName();
    }

    // isDirty() is the AUTHORITATIVE check — compares editor content against
    // savedText. The dirty flag is only for UI; never trust it alone for guards.
    function isDirty() {
      if (!currentFile) return false;
      return getEditorContent() !== savedText;
    }

    function syncDirty() {
      var d = isDirty();
      if (d !== dirty) markDirty(d);
    }

    // Call withCleanState before ANY action that abandons the current file.
    function withCleanState(verb, target, action) {
      syncDirty();
      if (!dirty) { action(); return; }
      showDirtyDialog(verb, target, action);
    }

    function showDirtyDialog(verb, target, action) {
      var fname      = (currentFile || "").split("/").pop() || currentFile || "file";
      var safeFile   = $("<span>").text(fname).html();
      var safeTarget = $("<span>").text(target || "").html();

      dsffModal({
        title: "Unsaved changes",
        body:  "You have unsaved changes in <strong>" + safeFile + "</strong>. " +
               "What would you like to do before " + (verb || "leaving") +
               (safeTarget ? " <strong>" + safeTarget + "</strong>" : "") + "?",
        buttons: [
          { label: "Cancel",
            key:    "Escape",
            action: function () { selectedPath = currentFile; refreshSelectedRow(); }
          },
          { label:  "Discard changes",
            cls:    "dsff-modal-btn-danger",
            action: function () { markDirty(false); action(); }
          },
          { label:  "Save",
            cls:    "dsff-modal-btn-primary",
            key:    "Enter",
            action: function () { doSave(action); }
          }
        ]
      });
    }

    function stopStatTimer() { if (statTimer) { clearInterval(statTimer); statTimer = null; } }
    function startStatTimer() {
      stopStatTimer();
      if (!currentFile) return;
      statTimer = setInterval(function () {
        if (!currentFile) return;
        dsffAjax("GET", "dslflow/files/stat?path=" + encodeURIComponent(currentFile))
          .done(function (r) {
            var changed = lastDisk.mtime !== null &&
              (r.mtime !== lastDisk.mtime || r.size !== lastDisk.size);
            onDiskChanged = !!changed;
            setStatus("Opened: " + currentFile + (onDiskChanged ? " (changed on disk)" : ""));
          })
          .fail(function () {});
      }, 5000);
    }

    // openFile is a pure loader — no dirty guard. Callers must use withCleanState.
    function openFile(relPath) {
      selectedPath = relPath;
      refreshSelectedRow();
      saveViewState();

      dsffAjax("GET", "dslflow/files/open?path=" + encodeURIComponent(relPath))
        .done(function (res) {
          ensureEditorReady().then(function () {
            currentFile   = relPath;
            savedText     = res.text || "";
            lastDisk      = { mtime: res.mtime || null, size: res.size || null };
            onDiskChanged = false;
            fileReadOnly  = isReadOnly(relPath);
            setEditorContent(res.text || "", relPath);
            applyReadOnly();
            markDirty(false);
            setStatus("Opened: " + relPath);
            startStatTimer();
            layoutEditorSoon();
            $root.addClass("dsff-file-open").toggleClass("dsff-readonly-open", fileReadOnly);
            updateCompactFileName();
            if (isCompact) tryExpandSidebar();
            else layoutEditorSoon();
          });
        })
        .fail(function (xhr) {
          notifyErr("Open error: " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText || xhr.status));
        });
    }

    function doSave(callback) {
      if (!currentFile || fileReadOnly) return;
      var text = getEditorContent();
      dsffAjax("POST", "dslflow/files/save", { path: currentFile, text: text })
        .done(function (r) {
          savedText     = text;
          lastDisk      = { mtime: r.mtime || Date.now(), size: r.size || (text || "").length };
          onDiskChanged = false;
          markDirty(false);
          setStatus("Saved: " + currentFile);
          toast("Saved", "success");
          saveViewState();
          if (typeof callback === "function") callback();
        })
        .fail(function (xhr) {
          notifyErr("Save error: " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText || xhr.status));
        });
    }

    function resetEditorState() {
      stopStatTimer();
      currentFile      = null;
      selectedPath     = null;
      currentDir       = ".";
      savedText        = "";
      currentTextCache = "";
      lastDisk         = { mtime: null, size: null };
      onDiskChanged    = false;
      fileReadOnly     = false;
      markDirty(false);
      $root.removeClass("dsff-file-open dsff-readonly-open");
      updateCompactFileName();
      setStatus("");
      if (editorKind === "monaco" && monacoEditor) {
        monacoEditor.updateOptions({ readOnly: false });
        if (editorModel && !editorModel.isDisposed()) {
          suppressDirty = true;
          try { editorModel.setValue(""); } finally { suppressDirty = false; }
        }
      } else if (editorKind === "textarea" && $textarea) {
        $textarea.prop("readonly", false).val("");
      }
    }

    function loadConfigThenList() {
      dsffAjax("GET", "dslflow/files/config")
        .done(function (res) {
          var newProject = res.activeProject || null;
          if (projectRoot !== null && newProject !== projectRoot) resetEditorState();
          baseDir     = res.baseDir || "";
          projectRoot = newProject;
          $baseLabel.text(baseDir).attr("title", baseDir);
          loadList(projectRoot || ".");
          refreshVenvState();
        })
        .fail(function () { loadList("."); });
    }

    // Python venv — detect, create, install. Always scoped to projectRoot.
    function updateVenvBar() {
      if (!projectRoot) { $venvBar.hide(); return; }
      $venvBar.show().toggleClass("dsff-venv-ready", hasVenv);
      if (hasVenv) {
        $venvStatus.text("Python environment ready");
        $venvAction.hide();
      } else {
        $venvStatus.text("No Python environment");
        $venvAction.text("Create").show();
      }
    }
    function refreshVenvState() {
      if (!projectRoot) { hasVenv = false; updateVenvBar(); return; }
      dsffAjax("GET", "dslflow/files/python-env?project=" + encodeURIComponent(projectRoot))
        .done(function (r) { hasVenv = !!(r && r.present); updateVenvBar(); })
        .fail(function ()  { hasVenv = false; updateVenvBar(); });
    }
    function doCreateVenv() {
      if (!projectRoot) return;
      dsffConfirm({
        title:        "Create Python environment",
        body:         'Create a virtual environment at <strong>' + $("<span>").text(projectRoot + "/.venv").html() + '</strong>? This may take a moment.',
        confirmLabel: "Create",
        onConfirm: function () {
          setStatus("Creating Python environment…");
          dsffAjax("POST", "dslflow/files/python-env/create", { project: projectRoot })
            .done(function () {
              toast("Python environment created", "success");
              setStatus("");
              refreshVenvState();
              loadList(currentDir, { silent: true });
            })
            .fail(function (xhr) {
              setStatus("");
              notifyErr("Create failed: " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText));
            });
        }
      });
    }
    function doInstallRequirements(relPath) {
      if (!projectRoot || !hasVenv) return;
      setStatus("Installing Python libraries…");
      dsffAjax("POST", "dslflow/files/python-env/install", { project: projectRoot, requirements: relPath })
        .done(function () {
          toast("Python libraries installed", "success");
          setStatus("");
        })
        .fail(function (xhr) {
          setStatus("");
          notifyErr("Install failed: " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText));
        });
    }

    function doInstallNodePackages() {
      if (!projectRoot) return;
      setStatus("Installing Node libraries…");
      dsffAjax("POST", "dslflow/files/node-packages/install", { project: projectRoot })
        .done(function () {
          toast("Node libraries installed", "success");
          setStatus("");
          loadList(currentDir, { silent: true });
        })
        .fail(function (xhr) {
          setStatus("");
          notifyErr("Install failed: " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText));
        });
    }

    // ── 7. File-tree behavior ────────────────────────────────────────────────

    // Sort
    function updateSortHeader() {
      var na = sortField === "name"  ? (sortDir === "asc" ? " ▲" : " ▼") : "";
      var ma = sortField === "mtime" ? (sortDir === "asc" ? " ▲" : " ▼") : "";
      $hdrName.text("Name"     + na);
      $hdrMod.text("Modified" + ma);
    }

    function sortItems(items) {
      var copy = items.slice();
      copy.sort(function (a, b) {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        var cmp = sortField === "mtime"
          ? (a.mtime || 0) - (b.mtime || 0)
          : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        if (cmp === 0) cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        return sortDir === "asc" ? cmp : -cmp;
      });
      return copy;
    }

    // Tree rendering
    function formatMtime(ms) {
      if (!ms) return "";
      var d = new Date(ms);
      var p = function (n) { return String(n).padStart(2, "0"); };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
             " " + p(d.getHours()) + ":" + p(d.getMinutes());
    }

    function refreshSelectedRow() {
      $tree.find(".dsff-row").removeClass("dsff-row-selected");
      if (!selectedPath) return;
      $tree.find(".dsff-row").each(function () {
        if ($(this).data("dsff-path") === selectedPath) $(this).addClass("dsff-row-selected");
      });
    }

    function setCrumb(parts) {
      var segs = [];
      var acc  = [];
      segs.push($('<a href="#">.</a>').on("click", function (e) { e.preventDefault(); loadList("."); }));
      (parts || []).forEach(function (p) {
        acc.push(p);
        var snap = acc.slice();
        segs.push($("<span>/</span>"));
        segs.push($("<a href='#'></a>").text(p).on("click", function (e) {
          e.preventDefault(); loadList(snap.join("/"));
        }));
      });
      $crumb.empty().append(segs);
    }

    function renderTree(list) {
      lastList = list;
      baseDir  = list.baseDir || baseDir;
      var _fullPath = (list.baseDir || "") + (list.cwd && list.cwd !== "." ? "/" + list.cwd : "");
      $baseLabel.text(_fullPath).attr("title", _fullPath);
      currentDir = list.cwd;
      setCrumb(list.breadcrumb);
      $tree.empty();
      updateSortHeader();
      updateCompactFolderLabel();

      var rows    = [];
      var atRoot  = list.cwd === "." || list.cwd === projectRoot;

      if (!atRoot) {
        var parentDir = (function () {
          var parts = currentDir.split("/").filter(Boolean);
          var p     = parts.slice(0, -1).join("/") || ".";
          if (projectRoot && p !== "." && !p.startsWith(projectRoot)) p = projectRoot;
          return p;
        })();
        var $up = $('<div class="dsff-row">').data("dsff-path", null);
        $up.append($('<i class="fa fa-level-up">').css({ width: "16px", marginRight: "6px" }));
        $up.append($('<span class="dsff-row-name">..'));
        $up.on("click", function () { loadList(parentDir); });
        $up.on("dragover", function (ev) {
          if (!draggedFile) return;
          ev.preventDefault();
          ev.originalEvent.dataTransfer.dropEffect = "move";
        });
        $up.on("dragenter", function (ev) {
          if (!draggedFile) return;
          ev.preventDefault();
          if (!$(ev.relatedTarget).closest(this).length) $(this).addClass("dsff-row-drag-over");
        });
        $up.on("dragleave", function (ev) {
          if (!$(ev.relatedTarget).closest(this).length) $(this).removeClass("dsff-row-drag-over");
        });
        $up.on("drop", function (ev) {
          // External (OS) drops are handled by the capture listener on $root[0].
          // Bail without touching the event so nothing interferes with that flow.
          if (!draggedFile) return;
          ev.preventDefault();
          $(this).removeClass("dsff-row-drag-over");
          var src = draggedFile;
          draggedFile = null;
          doMoveFile(src.path, parentDir);
        });
        rows.push($up);
      }

      sortItems(list.items.filter(function (it) {
        return showHidden || it.name[0] !== ".";
      })).forEach(function (it) {
        var hidden     = it.name[0] === ".";
        var $r         = $('<div class="dsff-row">').data("dsff-path", it.path);
        var iconClass  = it.type === "dir" ? "fa-folder" : "fa-file-text-o";
        if (hidden) $r.addClass("dsff-row-hidden");
        $r.append($('<i class="fa ' + iconClass + '">').css({ width: "16px", marginRight: "6px" }));
        $r.append($('<span class="dsff-row-name">').text(it.name));
        if (isProtected(it)) $r.append($('<i class="fa fa-lock dsff-protected-icon" title="Protected">'));
        $r.append($('<span class="dsff-mtime">').text(formatMtime(it.mtime)));

        if (it.type === "dir") {
          if (isProtectedDir(it)) {
            $r.addClass("dsff-row-protected-dir");
            $r.on("click", function () {
              toast("This folder is managed by Git and cannot be accessed here.", "warning");
            });
          } else {
            $r.on("click", function () { loadList(it.path); });
            $r.on("dragover", function (ev) {
              if (!draggedFile) return;
              ev.preventDefault();
              ev.originalEvent.dataTransfer.dropEffect = "move";
            });
            $r.on("dragenter", function (ev) {
              if (!draggedFile) return;
              ev.preventDefault();
              if (!$(ev.relatedTarget).closest(this).length) $(this).addClass("dsff-row-drag-over");
            });
            $r.on("dragleave", function (ev) {
              if (!$(ev.relatedTarget).closest(this).length) $(this).removeClass("dsff-row-drag-over");
            });
            $r.on("drop", function (ev) {
              if (!draggedFile) return;  // external drop: $root[0] capture owns it
              ev.preventDefault();
              $(this).removeClass("dsff-row-drag-over");
              var src = draggedFile;
              draggedFile = null;
              doMoveFile(src.path, it.path);
            });
          }
        } else {
          $r.on("click", (function (path, name) {
            return function () {
              withCleanState("opening", name, function () { openFile(path); });
            };
          })(it.path, it.name));
          if (canMove(it)) {
            $r.attr("draggable", "true");
            $r.on("dragstart", function (ev) {
              draggedFile = { path: it.path, name: it.name };
              ev.originalEvent.dataTransfer.effectAllowed = "move";
              ev.originalEvent.dataTransfer.setData("text/plain", it.path);
              var self = this;
              setTimeout(function () { $(self).addClass("dsff-row-dragging"); }, 0);
            });
            $r.on("dragend", function () {
              $(this).removeClass("dsff-row-dragging");
              draggedFile = null;
              $tree.find(".dsff-row-drag-over").removeClass("dsff-row-drag-over");
            });
          }
        }

        $r.on("contextmenu", function (ev) {
          showCtxMenu(ev, { path: it.path, type: it.type, name: it.name });
        });
        rows.push($r);
      });

      rows.forEach(function (r) { $tree.append(r); });
      $treeEmpty.toggle(rows.length === 0);
      refreshSelectedRow();
    }

    // File list API
    function loadList(dir, opts) {
      opts = opts || {};
      return dsffAjax("GET", "dslflow/files/list?path=" + encodeURIComponent(dir))
        .done(function (res) { renderTree(res); if (!opts.silent) setStatus("Listed: " + res.cwd); })
        .fail(function (xhr) { notifyErr("List error: " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText || xhr.status)); });
    }

    // Context menus
    function hideCtxMenu() {
      $ctxMenu.hide();
      $(document).off("mousedown.dsff-ctx");
      ctxTarget = null;
    }

    function showCtxMenu(ev, item) {
      ev.preventDefault();
      hideCtxMenu();
      ctxTarget = item;
      $ctxLabel.text(item.name);
      $ctxDownload.toggle(item.type === "file");
      var prot = isProtected(item);
      $ctxRename.toggleClass("dsff-ctx-disabled", prot)
                .attr("title", prot ? "This item is protected and cannot be renamed or moved" : null);
      $ctxDelete.toggleClass("dsff-ctx-disabled", prot)
                .attr("title", prot ? "This file is protected and cannot be deleted" : null);

      var isReqFile = item.type === "file" && item.name === "requirements.txt";
      $ctxInstallPy.toggle(isReqFile);
      if (isReqFile) {
        $ctxInstallPy.toggleClass("dsff-ctx-disabled", !hasVenv)
                     .attr("title", hasVenv ? null : "Create a Python environment first");
      }

      // Root-level package.json only. Nested package.json files are ignored.
      var isRootPkg = item.type === "file" && item.name === "package.json" &&
                      !!projectRoot && item.path === projectRoot + "/package.json";
      $ctxInstallNode.toggle(isRootPkg);

      var x = ev.clientX, y = ev.clientY;
      $ctxMenu.css({ top: 0, left: 0 }).show();
      var mw = $ctxMenu.outerWidth(), mh = $ctxMenu.outerHeight();
      if (x + mw > window.innerWidth)  x = window.innerWidth  - mw - 4;
      if (y + mh > window.innerHeight) y = window.innerHeight - mh - 4;
      $ctxMenu.css({ top: y + "px", left: x + "px" });

      setTimeout(function () {
        $(document).on("mousedown.dsff-ctx", function (e) {
          if (!$(e.target).closest($ctxMenu).length) hideCtxMenu();
        });
      }, 0);
    }

    function showBgCtxMenu(ev) {
      ev.preventDefault();
      $bgCtxMenu.css({ top: 0, left: 0 }).show();
      var x = ev.clientX, y = ev.clientY;
      var mw = $bgCtxMenu.outerWidth(), mh = $bgCtxMenu.outerHeight();
      if (x + mw > window.innerWidth)  x = window.innerWidth  - mw - 4;
      if (y + mh > window.innerHeight) y = window.innerHeight - mh - 4;
      $bgCtxMenu.css({ top: y + "px", left: x + "px" });
      setTimeout(function () {
        $(document).one("mousedown.dsff-bg-ctx", function (e) {
          if (!$(e.target).closest($bgCtxMenu).length) hideBgCtxMenu();
        });
      }, 0);
    }

    function hideBgCtxMenu() {
      $bgCtxMenu.hide();
      $(document).off("mousedown.dsff-bg-ctx");
    }

    // File operations
    function doMoveFile(srcPath, destDir, overwrite) {
      var srcName  = srcPath.split("/").pop();
      var destName = destDir.split("/").pop();
      dsffAjax("POST", "dslflow/files/move", { path: srcPath, dir: destDir, overwrite: overwrite || false })
        .done(function (res) {
          toast('Moved "' + srcName + '" into "' + destName + '"', "success");
          if (currentFile === srcPath) {
            currentFile = res.path;
            updateCompactFileName();
          }
          loadList(currentDir, { silent: true });
        })
        .fail(function (xhr) {
          if (xhr.status === 409) {
            var errMsg  = (xhr.responseJSON && xhr.responseJSON.error) ||
                          '"' + srcName + '" already exists in "' + destName + '"';
            var safeMsg = $("<span>").text(errMsg).html();
            dsffConfirm({
              title:        "File already exists",
              body:         safeMsg + " Do you want to overwrite it?",
              confirmLabel: "Overwrite",
              danger:       true,
              onConfirm:    function () { doMoveFile(srcPath, destDir, true); }
            });
          } else {
            notifyErr("Move failed: " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText));
          }
        });
    }

    function doNewFile() {
      hideCompactMenu();
      dsffPrompt({
        title:        "New file",
        placeholder:  "filename.txt",
        confirmLabel: "Create",
        onConfirm: function (name) {
          dsffAjax("POST", "dslflow/files/new-file", { dir: currentDir, name: name })
            .done(function (res) {
              toast("File created", "success");
              loadList(currentDir, { silent: true });
              withCleanState("creating", name, function () { openFile(res.path); });
            })
            .fail(function (xhr) {
              notifyErr("Error: " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText));
            });
        }
      });
    }

    function doNewFolder() {
      hideCompactMenu();
      dsffPrompt({
        title:        "New folder",
        placeholder:  "folder-name",
        confirmLabel: "Create",
        onConfirm: function (name) {
          dsffAjax("POST", "dslflow/files/new-folder", { dir: currentDir, name: name })
            .done(function (res) {
              toast("Folder created", "success");
              currentDir = res.path;
              loadList(currentDir);
            })
            .fail(function (xhr) {
              notifyErr("Error: " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText));
            });
        }
      });
    }

    function uploadFiles(files) {
      var total   = files.length;
      var pending = total;
      var failed  = 0;
      function onDone(ok) {
        if (!ok) failed++;
        pending--;
        if (pending === 0) {
          loadList(currentDir, { silent: true });
          if (failed === 0) toast("Uploaded " + total + " file" + (total > 1 ? "s" : ""), "success");
          else notifyErr(failed + " upload(s) failed");
        }
      }
      files.forEach(function (file) {
        var reader = new FileReader();
        reader.onload = function (e) {
          var base64 = e.target.result.split(",")[1];
          dsffAjax("POST", "dslflow/files/upload", { dir: currentDir, name: file.name, data: base64 })
            .done(function () { onDone(true); })
            .fail(function (xhr) {
              notifyErr("Upload failed: " + file.name + " — " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText));
              onDone(false);
            });
        };
        reader.onerror = function () { notifyErr("Could not read: " + file.name); onDone(false); };
        reader.readAsDataURL(file);
      });
    }

    // True iff this drag originates from the OS (files from the user's computer),
    // not an internal row drag. Robust across browsers: checks `files` (populated
    // on drop), the `types` list (populated during drag), and the Mozilla-specific
    // "application/x-moz-file" marker.
    function isOsDrag(ev) {
      var dt = ev.dataTransfer;
      if (!dt) return false;
      if (dt.files && dt.files.length) return true;
      var types = dt.types;
      if (!types) return false;
      for (var i = 0; i < types.length; i++) {
        var t = String(types[i]);
        if (t === "Files" || t === "application/x-moz-file") return true;
      }
      return false;
    }

    // ── 8. Event wiring ──────────────────────────────────────────────────────

    // Context menu actions
    $ctxCopyPath.on("click", function () {
      if (!ctxTarget) return;
      var fullPath = baseDir + "/" + ctxTarget.path;
      hideCtxMenu();
      navigator.clipboard.writeText(fullPath)
        .then(function () { toast("Path copied", "success"); })
        .catch(function () { notifyErr("Copy failed"); });
    });

    $ctxDownload.on("click", function () {
      if (!ctxTarget || ctxTarget.type !== "file") return;
      var item = ctxTarget;
      hideCtxMenu();
      dsffAjax("GET", "dslflow/files/open?path=" + encodeURIComponent(item.path))
        .done(function (res) {
          var blob = new Blob([res.text || ""], { type: "application/octet-stream" });
          var url  = URL.createObjectURL(blob);
          var a    = document.createElement("a");
          a.href = url; a.download = item.name;
          a.style.cssText = "position:fixed;opacity:0";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        })
        .fail(function (xhr) {
          notifyErr("Download failed: " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText));
        });
    });

    $ctxRename.on("click", function () {
      if (!ctxTarget) return;
      if (isProtected(ctxTarget)) {
        hideCtxMenu();
        notifyErr("This item is protected and cannot be renamed or moved.");
        return;
      }
      var item = ctxTarget;
      hideCtxMenu();
      dsffPrompt({
        title:        'Rename "' + item.name + '"',
        placeholder:  item.name,
        value:        item.name,
        confirmLabel: "Rename",
        onConfirm: function (newName) {
          if (newName === item.name) return;
          dsffAjax("POST", "dslflow/files/rename", { path: item.path, name: newName })
            .done(function (res) {
              toast('Renamed to "' + newName + '"', "success");
              if (currentFile === item.path) {
                currentFile = res.path;
                $root.addClass("dsff-file-open");
                updateCompactFileName();
              }
              loadList(currentDir, { silent: true });
            })
            .fail(function (xhr) {
              notifyErr("Rename failed: " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText));
            });
        }
      });
    });

    $ctxDelete.on("click", function () {
      if (!ctxTarget || isProtected(ctxTarget)) return;
      var item = ctxTarget;
      hideCtxMenu();
      var safeName = $("<span>").text(item.name).html();
      dsffConfirm({
        title:        item.type === "dir" ? "Delete folder" : "Delete file",
        body:         item.type === "dir"
          ? "Delete folder <strong>" + safeName + "</strong> and all its contents? This cannot be undone."
          : "Delete <strong>" + safeName + "</strong>? This cannot be undone.",
        confirmLabel: "Delete",
        danger:       true,
        onConfirm: function () {
          dsffAjax("POST", "dslflow/files/delete", { path: item.path })
            .done(function () {
              toast('Deleted "' + item.name + '"', "success");
              if (currentFile === item.path) {
                currentFile  = null;
                selectedPath = null;
                $root.removeClass("dsff-file-open");
                setStatus("");
                stopStatTimer();
                if (editorKind === "monaco" && monacoEditor) {
                  suppressDirty = true;
                  try { editorModel && editorModel.setValue(""); } finally { suppressDirty = false; }
                } else if (editorKind === "textarea" && $textarea) {
                  $textarea.val("");
                }
                markDirty(false);
              }
              loadList(currentDir, { silent: true });
            })
            .fail(function (xhr) {
              notifyErr("Delete failed: " + (xhr.responseJSON && xhr.responseJSON.error || xhr.statusText));
            });
        }
      });
    });

    $ctxInstallPy.on("click", function () {
      if (!ctxTarget) return;
      if (!hasVenv) {
        hideCtxMenu();
        notifyErr("Create a Python environment first.");
        return;
      }
      var item = ctxTarget;
      hideCtxMenu();
      doInstallRequirements(item.path);
    });

    $ctxInstallNode.on("click", function () {
      if (!ctxTarget) return;
      hideCtxMenu();
      doInstallNodePackages();
    });

    // Python venv create link in the venv bar
    $venvAction.on("click", function (ev) { ev.preventDefault(); doCreateVenv(); });

    // Background context menu (right-click on empty tree area)
    $bgCtxNewFile.on("click", function () { hideBgCtxMenu(); doNewFile(); });
    $bgCtxNewDir.on("click",  function () { hideBgCtxMenu(); doNewFolder(); });

    $treeWrap.on("contextmenu", function (ev) {
      if ($(ev.target).closest(".dsff-row").length) return;
      showBgCtxMenu(ev);
    });

    $treeWrap.on("dragstart", function () { hideBgCtxMenu(); hideCtxMenu(); });

    // Sort header clicks
    $hdrName.on("click", function () {
      if (sortField === "name") sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortField = "name"; sortDir = "asc"; }
      if (lastList) renderTree(lastList);
    });
    $hdrMod.on("click", function () {
      if (sortField === "mtime") sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortField = "mtime"; sortDir = "asc"; }
      if (lastList) renderTree(lastList);
    });

    // Toolbar buttons
    function updateHiddenBtn() {
      $btnHidden
        .toggleClass("dsff-btn-active", showHidden)
        .attr("title", showHidden ? "Hide hidden files" : "Show hidden files")
        .find("i").attr("class", showHidden ? "fa fa-eye" : "fa fa-eye-slash");
    }

    $btnHidden.on("click", function () {
      showHidden = !showHidden;
      updateHiddenBtn();
      loadList(currentDir, { silent: true });
    });

    $btnRefresh.on("click", function () { loadList(currentDir); refreshVenvState(); });
    $btnSave.on("click", doSave);
    $btnNew.on("click", function (ev) { ev.stopPropagation(); showCompactMenu(ev); });
    $menuNewFile.on("click", doNewFile);
    $menuNewDir.on("click",  doNewFolder);
    $btnBack.on("click", function () { if (isCompact) showBrowserPanel(); });
    $btnCollapse.on("click", collapseSidebar);
    $btnExpand.on("click", tryExpandSidebar);
    $btnNewCompact.on("click", function (ev) { ev.stopPropagation(); showCompactMenu(ev); });
    $btnWrap.on("click", function () {
      var on = !dsffWrapEnabled();
      dsffSetWrap(on);
      applyWrap();
      $btnWrap.attr("title", "Toggle word wrap (currently " + (on ? "ON" : "OFF") + ")");
      toast("Wrap " + (on ? "ON" : "OFF"), "compact");
    });

    // OS drag-and-drop upload.
    // Registered on $root[0] with capture so these handlers fire before any
    // inner row/Monaco handler can swallow the event, and before Node-RED's
    // canvas-level drop handlers. Scoped to $treeWrap via contains() so drops
    // on the editor pane / toolbar are left alone.
    //
    // Two drag modes coexist here, distinguished explicitly:
    //   • external (OS file) → isOsDrag(ev) === true, draggedFile === null
    //   • internal (row move) → isOsDrag(ev) === false, draggedFile is set
    // The external path only runs when isOsDrag is true, so the internal path
    // on the rows is never triggered by OS drags.
    function isInTree(ev) { return $treeWrap[0].contains(ev.target); }

    $root[0].addEventListener("dragenter", function (ev) {
      if (!isOsDrag(ev) || !isInTree(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      $treeWrap.addClass("dsff-drop-active");
    }, true);
    $root[0].addEventListener("dragover", function (ev) {
      if (!isOsDrag(ev) || !isInTree(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.dataTransfer.dropEffect = "copy";
    }, true);
    $root[0].addEventListener("dragleave", function (ev) {
      if (!$treeWrap.hasClass("dsff-drop-active")) return;
      var to = ev.relatedTarget;
      if (to && $treeWrap[0].contains(to)) return;
      $treeWrap.removeClass("dsff-drop-active");
    }, true);
    $root[0].addEventListener("drop", function (ev) {
      if (!isOsDrag(ev) || !isInTree(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      $treeWrap.removeClass("dsff-drop-active");
      var files = ev.dataTransfer && ev.dataTransfer.files;
      if (!files || !files.length) return;
      uploadFiles(Array.from(files));
    }, true);

    // Splitter drag
    $split.on("mousedown", function (ev) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      isDraggingSplit     = true;
      splitDrag.startX    = ev.clientX;
      splitDrag.startLeft = $left.width();
      splitDrag.min       = 200;
      splitDrag.max       = Math.max(splitDrag.min + 200, ($root.width() || 600) - 260);
      $root.addClass("dsff-root-splitting");

      $(document)
        .on("mousemove.dsff-split", function (e) {
          if (!isDraggingSplit) return;
          var dx = e.clientX - splitDrag.startX;
          var w  = Math.min(Math.max(splitDrag.startLeft + dx, splitDrag.min), splitDrag.max);
          $left.css("width", w + "px");
          savedLeftWidth = w + "px";
          layoutEditorSoon();
        })
        .on("mouseup.dsff-split", function () {
          isDraggingSplit = false;
          $(document).off("mousemove.dsff-split mouseup.dsff-split");
          $root.removeClass("dsff-root-splitting");
        });
    });

    // ResizeObserver for compact/expanded mode switching
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(function () { applyMode(false); }).observe($root[0]);
    }

    // Node-RED editor events
    RED.events.on("editor:close", function () {
      saveViewState();
      enforceLayout();
      // Defer Monaco model revival so NR's own close handler finishes first.
      Promise.resolve().then(function () {
        if (editorKind === "monaco" && window.monaco) {
          var lang = langFromName(currentFile || "");
          suppressDirty = true;
          try {
            if (!editorModel || editorModel.isDisposed()) {
              editorModel = window.monaco.editor.createModel(currentTextCache || "", lang, editorModelUri);
              monacoEditor.setModel(editorModel);
            } else {
              window.monaco.editor.setModelLanguage(editorModel, lang);
              if (monacoEditor.getValue() !== currentTextCache) {
                editorModel.setValue(currentTextCache || "");
              }
            }
          } finally {
            suppressDirty = false;
          }
          applyReadOnly();
          layoutEditorSoon();
          restorePositionFor(currentFile, { retries: 14, delay: 60, guardMs: 900 });
        } else if (editorKind === "textarea") {
          restorePositionFor(currentFile, { retries: 10, delay: 60, guardMs: 700 });
        }
      });
    });

    RED.events.on("editor:open", function () {
      enforceLayout();
      layoutEditorSoon();
      Promise.resolve().then(function () { restorePositionFor(currentFile, { guardMs: 700 }); });
    });

    RED.events.on("deploy", function () {
      enforceLayout();
      layoutEditorSoon();
      Promise.resolve().then(function () { restorePositionFor(currentFile, { guardMs: 700 }); });
    });

    if (RED.events.on) {
      // workspace:resize / sidebar:resize come from NR's own layout system —
      // do not call enforceLayout() here to avoid feedback loops.
      RED.events.on("workspace:resize", function () {
        layoutEditorSoon();
        restorePositionFor(currentFile, { guardMs: 600 });
      });
      RED.events.on("sidebar:resize", function () {
        applyMode(false);
        layoutEditorSoon();
        restorePositionFor(currentFile, { guardMs: 600 });
      });
    }

    window.addEventListener("resize",       function () { layoutEditorSoon(); restorePositionFor(currentFile, { guardMs: 600 }); });
    window.addEventListener("beforeunload", saveViewState);

    // ── 9. Sidebar registration / startup ────────────────────────────────────

    updateHiddenBtn(); // set initial toggle state

    RED.actions.add("dslflow-files:show", function () { RED.sidebar.show("dslflow-files"); });

    RED.sidebar.addTab({
      id:           "dslflow-files",
      name:         "Project Files",
      label:        "Project Files",
      iconClass:    "fa fa-files-o",
      content:      $root,
      action:       "dslflow-files:show",
      enableOnEdit: true,
      toolbar:      null,
      onshow: function () {
        if (!$tree.children().length) loadConfigThenList();
        applyMode(true);
        layoutEditorSoon();
        if (currentFile) restorePositionFor(currentFile, { guardMs: 700 });
        // Width-driven expand/collapse button sync — works regardless of
        // which plugin manipulated the sidebar (or whether the user dragged
        // the divider). One-time observer attaches on first show.
        ensureSidebarResizeObserver();
        syncSidebarExpansionClass();
      },
    });

    // nodes:loaded fires after NR restores its sidebar state — safely activates
    // Files as the default tab without racing against NR's own init.
    var _defaultTabShown = false;
    RED.events.on("nodes:loaded", function () {
      if (!_defaultTabShown) {
        _defaultTabShown = true;
        RED.sidebar.show("dslflow-files");
      }
      loadConfigThenList();
    });

    // project:change fires (with {name}) before nodes:loaded, without a page reload.
    RED.events.on("project:change", function (data) {
      var name = (data && data.name) || null;
      if (name === projectRoot) return;
      resetEditorState();
      projectRoot = name;
      hasVenv = false;
      updateVenvBar();
      loadList(projectRoot || ".");
      refreshVenvState();
    });

    setTimeout(function () {
      if (!$tree.children().length) loadConfigThenList();
    }, 0);
  },
});
