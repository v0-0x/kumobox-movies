# Streaming providers

KumoBox finds something to watch for a movie or an episode by asking
**providers**. Each one answers with streams: direct links (played in the
app or in mpv), torrents (streamed through the torrent client), YouTube
videos or web pages to open. All enabled providers are asked at once, each
within `providers.timeoutSeconds` (Settings › Providers), and the streams
are listed best first: direct links before torrents, the preferred quality
(`providers.preferredQuality`) first, then higher qualities, then the most
seeded.

| Kind | What | Ids it needs |
|---|---|---|
| Internet Archive (built in) | public-domain and freely licensed films hosted by archive.org | title + year |
| Stremio addons | any addon serving `stream` (or `subtitles`) for `movie`/`series` | IMDb id (or `tmdb:` for addons that only take it) |
| Nuvio providers | JavaScript scrapers from Nuvio provider repositories, run in KumoBox's extension sandbox | TMDB id |
| Extensions | KumoBox/Seanime-style marketplace extensions | as before |

Code: `server/internal/providers` (common types, ranking, aggregation),
`providers/archive`, `providers/stremio`, and `server/internal/extensions`
(`nuvio*.go`) for Nuvio providers.

## Adding providers

### Stremio addons

Settings › Providers › Stremio addons:

* **Paste an addon URL.** Any of these work: the manifest URL
  (`https://torrentio.strem.fun/manifest.json`), the addon's base URL
  (`https://torrentio.strem.fun`) or a `stremio://` install link. Addons
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

Settings › Providers › Nuvio: paste a repository's manifest URL, for
example
`https://raw.githubusercontent.com/<user>/<repo>/refs/heads/main/manifest.json`
(kept in `providers.nuvioRepos`). KumoBox lists the repository's
providers; install the ones you want, or all those the repository enables
by default. Installed providers are extensions of type `nuvio-provider`
(id `nuvio.<provider id>`): they show up in Extensions, with their logs,
can be disabled or removed there, and their updates come with the other
extension updates (KumoBox compares the versions in the repository).

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
