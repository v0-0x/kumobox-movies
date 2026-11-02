#!/bin/sh
# Launches the Moviko desktop app with the system Electron.
# Extra Electron flags can go in ~/.config/moviko-flags.conf (one per line);
# KumoBox's ~/.config/kumobox-flags.conf (Moviko's name before 2.0.9) still
# counts when there's no moviko-flags.conf.
ELECTRON="${MOVIKO_ELECTRON:-${KUMOBOX_ELECTRON:-electron}}"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}"
FILE="$CONF/moviko-flags.conf"
[ -f "$FILE" ] || FILE="$CONF/kumobox-flags.conf"
FLAGS=""
if [ -f "$FILE" ]; then
    FLAGS="$(grep -v '^#' "$FILE" | tr '\n' ' ')"
fi
# shellcheck disable=SC2086
exec "$ELECTRON" --ozone-platform-hint=auto $FLAGS /usr/lib/moviko/app "$@"
