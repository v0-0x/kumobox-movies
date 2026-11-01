# KumoBox for Android

Made for TVs (a Fire TV Stick, Android TV), mainly to watch the libraries
the computers at home share; it works on phones and tablets too.

The app runs KumoBox's server, the same as on a computer, built for Android
(`libkumobox.so`, which Android extracts somewhere it may run it), and shows its
web UI full screen. On a TV the web UI is in TV mode (`web/src/lib/tv.ts`):
the remote's arrows move the focus, OK presses, Back closes what's open or
goes back (at Home, KumoBox goes to the background: its server stays, so the
computers still reach it), ☰ lists what a right-click would, and the media
keys drive the player (Play, Pause, Play/Pause, rewind, fast-forward, Next
for the next episode).

- `app/src/main/java/app/kumobox/MainActivity.java`: the screen, the remote's
  keys, and what the page asks of the app (`window.KumoBoxAndroid`: keeping the
  screen on while a video plays, installing an update).
- `KumoBoxServer.java`: starts the server (data in the app's files) and waits for
  it to answer. The server stops by itself when the app is gone (its standard
  input closes, `--exit-with-stdin`), saving where a video was; the app
  starts it again (and reloads the page) if it stops, and opens the page
  again if the WebView's process crashes.
- `Installer.java`: installs an update the server downloaded (the newest
  `android-v<version>` release's APK); Android asks first.

## Building

[`.github/workflows/android.yml`](../.github/workflows/android.yml) builds and
publishes it on every push. By hand, with the Android SDK, the NDK and
Gradle 8.11:

```bash
cd web && npm ci && npm run build && cd ..
rm -rf server/internal/webui/dist && cp -R web/dist server/internal/webui/dist
cd server
tc=$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin
CGO_ENABLED=1 GOOS=android GOARCH=arm GOARM=7 CC=$tc/armv7a-linux-androideabi21-clang \
  go build -ldflags "-s -w" -o ../android/app/src/main/jniLibs/armeabi-v7a/libkumobox.so ./cmd/kumobox
CGO_ENABLED=1 GOOS=android GOARCH=arm64 CC=$tc/aarch64-linux-android21-clang \
  go build -ldflags "-s -w" -o ../android/app/src/main/jniLibs/arm64-v8a/libkumobox.so ./cmd/kumobox
cd ../android && gradle assembleRelease
```

## Signing

Android installs an update over KumoBox only when it's signed with the same
key as the installed app. The releases are signed with KumoBox's key, in the
repository's secrets.

Make that key once, on your computer, with
[`packaging/android/new-signing-key.sh`](../packaging/android/new-signing-key.sh):
it makes it in `~/.local/share/kumobox-android-key` (keep a backup: without it,
an installed KumoBox can't update and must be reinstalled) and puts it in the
secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` with the GitHub CLI (or says
what to paste where). Until then, the release workflow signs each build with
a throwaway key, keeps it as a workflow artifact, and publishes nothing.
