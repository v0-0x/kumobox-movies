<p align="center"><img src="packaging/icons/kumobox-128.png" width="96" alt="KumoBox"></p>

<h1 align="center">KumoBox</h1>

<p align="center">A movie and TV app for Arch Linux, Windows and macOS: your local library, Letterboxd tracking, streaming providers, torrents and an extension system — in one desktop app that only ever talks to your own computer and home network.</p>

<p align="center"><sub>KumoBox is <a href="https://github.com/v0-0x/kumo-anime">Kumo</a> (the anime app) for movies and shows: same architecture, same features, with TMDB and Letterboxd in place of AniList.</sub></p>

---

## Features

**Library**
- Scans your movie and TV folders (plus extra folders), reads every file and folder name and **matches it to TMDB automatically**: scene/release names (`The.Matrix.1999.1080p.BluRay.x264-GROUP`), Plex/Jellyfin layouts (`Show (2008)/Season 01/S01E02.mkv`, `Movie (2010)/Movie (2010).mkv`), id tags (`{tmdb-603}`, `[imdbid-tt0133093]`), multi-episode files, season packs, specials (season 0), daily shows and absolute numbering. Trailers, featurettes, samples and other extras are left out.
- Works with **every video format**: mkv, mp4, avi, webm, mov, wmv, flv, ts/m2ts, ogm, rmvb, vob, 3gp, divx and more.
- **Auto refresh**: watches the folders and rescans when files appear, and refreshes on startup.
- **Local library** page with only the titles you have on disk: recently added, filters by list status, sorting, grid or list view with the episodes you have per season, size, resolution and release group, and one-click "play next".
- **Library sharing** between the KumoBox apps on your computers at home: they find each other by themselves (or by address). Turn on **Share my library** in **Settings › Local Library › Library sharing** on the computer with the files: its movies and shows show up on the others and play like local files.
- Library tools to fix matches by hand, change season/episode numbers, lock files and ignore junk. Safe with removable drives; symlinked folders are followed.

**Movies & shows (TMDB)**
- Posters, backdrops, descriptions, genres, certifications, cast & crew, trailers, collections (franchises), recommendations, and for shows every **season and episode** with titles, summaries, stills and air dates. All artwork is cached locally, so it loads instantly and still shows offline.
- **Where to watch**: the streaming services, rentals and stores that have a title in your country (TMDB / JustWatch data).
- **Discover** (trending, popular, top rated, in cinemas, coming soon, on the air), **Search** with filters (movies/shows, genres, year, rating, language, sort) and a **Calendar** of the upcoming episodes of the shows on your list.

**Your list & Letterboxd**
- A list that works with no account: Watching, Watchlist, Watched, Rewatching, Paused, Dropped — with Letterboxd-style **half-star ratings**, likes, reviews, watched dates and a **diary** of every viewing. Shows are tracked episode by episode.
- **Letterboxd sync** (films):
  - **Connect your username**: KumoBox reads your public Letterboxd diary on its own (every hour by default) and brings your viewings, ratings, likes and reviews into your list.
  - **Import your Letterboxd export** (letterboxd.com › Settings › Data › Export): watched films, ratings, diary, reviews, likes and watchlist.
  - **Send what you watch in KumoBox to Letterboxd**: movies you finish are logged in KumoBox's diary and exported as a CSV that [letterboxd.com/import](https://letterboxd.com/import/) takes (one click, then "I imported it").
  - With access to Letterboxd's official API (granted by Letterboxd on request), KumoBox logs viewings straight to your account.
- Progress updates automatically after an episode or movie passes the completion threshold you set.

**Watching**
- **mpv** (desktop media player, controlled over IPC) or the **in-app player**.
- In-app player plays any file: direct play when the browser can, otherwise ffmpeg **remuxes or transcodes on the fly** (VA-API / NVENC / QSV supported). Embedded and external subtitles (ASS/SRT/VTT) and audio-track switching are supported.
- **Resume exactly where you stopped**: the position is saved every few seconds, in both players.
- **Plays the original language** (or your preferred dub) with its forced subtitles, and turns on subtitles in your language when the audio is foreign.
- **Remembers your audio and subtitle track per movie or show.** Pick "French + English subtitles" once and every next episode opens with the same tracks, matched by language and title, so it works even when the track order changes.
- Skips intros, recaps and end credits by the file's chapter names, auto play next across seasons, "Continue watching" row, now-playing bar for mpv.

**Streaming providers**
- **Internet Archive** built in: thousands of public-domain and Creative Commons films, streamed straight from archive.org.
- **Stremio addons**: browse the official addon collection (or any other collection) and install addons in one click, or paste any addon's manifest URL. Their streams play in KumoBox; torrent streams go to your torrent client; subtitle addons add subtitles.
- **Nuvio provider repositories**: add a repository URL and install its JavaScript providers, which run in KumoBox's sandbox.
- **KumoBox/Seanime-style extensions** from an extension marketplace.
- **Download** movies and episodes (single or ranges) with yt-dlp or ffmpeg straight into your library; they're matched instantly.

See [docs/PROVIDERS.md](docs/PROVIDERS.md) for the formats and how to write a provider.

**Torrents**
- **qBittorrent** (Web UI API, v4 and v5) and **Transmission** sync: list, pause/resume, remove (with data), open folder, active count in the sidebar. KumoBox can launch the client for you.
- Search from any movie or show page, by IMDb/TMDB/TVDB id where the source supports it: **Torznab** indexers (**Jackett**, **Prowlarr**), **YTS** (movies), **EZTV** (shows), **The Pirate Bay**, **Torrents-CSV**, **Internet Archive**, plus extension providers. Results are merged, de-duplicated and filtered to the right season/episode, with resolution, release group, pack and seeder badges. Each source can be turned off or pointed at a mirror (**Settings › Torrent Sources**).
- **Auto downloader** for shows: rules per show (resolution, release groups, keywords, minimum seeders, season packs) grab new episodes as they air.

**Extensions & plugins**
- Runs online-streaming, torrent and Nuvio providers in a sandboxed JavaScript runtime with the APIs extensions use (`fetch`, `LoadDoc`/cheerio, `CryptoJS`, `$store`, `$storage`, user config…), and **UI plugins** (trays, title-page buttons, webviews, toasts, storage). Plugins never get file, command or local-network access.

**Extras**: can keep running in the tray (or the Dock) when its window is closed, so streaming to other devices and downloads go on, and start in the background when you log in (Settings › App › Desktop app); updates itself from the Home page, Discord rich presence (local IPC), accent colours, spoiler blur, Ctrl+K quick search, server logs and cache viewer.

## Closed network by design

| Who | Access |
|---|---|
| The desktop window | Always (authenticated with a per-run token) |
| A browser on this PC | Only when **Settings › App › Web UI** is on (`http://127.0.0.1:43311`) |
| Devices on your home network | Only when **Allow devices on my network** is on. They can be password protected, and can't change paths/programs/providers, see keys or browse folders. |
| KumoBox on your other computers | With **Library sharing** on: they see it, and only those you turn on get the library, and nothing else (each KumoBox has its own key pair; requests are signed, and play only files of the library). |
| Anything on the internet | **Never** (connections from public IP addresses are refused) |

The server also rejects other websites' requests (Origin check) and DNS rebinding tricks (Host check). Extensions, providers and the stream/image proxies can't connect to localhost or your LAN (Jackett/Prowlarr indexers and addons you explicitly allow excepted). Nothing is sent anywhere except the services you use (TMDB, Letterboxd, the providers and torrent sources you turn on).

KumoBox and Kumo can run side by side: KumoBox has its own port (43311), data folder and app id.

## Install (Arch Linux)

```bash
sudo pacman -S --needed base-devel go nodejs npm electron mpv ffmpeg yt-dlp
git clone https://github.com/v0-0x/kumobox-movies kumobox && cd kumobox
cd packaging/arch && makepkg -si
```

No git? Download the source from GitHub (**Code › Download ZIP**), unpack it (`bsdtar -xf kumobox-*.zip`) and run `makepkg -si` in its `packaging/arch` folder.

Start **KumoBox** from your app menu (or run `kumobox`).

### Updates
When GitHub has a newer KumoBox, the **Home** page shows it with an **Update** button: KumoBox downloads the new source, builds it with makepkg and installs the package with pacman (a password dialog asks for your password); **Restart KumoBox** then starts the new version. **Settings › About & updates** shows the version and the last check, and checks again right away.

Without a password dialog (e.g. when KumoBox runs as the `kumobox-server` service), KumoBox builds the update and shows the `sudo pacman -U …` command to run. You can still update by hand: `cd kumobox && git pull && cd packaging/arch && makepkg -sif`.

### First run
1. **Settings › Metadata (TMDB)**: paste a free TMDB key. Create a themoviedb.org account, then [Settings › API](https://www.themoviedb.org/settings/api); either the "API Key" or the "API Read Access Token" works. KumoBox shows a banner until it has one: every title, poster and episode comes from TMDB.
2. **Settings › Local Library**: pick your movies/TV folder(s) and save. The first scan starts on its own.
3. Click your avatar, then **Connect Letterboxd** (optional): your username, and optionally your Letterboxd export.
4. **Providers & extensions**: install Stremio addons or add a Nuvio repository (the Internet Archive provider is on already).
5. **Settings › Torrent Client** and **Settings › Torrent Sources** (optional): your qBittorrent/Transmission details, and your Jackett/Prowlarr indexers.

### Headless / other devices
```bash
systemctl --user enable --now kumobox-server   # server only, web UI on 127.0.0.1:43311
```
Turn on **Allow devices on my network** (with a password) to use KumoBox from your phone or TV at `http://<pc-name>.local:43311`. The desktop app attaches to the running server.

## Windows

KumoBox runs on Windows 10/11 (64-bit): get the installer (`KumoBox-Setup-X.Y.Z-windows-x64.exe`) or the portable zip from the newest **KumoBox X.Y.Z for Windows** [release](https://github.com/v0-0x/kumobox-movies/releases) (tag `windows-vX.Y.Z`). The installer also offers to install the programs KumoBox uses (ffmpeg, mpv, yt-dlp) with Scoop, and the installed app updates itself from its Home page.

What to install alongside it, where it keeps its data, how to build it and how releases are made: [packaging/windows/README.md](packaging/windows/README.md).

## macOS

KumoBox runs on macOS 13 Ventura or newer, on Apple silicon and Intel Macs (one universal app): get the disk image (`KumoBox-X.Y.Z-macos-universal.dmg`) from the newest **KumoBox X.Y.Z for macOS** [release](https://github.com/v0-0x/kumobox-movies/releases) (tag `macos-vX.Y.Z`) and drag KumoBox to Applications. It isn't notarized by Apple: the first time, allow it in System Settings › Privacy & Security (**Open Anyway**). KumoBox downloads the programs it uses (ffmpeg, yt-dlp, mpv) from **Settings › App › Programs**, with no Homebrew needed, and updates itself from its Home page.

How to open it the first time, where it keeps its data, how to build it: [packaging/macos/README.md](packaging/macos/README.md).

## Development

```bash
make            # builds web/ and embeds it into dist/kumobox
make test       # Go tests
./dist/kumobox --web-ui              # server + web UI at http://127.0.0.1:43311
cd web && npm run dev                # UI dev server on :43100 (proxies /api)
cd desktop && npm i && npx electron .   # desktop window (uses ../dist/kumobox)
```

`KUMOBOX_DATA_DIR` moves the data folder; `KUMOBOX_TMDB_URL` / `KUMOBOX_TMDB_IMAGE_URL` point the catalog at another TMDB-compatible host, and `KUMOBOX_LETTERBOXD_URL` / `KUMOBOX_LETTERBOXD_API_URL` the Letterboxd sync at another host serving the diary feeds (`<url>/<username>/rss/`) and the API (tests, offline demos). `KUMOBOX_MEMORY_LIMIT_MB` changes the server's soft memory limit (256 MB; `0` turns it off, `GOMEMLIMIT` wins when set).

| Path | What |
|---|---|
| `server/` | Go server: TMDB catalog and list (`catalog`), Letterboxd (`letterboxd`), release-name parser (`release`), library scanner/matcher, streaming providers (`providers`), mpv IPC and players, downloads, torrents, extension runtime (goja), API |
| `web/` | React + Tailwind UI (embedded into the binary) |
| `desktop/` | Electron shell (system `electron` on Arch; bundled by electron-builder for Windows and macOS) |
| `packaging/` | PKGBUILD, launcher, `.desktop`, icons, systemd user unit; `windows/` and `macos/` build notes |
| `docs/` | [DESIGN.md](docs/DESIGN.md) (architecture, ids and episode keys), [PROVIDERS.md](docs/PROVIDERS.md) |

Data lives in `~/.local/share/kumobox` (SQLite database, artwork cache, extension storage; `%APPDATA%\KumoBox` on Windows, `~/Library/Application Support/KumoBox` on macOS).

## Notes
- TMDB's API may rate-limit large first scans; KumoBox waits and retries automatically.
- Letterboxd only tracks films: shows are tracked in KumoBox. The public diary feed holds your most recent viewings; import your Letterboxd export once to bring in everything older.
- Image-based subtitles (PGS/VobSub) only render in mpv.
- KumoBox is a personal project, unaffiliated with TMDB, Letterboxd, Stremio, Nuvio or the Internet Archive. This product uses the TMDB API but is not endorsed or certified by TMDB. Licensed GPL-3.0.
