#!/bin/bash
#
# DSLFlow container entrypoint.
#
# Runs as root so it can fix ownership of the bind-mounted /data directory
# (Docker creates bind-mount directories as root; the node-red user cannot
# write to them without this step). After fixing permissions, drops to the
# node-red user and delegates to the original Node-RED entrypoint.
#
# Safe mode:
#   To start Node-RED without deploying flows (useful when a broken node
#   prevents the runtime from starting), create the flag file before restart:
#
#     touch ./dslflow_data/.safe-mode
#     docker compose restart
#
#   Node-RED will start with --safe: flows load but do not run, and the
#   editor remains accessible so you can locate and remove the broken node.
#   Delete the file and restart again to resume normal operation:
#
#     rm ./dslflow_data/.safe-mode
#     docker compose restart
#
set -e

# Fix ownership of the bind-mounted data directory.
# This is a no-op if the directory is already owned by node-red.
chown -R node-red:node-red /data

# ── WhatsApp session persistence ──────────────────────────────────────────────
# whatsapp-web.js writes session data to .wwebjs_auth relative to the Node-RED
# process's working directory (/usr/src/node-red). That path is inside the
# image layer — it survives container restarts but is lost on docker compose down.
#
# By replacing it with a symlink into /data (the bind mount), session data
# survives container recreation and is visible on the host under dslflow_data/.
#
# We also handle .wwebjs_cache the same way (Puppeteer profile cache).
for ww_dir in .wwebjs_auth .wwebjs_cache; do
    # Ensure the persistent target exists in /data with correct ownership.
    mkdir -p "/data/${ww_dir}"
    chown node-red:node-red "/data/${ww_dir}"
    # .wwebjs_auth must be mode 700 (whatsapp-web.js enforces this and will warn otherwise).
    if [ "${ww_dir}" = ".wwebjs_auth" ]; then
        chmod 700 "/data/${ww_dir}"
    fi
    # Remove any real directory at the source location (left by a previous run
    # before this symlink was introduced) and replace with the symlink.
    rm -rf "/usr/src/node-red/${ww_dir}"
    ln -s "/data/${ww_dir}" "/usr/src/node-red/${ww_dir}"
done

# ── Chromium stale lock cleanup ───────────────────────────────────────────────
# When the container is killed/stopped, Chromium does not remove its profile
# lock files (Singleton*). On the next start Chromium refuses to launch because
# it thinks the profile is still in use by another process.
# Remove those locks unconditionally — they are meaningless across container
# restarts and their absence is safe.
find /data/.wwebjs_auth -name 'Singleton*' -delete 2>/dev/null || true

# Safe-mode flag file: /data/.safe-mode
# If present, Node-RED starts with --safe (flows do not auto-deploy).
EXTRA_ARGS=""
if [ -f "/data/.safe-mode" ]; then
    echo "[dslflow] /data/.safe-mode detected — starting Node-RED in safe mode (flows will not run)"
    EXTRA_ARGS="--safe"
fi

# Drop privileges and run Node-RED.
# Arguments from docker-compose command (e.g. --settings /app/settings.js)
# are passed through as $@; EXTRA_ARGS appends safe-mode flag when active.
exec gosu node-red /usr/src/node-red/entrypoint.sh "$@" $EXTRA_ARGS
