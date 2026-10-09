#!/bin/sh
# Launches the KumoBox desktop app with the system Electron.
# Extra Electron flags can go in ~/.config/kumobox-flags.conf (one per line).
ELECTRON="${KUMOBOX_ELECTRON:-electron}"
FLAGS=""
if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/kumobox-flags.conf" ]; then
    FLAGS="$(grep -v '^#' "${XDG_CONFIG_HOME:-$HOME/.config}/kumobox-flags.conf" | tr '\n' ' ')"
fi
# shellcheck disable=SC2086
exec "$ELECTRON" --ozone-platform-hint=auto $FLAGS /usr/lib/kumobox/app "$@"
