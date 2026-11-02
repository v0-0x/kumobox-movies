# Moviko for macOS

Moviko, the movies and TV shows app, runs on macOS 13 Ventura or newer, on
Apple silicon and Intel Macs: one universal app for both. It's the same Moviko
as on Linux and Windows: a local server with the app's window on top of it.

## Install

1. Download `Moviko-X.Y.Z-macos-universal.dmg` from the newest **Moviko X.Y.Z for
   macOS** [release](https://github.com/v0-0x/kumobox-movies/releases) (tag
   `macos-vX.Y.Z`).
2. Open it and drag **Moviko** onto **Applications**.
3. Open Moviko from your Applications folder.

Moviko isn't notarized by Apple (that takes a paid Apple Developer account), so
the first time macOS says it can't check Moviko for malicious software:

- **macOS 15 Sequoia and newer:** click **Done**, then go to **System Settings
  › Privacy & Security**, scroll down to the message about Moviko and click
  **Open Anyway** (macOS asks for your password).
- **macOS 13 and 14:** Control-click Moviko in Applications, choose **Open**, then
  **Open** again.

Or, in Terminal, once: `xattr -dr com.apple.quarantine /Applications/Moviko.app`

Movie and show details (posters, seasons, episodes, cast) come from
[TMDB](https://www.themoviedb.org): the first time, Moviko asks for your free
TMDB API key (**Settings › Metadata**). Letterboxd tracking needs only your
Letterboxd username.

## Programs Moviko uses

| Program | For |
|---|---|
| ffmpeg (with ffprobe) | The in-app player (most files), stream downloads, and reading a file's audio and subtitle tracks |
| yt-dlp | Faster, more reliable stream downloads |
| mpv | The external player (optional: Moviko has its own) |
| qBittorrent or Transmission | Torrents (optional) |

**Settings › Desktop app & programs › Install missing programs** downloads ready-made
ffmpeg, ffprobe and yt-dlp for your Mac (Apple silicon or Intel) into Moviko's
own folder, `~/Library/Application Support/Moviko/bin`, in a Terminal window:
no Homebrew, no password. ffmpeg comes from
[Martin Riedl's builds](https://ffmpeg.martin-riedl.de) (and
[evermeet.cx](https://evermeet.cx/ffmpeg/) on Intel), yt-dlp from its GitHub
project. The script is
[`server/internal/macsetup/install-tools.command`](../../server/internal/macsetup/install-tools.command).

mpv is optional. On an Apple silicon Mac with [Homebrew](https://brew.sh) the
setup installs it with `brew install mpv`; otherwise get it from
[mpv.io](https://mpv.io/installation/). Homebrew no longer builds ready-made
packages for Intel Macs, so there it would compile everything for a long time.

Moviko also finds programs installed with Homebrew (`/opt/homebrew/bin` on Apple
silicon, `/usr/local/bin` on Intel), even when it's opened from the Dock, which
doesn't give apps those folders.

For torrents, Moviko talks to [qBittorrent](https://www.qbittorrent.org)'s Web
UI or to [Transmission](https://transmissionbt.com)'s remote access: turn it on
in the torrent client, and set the address and login in **Settings ›
Torrents**.

## Where Moviko keeps its files

| What | Where |
|---|---|
| Settings, database (your list, diary, library matches, watch progress), artwork, extensions | `~/Library/Application Support/Moviko` |
| The window's own data (browser cache, local storage) | `~/Library/Application Support/Moviko/electron` |
| Programs the setup downloaded | `~/Library/Application Support/Moviko/bin` |
| Updates being downloaded | `~/Library/Caches/moviko/update` |
| The local library, until you pick yours in **Settings › Local library** | `~/Movies` |

## Updates

Moviko checks GitHub for a newer macOS release, and the **Update** button on its
Home page installs it: Moviko downloads the new app, puts it in place of the old
one, closes and opens again. That works once Moviko is in a folder you can write
to (your Applications folder): not from the disk image, nor from your Downloads
folder before you've moved it. If macOS says Moviko was prevented from modifying
apps, allow it in **System Settings › Privacy & Security › App Management**, or
download the new version from its release page.

## Build it yourself

On a Mac with Go, Node.js and the Xcode command line tools:

```bash
make macos                 # web UI, then the servers for Intel and Apple silicon
cd desktop && npm ci
npx electron-builder --mac --universal -c.directories.output=../dist/macos/release
```

The app (`mac-universal/Moviko.app`), the disk image and the zip land in
`dist/macos/release`. `make macos` works on Linux too (the servers
cross-compile into `dist/macos/moviko-x64` and `moviko-arm64`); the app
itself needs a Mac.

## How releases are made

The **macOS release** workflow (`.github/workflows/macos.yml`) builds, tests
and packages Moviko on a GitHub-hosted Mac for every push, on any branch, and
for every pull request. It checks the app (both architectures, its signature,
the zip as an update unpacks it, and that it starts and its server answers)
and keeps the disk image and the zip as downloadable workflow artifacts, so a
branch can be tried before it's merged. Only pushes to the default branch (or
a run from the **Actions** tab with **publish** ticked) publish the release
`macos-v<version>`. The version is `2.0.<commits since 2.0.0's>`
(`1.0.<number of commits>` before), like the Windows release's. Each published
build is a beta (a pre-release) unless its commit's message says `[stable]` or
it's run by hand as stable (see packaging/windows/README.md). The newest 10
stable macOS releases and the newest 10 betas are kept.
