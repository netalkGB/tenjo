# Toolchain image for per-project agent containers.
FROM node:24-trixie

# Common toolchain beyond node/npm.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        git \
        ca-certificates \
        iproute2 \
        fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Fonts for documents, PDFs, CJK text, and emoji rendering.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-noto-cjk \
        fonts-noto-color-emoji \
        fonts-ipaexfont-gothic \
        fonts-ipaexfont-mincho \
        fonts-aoyagi-kouzan-t \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

# Prefer Latin fonts first, then Japanese fallbacks for generic font families.
RUN printf '%s\n' \
        '<?xml version="1.0"?>' \
        '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">' \
        '<fontconfig>' \
        '  <match target="pattern"><test name="family"><string>sans-serif</string></test>' \
        '    <edit name="family" mode="prepend" binding="strong">' \
        '      <string>Liberation Sans</string><string>Noto Sans CJK JP</string></edit></match>' \
        '  <match target="pattern"><test name="family"><string>serif</string></test>' \
        '    <edit name="family" mode="prepend" binding="strong">' \
        '      <string>Liberation Serif</string><string>IPAexMincho</string></edit></match>' \
        '  <match target="pattern"><test name="family"><string>monospace</string></test>' \
        '    <edit name="family" mode="prepend" binding="strong">' \
        '      <string>Liberation Mono</string><string>Noto Sans Mono CJK JP</string></edit></match>' \
        '</fontconfig>' \
        > /etc/fonts/local.conf \
    && fc-cache -f

# Document-generation libraries available without per-project installs.
RUN npm install -g \
        pdfkit \
        pdf-lib \
        exceljs \
        docx \
    && npm cache clean --force
ENV NODE_PATH=/usr/local/lib/node_modules

ENV AGENT_PYTHON_VENV=/opt/tenjo-python
RUN python3 -m venv "$AGENT_PYTHON_VENV" \
    && "$AGENT_PYTHON_VENV/bin/pip" install --no-cache-dir python-pptx
ENV PATH=/opt/tenjo-python/bin:$PATH

# Headless Chromium + Puppeteer for HTML -> PDF and GUI preview browsing.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g puppeteer \
    && npm cache clean --force

# GUI preview desktop stack.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        sway \
        wayvnc \
        xwayland \
        xvfb \
        xauth \
        fcitx5 \
        fcitx5-mozc \
        dbus \
        procps \
    && rm -rf /var/lib/apt/lists/*

# Mozc refuses to run as root, so fcitx5/Mozc use a dedicated user.
RUN useradd -m -u 1500 fcitx \
    && mkdir -p /home/fcitx/.config/fcitx5 /home/fcitx/.config/mozc \
    && printf '%s\n' \
        '[Groups/0]' \
        'Name=Default' \
        'Default Layout=jp' \
        'DefaultIM=mozc' \
        '' \
        '[Groups/0/Items/0]' \
        'Name=keyboard-jp' \
        '' \
        '[Groups/0/Items/1]' \
        'Name=mozc' \
        '' \
        '[GroupOrder]' \
        '0=Default' \
        > /home/fcitx/.config/fcitx5/profile \
    && chown -R fcitx:fcitx /home/fcitx/.config

# Minimal sway config for the headless GUI preview.
RUN mkdir -p /etc/sway && printf '%s\n' \
        'output HEADLESS-1 resolution 1280x800' \
        'default_border pixel 2' \
        'client.focused #2563eb #2563eb #ffffff #2563eb #2563eb' \
        'client.unfocused #64748b #64748b #ffffff #64748b #64748b' \
        'xwayland enable' \
        'input type:keyboard xkb_layout jp' \
        > /etc/sway/headless.conf

# start-fcitx: idempotently start the Japanese IME inside the running desktop.
RUN printf '%s\n' \
        '#!/bin/bash' \
        'set -u' \
        'COMPOSITOR_RUNTIME_DIR=/tmp/xdg' \
        'FCITX_RT=/tmp/fcitx-rt' \
        'SOCKET=$(ls "$COMPOSITOR_RUNTIME_DIR" 2>/dev/null | grep -m1 "^wayland-[0-9]*$" || true)' \
        '[ -n "$SOCKET" ] || { echo "desktop not running" >&2; exit 1; }' \
        'chmod 711 "$COMPOSITOR_RUNTIME_DIR"' \
        'chmod 666 "$COMPOSITOR_RUNTIME_DIR/$SOCKET"' \
        'install -d -o fcitx -g fcitx -m 700 "$FCITX_RT"' \
        'BUS="unix:path=$FCITX_RT/bus"' \
        'if ! pgrep -u fcitx -x dbus-daemon >/dev/null 2>&1; then' \
        '  rm -f "$FCITX_RT/bus"' \
        '  setpriv --reuid fcitx --regid fcitx --init-groups env HOME=/home/fcitx XDG_RUNTIME_DIR="$FCITX_RT" DBUS_SESSION_BUS_ADDRESS="$BUS" dbus-daemon --session --address="$BUS" --fork' \
        'fi' \
        'if ! pgrep -u fcitx -x fcitx5 >/dev/null 2>&1; then' \
        '  setpriv --reuid fcitx --regid fcitx --init-groups env HOME=/home/fcitx XDG_RUNTIME_DIR="$FCITX_RT" WAYLAND_DISPLAY="$COMPOSITOR_RUNTIME_DIR/$SOCKET" DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS="$BUS" fcitx5 -d >/tmp/fcitx5.log 2>&1 || true' \
        'fi' \
        'for _ in 1 2 3 4 5; do' \
        '  pgrep -u fcitx -x fcitx5 >/dev/null 2>&1 && exit 0' \
        '  sleep 0.2' \
        'done' \
        'exit 1' \
        > /usr/local/bin/start-fcitx \
    && chmod 755 /usr/local/bin/start-fcitx

# start-desktop: start the GUI preview desktop on demand and stamp readiness.
RUN printf '%s\n' \
        '#!/bin/bash' \
        'set -u' \
        ': "${VNC_PORT:=5910}"' \
        'export XDG_RUNTIME_DIR=/tmp/xdg' \
        'mkdir -p "$XDG_RUNTIME_DIR"' \
        'chmod 700 "$XDG_RUNTIME_DIR"' \
        '' \
        '# Already up? (sway alive AND its socket present) -> nothing to do.' \
        'if pgrep -x sway >/dev/null 2>&1 \' \
        '   && ls "$XDG_RUNTIME_DIR" 2>/dev/null | grep -q "^wayland-[0-9]*$"; then' \
        '  exit 0' \
        'fi' \
        '# No live sway: clear any stale socket so detection picks the new one.' \
        'rm -f "$XDG_RUNTIME_DIR"/wayland-* /tmp/.gui-ready 2>/dev/null' \
        '# Stamp the IME choice so the caller can detect a setting change later.' \
        'echo "${GUI_IME:-1}" > /tmp/.gui-ime' \
        '' \
        'export WLR_BACKENDS=headless' \
        'export WLR_LIBINPUT_NO_DEVICES=1' \
        'export WLR_RENDERER=pixman' \
        'export XDG_SESSION_TYPE=wayland' \
        '' \
        '# Discard sway output; fcitx5 grab retries can emit large logs.' \
        'sway -c /etc/sway/headless.conf >/dev/null 2>&1 &' \
        'SWAY_PID=$!' \
        '' \
        '# Wait for sways Wayland socket (name is assigned, so detect it).' \
        'for _ in $(seq 1 150); do' \
        '  SOCKET=$(ls "$XDG_RUNTIME_DIR" 2>/dev/null | grep -m1 "^wayland-[0-9]*$" || true)' \
        '  [ -n "$SOCKET" ] && break' \
        '  kill -0 "$SWAY_PID" 2>/dev/null || exit 1' \
        '  sleep 0.2' \
        'done' \
        '[ -n "${SOCKET:-}" ] || exit 1' \
        'export WAYLAND_DISPLAY="$SOCKET"' \
        '' \
        '# Start fcitx5/Mozc only after wayvnc creates a virtual keyboard.' \
        'if [ "${GUI_IME:-1}" = "1" ]; then' \
        '  export SWAYSOCK=$(ls "$XDG_RUNTIME_DIR"/sway-ipc.* 2>/dev/null | head -1)' \
        '  # fcitx uses its own uid/runtime dir and connects to sway by absolute path.' \
        '  chmod 711 "$XDG_RUNTIME_DIR"' \
        '  chmod 666 "$XDG_RUNTIME_DIR/$SOCKET"' \
        '  # Avoid starting fcitx before wayvnc creates the seat keyboard.' \
        '  ( while ! swaymsg -t get_inputs 2>/dev/null | grep -Eiq "wlr_virtual_keyboard|virtual.*keyboard|wayvnc"; do' \
        '      sleep 1' \
        '    done' \
        '    /usr/local/bin/start-fcitx >/tmp/fcitx5.log 2>&1 ) &' \
        'fi' \
        '' \
        '# jp still contains ASCII keysyms and enables JIS-specific keys.' \
        'wayvnc --keyboard="${GUI_KEYBOARD:-jp}" 0.0.0.0 "$VNC_PORT" >/dev/null 2>&1 &' \
        'WAYVNC_PID=$!' \
        '' \
        '# Stamp ready once wayvnc accepts TCP connections.' \
        '( for _ in $(seq 1 150); do' \
        '    if (exec 3<>"/dev/tcp/127.0.0.1/$VNC_PORT") 2>/dev/null; then' \
        '      touch /tmp/.gui-ready' \
        '      break' \
        '    fi' \
        '    kill -0 "$WAYVNC_PID" 2>/dev/null || break' \
        '    sleep 0.2' \
        '  done ) &' \
        'disown -a 2>/dev/null || true' \
        'exit 0' \
        > /usr/local/bin/start-desktop \
    && chmod 755 /usr/local/bin/start-desktop

# open-url <url>: open a page in the GUI desktop's Chromium.
RUN printf '%s\n' \
        '#!/bin/bash' \
        'set -u' \
        'export XDG_RUNTIME_DIR=/tmp/xdg' \
        'export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"' \
        'SOCKET=$(ls "$XDG_RUNTIME_DIR" 2>/dev/null | grep -m1 "^wayland-[0-9]*$" || true)' \
        '[ -n "$SOCKET" ] || { echo "desktop not running" >&2; exit 1; }' \
        'export WAYLAND_DISPLAY="$SOCKET"' \
        'URL="${1:-about:blank}"' \
        'FLAGS="--no-sandbox --test-type --disable-gpu --disable-dev-shm-usage --ozone-platform=wayland --enable-wayland-ime --wayland-text-input-version=3 --no-first-run --no-default-browser-check --start-maximized --user-data-dir=/tmp/chromium-profile"' \
        'nohup chromium $FLAGS "$URL" >/tmp/chromium.log 2>&1 &' \
        'disown -a 2>/dev/null || true' \
        'exit 0' \
        > /usr/local/bin/open-url \
    && chmod 755 /usr/local/bin/open-url

# launch-gui-app <pidfile> <cwd> <command>: run a native GUI app on the desktop.
RUN printf '%s\n' \
        '#!/bin/bash' \
        'set -u' \
        'COMPOSITOR_RUNTIME_DIR=/tmp/xdg' \
        'APP_RUNTIME_DIR=/tmp/tenjo-gui-app-runtime' \
        'export DBUS_SESSION_BUS_ADDRESS="unix:path=$COMPOSITOR_RUNTIME_DIR/bus"' \
        'SOCKET=$(ls "$COMPOSITOR_RUNTIME_DIR" 2>/dev/null | grep -m1 "^wayland-[0-9]*$" || true)' \
        '[ -n "$SOCKET" ] || { echo "desktop not running" >&2; exit 1; }' \
        'install -d -m 700 "$APP_RUNTIME_DIR"' \
        'chmod 700 "$APP_RUNTIME_DIR"' \
        'export XDG_RUNTIME_DIR="$APP_RUNTIME_DIR"' \
        'export WAYLAND_DISPLAY="$COMPOSITOR_RUNTIME_DIR/$SOCKET"' \
        '# Xwayland DISPLAY (sway starts it lazily; derive from its socket).' \
        'export DISPLAY=:0' \
        'for _ in 1 2 3 4 5 6 7 8 9 10; do [ -S /tmp/.X11-unix/X0 ] && break; sleep 0.2; done' \
        'X=$(ls /tmp/.X11-unix 2>/dev/null | grep -m1 "^X[0-9]*$" || true)' \
        '[ -n "$X" ] && export DISPLAY=":${X#X}"' \
        'export GDK_BACKEND=wayland,x11' \
        'export QT_QPA_PLATFORM="wayland;xcb"' \
        'export SDL_VIDEODRIVER=wayland' \
        'PIDFILE="$1"; CWD="$2"; COMMAND="$3"' \
        'mkdir -p "$(dirname "$PIDFILE")"' \
        'cd "$CWD" 2>/dev/null || cd /' \
        'nohup sh -c "$COMMAND" </dev/null >/tmp/gui-app.log 2>&1 &' \
        'echo $! > "$PIDFILE"' \
        '# Give the toolkit a moment to map the window, then fit it to the preview.' \
        '( COMPOSITOR_RUNTIME_DIR=/tmp/xdg; SWAYSOCK=$(ls "$COMPOSITOR_RUNTIME_DIR"/sway-ipc.*.sock 2>/dev/null | head -n1 || true); [ -n "$SWAYSOCK" ] || exit 0; export SWAYSOCK; for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do swaymsg "[class=\".*\"] floating disable" >/dev/null 2>&1 || true; swaymsg "[class=\".*\"] border pixel 2" >/dev/null 2>&1 || true; swaymsg "[app_id=\".*\"] floating disable" >/dev/null 2>&1 || true; swaymsg "[app_id=\".*\"] border pixel 2" >/dev/null 2>&1 || true; sleep 0.5; done ) &' \
        'disown -a 2>/dev/null || true' \
        'exit 0' \
        > /usr/local/bin/launch-gui-app \
    && chmod 755 /usr/local/bin/launch-gui-app

# Avoid CRLF rewriting when files are written through docker exec.
RUN git config --system core.autocrlf false
