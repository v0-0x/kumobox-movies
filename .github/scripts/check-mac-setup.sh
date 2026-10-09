#!/bin/bash
# Runs KumoBox's macOS programs setup (server/internal/macsetup/
# install-tools.command) like a user would, without Homebrew, into a fresh
# folder, then checks that the programs it put there run on this Mac. The
# macOS release workflow runs it on Apple silicon and on Intel.

bin="${RUNNER_TEMP:-/tmp}/kumobox-bin"
script="${RUNNER_TEMP:-/tmp}/kumobox-setup.command"
rm -rf "$bin"
sed "s|'@KUMOBOX_BIN@'|'$bin'|" server/internal/macsetup/install-tools.command >"$script"
chmod 755 "$script"
echo "== $(uname -m), macOS $(sw_vers -productVersion)"
KUMOBOX_SETUP_NO_BREW=1 TERM=dumb "$script" </dev/null
echo "== the setup ended with $?"

failed=""
check() {
	name=$1
	shift
	out=$("$@" 2>&1)
	code=$?
	first=$(printf '%s\n' "$out" | head -1)
	if [ $code -eq 0 ] && [ -n "$first" ]; then
		echo "$name: $first | $(file -b "$bin/$name" | cut -c1-90)"
	else
		echo "::error::$name doesn't run (exit $code): $first"
		failed="$failed $name"
	fi
}
check ffmpeg "$bin/ffmpeg" -hide_banner -version
check ffprobe "$bin/ffprobe" -hide_banner -version
check yt-dlp "$bin/yt-dlp" --version
# mpv only comes with Homebrew, which the check leaves out: nothing to run.
if [ -n "$failed" ]; then
	echo "::warning::The programs setup didn't install:$failed"
	exit 1
fi
