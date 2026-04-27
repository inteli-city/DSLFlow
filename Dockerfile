FROM nodered/node-red:4.1-debian

USER root

# ── System dependencies ────────────────────────────────────────────────────────
# gosu: privilege drop in entrypoint (root → node-red after chown /data)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gosu \
    git \
    python3 \
    python3-venv \
    python3-pip \
    python3-dev \
    build-essential \
    postgresql-client \
    gdal-bin \
    curl \
    ca-certificates \
    libgraphite2-3 \
    libharfbuzz0b \
    libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*

# ── Chromium (Puppeteer / whatsapp-web.js) ────────────────────────────────────
# whatsapp-web.js drives a browser via puppeteer-core and expects to find Chrome.
# We install the Debian-packaged Chromium (maintained, security-patched) and
# point puppeteer to it via PUPPETEER_EXECUTABLE_PATH.
#
# The wrapper adds --no-sandbox and --disable-setuid-sandbox, which are required
# when Chrome runs inside a Docker container: Docker's default seccomp profile
# blocks the kernel user-namespace syscalls that Chrome's sandbox relies on.
# Running as a non-root user (node-red, UID 1000) is still enforced by the OS.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxkbcommon0 \
    libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

# Wrapper: transparently injects container-safe flags before any puppeteer args.
RUN printf '#!/bin/bash\nexec /usr/bin/chromium --no-sandbox --disable-setuid-sandbox "$@"\n' \
    > /usr/local/bin/chromium-docker \
    && chmod +x /usr/local/bin/chromium-docker

# Tell puppeteer-core to use our wrapper instead of searching its download cache.
# PUPPETEER_SKIP_*: prevent any accidental Chrome download if puppeteer (not -core)
# is ever added — the system Chromium is the only browser in this image.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chromium-docker
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true

# ── Tectonic ───────────────────────────────────────────────────────────────────
# Statically-linked musl build — no glibc version dependency.
ARG TECTONIC_VERSION=0.16.8
RUN curl -fsSL \
    "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin/ \
    && tectonic --help > /dev/null

# ── Node.js dependencies ───────────────────────────────────────────────────────
# Installed into /usr/src/node-red (the inherited WORKDIR and Node-RED's own
# node_modules directory). Node-RED discovers peer packages here automatically —
# this is the documented approach for extending the base image with custom nodes.
# Using --no-save keeps Node-RED's own package.json unmodified.
# Using --no-fund --no-update-notifier keeps output clean.
COPY package.json /tmp/user-package.json
RUN PKGS=$(node -e "\
    const d = require('/tmp/user-package.json').dependencies; \
    console.log(Object.entries(d).map(([k,v]) => k+'@'+v).join(' ')); \
    ") \
    && npm install --no-save --omit=dev --no-fund --no-update-notifier $PKGS \
    && rm /tmp/user-package.json

# ── First-party DSLFlow plugins ────────────────────────────────────────────────
# Plugins owned by this repo are copied directly into node_modules rather than
# installed via a second `npm install` call. A second `npm install` would treat
# all packages from the previous step as extraneous and remove them (npm dedup).
# Direct copy is safe: Node-RED discovers plugins by scanning node_modules for
# packages that have a "node-red" key in their package.json — no npm metadata needed.
COPY plugins/ /app/plugins/
RUN mkdir -p /usr/src/node-red/node_modules/@dslflow && \
    cp -r /app/plugins/dslflow-files \
          /usr/src/node-red/node_modules/@dslflow/node-red-plugin-files && \
    cp -r /app/plugins/dslflow-telemetry \
          /usr/src/node-red/node_modules/@dslflow/node-red-plugin-telemetry

# ── Configuration (image layer — never overwritten by the bind mount) ──────────
# settings.js and branding live in /app. Node-RED is started with
# --settings /app/settings.js so the bind-mounted /data does not affect config.
COPY --chown=node-red:node-red settings.js /app/settings.js
COPY --chown=node-red:node-red assets/      /app/assets/
COPY --chown=node-red:node-red editorTheme/ /app/editorTheme/

# ── Python runtime ─────────────────────────────────────────────────────────────
# No container-level virtual environment is created here. The image provides
# only the Python runtime (python3 + python3-venv + python3-pip, installed
# above). Each project owns its own `.venv`, created on demand from the Files
# sidebar and stored inside the project directory on the bind mount.

# ── Entrypoint ─────────────────────────────────────────────────────────────────
# Runs as root: fixes /data ownership, then drops to node-red via gosu.
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

RUN chown -R node-red:node-red /app

EXPOSE 1995

# ── Healthcheck ────────────────────────────────────────────────────────────────
# Override the base image healthcheck, which reads /data/settings.js to find
# the port. Our settings.js lives at /app/settings.js (image layer), so the
# base check always fails. Use a direct HTTP probe instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -sf http://127.0.0.1:${PORT:-1880}/ || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
