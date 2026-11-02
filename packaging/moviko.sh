#!/bin/sh
# Launches the Moviko desktop app with the system Electron.
# Extra Electron flags can go in ~/.config/moviko-flags.conf (one per line).
ELECTRON="${MOVIKO_ELECTRON:-electron}"
FLAGS=""
if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/moviko-flags.conf" ]; then
    FLAGS="$(grep -v '^#' "${XDG_CONFIG_HOME:-$HOME/.config}/moviko-flags.conf" | tr '\n' ' ')"
fi
# shellcheck disable=SC2086
exec "$ELECTRON" --ozone-platform-hint=auto $FLAGS /usr/lib/moviko/app "$@"
