<p align="center"><img src="packaging/icons/moviko-128.png" width="96" alt="Moviko"></p>

<h1 align="center">Moviko</h1>
<p align="center"><sub>Called <b>KumoBox</b> until 2.0.9: every copy moved over to the new name by itself, with its data.</sub></p>

<p align="center">A movie and TV app for Arch Linux, Windows, macOS and Android TV (Fire TV): your local library, Letterboxd tracking, streaming providers, torrents and an extension system — in one app that only ever talks to your own computer and home network.</p>

<p align="center"><sub>Moviko is <a href="https://github.com/v0-0x/Aniko">Aniko</a> (the anime app, formerly Kumo) for movies and shows: same architecture, same features, with TMDB and Letterboxd in place of AniList.</sub></p>

---

## Features

**Library**
- Scans your movie and TV folders (plus extra folders), reads every file and folder name and **matches it to TMDB automatically**: scene/release names (`The.Matrix.1999.1080p.BluRay.x264-GROUP`), Plex/Jellyfin layouts (`Show (2008)/Season 01/S01E02.mkv`, `Movie (2010)/Movie (2010).mkv`), id tags (`{tmdb-603}`, `[imdbid-tt0133093]`), multi-episode files, season packs, specials (season 0), daily shows and absolute numbering. Trailers, featurettes, samples and other extras are left out.
- Works with **every video format**: mkv, mp4, avi, webm, mov, wmv, flv, ts/m2ts, ogm, rmvb, vob, 3gp, divx and more.
- **Auto refresh**: watches the folders and rescans when files appear, and refreshes on startup.
- **Local library** page with only the titles you have on disk: recently added, filters by list status, sorting, grid or list view with the episodes you have per season, size, resolution and release group, and one-click "play next".
- **Library sharing** between the Moviko apps on your computers and TVs at home: they find each other by themselves (or by address). On the computer with the files, turn on **Share my library** for the others in **Settings › Other devices**: its movies and shows show up on theirs and play like local files, converted by the computer that has them when needed. Watching updates the list (and Letterboxd diary) of the device you watch on, never the other's. Connected to the same Letterboxd account, Continue watching carries over to the second; positions saved while the other was off are sent when it's back, it syncs by itself when a device comes back on the network, and **Sync** on Home brings both up to date at once. A computer that's asleep can be **woken from the TV** (Wake-on-LAN on in its settings), and it **stays awake while another device plays its files**. Home asks whether to share with a new Moviko (a TV) when it shows up.
- Library tools to fix matches by hand, change season/episode numbers, lock files and ignore junk; **Missing episodes** (the gaps in your shows and the episodes aired since, with torrents a click away); **Clean up** (how full the drive is, what you watched a while ago, episodes there twice, put away into a trash that can be undone for 30 days). Safe with removable drives; symlinked folders are followed.
- Stays smooth with libraries of thousands of titles and files: the Local library and library tools only draw what's on screen.

**Movies & shows (TMDB)**
- Posters, backdrops, descriptions, genres, certifications, cast & crew, trailers, collections (franchises), recommendations, and for shows every **season and episode** with titles, summaries, stills and air dates. All artwork is cached locally, so it loads instantly and still shows offline.
- **Where to watch**: the streaming services, rentals and stores that have a title in your country (TMDB / JustWatch data).
- **Discover** (trending, popular, top rated, in cinemas, coming soon, on the air), **Search** with filters (movies/shows, genres, year, rating, language, sort) and a **Calendar** of the upcoming episodes of the shows on your list.

**Your list & Letterboxd**
- A list that works with no account: Watching, Watchlist, Watched, Rewatching, Paused, Dropped — with Letterboxd-style **half-star ratings**, likes, reviews, watched dates and a **diary** of every viewing. Shows are tracked episode by episode.
- **Letterboxd sync** (films):
  - **Connect your username**: Moviko reads your public Letterboxd diary on its own (every hour by default) and brings your viewings, ratings, likes and reviews into your list.
  - **Import your Letterboxd export** (letterboxd.com › Settings › Data › Export): watched films, ratings, diary, reviews, likes and watchlist.
  - **Send what you watch in Moviko to Letterboxd**: movies you finish are logged in Moviko's diary and exported as a CSV that [letterboxd.com/import](https://letterboxd.com/import/) takes (one click, then "I imported it").
  - With access to Letterboxd's official API (granted by Letterboxd on request), Moviko logs viewings straight to your account.
- Progress updates automatically after an episode or movie passes the completion threshold you set.

**Watching**
- **mpv** (desktop media player, controlled over IPC) or the **in-app player**.
- In-app player plays any file: direct play when the browser can, otherwise ffmpeg **remuxes or transcodes on the fly** (VA-API / NVENC / QSV supported). Embedded and external subtitles (ASS/SRT/VTT) and audio-track switching are supported. Online streams too, HLS included: one with HEVC video or AC-3/E-AC-3/DTS audio is converted rather than failing.
- **Resume exactly where you stopped**: the position is saved every few seconds, in both players.
- **Plays the original language** (or your preferred dub) with its forced subtitles, and turns on subtitles in your language when the audio is foreign.
- **Remembers your audio and subtitle track per movie or show.** Pick "French + English subtitles" once and every next episode opens with the same tracks, matched by language and title, so it works even when the track order changes.
- Skips intros, recaps and end credits by the file's chapter names, auto play next across seasons, "Continue watching" row, now-playing bar for mpv.
- An **Up next** card in the end credits, Start over, **previews on the seek bar** (also where Left/Right go on a TV), and **subtitles your way**: size, background and position for each device, timing moved with z / x (kept per movie or show).
- **Picture in picture** in the desktop app (p): the video goes on in a small window on top of the others, with Moviko's controls and subtitles; its button brings it back to the big player where it's at.

**Streaming providers**
- **Your own Jellyfin, Emby and Plex servers**: add them in Settings › Providers (with a Test button) and their movies and episodes show in Watch online, matched by TMDB/IMDb id, playing the files as they are. Their tokens stay on this computer.
- **Internet Archive** built in: thousands of public-domain and Creative Commons films, streamed straight from archive.org.
- **The luffy and FreeFlix sites** built in: the sources of the [luffy](https://github.com/DemonKingSwarn/luffy) and [FreeFlix](https://github.com/freedy237/freeflix-cli) command-line apps (Cinejoy; Vidlink, Hexa, Xpass, Mapple, Videasy), ported, each a provider you turn on (they're off by default) and can point at a mirror. Movies and episodes are found by their TMDB id; Cinejoy's own request encoder runs sandboxed and pinned to the build luffy checked.
- **Stremio addons**: browse the official addon collection (or any other collection) and install or uninstall addons in one click, open their configuration page, paste any addon's manifest URL, or import the addons of your Stremio account (your password isn't kept). Their streams play in Moviko; torrent streams go to your torrent client; subtitle addons add subtitles to online streams in the in-app player, found for the very file playing (by its size and OpenSubtitles hash).
- **Nuvio provider repositories**: add a repository URL and install its JavaScript providers, which run in Moviko's sandbox.
- **Moviko/Seanime-style extensions** from an extension marketplace.
- **Watch free**: Watch online lists the free and ad-supported services that have the title in your region (and the subscriptions that do), from TMDB/JustWatch, linking to where to watch it.
- **Watch online** shows each provider's sources as soon as it answers, with a spinner for those still looking. **Provider health** (Settings › Providers) shows which providers work and how fast, with a Test button; one that keeps failing is listed last and skipped by automatic picks until it answers again. A show's next episodes play from the provider and version (quality, release) you watched it in last.
- **Download** movies and episodes (single or ranges) straight into your library; they're matched instantly. Video files are fetched by Moviko itself (picking up where they stopped after a dropped connection), HLS streams with ffmpeg and web pages with yt-dlp, never from your own computer or local network.

See [docs/PROVIDERS.md](docs/PROVIDERS.md) for the formats and how to write a provider.

**Torrents**
- **qBittorrent** (Web UI API, v4 and v5) and **Transmission** sync: list, pause/resume, remove (with data), open folder, active count in the sidebar. Moviko can launch the client for you.
- Search from any movie or show page, by IMDb/TMDB/TVDB id where the source supports it: **Torznab** indexers (**Jackett**, **Prowlarr**), **YTS** (movies), **EZTV** (shows), **The Pirate Bay**, **Torrents-CSV**, **Internet Archive**, plus extension providers. Results are merged, de-duplicated and filtered to the right season/episode, with resolution, release group, pack and seeder badges. Each source can be turned off or pointed at a mirror (**Settings › Torrents**).
- **Auto downloader** for shows: rules per show (resolution, release groups, keywords, minimum seeders, season packs) grab new episodes as they air.

**Extensions & plugins**
- Runs online-streaming, torrent and Nuvio providers in a sandboxed JavaScript runtime with the APIs extensions use (`fetch`, `LoadDoc`/cheerio, `CryptoJS`, `$store`, `$storage`, user config…), and **UI plugins** (trays, title-page buttons, webviews, toasts, storage). Plugins never get file, command or local-network access, and an extension that uses too much memory is stopped (see [docs/PROVIDERS.md](docs/PROVIDERS.md)).

**Your movies & shows**
- **Alerts** when a new episode of a show you're watching airs, or something is ready to watch (a download or a torrent finished): in Moviko, or as the system's notifications.
- **What should I watch?** (the dice on Home) picks something from your list. **Stats**: your movies and shows in numbers, and what you watched month by month.
- **Backup and restore** (Settings › Backup & data): settings, watch history, list and diary, choices, matches, auto downloader rules, Stremio add-ons and extensions as one file; restoring merges with what's there.

**Extras**: can keep running in the tray (or the Dock) when its window is closed, so streaming to other devices and downloads go on, and start in the background when you log in (Settings › Desktop app & programs, both off unless you turn them on); updates itself from the Home page (stable releases, or betas too: Settings › Updates & about), Discord rich presence (local IPC), **color themes** (Midnight, Forest, Sakura, Ember, Ocean, Dusk, true Black…) and accent colours, **holiday themes** that come on by themselves in their month, each with its own colours, decorations and animation (Halloween's moon, cobweb and bats in October, Christmas lights and snow in December, Valentine's hearts in February, a cherry branch and falling petals in April, summer lanterns and fireflies in August, New Year's fireworks), or always one, or none — all switched from **Themes** in the sidebar (or Settings › Appearance), along with the **classic look** (Moviko as it looked before 2.0), spoiler blur, Ctrl+K quick search, a layout for phones, server logs and cache viewer.

## Closed network by design

| Who | Access |
|---|---|
| The desktop window | Always (authenticated with a per-run token) |
| A browser on this PC | Only when **Settings › Network & web UI › Web UI** is on (`http://127.0.0.1:43311`) |
| Devices on your home network | Only when **Allow devices on my network** is on. They can be password protected (Settings warns while they aren't), and can't change paths/programs, install, set up, turn on or off or remove providers, extensions and plugins, see keys or browse folders. |
| Moviko on your other computers and TVs | With **Library sharing** on: they see it, and only those you turn on get the library, and nothing else unless you also let them download there (each Moviko has its own key pair; requests are signed, and play only files of the library). |
| Other apps on an Android TV or phone | **Never**: the Moviko app's own window proves itself with a per-install token. |
| Anything on the internet | **Never** (connections from public IP addresses are refused) |

The server also rejects other websites' requests (Origin check) and DNS rebinding tricks (Host check); GET requests only read (whatever changes, syncs, installs or fetches again is a POST), so a link or an image on another site can't trigger any of that. Extensions, providers and the stream/image proxies can't connect to localhost or your LAN (Jackett/Prowlarr indexers, media servers and addons you explicitly allow excepted). Nothing is sent anywhere except the services you use (TMDB, Letterboxd, the providers and torrent sources you turn on).

Moviko and Kumo can run side by side: Moviko has its own port (43311), data folder and app id.

## Install (Arch Linux)

```bash
sudo pacman -S --needed base-devel go nodejs npm electron mpv ffmpeg yt-dlp
git clone https://github.com/v0-0x/kumobox-movies moviko && cd moviko
cd packaging/arch && makepkg -si
```

No git? Download the source from GitHub (**Code › Download ZIP**), unpack it (`bsdtar -xf Moviko-*.zip`) and run `makepkg -si` in its `packaging/arch` folder.

Start **Moviko** from your app menu (or run `moviko`).

### Updates
When GitHub has a newer Moviko, the **Home** page shows it with an **Update** button: Moviko downloads the new source, builds it with makepkg and installs the package with pacman (a password dialog asks for your password); **Restart Moviko** then starts the new version. **Settings › Updates & about** shows the version and the last check, and checks again right away.

**Stable or beta.** Each new version comes out as a **beta** first (a pre-release on GitHub), and the ones ready for everyone as a stable release. Moviko offers only stable releases, unless **Settings › Updates & about › Beta updates** is on: then betas too, as soon as they're out. Turning it off waits for the next stable release (a beta you have stays until one passes it). On Arch, a stable update builds the newest stable release's commit and a beta update the branch's newest commit.

Without a password dialog (e.g. when Moviko runs as the `moviko-server` service), Moviko builds the update and shows the `sudo pacman -U …` command to run. You can still update by hand, in the folder you cloned Moviko into:

```bash
pkill -f /usr/lib/moviko          # Moviko can't be replaced while it runs
git pull && cd packaging/arch && makepkg -sif
```

`-f` rebuilds (without it makepkg reinstalls the package it built last time). Build from a `git clone`, not a downloaded ZIP: without git the package's version can't be read.

### First run
1. **Settings › Metadata (TMDB)**: paste a free TMDB key. Create a themoviedb.org account, then [Settings › API](https://www.themoviedb.org/settings/api); either the "API Key" or the "API Read Access Token" works. Moviko shows a banner until it has one: every title, poster and episode comes from TMDB.
2. **Settings › Local library**: pick your movies/TV folder(s) and save. The first scan starts on its own.
3. Click your avatar, then **Connect Letterboxd** (optional): your username, and optionally your Letterboxd export.
4. **Providers & extensions**: install Stremio addons, add a Nuvio repository or turn on the luffy and FreeFlix sites (the Internet Archive provider is on already).
5. **Settings › Torrents** (optional): your qBittorrent/Transmission details, and your Jackett/Prowlarr indexers.

### Headless / other devices
```bash
systemctl --user enable --now moviko-server   # server only, web UI on 127.0.0.1:43311
loginctl enable-linger "$USER"              # and started at boot, before you log in
```
With linger on, the PC's library is there for the TV as soon as the PC is on, not only once you've logged in. Turn on **Allow devices on my network** (with a password) to use Moviko from your phone or a browser at `http://<pc-name>.local:43311`. The desktop app attaches to the running server.

## Windows

Moviko runs on Windows 10/11 (64-bit): get the installer (`Moviko-Setup-X.Y.Z-windows-x64.exe`) or the portable zip from the newest **Moviko X.Y.Z for Windows** [release](https://github.com/v0-0x/kumobox-movies/releases) (tag `windows-vX.Y.Z`). The installer also offers to install the programs Moviko uses (ffmpeg, mpv, yt-dlp) with Scoop, and the installed app updates itself from its Home page.

What to install alongside it, where it keeps its data, how to build it and how releases are made: [packaging/windows/README.md](packaging/windows/README.md).

## macOS

Moviko runs on macOS 13 Ventura or newer, on Apple silicon and Intel Macs (one universal app): get the disk image (`Moviko-X.Y.Z-macos-universal.dmg`) from the newest **Moviko X.Y.Z for macOS** [release](https://github.com/v0-0x/kumobox-movies/releases) (tag `macos-vX.Y.Z`) and drag Moviko to Applications. It isn't notarized by Apple: the first time, allow it in System Settings › Privacy & Security (**Open Anyway**). Moviko downloads the programs it uses (ffmpeg, yt-dlp, mpv) from **Settings › Desktop app & programs**, with no Homebrew needed, and updates itself from its Home page.

How to open it the first time, where it keeps its data, how to build it: [packaging/macos/README.md](packaging/macos/README.md).

## Android / Fire TV

Moviko for Android is made for TVs (a Fire TV Stick, Android TV) and plays the libraries the computers at home share, with the remote: get `Moviko-X.Y.Z-android.apk` from the newest **Moviko X.Y.Z for Android** [release](https://github.com/v0-0x/kumobox-movies/releases) (tag `android-vX.Y.Z`). On a Fire TV, install the **Downloader** app, allow it in Settings › My Fire TV › Developer options › Install unknown apps, and open the APK's address in it. Then, on a computer with Moviko, turn on **Library sharing** (Settings › Other devices): the TV shows up there. Turn on **Share my library** for it, and if you like **Let it download here** (the TV's downloads and torrents go to that computer, and it becomes where the TV downloads by default). Its downloads page and auto downloader then work on that computer. The app updates itself from its Home page (if Android's install question was cancelled, **Install** asks again); see [android/README.md](android/README.md). (Android releases are published once Moviko's Android signing key is in the repository's secrets: [android/README.md](android/README.md#signing).)

When something doesn't play right on the TV (no picture, it stops), the TV writes what it saw to its log and to the computer's (Settings › Logs & cache), which helps find out why.

## Development

```bash
make            # builds web/ and embeds it into dist/moviko
make test       # Go tests
./dist/moviko --web-ui              # server + web UI at http://127.0.0.1:43311
cd web && npm run dev                # UI dev server on :43100 (proxies /api)
cd desktop && npm i && npx electron .   # desktop window (uses ../dist/moviko)
```

`MOVIKO_DATA_DIR` moves the data folder; `MOVIKO_TMDB_URL` / `MOVIKO_TMDB_IMAGE_URL` point the catalog at another TMDB-compatible host, and `MOVIKO_LETTERBOXD_URL` / `MOVIKO_LETTERBOXD_API_URL` the Letterboxd sync at another host serving the diary feeds (`<url>/<username>/rss/`) and the API (tests, offline demos). `MOVIKO_MEMORY_LIMIT_MB` changes the server's soft memory limit (256 MB; `0` turns it off, `GOMEMLIMIT` wins when set); an extension call that grows the heap by more than half of it is stopped.

| Path | What |
|---|---|
| `server/` | Go server: TMDB catalog and list (`catalog`), Letterboxd (`letterboxd`), release-name parser (`release`), library scanner/matcher, streaming providers (`providers`), mpv IPC and players, downloads, torrents, extension runtime (goja), API |
| `web/` | React + Tailwind UI (embedded into the binary) |
| `desktop/` | Electron shell (system `electron` on Arch; bundled by electron-builder for Windows and macOS) |
| `packaging/` | PKGBUILD, launcher, `.desktop`, icons, systemd user unit; `windows/` and `macos/` build notes |
| `docs/` | [DESIGN.md](docs/DESIGN.md) (architecture, ids and episode keys), [PROVIDERS.md](docs/PROVIDERS.md) |

Data lives in `~/.local/share/moviko` (SQLite database, artwork cache, extension storage; `%APPDATA%\Moviko` on Windows, `~/Library/Application Support/Moviko` on macOS).

## Notes
- TMDB's API may rate-limit large first scans; Moviko waits and retries automatically.
- Letterboxd only tracks films: shows are tracked in Moviko. The public diary feed holds your most recent viewings; import your Letterboxd export once to bring in everything older.
- Image-based subtitles (PGS/VobSub) only render in mpv.
- Moviko is a personal project, unaffiliated with TMDB, Letterboxd, Stremio, Nuvio, the Internet Archive, luffy, FreeFlix or the sites they stream from. This product uses the TMDB API but is not endorsed or certified by TMDB. Licensed GPL-3.0.
