module.exports = function (RED) {
  const path = require("path");
  const fsp  = require("fs").promises;

  // ── Config ────────────────────────────────────────────────────────────────
  const USER_DIR  = path.resolve(RED.settings.userDir || process.cwd());
  const cfg       = RED.settings.get("dslflowFiles") || {};
  const BASE_DIR  = cfg.baseDir
    ? path.resolve(cfg.baseDir)
    : path.join(USER_DIR, "projects");
  const MAX_BYTES      = cfg.maxBytes || 50 * 1024 * 1024;
  const PROTECTED_FILES = new Set([
    "flows.json", "flows_cred.json", "package.json",
    ".flows.json.backup", ".flows_cred.json.backup",
    ".git",
  ]);

  // Sandbox check — every request goes through this.
  function within(abs) {
    const n = path.normalize(abs);
    const b = path.normalize(BASE_DIR);
    return n === b || n.startsWith(b + path.sep);
  }

  async function trystat(abs) {
    try { return await fsp.stat(abs); } catch { return null; }
  }

  // ── Auth middleware ───────────────────────────────────────────────────────
  const canRead  = RED.auth.needsPermission("dslflow.files.read");
  const canWrite = RED.auth.needsPermission("dslflow.files.write");

  // ── Routes ────────────────────────────────────────────────────────────────

  // Config: let the client know the effective base directory and active project.
  RED.httpAdmin.get("/dslflow/files/config", canRead, (req, res) => {
    const projectsCfg   = RED.settings.get("projects") || {};
    const activeProject = projectsCfg.activeProject || null;
    res.json({ baseDir: BASE_DIR, userDir: USER_DIR, activeProject });
  });

  // List directory contents.
  RED.httpAdmin.get("/dslflow/files/list", canRead, async (req, res) => {
    try {
      const dirAbs = path.resolve(BASE_DIR, req.query.path || ".");
      if (!within(dirAbs)) return res.status(400).json({ error: "Path escapes baseDir" });

      const ents = await fsp.readdir(dirAbs, { withFileTypes: true });
      const items = [];
      for (const de of ents) {
        const full = path.join(dirAbs, de.name);
        const st   = await trystat(full);
        items.push({
          name:  de.name,
          path:  path.relative(BASE_DIR, full).replace(/\\/g, "/"),
          type:  de.isDirectory() ? "dir" : "file",
          size:  st ? st.size  : 0,
          mtime: st ? st.mtimeMs : 0,
        });
      }
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const rel = path.relative(BASE_DIR, dirAbs).replace(/\\/g, "/") || ".";
      res.json({
        baseDir:    BASE_DIR,
        cwd:        rel,
        items,
        breadcrumb: rel === "." ? [] : rel.split("/").filter(Boolean),
      });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // Open a text file for reading.
  RED.httpAdmin.get("/dslflow/files/open", canRead, async (req, res) => {
    try {
      const abs = path.resolve(BASE_DIR, req.query.path || "");
      if (!within(abs)) return res.status(400).json({ error: "Path escapes baseDir" });
      const st = await fsp.stat(abs);
      if (!st.isFile()) return res.status(400).json({ error: "Not a file" });
      if (st.size > MAX_BYTES) return res.status(400).json({ error: "File too large" });
      const buf = await fsp.readFile(abs);
      if (buf.includes(0)) return res.status(400).json({ error: "Binary file not supported" });
      res.json({ text: buf.toString("utf8"), size: st.size, mtime: st.mtimeMs });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // Stat a file (used by the on-disk-change poller).
  RED.httpAdmin.get("/dslflow/files/stat", canRead, async (req, res) => {
    try {
      const abs = path.resolve(BASE_DIR, req.query.path || "");
      if (!within(abs)) return res.status(400).json({ error: "Path escapes baseDir" });
      const st = await fsp.stat(abs);
      if (!st.isFile()) return res.status(400).json({ error: "Not a file" });
      res.json({ size: st.size, mtime: st.mtimeMs });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // Write (save) a text file.
  RED.httpAdmin.post("/dslflow/files/save", canWrite, async (req, res) => {
    try {
      const { path: rel, text } = req.body || {};
      if (!rel) return res.status(400).json({ error: "Missing path" });
      const abs = path.resolve(BASE_DIR, rel);
      if (!within(abs)) return res.status(400).json({ error: "Path escapes baseDir" });
      const dirSt = await trystat(path.dirname(abs));
      if (!dirSt || !dirSt.isDirectory()) return res.status(400).json({ error: "Parent folder missing" });
      const buf = Buffer.from(String(text ?? ""), "utf8");
      if (buf.length > MAX_BYTES) return res.status(400).json({ error: "Content too large" });
      await fsp.writeFile(abs, buf);
      const st = await trystat(abs);
      res.json({ ok: true, size: st?.size ?? buf.length, mtime: st?.mtimeMs ?? Date.now() });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // Create an empty file.
  RED.httpAdmin.post("/dslflow/files/new-file", canWrite, async (req, res) => {
    try {
      const { dir, name } = req.body || {};
      if (!name || /[\\/:*?"<>|]/.test(name)) return res.status(400).json({ error: "Invalid filename" });
      const abs = path.resolve(BASE_DIR, dir || ".", name);
      if (!within(abs)) return res.status(400).json({ error: "Path escapes baseDir" });
      if (await trystat(abs)) return res.status(400).json({ error: "File already exists" });
      await fsp.writeFile(abs, "");
      const st = await trystat(abs);
      res.json({ ok: true, path: path.relative(BASE_DIR, abs).replace(/\\/g, "/"), size: st?.size ?? 0, mtime: st?.mtimeMs ?? Date.now() });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // Move a file into a target directory.
  RED.httpAdmin.post("/dslflow/files/move", canWrite, async (req, res) => {
    try {
      const { path: rel, dir, overwrite } = req.body || {};
      if (!rel || !dir) return res.status(400).json({ error: "Missing path or dir" });
      const srcAbs = path.resolve(BASE_DIR, rel);
      if (!within(srcAbs)) return res.status(400).json({ error: "Source escapes baseDir" });
      if (PROTECTED_FILES.has(path.basename(srcAbs))) return res.status(403).json({ error: "This file is protected and cannot be moved." });
      const st = await trystat(srcAbs);
      if (!st || !st.isFile()) return res.status(400).json({ error: "Source not found or not a file" });
      const destDirAbs = path.resolve(BASE_DIR, dir);
      if (!within(destDirAbs)) return res.status(400).json({ error: "Destination escapes baseDir" });
      const destDirSt = await trystat(destDirAbs);
      if (!destDirSt || !destDirSt.isDirectory()) return res.status(400).json({ error: "Destination is not a directory" });
      const filename = path.basename(srcAbs);
      const destAbs  = path.join(destDirAbs, filename);
      if (path.normalize(destAbs) === path.normalize(srcAbs))
        return res.status(400).json({ error: "Source and destination are the same" });
      if (await trystat(destAbs) && !overwrite)
        return res.status(409).json({ error: "A file named \"" + filename + "\" already exists there" });
      await fsp.rename(srcAbs, destAbs);
      res.json({ ok: true, path: path.relative(BASE_DIR, destAbs).replace(/\\/g, "/") });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // Upload a file (base64-encoded body).
  RED.httpAdmin.post("/dslflow/files/upload", canWrite, async (req, res) => {
    try {
      const { dir, name, data } = req.body || {};
      if (!name || /[\\/:*?"<>|]/.test(name)) return res.status(400).json({ error: "Invalid filename" });
      const abs = path.resolve(BASE_DIR, dir || ".", name);
      if (!within(abs)) return res.status(400).json({ error: "Path escapes baseDir" });
      const buf = Buffer.from(data || "", "base64");
      if (buf.length > MAX_BYTES) return res.status(400).json({ error: "File too large" });
      await fsp.writeFile(abs, buf);
      const st = await trystat(abs);
      res.json({ ok: true, path: path.relative(BASE_DIR, abs).replace(/\\/g, "/"), size: st?.size ?? buf.length });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // Rename a file or folder (same parent directory).
  RED.httpAdmin.post("/dslflow/files/rename", canWrite, async (req, res) => {
    try {
      const { path: rel, name } = req.body || {};
      if (!rel)  return res.status(400).json({ error: "Missing path" });
      if (!name || /[\\/:*?"<>|]/.test(name)) return res.status(400).json({ error: "Invalid name" });
      const abs    = path.resolve(BASE_DIR, rel);
      const newAbs = path.join(path.dirname(abs), name);
      if (!within(abs))    return res.status(400).json({ error: "Path escapes baseDir" });
      if (!within(newAbs)) return res.status(400).json({ error: "Target escapes baseDir" });
      if (PROTECTED_FILES.has(path.basename(abs))) return res.status(403).json({ error: "This file is protected and cannot be renamed." });
      if (await trystat(newAbs)) return res.status(400).json({ error: "Name already exists" });
      await fsp.rename(abs, newAbs);
      res.json({ ok: true, path: path.relative(BASE_DIR, newAbs).replace(/\\/g, "/") });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // Delete a file or folder (folders removed recursively).
  RED.httpAdmin.post("/dslflow/files/delete", canWrite, async (req, res) => {
    try {
      const { path: rel } = req.body || {};
      if (!rel) return res.status(400).json({ error: "Missing path" });
      const abs = path.resolve(BASE_DIR, rel);
      if (!within(abs)) return res.status(400).json({ error: "Path escapes baseDir" });
      if (PROTECTED_FILES.has(path.basename(abs))) return res.status(403).json({ error: "This file is protected and cannot be deleted." });
      const st = await trystat(abs);
      if (!st) return res.status(400).json({ error: "Not found" });
      await fsp.rm(abs, { recursive: true, force: true });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // Create a directory.
  RED.httpAdmin.post("/dslflow/files/new-folder", canWrite, async (req, res) => {
    try {
      const { dir, name } = req.body || {};
      if (!name || /[\\/:*?"<>|]/.test(name)) return res.status(400).json({ error: "Invalid folder name" });
      const abs = path.resolve(BASE_DIR, dir || ".", name);
      if (!within(abs)) return res.status(400).json({ error: "Path escapes baseDir" });
      await fsp.mkdir(abs, { recursive: true });
      res.json({ ok: true, path: path.relative(BASE_DIR, abs).replace(/\\/g, "/") });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // ── Python env routes ─────────────────────────────────────────────────────
  // Project-scoped virtual environments at <project>/.venv.
  // No auto-creation — every action is explicit and targets one project.
  const { spawn } = require("child_process");
  const SYSTEM_PYTHON = "/usr/bin/python3"; // project venvs always spawn from the system Python

  function resolveProjectAbs(project) {
    const abs = path.resolve(BASE_DIR, project);
    if (!within(abs)) throw new Error("Project escapes baseDir");
    return abs;
  }

  // Ensure the given entry is listed in <projAbs>/.gitignore. Recognises common
  // equivalent forms (.venv, .venv/, /.venv, /.venv/) so we don't create duplicates.
  // Non-fatal: any I/O error is swallowed — a missing .gitignore line should never
  // block venv creation itself.
  async function ensureGitignored(projAbs, entry) {
    const giAbs  = path.join(projAbs, ".gitignore");
    const target = entry.replace(/\/+$/, ""); // ".venv/" → ".venv"
    const equiv  = new Set([target, target + "/", "/" + target, "/" + target + "/"]);
    try {
      let existing = "";
      try { existing = await fsp.readFile(giAbs, "utf8"); } catch { /* missing: create below */ }
      const hit = existing.split(/\r?\n/).some((line) => equiv.has(line.trim()));
      if (hit) return;
      const prefix = existing.length && !existing.endsWith("\n") ? "\n" : "";
      await fsp.writeFile(giAbs, existing + prefix + entry + "\n");
    } catch { /* non-fatal */ }
  }

  function runChild(cmd, args, opts, done) {
    let stdout = "", stderr = "";
    let child;
    try { child = spawn(cmd, args, opts); }
    catch (e) { return done(-1, "", String(e.message || e)); }
    child.stdout.on("data", (d) => { if (stdout.length < 65536) stdout += d.toString(); });
    child.stderr.on("data", (d) => { if (stderr.length < 65536) stderr += d.toString(); });
    child.on("error", (err) => done(-1, stdout, stderr || String(err.message || err)));
    child.on("close", (code) => done(code, stdout, stderr));
  }

  // Report whether <project>/.venv exists as a directory.
  RED.httpAdmin.get("/dslflow/files/python-env", canRead, async (req, res) => {
    try {
      const project = req.query.project;
      if (!project) return res.status(400).json({ error: "Missing project" });
      const projAbs = resolveProjectAbs(project);
      const venvAbs = path.join(projAbs, ".venv");
      const st = await trystat(venvAbs);
      res.json({ present: !!(st && st.isDirectory()), path: project + "/.venv" });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // Create <project>/.venv using the system Python. No container-level venv exists.
  RED.httpAdmin.post("/dslflow/files/python-env/create", canWrite, async (req, res) => {
    try {
      const { project } = req.body || {};
      if (!project) return res.status(400).json({ error: "Missing project" });
      const projAbs = resolveProjectAbs(project);
      const projSt = await trystat(projAbs);
      if (!projSt || !projSt.isDirectory()) return res.status(400).json({ error: "Project folder not found" });
      const venvAbs = path.join(projAbs, ".venv");
      if (await trystat(venvAbs)) return res.status(409).json({ error: "Python environment already exists" });
      runChild(SYSTEM_PYTHON, ["-m", "venv", venvAbs], { cwd: projAbs }, async (code, _out, err) => {
        if (code !== 0) return res.status(500).json({ error: "venv creation failed: " + (err || "exit " + code).slice(-1000) });
        // Seed an empty requirements.txt so the "Install Python libraries" action
        // has an obvious target. Never overwrite an existing file.
        const reqAbs = path.join(projAbs, "requirements.txt");
        if (!(await trystat(reqAbs))) {
          try { await fsp.writeFile(reqAbs, ""); } catch (e) { /* non-fatal */ }
        }
        // Add .venv/ to the project's .gitignore so the environment never gets committed.
        await ensureGitignored(projAbs, ".venv/");
        res.json({ ok: true, path: project + "/.venv" });
      });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // Install a requirements file into <project>/.venv. Requires the env to exist.
  RED.httpAdmin.post("/dslflow/files/python-env/install", canWrite, async (req, res) => {
    try {
      const { project, requirements } = req.body || {};
      if (!project) return res.status(400).json({ error: "Missing project" });
      const projAbs = resolveProjectAbs(project);
      const pipAbs  = path.join(projAbs, ".venv", "bin", "pip");
      if (!(await trystat(pipAbs))) return res.status(400).json({ error: "Python environment not found. Create it first." });

      const reqRel = requirements || (project + "/requirements.txt");
      const reqAbs = path.resolve(BASE_DIR, reqRel);
      if (!within(reqAbs)) return res.status(400).json({ error: "Path escapes baseDir" });
      const relFromProj = path.relative(projAbs, reqAbs);
      if (relFromProj.startsWith("..") || path.isAbsolute(relFromProj)) {
        return res.status(400).json({ error: "Requirements file must be inside the project" });
      }
      const reqSt = await trystat(reqAbs);
      if (!reqSt || !reqSt.isFile()) return res.status(400).json({ error: "Requirements file not found" });

      runChild(pipAbs, ["install", "-r", reqAbs], { cwd: projAbs }, (code, out, err) => {
        if (code === 0) return res.json({ ok: true });
        res.status(500).json({ error: "pip install failed: " + ((err || out || "exit " + code).slice(-1000)) });
      });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  // ── Node packages route ───────────────────────────────────────────────────
  // Install project-local Node dependencies by running `npm install` with the
  // project directory as cwd. Packages land in <project>/node_modules — the
  // image's node_modules at /usr/src/node-red/node_modules is never touched.
  RED.httpAdmin.post("/dslflow/files/node-packages/install", canWrite, async (req, res) => {
    try {
      const { project } = req.body || {};
      if (!project) return res.status(400).json({ error: "Missing project" });
      const projAbs = resolveProjectAbs(project);
      const pkgAbs  = path.join(projAbs, "package.json");
      const pkgSt   = await trystat(pkgAbs);
      if (!pkgSt || !pkgSt.isFile()) return res.status(400).json({ error: "package.json not found in project root" });
      runChild("npm", ["install"], { cwd: projAbs }, (code, out, err) => {
        if (code === 0) return res.json({ ok: true });
        res.status(500).json({ error: "npm install failed: " + ((err || out || "exit " + code).slice(-1000)) });
      });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  RED.log.info(`[dslflow-files] ready — baseDir: ${BASE_DIR}`);
};
