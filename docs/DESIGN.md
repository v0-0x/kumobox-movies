# KumoBox design notes

KumoBox is Kumo (the anime app, github.com/v0-0x/kumo-anime) turned into an
app for **movies and TV shows**. It keeps Kumo's architecture and features —
Go server + React web UI embedded in the binary + Electron shell, local
library with automatic matching, mpv and in-app player, online streaming
providers, downloads, torrent search and clients, auto downloader,
extensions and UI plugins, library sharing between computers, Discord
presence, self-updates on Windows/macOS/Arch — and swaps the anime-specific
parts:

| Kumo (anime)                         | KumoBox (movies & shows)                                                |
|--------------------------------------|-------------------------------------------------------------------------|
| AniList (metadata + list)            | **TMDB** metadata (`internal/catalog`) + local list                     |
| AniList account sync                 | **Letterboxd** sync (`internal/letterboxd`): RSS diary, export import, CSV export, optional API |
| ani.zip episode metadata             | TMDB seasons/episodes (titles, overviews, stills)                       |
| ani-cli streaming                    | **Providers**: Internet Archive (built in), Stremio addons, Nuvio provider repos, Seanime-style extensions |
| Nyaa / AnimeTosho                    | **Torznab** (Jackett/Prowlarr), YTS, EZTV, The Pirate Bay (apibay), Torrents-CSV, Internet Archive, extension providers |
| anime file-name parser (habari)      | movie/TV release-name parser (`internal/release`)                        |
| AniSkip                              | skipping intros/recaps/credits by chapter names                         |
| Manga reader                         | removed                                                                  |
| Airing schedule (AniList)            | TV calendar: episodes of the shows on your list (TMDB air dates)        |

## Identity rules (must hold everywhere)

* **Media id** (`int`): a movie is its TMDB movie id; a show is
  `catalog.ShowBase + tmdbTVID` (ShowBase = 1,000,000,000). Helpers in
  `server/internal/catalog/ids.go`: `MovieID`, `ShowID`, `IsShow`,
  `IsMovie`, `TMDBID`, `KindOf`. The web UI mirrors them in
  `web/src/lib/ids.ts`.
* **Episode key** (`int`): `season*1000 + episode` (S02E05 → 2005, specials
  are season 0: S00E03 → 3). A movie has one "episode": key `1`
  (`catalog.MovieEpisode`). Every `episode` field/column/param in the app
  (watch history, library files, list progress, downloads, player
  sessions, track prefs...) holds a key. Keys sort in watch order.
* **List progress** is the key of the last regular episode watched (a
  watched movie has progress 1). It only moves forward. "12 / 24" counts are
  computed with `Media.EpisodeIndex(key)` / `TotalEpisodes()`.
  Next/previous episodes: `Media.NextEpisode(key)` / `PrevEpisode(key)`,
  which use `Media.Seasons` (always kept in the lite media).
* **Scores** are 0–100 internally; the UI shows Letterboxd-style 0.5–5
  stars (one half star = 10 points).
* **List statuses** keep AniList's codes, shown with movie words:
  `CURRENT` Watching, `REPEATING` Rewatching, `PLANNING` Watchlist,
  `PAUSED` Paused, `COMPLETED` Watched, `DROPPED` Dropped.
* **Media.Type** is `MOVIE` or `TV`. Collections are fetched with type
  `""` (everything), `MOVIE` or `TV`.

## Packages

| Package | What |
|---|---|
| `catalog` | TMDB client (`tmdb.go`), types, ids, `Platform` (cache + local list + diary), discover, search, schedule, seasons |
| `letterboxd` | RSS diary reader, export-ZIP importer, Letterboxd-import CSV writer, optional API client, `Sync` service |
| `release` | parses movie/TV file and release names: title, year, season, episode(s), resolution, source, codec, HDR, audio, group, edition, extras |
| `providers` | streaming providers: `archive` (Internet Archive), `stremio` (addon protocol client + catalogs), Nuvio JS providers (run in `extensions`' sandbox) |
| `torrent` | clients (qBittorrent, Transmission — unchanged), search sources (Torznab, YTS, EZTV, apibay, Torrents-CSV, Internet Archive), auto downloader for shows |
| `library` | scanner/matcher using `release` + `catalog` (folders like `Movie (2010)/`, `Show/Season 01/S01E02.mkv`): files matched by movie/show folder (earlier matches, `{tmdb-…}`/`{imdb-…}`/`{tvdb-…}` tags, the list, then a remembered TMDB search); kinds `main`, `part` (a movie's later part), `special`, `extra`; a multi-episode file's last key in `episodeEnd` |
| `stream` | in-app player helpers (unchanged) + `Service` aggregating the providers |
| `player` | mpv/in-app sessions; chapter-based intro/credits skip |
| everything else | as in Kumo (share, update, downloads, discord, images, extensions, winsetup, macsetup, util) |

## Settings (server/internal/config)

New blocks (see `config/kumobox.go`): `tmdb` (apiKey, language, region),
`letterboxd` (username, autoSync, syncMinutes, logWatched,
importWatchlist, apiClientId, apiClientSecret), `providers` (archive,
stremioCatalogs, nuvioRepos, preferredQuality, timeoutSeconds),
`torrentSources` (torznab[], yts, eztv, pirateBay, torrentsCsv, archive).
Kumo's `aniCli`, `manga` and `anilist` blocks are gone.

Without a TMDB key the app still runs (library scan, players, settings)
and the UI asks for a key (first-run banner + Settings › Metadata).
`KUMOBOX_TMDB_URL` / `KUMOBOX_TMDB_IMAGE_URL` override the API and image
hosts (tests, offline demos).

## Playback (`internal/player`)

* **Skipping by chapters** (`chapters.go`): chapter names are classified
  as `intro` (Intro, Opening, OP, Opening Credits, Title Sequence, Main
  Titles), `recap` (Recap, Previously On), `credits` (Credits, End
  Credits, Ending, ED, Outro) or `preview` (Preview, Next Episode, Next
  Time); scenes after the credits are never skipped. Settings
  `playback.skipIntro` covers intros and recaps, `playback.skipCredits`
  credits and previews. Local files: ffprobe's chapters (`stream.Probe`,
  cached per path, size and modification time) →
  `GET /api/playback/skips?path=` and the `skips` of the in-app player's
  `POST /api/playback/local`. mpv: the `chapter-list`/`chapter`
  properties; entering a skipped chapter seeks past it (and the skipped
  chapters right after it) with an OSD "Skipped intro". Credits that run
  to the end of the file are only skipped when auto play next has a next
  episode to play. Streams have no chapters.
* **Tracks** (`choose.go`, `ChooseTracks`): the choice remembered for the
  title (track prefs, by media id) wins; else audio in
  `preferredAudioLang` when set, else the title's original language
  (`Media.OriginalLanguage`, ISO 639-1, matched against 639-2/B, 639-2/T
  and BCP 47 tags); subtitles with `playback.subtitlesForForeign`
  (default) in `preferredSubLang` (English when unset) only when the audio
  isn't in the user's languages (that one or `preferredAudioLang`),
  without it whenever `preferredSubLang` is set; otherwise off, except
  forced subtitles in the audio's language. The in-app player gets the
  same choice for local files (`choice` of `POST /api/playback/local`).
* **Episodes**: sessions, history and progress use episode keys; auto
  play next (`app/playback.go`) is `Media.NextEpisode` across seasons,
  from the next file (this computer's or a shared one) or, for a stream,
  the same provider and version. Players title episodes
  "Show — S01E02 · Episode title" and movies "Title (Year)".
* **Discord** (`discord.Presence`): "Watching <title>", the episode
  ("S01E02 · Episode title") or the year, the TMDB poster as the large
  image (an https URL), the application's `kumobox` art asset as the
  small one ("KumoBox"), and the time bar while playing. It needs a
  Discord application id in Settings › Discord.

## HTTP API (renamed from Kumo's anime routes)

| Kumo | KumoBox |
|---|---|
| `GET /api/anime/collection` | `GET /api/media/collection?type=` |
| `GET /api/anime/{id}` | `GET /api/media/{id}` (`?refresh=1`) |
| `POST /api/anime/{id}/entry`, `DELETE …/entry` | `POST/DELETE /api/media/{id}/entry` |
| `POST /api/anime/{id}/episode` | `POST /api/media/{id}/episode` (body `{episode: key, watched}`) |
| `GET/PUT /api/anime/{id}/language` | `GET/PUT /api/media/{id}/language` |
| — | `GET /api/media/{id}/season/{n}` → `SeasonDetail` |
| — | `GET /api/media/{id}/episodes` (library-aware episode list, as Kumo's; each episode's `key` — also in `number` — `season` and `episode`) |
| — | `GET /api/library/titles?host=` (Local library page: each title's files summed up) |
| `POST /api/library/match` | same, body `{paths, mediaId, absolute?, season?, episodeOffset?, renumber?}` |
| `POST /api/anilist/search` | `POST /api/catalog/search` |
| `GET /api/anilist/discover` | `GET /api/catalog/discover` |
| `GET /api/anilist/schedule` | `GET /api/catalog/schedule?start=&end=` |
| `GET /api/anilist/list` | `GET /api/catalog/list` |
| — | `GET /api/catalog/genres` |
| `POST /api/auth/anilist` | `POST /api/letterboxd/connect` `{username}` |
| `POST /api/auth/logout` | `POST /api/letterboxd/disconnect` |
| — | `POST /api/letterboxd/sync`, `POST /api/letterboxd/import` (multipart ZIP/CSV), `GET /api/letterboxd/export.csv` + `POST /api/letterboxd/mark-exported`, `GET /api/letterboxd/watchlist.csv`, `GET /api/letterboxd/status`, `GET /api/letterboxd/diary`, `DELETE /api/letterboxd/diary/{id}`, `POST /api/letterboxd/push`, `POST`/`DELETE /api/letterboxd/api-login` |
| `/api/onlinestream/*` | `/api/providers/*` (providers, sources, play, download, stremio install/uninstall, nuvio repos) |
| `/api/anicli/status` | removed |
| `/api/manga/*` | removed |

The Letterboxd routes are in `api/letterboxd.go`. Devices on the LAN read
the status and the diary, sync, export and send; connecting or
disconnecting the account, importing files and the API sign-in are done on
this computer. The account is only changed by connect/disconnect (or an API
sign-in with none connected), never by `PUT /api/settings`. A movie that
becomes Watched (played to the end, marked watched, or put on the Watched
list: `App.UpdateEntry`) is logged in the diary once a day
(`app/letterboxd.go`), and a rating given afterwards goes to that entry
while it isn't on Letterboxd yet; shows aren't logged, nor what another
KumoBox on the account finished. A diary entry Letterboxd has (imported,
or sent) that the user deletes is remembered (`diary_deleted`): syncing
doesn't import it again, by its id or as the same film the same day.
Events: `letterboxd-status` (with the
status), `diary-updated`, `collection-updated`.

## Conventions

* Match Kumo's style: plain-English comments that explain why, small
  focused files, table-driven tests.
* Tests never touch the network: use `httptest` servers and fixtures in
  `testdata/`. `go vet ./...` and `go test ./...` must pass on Linux,
  macOS and Windows (CI runs both).
* Git: commits are authored by the repository owner (the repo's local git
  config). Do not add `Co-Authored-By` or other trailers.
