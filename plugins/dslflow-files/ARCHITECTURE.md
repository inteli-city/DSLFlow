# DSLFlow Project Files Plugin — Architecture

## Why the refactor stayed small

Node-RED loads plugin HTML via an async AJAX pipeline. Each `<script src="...">` tag in the
HTML file is fetched and injected sequentially. Adding too many files creates ordering
complexity with no real benefit. The goal was readability, not abstraction.

## File responsibilities

### `plugin.js` — owns everything that runs the sidebar
DOM construction, plugin state, layout behavior, Monaco editor lifecycle, file-tree
rendering, event wiring, and sidebar registration. This is intentionally the large file.

### `rules.js` — pure policy, no side effects
IIFE that exports four globals: `isProtected`, `isProtectedDir`, `isReadOnly`,
`langFromName`. Add new protected filenames, read-only rules, or language mappings here.
No DOM, no AJAX, no state.

### `dialogs.js` — modal shell only
Three globals: `dsffModal` (low-level builder), `dsffPrompt` (text input dialog),
`dsffConfirm` (yes/no dialog). Feature-level decisions (what to do after confirmation)
stay in `plugin.js`.

### `style.js` — injects CSS into `<head>`
### `prefs.js` — reads/writes user preferences via Node-RED settings API
### `admin-ajax.js` — all `$.ajax` calls to the backend REST routes

## What should NOT be split further

- The file-tree and editor sections of `plugin.js` are tightly coupled through shared state
  (`currentPath`, `currentFile`, dirty flag, Monaco instance). Splitting them would require
  a shared-state object and a dependency protocol — more complexity than the current size
  warrants.
- `style.js`, `prefs.js`, and `admin-ajax.js` already have clear, narrow responsibilities
  and are stable.
