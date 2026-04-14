# DSLFlow

A customized, containerized Node-RED environment with violet branding, Git-based project management, Python tooling, and a curated set of CLI utilities.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Authentication](#authentication)
- [Getting Started](#getting-started)
- [Compose Files](#compose-files)
- [Development Workflow](#development-workflow)
- [Dependency Management](#dependency-management)
- [Theming & Branding](#theming--branding)
- [Python & External Tools](#python--external-tools)
- [Deployment Model](#deployment-model)
- [Disabled Built-in Nodes](#disabled-built-in-nodes)
- [Ownership Boundary](#ownership-boundary)
- [Known Limitations & Tradeoffs](#known-limitations--tradeoffs)

---

## Overview

DSLFlow packages Node-RED into a reproducible Docker image that is ready for flow-based development without manual setup. It replaces the default Node-RED branding with a DSLFlow identity, enables the Node-RED Projects feature for Git-backed flow versioning, and bundles Python, PostgreSQL client, GDAL, and Tectonic for use in data and document workflows.

The environment is split into two distinct layers:

- **Image** — defines the runtime (Node-RED, system tools, configuration, Python, pre-installed packages). Rebuilt from source; stateless.
- **Volume** — holds all Node-RED state (projects, flows, runtime config). Persists across container rebuilds.

Cloning this repository and running `docker compose up` produces a working Node-RED instance. Destroying and recreating the container does not lose flows or project history.

---

## Key Features

- **Stateless image** — the container defines the environment only; all runtime state lives in a host-side bind mount
- **Persistent bind mount** — `./dslflow_data` is mounted at `/data`; flows, projects, and git repos survive container recreations and are directly accessible on the host
- **Node-RED Projects enabled** — each project is a Git repository managed by the editor, with manual commit mode
- **Custom branding** — editor title, header icon, and UI color system replaced with DSLFlow violet theme
- **Python execution support** — a virtual environment at `/app/venv` is baked into the image
- **Extended CLI tooling** — `psql`, `ogr2ogr` (GDAL), and `tectonic` (LaTeX compiler) are available in the container

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Docker image (stateless — rebuilt from Dockerfile)        │
│                                                            │
│  /app/                                                     │
│    settings.js      Node-RED configuration                 │
│    assets/          branding (icon)                        │
│    editorTheme/     custom CSS                             │
│    venv/            Python virtual environment             │
│                                                            │
│  /usr/src/node-red/node_modules/                           │
│    @inteli.city/*   pre-installed custom nodes             │
│    canvas, ...      other declared dependencies            │
└────────────────────────────────────────────────────────────┘
              │ bind mount  ./dslflow_data → /data
              ▼
┌────────────────────────────────────────────────────────────┐
│  Host directory: ./dslflow_data  (visible on host)         │
│                                                            │
│    projects/        Node-RED Projects + git repos          │
│    context/         node context storage                   │
│    lib/             user snippets                          │
│    .config.*.json   runtime configuration                  │
└────────────────────────────────────────────────────────────┘
              │ port 1995
              ▼
        Host browser / client
```

**Key design decisions:**

**Image is stateless.** `settings.js` and branding assets live at `/app/` inside the image. Node-RED is started with `--settings /app/settings.js` so the bind-mounted `/data` does not overwrite configuration.

**Bind mount is the single source of truth.** All Node-RED runtime state lives in `./dslflow_data` on the host. The directory is directly readable and writable without entering the container. Recreating or rebuilding the container does not affect it. `docker compose down -v` does not remove it — it is not a Docker volume.

**Packages live in the image.** Custom nodes are installed into `/usr/src/node-red/node_modules/` during the Docker build (the official Node-RED extension pattern). Node-RED discovers them as peer packages. Nothing in `/data` needs to exist for packages to work — there is no seeding step.

**Entrypoint handles permissions.** The container starts as root, runs `chown -R node-red:node-red /data` to fix bind-mount ownership (Docker creates the directory as root), then drops to the `node-red` user via `gosu` before launching Node-RED.

**Git ownership is managed by Node-RED Projects.** Each project at `/data/projects/<name>/` has its own `.git` repository, managed entirely by the Node-RED editor. The main repository (this repo) does not version flows or project state.

**Isolation is at the container level.** Node-RED shares `node_modules` across all projects loaded in the same container. Run one container per project to prevent dependency conflicts.

---

## Project Structure

```
.
├── Dockerfile                  # Image definition (environment only — no state)
├── docker-compose.yml          # Build image + run container (default entry point)
├── docker-compose-reuse.yml    # Run container using an already-built image
├── settings.js                 # Node-RED runtime and editor configuration
├── package.json                # Node-RED node dependencies
├── package-lock.json           # Locked dependency tree
├── .env.example                # Required environment variables with bootstrap defaults
├── .gitignore                  # Excludes all runtime state from the repo
├── .dockerignore               # Excludes runtime state from the build context
├── assets/
│   └── icons/
│       └── app-icon.png        # Header icon (replaces Node-RED logo)
└── editorTheme/
    └── custom.css              # Violet color system applied to the editor UI
```

**Ownership boundary:** the repository defines the environment. The bind mount (`./dslflow_data`) holds all runtime state. Nothing generated at runtime belongs in the repository — see [Ownership Boundary](#ownership-boundary) for the full table.

---

## Authentication

Authentication is mandatory. The editor and admin API are never accessible without a valid login — there is no dev mode, no insecure fallback, and no way to bypass it at runtime.

### How it works

Credentials are supplied exclusively through environment variables:

| Variable | Purpose |
|---|---|
| `NODE_RED_ADMIN_USER` | Username for the Node-RED editor and admin API |
| `NODE_RED_ADMIN_PASSWORD_HASH` | Bcrypt hash of the admin password |

Both variables are read by `settings.js` at startup. The entrypoint script checks for them before Node-RED is launched — if either is missing or empty, **the container exits immediately** with an error message.

### Setup

```bash
cp .env.example .env
```

`.env.example` ships a default hash for password `dslflow`, intended as a bootstrap credential for local development. Edit `.env` and replace both values before using the environment for anything that requires real access control.

`.env` is gitignored and must never be committed. `.env.example` is the versioned contract — it documents which variables are required and provides a working default.

### Generating a new password hash

```bash
npx node-red-admin hash-pw
```

Paste the output as the value of `NODE_RED_ADMIN_PASSWORD_HASH` in your `.env`.

### Startup failure

If the container starts without the required variables set:

```
[dslflow] ERROR: NODE_RED_ADMIN_USER and NODE_RED_ADMIN_PASSWORD_HASH must be set.
[dslflow]        Copy .env.example to .env, set your credentials, then restart.
```

The container exits with code 1. Node-RED is never reached.

---

## Getting Started

**Prerequisites:** Docker and Docker Compose.

```bash
# 1. Clone the repository
git clone <repository-url>
cd dslflow

# 2. Set credentials
cp .env.example .env   # edit .env to change username or password

# 3. Start
docker compose up -d

# 4. Open the editor and log in
# http://localhost:2000
```

`docker compose up -d` builds the image on first run and starts the container. No separate build step is needed. On first start, Docker creates `./dslflow_data` if it does not exist and the entrypoint fixes its ownership. Custom nodes are already in the image — no seeding or `npm install` step is required. Login is required immediately on first access.

To stop without removing state:

```bash
docker compose down
```

To tail logs:

```bash
docker compose logs -f
```

---

## Compose Files

Two compose files exist with distinct responsibilities. They produce identical runtime behavior — the only difference is the source of the image.

### `docker-compose.yml` — build + run (default)

Builds `dslflow:latest` from source and starts the container. Use this for first-time setup and any time the image needs to be rebuilt.

```bash
docker compose up -d          # build if needed, then start
docker compose build          # build only, do not start
docker compose up -d --build  # force rebuild and start
```

This is the only file that contains a `build:` block. It pins a single named instance (`container_name: dslflow`) on port `2000`.

### `docker-compose-reuse.yml` — reuse existing image

Starts a container using `dslflow:latest` without any build step. The image must already exist locally — this file contains no build configuration and will fail if the image is absent.

```bash
docker compose -f docker-compose-reuse.yml up -d
```

Designed for running multiple independent instances on the same machine. There is no hardcoded container name, and both the port and data directory are configurable per instance:

| Variable | Default | Purpose |
|---|---|---|
| `DSLFLOW_PORT` | `2000` | Host port exposed to the browser |
| `DSLFLOW_DATA` | `./dslflow_data` | Host path for the data bind mount |

**Multiple instances example:**

```bash
# Build the image once
docker compose build

# Instance A — port 2001, its own data directory
DSLFLOW_PORT=2001 DSLFLOW_DATA=./project_a \
  docker compose -p project_a -f docker-compose-reuse.yml up -d

# Instance B — port 2002, its own data directory
DSLFLOW_PORT=2002 DSLFLOW_DATA=./project_b \
  docker compose -p project_b -f docker-compose-reuse.yml up -d
```

The `-p` flag sets a unique project name per instance, preventing Docker Compose from treating them as the same service. Each instance is fully isolated — no shared state, no port conflicts, no rebuilds.

### Summary

| | `docker-compose.yml` | `docker-compose-reuse.yml` |
|---|---|---|
| Builds image | Yes | No |
| Requires pre-built image | No | Yes |
| Fixed container name | Yes (`dslflow`) | No |
| Port configurable | No (fixed `2000`) | Yes (`DSLFLOW_PORT`) |
| Data dir configurable | No (fixed `./dslflow_data`) | Yes (`DSLFLOW_DATA`) |
| Multiple instances | No | Yes |

---

## Development Workflow

Flow development happens in the Node-RED editor at `http://localhost:2000`. Each developer runs their own local container instance against their own local volume.

**Typical cycle:**

1. `docker compose up -d`
2. Open the editor, create or clone a project via the Projects panel
3. Edit flows in the UI — changes are written immediately to the volume
4. Commit via the Projects panel (git runs inside the container against the project's `.git`)
5. Push to a remote to share work

**State persistence:**

`docker compose down && docker compose up -d` preserves all state — `./dslflow_data` is on the host and is never touched by Docker lifecycle commands.

`docker compose down -v` does **not** affect `./dslflow_data` because it is a bind mount, not a named volume. The `-v` flag only removes named volumes. To wipe state, delete `./dslflow_data` manually — ensure all projects are pushed to a remote first.

**Collaboration:**

Node-RED does not support concurrent multi-user editing on the same instance. Two developers editing the same running container simultaneously will overwrite each other's changes. Use separate local containers and merge through Git.

Resolving merge conflicts in `flows.json` is difficult because the format is a flat JSON array of node objects with opaque UUIDs. Prefer small, focused commits and coordinate to avoid long-lived divergent branches.

---

## Dependency Management

Node-RED node packages are declared in `package.json`. During the Docker build, they are installed into `/usr/src/node-red/node_modules/` — the same directory Node-RED uses for its own packages. Node-RED discovers them as peer packages without any runtime install step.

**To add or update a dependency:**

1. Add or update the package in `package.json` under `dependencies`
2. Rebuild the image: `docker compose build`
3. Restart the container: `docker compose up -d`

**Palette Manager and version precedence:**

The Palette Manager is fully enabled. Installing or updating a node through the editor UI will write that package to `/data/node_modules`. Node-RED scans `userDir/node_modules` (`/data`) before the global install (`/usr/src/node-red/node_modules`), so any package present in `/data/node_modules` takes precedence over the image version. This is Node-RED's intended behavior — it allows users to update packages without rebuilding the image.

Consequence: if a package is installed or updated via the UI and later the image is rebuilt with a different version, the UI-installed version in `/data/node_modules` will continue to win. To reset to the image version, delete `./dslflow_data/node_modules` (and `package.json` / `package-lock.json` if present in `./dslflow_data`) and restart the container. The image version will then be loaded.

**Function-node external modules** (`functionExternalModules: true`) work the same way — packages declared in Function nodes auto-install into `/data/node_modules`. They are utility libraries (e.g. `canvas`), not Node-RED nodes, and are expected to live in `/data`.

**All packages are shared across every project in the container.** There is no per-project isolation. Declare all intended baseline dependencies in `package.json` to ensure they are available on a clean start.

---

## Theming & Branding

Configuration lives in the image at `/app/` and is loaded via `--settings /app/settings.js`.

**`settings.js` — `editorTheme` block:**

- `page.title` and `header.title` → `"DSLFlow"`
- `header.image` → `assets/icons/app-icon.png` (resolved relative to `/app/`)
- `page.css` → `editorTheme/custom.css` (resolved relative to `/app/`)

**`editorTheme/custom.css` — violet color system:**

| Variable | Value | Usage |
|---|---|---|
| `--dslflow-primary` | `#6D28D9` | Deploy button, header accent |
| `--dslflow-primary-hover` | `#5B21B6` | Hover states |
| `--dslflow-primary-active` | `#4C1D95` | Active/pressed states |
| `--dslflow-accent-soft` | `#8B5CF6` | Highlights |

To change the color scheme, update `editorTheme/custom.css` and rebuild the image.

---

## Python & External Tools

**Python virtual environment:**

The venv is built into the image at `/app/venv` and is always available regardless of volume state.

```dockerfile
ENV PATH="/app/venv/bin:$PATH"
```

To add Python packages, extend the Dockerfile:

```dockerfile
RUN /app/venv/bin/pip install pandas numpy
```

Then rebuild the image.

**Intended usage pattern:**

Node-RED orchestrates Python execution rather than running Python inline. Invoke scripts with the exec node using `/app/venv/bin/python`. This keeps heavy computation outside the Node.js event loop and makes scripts independently testable.

**Available CLI tools:**

| Tool | Source | Use case |
|---|---|---|
| `psql` | `postgresql-client` | Query PostgreSQL from exec nodes or scripts |
| `ogr2ogr` | `gdal-bin` | Convert and process geospatial data |
| `tectonic` | upstream musl binary (pinned) | Compile LaTeX documents to PDF |

All tools are on `PATH` inside the container.

---

## Deployment Model

**One container per project.** Node-RED shares `node_modules` globally within a container. Running multiple unrelated projects in the same instance risks package version conflicts that are invisible at the Node-RED level.

To create a new project environment, fork this repository, update `package.json`, and build a new image with its own named volume.

**Container configuration (`docker-compose.yml`):**

| Setting | Value | Note |
|---|---|---|
| Port | `1995` | Configurable via `PORT` env var |
| Volume | `./dslflow_data:/data` | Bind mount — host directory, visible without entering the container |
| Memory limit | `5g` | Adjust based on workload |
| Node.js heap | `4096 MB` | Set via `NODE_OPTIONS` |
| Restart | `unless-stopped` | Auto-restarts unless explicitly stopped |

---

## Ownership Boundary

This section is the authoritative reference for what belongs where. When in doubt, treat a file as runtime and keep it out of the repository.

### What belongs in the repository

These files define the environment and must be version-controlled:

| File / path | Purpose |
|---|---|
| `Dockerfile` | Image definition — system packages, Node-RED, custom nodes |
| `docker-compose.yml` | Build image + run container (default entry point) |
| `docker-compose-reuse.yml` | Run container using an already-built image; supports multiple instances |
| `entrypoint.sh` | Container startup logic — permissions, symlinks, safe-mode |
| `settings.js` | Node-RED runtime and editor configuration |
| `package.json` | Node-RED node dependencies installed into the image |
| `package-lock.json` | Locked dependency tree for reproducible image builds |
| `assets/icons/app-icon.png` | DSLFlow header icon |
| `editorTheme/custom.css` | Violet color system applied to the editor UI |
| `README.md` | Project documentation |
| `.env.example` | Contract for required environment variables (no secrets) |
| `.gitignore` | Prevents runtime artifacts from being committed |
| `.dockerignore` | Prevents runtime artifacts from entering the build context |

### What belongs in `./dslflow_data` (bind mount — never commit)

Everything created or modified at runtime lives here. This directory is owned by Node-RED and managed by the container. It is on the host for visibility and backup, not for version control.

| Path inside `./dslflow_data` | What it is |
|---|---|
| `projects/<name>/` | Node-RED project — flows, git history, package manifest |
| `projects/<name>/flows.json` | Live flow definition (versioned inside the project's own git) |
| `projects/<name>/flows_cred.json` | Encrypted flow credentials — never commit |
| `projects/.sshkeys/` | SSH keys for remote git operations — never commit |
| `.config.*.json` | Node-RED runtime configuration snapshots |
| `node_modules/` | Packages installed via Palette Manager or Function nodes |
| `context/` | Node-RED context storage (if enabled) |
| `lib/` | User-defined function library snippets |
| `.wwebjs_auth/` | WhatsApp session data (Puppeteer profile) |
| `.wwebjs_cache/` | WhatsApp Chromium cache |
| `.runtime_data/` | Runtime data directory for container-local state |

### What is intentionally not versioned anywhere

| Artifact | Reason |
|---|---|
| `.env` | Contains live credentials — must never enter git |
| `flows_cred.json` | Contains secrets — must never enter git |
| `projects/.sshkeys/` | Private keys — must never enter git |
| `*.backup` | Auto-generated by Node-RED — redundant, mutable |
| `node_modules/` at repo root | Only used inside the image; installing locally creates confusion |
| `projects/` at repo root | Node-RED writes this if userDir is the repo root — it is a runtime artifact, not source of truth |
| `lib/` at repo root | Same: written by Node-RED when userDir is the repo root |
| `context/` at repo root | Same: context storage generated at runtime |
| `.runtime_data/` at repo root | Runtime data directory — generated at execution time, not a source of truth |

### Enforcement

`.gitignore` excludes all of the above. `.dockerignore` independently excludes the same set to keep the build context clean. Neither file needs to be changed unless a new category of runtime artifact is introduced.

If you find a file in the repository that is not in the first table above, it does not belong there — remove it.

---

## Known Limitations & Tradeoffs

**No per-project package isolation inside Node-RED.**
All projects in a container share the same `node_modules` (image-layer packages in `/usr/src/node-red/node_modules/`). Package version conflicts between projects are not detectable at the Node-RED level. The container-per-project model is the mitigation.

**`flows.json` is hard to diff and merge.**
Node-RED stores flows as a flat array of JSON objects with opaque UUIDs. Merge conflicts require manual JSON editing. Coordinate with collaborators to minimize concurrent modifications to the same flow.

**No concurrent multi-user editing.**
Multiplayer is explicitly disabled (`multiplayer.enabled: false`). Each developer should run a separate local container.

**Function nodes and npm modules.**
`functionExternalModules` is enabled, but modules used in Function nodes must already be installed. UI-installed nodes persist in the volume but will be lost on a volume reset unless also declared in `package.json`.

**Manual data directory deletion loses all local state.**
Deleting `./dslflow_data` removes all projects and flow history. All projects must be pushed to a remote git repository before doing this. `docker compose down -v` does **not** delete it (bind mount, not a named volume) — deletion must be deliberate.

**Palette Manager packages are not image-layer packages.**
Nodes installed via the Palette Manager go into `/data/node_modules` (the bind mount), not into the image. They persist in `./dslflow_data` but are not reproducible without `package.json` — declare all dependencies there to ensure they survive a fresh `./dslflow_data`.

---

## Disabled Built-in Nodes

The following default Node-RED nodes are intentionally excluded from the DSLFlow runtime. They will not appear in the palette, cannot be searched, and cannot be loaded — even if a flow file references them, those nodes will be marked unknown and the flow will not start.

This is a deliberate platform restriction enforced via `nodesExcludes` in `settings.js`, which prevents the corresponding core modules from loading at startup. It is reproducible across all environments by design.

| Disabled node | Core module file | DSLFlow replacement |
|---|---|---|
| HTTP In | `21-httpin.js` | `@inteli.city/node-red-contrib-http-plus` — `http-plus-in` |
| HTTP Response | `21-httpin.js` | `@inteli.city/node-red-contrib-http-plus` — `http-plus-response` |
| HTTP Request | `21-httprequest.js` | `@inteli.city/node-red-contrib-http-plus` — `http-plus-request` |
| Exec | `90-exec.js` | `@inteli.city/node-red-contrib-exec-collection` |
| Template (Mustache) | `80-template.js` | Function node or `@inteli.city/node-red-contrib-http-plus` |
| WebSocket In | `22-websocket.js` | — |
| WebSocket Out | `22-websocket.js` | — |

**Why these nodes are removed:**

- **HTTP In / Response / Request** — replaced by `http-plus` nodes which provide a consistent, extended interface aligned with DSLFlow's HTTP patterns (structured error handling, typed responses, additional options not available in the built-in nodes).
- **Exec** — replaced by exec-collection nodes which provide managed, observable subprocess execution with structured output, avoiding the footguns of raw exec (no timeout enforcement, no structured stderr, difficult to test).
- **Template** — Mustache templating is replaced by JavaScript string templating inside Function nodes or by the http-plus nodes where templating is needed in the HTTP response context. This avoids mixing a logic-less template language into flows where a Function node provides more control with less ambiguity.

**Behavior when a flow contains a disabled node:**

Node-RED will log `Waiting for missing types to be registered: - <type>` and will refuse to start the affected flow until the unknown nodes are removed or replaced. This is explicit and intentional — there is no silent degradation.

**These nodes cannot be re-enabled via the UI.** The restriction is applied at the runtime level during startup and is not configurable from the editor.
