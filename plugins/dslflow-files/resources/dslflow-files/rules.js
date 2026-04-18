// rules.js — Pure policy/decision functions for the Project Files plugin.
// No DOM, no state, no AJAX, no side effects.
// Loaded before plugin.js; all four exports are plain globals on window.
(function () {
  var PROTECTED_NAMES = {
    "flows.json": 1, "flows_cred.json": 1, "package.json": 1,
    ".flows.json.backup": 1, ".flows_cred.json.backup": 1,
  };
  var PROTECTED_DIRS = { ".git": 1 };
  var READONLY_NAMES = {
    "flows.json": 1, "flows_cred.json": 1,
    ".flows.json.backup": 1, ".flows_cred.json.backup": 1,
  };
  var EXT_LANG = {
    js:"javascript", ts:"typescript", py:"python",  json:"json",
    md:"markdown",   html:"html",     css:"css",    yml:"yaml",  yaml:"yaml",
    sh:"shell",      bat:"bat",       c:"c",        cpp:"cpp",
    h:"cpp",         hpp:"cpp",       java:"java",  cs:"csharp",
    rs:"rust",       go:"go",         sql:"sql",    xml:"xml",
    ini:"ini",       toml:"toml",     txt:"plaintext",
  };

  // item: { type: "file"|"dir", name: basename }
  window.isProtected = function (item) {
    if (item.type === "file") return !!PROTECTED_NAMES[item.name];
    if (item.type === "dir")  return !!PROTECTED_DIRS[item.name];
    return false;
  };
  // Returns true for dirs the user cannot navigate into.
  window.isProtectedDir = function (item) {
    return item.type === "dir" && !!PROTECTED_DIRS[item.name];
  };
  // path is a relative path; only the basename is matched.
  window.isReadOnly = function (path) {
    var name = (path || "").split("/").pop();
    return !!READONLY_NAMES[name];
  };
  // Monaco language identifier from a filename.
  window.langFromName = function (name) {
    var ext = (name.split(".").pop() || "").toLowerCase();
    return EXT_LANG[ext] || "plaintext";
  };
  // item: { type: "file"|"dir", name: basename }
  window.canMove = function (item) {
    return !window.isProtected(item);
  };
})();
