# Streaming providers

KumoBox finds something to watch for a movie or an episode by asking
**providers**. Each one answers with streams: direct links (played in the
app or in mpv), torrents (streamed through the torrent client), YouTube
videos or web pages to open. All enabled providers are asked at once, each
within `providers.timeoutSeconds` (Settings › Providers), and the streams
are listed best first: direct links before torrents, the preferred quality
(`providers.preferredQuality`) first, then higher qualities, then the most
seeded. With a default provider (`onlineStream.defaultProvider`, empty for
none) its streams come first. Subtitles of Stremio subtitle addons come
with the direct links. What the providers answered is kept five minutes.

| Kind | Provider id | What | Ids it needs |
|---|---|---|---|
| Internet Archive (built in) | `archive` | public-domain and freely licensed films hosted by archive.org | title + year |
| Stremio addons | `stremio:<addon id>` | any addon serving `stream` (or `subtitles`) for `movie`/`series` | IMDb id (or `tmdb:` for addons that only take it) |
| Nuvio providers | `nuvio:<id>` | JavaScript scrapers from Nuvio provider repositories, run in KumoBox's extension sandbox | TMDB id |
| Extensions | `ext:<extension id>` | KumoBox/Seanime-style `onlinestream-provider` extensions: searched by title (+ year), the best match kept (wrong match? pick it by hand in Watch online), episodes numbered from the show's first one | title |

On a title's page, **Watch online** lists the streams of the movie, or of
the episode picked (the next one to watch by default): play a direct link
in the app or in mpv, download it into the library (its link is looked up
again when the download starts, from the same provider in the closest
quality: links expire), send a torrent to the torrent client (saved into
the library), open a YouTube video or a web page in the browser.

Code: `server/internal/providers` (common types, ranking, aggregation),
`providers/archive`, `providers/stremio`, `server/internal/extensions`
(`nuvio*.go`) for Nuvio providers, `server/internal/stream`
(`onlinestream.go`: the service asking them; `extension.go`: extensions as
providers), `server/internal/app/providers.go` (which providers, in which
order) and `server/internal/api/providers_routes.go` (the HTTP API).

## The in-app player

The in-app player gets a stream's direct links through `/api/proxy`
(headers, CORS, HLS playlists rewritten so that everything goes through
it), and each link named for the conversion endpoints (`remote`, a
`remote:` path). Before playing a link, it has it probed: what the
browser decodes plays as it is; anything else (Matroska, HEVC video,
AC-3, E-AC-3, DTS or TrueHD audio...) is remuxed or transcoded by ffmpeg
like a library file, ffmpeg reading the link from the stream relay on
this computer's loopback address (`server/internal/stream/remote.go`),
which fetches it with the proxy's guarded client.

HLS streams are probed too: one whose video the browser decodes, with AAC
or MP3 audio, plays as it is (hls.js), others are converted. ffmpeg reads
them through the relay, which rewrites their playlists so that every link
in them is the relay's (`relayhls.go`, see Downloads below). Of a master
playlist, the variant probed and converted is the one with the highest
bandwidth among those whose `CODECS` browsers play (H.264 with AAC or
MP3), else the one with the highest bandwidth. A stream that fails in
hls.js all the same (a codec error) is converted rather than skipped.

Subtitles: a stream's own subtitle files and those the subtitle addons
found for the title are listed in the player's subtitle menu (by
language) as WebVTT, fetched through the proxy and converted from SubRip
or ASS/SSA (UTF-8, UTF-16 or Windows-1252, gzipped or not). Once a
link's way of playing is decided, the player asks the subtitle addons
again for the very file (`GET /api/providers/subtitles`): KumoBox reads
its size and OpenSubtitles hash (the size plus the sum of the
little-endian 64-bit words of its first and last 64 KiB) with two byte
ranges, fetched like the stream, and sends them as Stremio does
(`videoSize`, `videoHash`, `filename`). Those come first, and the
default subtitles are picked again from them by the usual rules (the
title's remembered choice, else `playback.preferredSubLang` when the
audio is foreign), unless subtitles were picked by hand. Subtitles
inside an online stream's file aren't shown in the app (that would mean
reading all of it): mpv shows them.

## Downloads

A provider's link can name any address, this computer's and the local
network's included, and an HLS playlist names more of them. So downloads
fetch what links lead to the way the in-app player does
(`server/internal/stream`), never from this computer or the LAN, redirects
included (the addresses of Stremio addons installed as local ones
excepted), by what the link answers with
(`server/internal/downloads/fetch.go`):

* **A video file** is fetched by KumoBox itself, with the stream's
  headers. When the connection breaks it picks up where it stopped (a byte
  range from there, `If-Range` so a changed file starts over), and the
  file is named after what it holds (a Matroska file a provider calls an
  MP4 is saved as `.mkv`).
* **An HLS stream** is copied by ffmpeg, which reads it through the stream
  relay on this computer's loopback address: the relay fetches each
  playlist and hands ffmpeg a rewritten copy in which every variant,
  rendition, segment, key and init section is one of the relay's own
  links, fetched in turn with the guarded client (playlists rewritten the
  same way, segments refused when they're a playlist or a manifest). ffmpeg
  may only speak plain HTTP to it (`-protocol_whitelist http,tcp`, plus
  `crypto` for AES-128 encrypted streams). Of a master playlist, the
  variant with the highest bandwidth is downloaded, with its renditions.
* **A web page** (a stream marked as one, or a link answering with HTML)
  goes to yt-dlp, which fetches what it finds by itself: only when the
  page's host is on the internet, by its name and by the addresses it
  resolves to (and not when `downloads.downloader` is `ffmpeg`).
* DASH and other manifests aren't downloaded.

## Adding providers

Providers are managed on the **Providers & extensions** page (devices on
the LAN can use them, not install or remove them).

### Stremio addons

Providers & extensions › Stremio addons:

* **Paste an addon URL.** Any of these work: the manifest URL
  (`https://addon.example/manifest.json`), the addon's base URL
  (`https://addon.example`) or a `stremio://` install link. Addons
  that keep their settings in the URL (`https://addon.example/<config>/manifest.json`)
  are installed with that configuration.
* **Browse a collection.** The official Stremio collection
  (`https://api.strem.io/addonscollection.json`) is listed by default;
  more collections can be added to `providers.stremioCatalogs`. A
  collection is a JSON array of `{transportUrl, transportName, manifest,
  flags: {official, protected}}` (an addon catalog answer,
  `{"addons": [...]}`, works too).

KumoBox refuses addons it can't use (catalog- or metadata-only addons such
as Cinemeta), asks for confirmation for addons flagged `adult` and for
addons running on this computer or the local network (a private address,
`localhost`, a single-label host name like `nas`, or `.local`, `.lan`,
`.home.arpa`, `.internal`...), and sends addons that are
`configurationRequired` to their `/configure` page first. There's one
addon per manifest id, as in Stremio: installing another configuration of
an addon replaces the installed one, in place. Addons can be disabled,
reordered (they're asked, and their streams listed, in that order),
refreshed (manifests downloaded again) and removed.

Public addons are reached through KumoBox's guarded HTTP client, which
refuses to connect to the LAN even when a public host name resolves there.
Answers are limited in size (2 MB for a manifest, 8 MB for streams and
collections) and time (30 s per request, less within the provider
timeout).

### Nuvio repositories

Providers & extensions › Nuvio providers: paste a repository's manifest
URL, for example
`https://raw.githubusercontent.com/<user>/<repo>/refs/heads/main/manifest.json`
(kept in `providers.nuvioRepos`). KumoBox lists the repository's
providers; install the ones you want, or all those the repository enables
by default. Installed providers are extensions of type `nuvio-provider`
(id `nuvio.<provider id>`): they're enabled, disabled, updated and removed
there (or with the extension API), with their logs, and their updates come
with the other extension updates (KumoBox compares the versions in the
repository).

## HTTP API

| Route | What |
|---|---|
| `GET /api/providers` | every provider, in order: `[{id, name, kind, icon, types, enabled, extension}]` |
| `GET /api/providers/streams?mediaId=&episode=&provider=&refresh=1` | `{streams, errors: [{provider, name, error}], subtitles, providers, matches}`; each stream has a stable `id` and a `kind` (`direct`, `torrent`, `youtube`, `external`); `episode` is a key (a movie's is 1), `provider` empty for all |
| `POST /api/providers/play` | `{mediaId, episode, streamId \| stream \| provider, player: "builtin" \| "mpv", start}` → `{action: "builtin", sources, title, resumeAt, tracks}` (sources through `/api/proxy`, each named for the conversion endpoints as `remote`, the stream picked first), `{action: "mpv", session}`, `{action: "torrent", savePath}` or `{action: "external", url}` |
| `GET /api/providers/subtitles?mediaId=&episode=&remote=&filename=` | the subtitles of subtitle addons for the very file the stream `remote` (a source's `remote:` path) plays, matched by its size and OpenSubtitles hash: `[{url, language, label, original, addon}]`, WebVTT through the proxy, the preferred languages first |
| `POST /api/providers/download` | `{mediaId, episodes: [keys], provider, quality}` → the queued downloads |
| `GET /api/providers/search?provider=&q=`, `POST /api/providers/mapping` | an extension's titles, and picking one by hand `{provider, mediaId, id, title}` |
| `GET/POST/DELETE /api/providers/stremio/addons` | installed addons; install `{url, allowLocal, allowAdult}` (409 `{error, code: "local" \| "adult" \| "configure" \| "unsupported", configureUrl}`); remove `?key=` (transport URL or `stremio:<id>`) |
| `PUT /api/providers/stremio/addons/enabled`, `…/order` | `{key, enabled}`, `{keys}` |
| `POST /api/providers/stremio/refresh`, `GET /api/providers/stremio/catalog?url=` | manifests downloaded again; an addon collection (the first of `providers.stremioCatalogs` by default) |
| `GET /api/providers/nuvio/repo?url=`, `POST/DELETE /api/providers/nuvio/repos` | a repository with the installed and updatable providers marked; keeping or forgetting one |
| `POST /api/providers/nuvio/install`, `…/install-all` | `{repo, id}`, `{repo}` (the repository is kept too) |

## Formats

### Stremio

Requests are `GET <base>/stream/<type>/<id>.json` and
`GET <base>/subtitles/<type>/<id>[/<extra>].json`, where `<base>` is the
transport URL without `/manifest.json`, `<type>` is `movie` or `series`,
and `<id>` is `tt0133093` for a movie or `tt0944947:1:2` for season 1
episode 2. Addons whose `stream` resource only takes `tmdb:` ids get
`tmdb:603` / `tmdb:1399:1:2`. Without an IMDb id (TMDB doesn't know every
title's), IMDb-only addons are skipped with an error saying so.

Manifest fields read: `id`, `version`, `name`, `description`, `logo`,
`background`, `types`, `catalogs`, `resources` (strings, which take the
manifest's `types` and `idPrefixes`, or `{name, types, idPrefixes}`
objects), `idPrefixes`, `behaviorHints` (`adult`, `p2p`, `configurable`,
`configurationRequired`).

Stream objects, and what KumoBox makes of them:

| Stremio | KumoBox stream |
|---|---|
| `url` (http/https) | direct link; a `magnet:` URL becomes a torrent |
| `infoHash`, `fileIdx`, `sources` (`tracker:` entries) | torrent: info hash, file index (-1 = largest file), magnet link with those trackers (public trackers otherwise) |
| `ytId` | YouTube video |
| `externalUrl` | web page to open |
| `name`, `title`/`description` | title (description first), quality (`4k`, `1080p`...), size (`💾 1.2 GB`), seeders (`👤 123`) |
| `subtitles` `[{id, url, lang, label}]` | subtitles |
| `behaviorHints.notWebReady` | played through mpv/the proxy rather than the browser |
| `behaviorHints.proxyHeaders.request` | headers sent with the link |
| `behaviorHints.filename`, `videoSize` | file name, size |

`nzbUrl`, `rarUrls` and the other archive sources aren't supported; those
streams are skipped.

### Nuvio repository

A repository's `manifest.json` is either an array of provider entries or an
object `{"name", "version", "scrapers": [...]}`:

```json
[
  {
    "id": "myprovider",
    "name": "My Provider",
    "description": "Short description",
    "version": "1.0.0",
    "author": "You",
    "supportedTypes": ["movie", "tv"],
    "filename": "providers/myprovider.js",
    "enabled": true,
    "logo": "https://example.org/logo.png",
    "contentLanguage": ["en"],
    "formats": ["mp4", "m3u8"]
  }
]
```

`filename` is resolved against the manifest's URL (an absolute URL works
too). A missing `id` is taken from the file name, a missing
`supportedTypes` means both, a missing `enabled` means enabled (`enabled`
only says whether "install all" picks the provider).

## Writing a Nuvio provider for KumoBox

A provider is one CommonJS file exporting `getStreams`:

```js
const cheerio = require('cheerio-without-node-native');

/**
 * @param {string} tmdbId      TMDB id ("550")
 * @param {string} mediaType   "movie" or "tv"
 * @param {number} season      season number, null for movies
 * @param {number} episode     episode number, null for movies
 * @returns {Promise<Array>}   streams
 */
async function getStreams(tmdbId, mediaType, season, episode) {
  const path = mediaType === 'tv' ? `/tv/${tmdbId}/${season}/${episode}` : `/movie/${tmdbId}`;
  const res = await fetch('https://example.org' + path, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return [];
  const $ = cheerio.load(await res.text());
  return $('.source').map((i, el) => ({
    name: 'My Provider',
    title: $(el).find('.label').text().trim(),
    url: $(el).find('a').attr('href'),
    quality: $(el).data('quality'),        // "1080p", "4K", 720...
    size: $(el).attr('data-size'),         // "1.4 GB" or a number of bytes
    headers: { Referer: 'https://example.org/' },
  })).get();
}

module.exports = { getStreams };
```

Stream fields: `url` (required: http(s), or a magnet link), `name`,
`title`, `quality`, `size`, `headers`, `type` (`hls`/`m3u8`, `mp4`, `mkv`,
`webm`; guessed from the URL otherwise), `subtitles`
(`[{url, lang, label}]`), `fileName`, `behaviorHints.notWebReady`. Returning
`{streams: [...]}` works too.

What the code can use:

* `require('cheerio-without-node-native')` (or `cheerio`,
  `react-native-cheerio`): `cheerio.load(html)` gives a cheerio-style `$`:
  `$(selector[, context])`, `$(element)`, `$('<html>')`, `$.html()`,
  `$.text()`, `$.root()`; selections have a numeric `length`, `[i]`,
  `for...of`, `find`, `children`, `parent(s)`, `closest`, `next`/`prev`
  (`All`/`Until`), `siblings`, `contents`, `first`, `last`, `eq`, `slice`,
  `filter`, `not`, `is`, `has`, `add`, `each`, `map` (`.get()`),
  `get`, `toArray`, `index`, `text`, `html`, `attr`, `prop`, `data`, `val`,
  `hasClass`, `remove`... Elements passed to callbacks (also `this`) have
  `attribs`, `name`/`tagName`, `type`, `data` (text nodes), `children`.
  Selectors are CSS (cascadia): jQuery-only pseudo-classes like `:eq()` or
  `:first` aren't supported, use `.eq()` and `.first()`.
* `require('crypto-js')`: `AES.encrypt/decrypt` (CBC, PKCS#7),
  `MD5`, `SHA1`, `SHA256`, `SHA512`, `Hmac*`, `enc.Utf8/Hex/Base64/Latin1`
  (also `crypto-js/md5` and the like).
* `require('axios')`: `axios(config)`, `get`, `post`, `put`, `patch`,
  `delete`, `head`, `create({baseURL, headers, timeout})`, interceptors,
  `params`, JSON bodies and answers, errors with `response` for non-2xx
  statuses.
* `fetch` (with `Headers`, `text()`/`json()`/`arrayBuffer()` promises,
  `URLSearchParams` bodies, `AbortController`/`AbortSignal.timeout`),
  `console`, `setTimeout`, `Promise`, `URL`, `URLSearchParams`, `Buffer`,
  `atob`/`btoa`, `TextEncoder`/`TextDecoder`, `global`, `process.env`.
  `require('buffer')` and `require('url')` work; any other module throws.

Differences with the Nuvio app:

* `async`/`await` work as they are (no need for Nuvio's transpiling, though
  its generator-based output works too), and files using `import`/`export`
  are converted to CommonJS. A provider is still one file: bundle
  multi-file sources (`node build.js myprovider`).
* Providers run in KumoBox's extension sandbox: they can't reach this
  computer or the local network (`localhost`, `192.168.x.x`... are
  refused, for the repository and the code too), a call to `getStreams`
  gets the provider timeout of Settings › Providers, loading the file
  30 seconds. So a development server on the LAN (`npm start` in the
  nuvio-providers repository) can't be used: publish the repository
  somewhere public (a GitHub repository, a gist...) to test it.
* `console.log`/`error` go to the provider's logs (Extensions › the
  provider › Logs).
* Do no network work at the top level of the file: only in `getStreams`.
