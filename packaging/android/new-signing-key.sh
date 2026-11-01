#!/usr/bin/env bash
# Makes the key KumoBox for Android is signed with, once, on your computer, and
# puts it in the repository's secrets, where the Android release workflow
# signs with it (.github/workflows/android.yml). Until it's there, the
# workflow builds the APK with a throwaway key and publishes nothing.
#
# Needs openssl, and the GitHub CLI (gh, logged in with `gh auth login`) to
# put the key in the secrets itself; without it, the script says what to
# paste where. Keep the folder it makes (backed up): without the key, a new
# KumoBox can't update the installed one, which must then be reinstalled.
set -euo pipefail

repo="${KUMOBOX_REPO:-v0-0x/kumobox-movies}"
dir="${XDG_DATA_HOME:-$HOME/.local/share}/kumobox-android-key"
keystore="$dir/kumobox-release.p12"
alias=kumobox

umask 077
if [ -e "$keystore" ]; then
    echo "The key is made already: $keystore (its password: $dir/password)."
    echo "Delete that folder to make another one (installed copies would then need to be reinstalled)."
else
    command -v openssl > /dev/null || { echo "openssl is needed (sudo pacman -S openssl)" >&2; exit 1; }
    mkdir -p "$dir"
    pass=$(openssl rand -hex 24)
    openssl req -x509 -newkey rsa:4096 -sha256 -days 36500 -nodes -subj "/CN=KumoBox for Android" \
        -keyout "$dir/key.pem" -out "$dir/cert.pem" 2> /dev/null
    openssl pkcs12 -export -name "$alias" -inkey "$dir/key.pem" -in "$dir/cert.pem" \
        -out "$keystore" -passout "pass:$pass"
    rm -f "$dir/key.pem"
    printf '%s\n' "$pass" > "$dir/password"
    echo "Made the key: $keystore"
fi
pass=$(cat "$dir/password")
b64=$(base64 -w0 "$keystore")
echo "Its certificate (SHA-256): $(openssl x509 -in "$dir/cert.pem" -noout -fingerprint -sha256 | cut -d= -f2)"

if [ -z "${KUMOBOX_NO_GH:-}" ] && command -v gh > /dev/null && gh auth status > /dev/null 2>&1; then
    printf '%s' "$b64" | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$repo"
    printf '%s' "$pass" | gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$repo"
    printf '%s' "$alias" | gh secret set ANDROID_KEY_ALIAS --repo "$repo"
    printf '%s' "$pass" | gh secret set ANDROID_KEY_PASSWORD --repo "$repo"
    echo
    echo "Done: the secrets of $repo have the key. The next Android release is signed with it."
else
    cat <<EOF

The GitHub CLI isn't there or not logged in (gh auth login): add these 4
secrets by hand at https://github.com/$repo/settings/secrets/actions/new
(name, then value; each value on one line, nothing around it):

ANDROID_KEY_ALIAS
$alias

ANDROID_KEYSTORE_PASSWORD
$pass

ANDROID_KEY_PASSWORD
$pass

ANDROID_KEYSTORE_BASE64
$b64

Then clear this terminal (it shows the key): clear
EOF
fi
