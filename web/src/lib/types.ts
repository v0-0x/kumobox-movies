// Shapes returned by the KumoBox API (mirrors the Go structs).

export type FuzzyDate = { year?: number | null; month?: number | null; day?: number | null }

// ---------------------------------------------------------------------------
// The catalog (server/internal/catalog/types.go). Media ids and episode keys
// are explained in lib/ids.ts.

export type MediaType = "MOVIE" | "TV"

// An episode of a show and when it airs: episode is its key, airingAt that
// day at 00:00 UTC (TMDB only has air dates).
export type AiringEpisode = {
    id?: number
    airingAt: number
    timeUntilAiring: number
    episode: number
    title?: string
    media?: Media
}

export type Person = { id: number; name: { full: string }; image: { large: string } }

// One cast member: node is the role (named after the character, with the
// actor's photo), voiceActors[0] the actor.
export type CharacterEdge = { role: string; node: Person; voiceActors: Person[] }

export type CrewMember = { id: number; name: string; job: string; image?: string }

// A season as listed with its show; number 0 holds the specials.
export type Season = { seasonNumber: number; name: string; episodeCount: number; airDate?: string; poster?: string }

// An episode from its season's details (GET /api/media/{id}/season/{n}).
export type Episode = {
    key: number
    season: number
    number: number
    title: string
    overview?: string
    still?: string
    airDate?: string // YYYY-MM-DD
    runtime?: number // minutes
    rating?: number // 0-10
}

export type SeasonDetail = {
    mediaId: number
    seasonNumber: number
    name: string
    overview?: string
    poster?: string
    airDate?: string
    episodes: Episode[] | null
}

export type WatchProvider = { id: number; name: string; logo: string }

// Where a title can be watched in one country (TMDB, from JustWatch).
export type WatchProviders = {
    region: string
    link?: string
    flatrate?: WatchProvider[]
    free?: WatchProvider[]
    ads?: WatchProvider[]
    rent?: WatchProvider[]
    buy?: WatchProvider[]
}

export type CollectionRef = { id: number; name: string; poster?: string; backdrop?: string }

export type ListEntryLite = { id: number; status: string; progress: number; score: number; repeat: number }

// A movie or a show.
export type Media = {
    id: number
    tmdbId: number
    imdbId?: string
    tvdbId?: number
    type: MediaType
    format: string // MOVIE, TV or MINISERIES
    status: string // FINISHED, RELEASING, NOT_YET_RELEASED, CANCELLED
    season?: string
    seasonYear?: number | null
    episodes?: number | null // regular episodes of a show, 1 for a movie
    duration?: number | null // minutes (per episode for shows)
    isAdult: boolean
    title: { romaji?: string; english?: string; native?: string; userPreferred?: string }
    synonyms?: string[] | null
    coverImage: { extraLarge?: string; large?: string; medium?: string; color?: string }
    bannerImage?: string
    genres?: string[] | null
    averageScore?: number | null // TMDB rating x 10
    meanScore?: number | null
    popularity?: number
    voteCount?: number
    startDate?: FuzzyDate
    endDate?: FuzzyDate
    tagline?: string
    originalLanguage?: string
    certification?: string
    seasons?: Season[] | null
    latestEpisode?: number // key of the last episode that aired
    nextAiringEpisode?: AiringEpisode | null
    description?: string
    countryOfOrigin?: string
    siteUrl?: string
    belongsTo?: CollectionRef | null
    trailer?: { id: string; site: string; thumbnail: string } | null
    studios?: { nodes: { id: number; name: string; logo?: string }[] | null } | null
    tags?: { name: string; rank: number; isMediaSpoiler: boolean }[] | null
    relations?: { edges: { relationType: string; node: Media | null }[] | null } | null
    recommendations?: { nodes: { mediaRecommendation: Media | null }[] | null } | null
    characters?: { edges: CharacterEdge[] | null } | null
    crew?: CrewMember[] | null
    watchProviders?: WatchProviders | null
    mediaListEntry?: ListEntryLite | null
}

// A media on the user's list. progress is the key of the last episode
// watched (1 for a watched movie); score is 0-100 (a half star is 10);
// notes is the review.
export type ListEntry = {
    id: number
    mediaId: number
    status: string
    progress: number
    score: number
    repeat: number
    notes?: string
    private?: boolean
    liked?: boolean
    startedAt?: FuzzyDate
    completedAt?: FuzzyDate
    updatedAt: number
    letterboxdUri?: string
    letterboxdSynced?: number
    media: Media
}

// POST /api/media/{id}/entry
export type EntryUpdate = {
    status?: string
    progress?: number
    score?: number
    repeat?: number
    notes?: string
    liked?: boolean
    startedAt?: FuzzyDate
    completedAt?: FuzzyDate
}

// GET /api/catalog/list
export type RawCollection = { lists: { name: string; status: string; isCustomList: boolean; entries: ListEntry[] | null }[] | null }

export type MediaPage = { pageInfo: { total: number; currentPage: number; lastPage?: number; hasNextPage: boolean }; media: Media[] | null }

// GET /api/catalog/discover (fetchedAt: unix seconds).
export type Discover = {
    trending: Media[] | null
    popularMovies: Media[] | null
    popularShows: Media[] | null
    topRatedMovies: Media[] | null
    topRatedShows: Media[] | null
    nowPlaying: Media[] | null
    upcoming: Media[] | null
    onTheAir: Media[] | null
    fetchedAt: number
}

// One viewing of a movie: a Letterboxd diary entry. rating is 0-100 (0:
// none); source is "kumobox" (logged here) or "letterboxd" (imported);
// exportedAt is when a KumoBox entry went to Letterboxd (0: not yet).
export type DiaryEntry = {
    id: number
    mediaId: number
    watchedDate: string // YYYY-MM-DD
    rating: number
    rewatch: boolean
    liked: boolean
    review?: string
    tags?: string
    source: string
    letterboxdId?: string
    exportedAt?: number
    createdAt: number
    media?: Media | null
}

// The connected Letterboxd member (status.letterboxd).
export type Viewer = {
    id: number
    name: string
    avatar: { large: string; medium: string }
    bannerImage?: string
    letterboxd?: string // profile page
}

// GET /api/letterboxd/status. lastSync is unix seconds (0: never); pending
// counts the diary entries not on Letterboxd yet.
export type LetterboxdStatus = {
    connected: boolean
    username: string
    displayName: string
    lastSync: number
    lastError: string
    pending: number
    apiConfigured: boolean
    apiConnected: boolean
}

// What a sync, an import or a push did. unmatched: titles that weren't found.
export type LetterboxdResult = { added: number; updated: number; skipped: number; unmatched: string[] | null }

export type Parsed = {
    title: string
    folderTitle: string
    season: number
    part: number
    episode: number
    episodeTitle: string
    releaseGroup: string
    resolution: string
    year: number
    kind: string
}

// A video file of the library. episode is its episode key (1 for a movie,
// see lib/ids.ts).
export type LocalFile = {
    path: string
    dir: string
    name: string
    size: number
    modTime: number
    parsed: Parsed
    mediaId: number
    episode: number
    airedEpisode: number
    kind: "main" | "special" | "nc"
    locked: boolean
    ignored: boolean
    matchScore: number
    // Shared by another KumoBox app on the network (path kumobox://<host>/…).
    host?: string
    hostName?: string
}

export type HistoryEntry = {
    mediaId: number
    episode: number
    position: number
    duration: number
    source: string
    updatedAt: number
}

// An episode as GET /api/media/{id} (and …/episodes) lists it, with what
// the library and the watch history know: number is the episode key.
export type EpisodeView = {
    number: number
    title: string
    image: string
    summary: string
    airDate: string
    runtime: number
    kind: string
    file: LocalFile | null
    watched: boolean
    aired: boolean
    history: HistoryEntry | null
    resumeAt: number
    hasFile: boolean
}

export type EntryView = {
    media: Media
    listEntry: ListEntry | null
    episodes: EpisodeView[]
    specials: EpisodeView[] | null
    others: EpisodeView[] | null
    nextEpisode: EpisodeView | null
    localCount: number
    sharedCount: number // files other KumoBox apps share
    images?: { banner: string; poster: string; fanart: string; clearlogo: string } | null
    metadataNote?: string
}

// GET /api/media/{id}/episodes: the same lists as the entry, without the media.
export type EpisodesView = {
    episodes: EpisodeView[] | null
    specials?: EpisodeView[] | null
    others?: EpisodeView[] | null
    nextEpisode?: EpisodeView | null
}

export type CollectionItem = {
    media: Media
    listEntry: ListEntry | null
    localFiles: number
    downloaded: number[] | null
    nextEpisode: number
    nextHasFile: boolean
    lastWatched: number
}

export type ContinueItem = {
    media: Media
    episode: number
    total: number
    title: string
    image: string
    runtime: number
    hasFile: boolean
    filePath?: string
    resumeAt: number
    duration: number
    lastWatched: number
    source: string
}

export type CollectionView = {
    lists: { status: string; name: string; items: CollectionItem[] }[] | null
    continueWatching: ContinueItem[] | null
    unmatchedCount: number
    ignoredCount: number
    localOnly: CollectionItem[] | null
    genres: string[] | null
}

export type Settings = {
    library: {
        dir: string
        extraDirs: string[]
        autoRefresh: boolean
        refreshOnStartup: boolean
        matchThreshold: number
        ignorePatterns: string[]
        matchOutsideList: boolean
    }
    playback: {
        defaultPlayer: "mpv" | "builtin"
        autoUpdateProgress: boolean
        completionThreshold: number
        resumePlayback: boolean
        autoPlayNext: boolean
        rememberTracks: boolean
        preferredAudioLang: string
        preferredSubLang: string
        skipIntroAniSkip: boolean
        skipOutroAniSkip: boolean
    }
    mpv: { path: string; socket: string; extraArgs: string; fullscreen: boolean }
    transcode: { ffmpegPath: string; ffprobePath: string; mode: string; hwAccel: string; vaapiNode: string; preset: string }
    // Where streams are downloaded to (empty: the library folder) and with what.
    downloads: { dir: string; downloader: string }
    onlineStream: { enabled: boolean; defaultProvider: string; preferDub: boolean }
    torrent: {
        defaultClient: string
        defaultProvider: string
        showActiveCount: boolean
        createSubfolder: boolean
        preferredResolution: string
        autoDownloader: boolean
        autoDownloadMinutes: number
    }
    qbittorrent: TorrentClientConfig
    transmission: TorrentClientConfig
    server: { host: string; port: number; allowLan: boolean; password: string; webUi: boolean }
    sharing: { enabled: boolean; name: string }
    ui: {
        accentColor: string
        showAdult: boolean
        bannerType: string
        cardSize: string
        reducedMotion: boolean
        showEpisodeTitle: boolean
        blurUnwatched: boolean
        homeSections: string[]
    }
    discord: { richPresence: boolean; clientId: string }
    extensions: { marketplaceUrl: string; autoUpdate: boolean }
    tmdb: TMDBSettings
    letterboxd: LetterboxdSettings
    providers: ProviderSettings
    torrentSources: TorrentSourceSettings
}

// apiKey: a TMDB v3 API key or a v4 read access token. region (ISO 3166-1)
// is for release dates, certifications and where to watch.
export type TMDBSettings = { apiKey: string; language: string; region: string }

export type LetterboxdSettings = {
    username: string
    autoSync: boolean
    syncMinutes: number
    logWatched: boolean
    importWatchlist: boolean
    apiClientId: string
    apiClientSecret: string
}

export type ProviderSettings = {
    archive: boolean
    stremioCatalogs: string[]
    nuvioRepos: string[]
    preferredQuality: string // 2160p, 1080p, 720p, 480p or "" (best first)
    timeoutSeconds: number
}

export type TorznabIndexer = { name: string; url: string; apiKey: string; enabled: boolean }
export type TorrentSource = { enabled: boolean; url: string }

export type TorrentSourceSettings = {
    torznab: TorznabIndexer[]
    yts: TorrentSource
    eztv: TorrentSource
    pirateBay: TorrentSource
    torrentsCsv: TorrentSource
    archive: TorrentSource
}

export type TorrentClientConfig = {
    host: string
    port: number
    username: string
    password: string
    executable: string
    tags: string
    category: string
    useHttps: boolean
}

export type Status = {
    version: string
    appName: string
    // Without a TMDB key there is no catalog: the UI asks for one.
    tmdbConfigured: boolean
    // The connected Letterboxd member, null when none.
    letterboxd: Viewer | null
    features: { mpv: boolean; ffmpeg: boolean; ffprobe: boolean; ytDlp: boolean; xdgOpen: boolean }
    client: "desktop" | "local" | "lan"
    hostname: string
    platform?: string // "linux", "windows"…
    scanning: boolean
    dataDir: string
    listenAddr: string
    lanUrls?: string[] | null // where devices on the home network open KumoBox
    webUiForced: boolean
    setupRunning?: boolean // Windows: the window installing KumoBox's programs is open
    settings: Settings
}

export type PlaybackSession = {
    id: string
    mediaId: number
    episode: number
    title: string
    source: string
    player: string
    position: number
    duration: number
    paused: boolean
    active: boolean
    progressUpdated: boolean
}

export type TrackPrefs = {
    mediaId: number
    audioLang?: string
    audioTitle?: string
    audioIndex?: number
    subLang?: string
    subTitle?: string
    subIndex?: number
    subOff?: boolean
    streamMode?: string
}

export type ProbeStream = {
    index: number
    typeIndex: number
    type: string
    codec: string
    language: string
    title: string
    default: boolean
    forced: boolean
    channels?: number
    width?: number
    height?: number
    bitmap?: boolean
}

export type Probe = {
    path: string
    container: string
    duration: number
    size: number
    video: ProbeStream[] | null
    audio: ProbeStream[] | null
    subtitles: ProbeStream[] | null
    externalSubs: { name: string; path: string; language: string }[] | null
    method: "direct" | "remux" | "transcode"
    reason: string
}

export type StreamSource = {
    url: string
    originalUrl: string
    type: string
    quality: string
    label?: string
    server: string
    subtitles: { url: string; language: string; isDefault: boolean; original: string }[]
    headers: Record<string, string>
    referrer?: string
}

export type OnlineProvider = { id: string; name: string; icon: string; supportsDub: boolean; servers: string[]; builtin: boolean }

export type StreamEpisodes = {
    provider: string
    mapping: { id: string; title: string; score: number; query?: string; index?: number } | null
    episodes: { number: number; id: string; title: string }[] | null
    dub: boolean
}

export type DownloadItem = {
    id: string
    mediaId: number
    episode: number // key
    title?: string
    animeTitle?: string // older servers
    image: string
    mode: string
    source: string
    provider: string
    status: "queued" | "resolving" | "downloading" | "completed" | "failed" | "canceled"
    progress: number
    speed: string
    eta: string
    error?: string
    output?: string
    createdAt: number
}

export type TorrentResult = {
    provider: string
    name: string
    link: string
    downloadUrl: string
    magnetLink: string
    infoHash: string
    size: number
    formattedSize: string
    seeders: number
    leechers: number
    downloadCount: number
    date: string
    resolution: string
    releaseGroup: string
    episodeNumber: number
    isBatch: boolean
    isBestRelease: boolean
    confirmed: boolean
    trusted: boolean
    remake: boolean
    dub: boolean
}

export type Torrent = {
    hash: string
    name: string
    size: number
    progress: number
    downSpeed: number
    upSpeed: number
    eta: number
    state: string
    seeds: number
    peers: number
    savePath: string
    contentPath: string
    addedOn: number
    ratio: number
}

export type ExtensionManifest = {
    id: string
    name: string
    version: string
    manifestURI: string
    language: string
    type: string
    description: string
    author: string
    icon: string
    website: string
    lang: string
    notes?: string
    userConfig?: {
        version: number
        requiresConfig: boolean
        fields: {
            type: "text" | "switch" | "select"
            name: string
            label: string
            options?: { value: string; label: string }[]
            default?: string
            description?: string
        }[]
    } | null
    plugin?: {
        version: string
        permissions: {
            scopes: string[] | null
            allow: {
                networkAccess: { allowedDomains: string[] | null; reasoning: string }
                unsafeFlags: { flag: string; reason: string }[] | null
                readPaths: string[] | null
                writePaths: string[] | null
            }
        }
    } | null
}

export type ExtensionInfo = {
    manifest: ExtensionManifest
    enabled: boolean
    userConfig: { version: number; values: Record<string, string> }
    error?: string
    configError?: string
    running: boolean
    installedAt: number
    updatedAt: number
    supported: boolean
    granted: boolean
}

export type MarketEntry = {
    id: string
    name: string
    version: string
    author: string
    description: string
    type: string
    language: string
    lang: string
    icon: string
    manifestURI: string
    website: string
    flags: string
    permalink: string
    workingTag: boolean
    brokenTag: boolean
    deprecatedTag: boolean
    official: boolean
    stars: number
    updatedAt: string
    installed: boolean
    installedVersion?: string
    hasUpdate: boolean
    supported: boolean
}

export type UINode = { id: string; type: string; props: Record<string, any> }

export type PluginState = {
    id: string
    name: string
    icon: string
    state: {
        trays?: {
            id: string
            iconUrl: string
            tooltipText: string
            withContent: boolean
            width: string
            minHeight: string
            badge?: { number?: number; intent?: string } | null
            tree: UINode | null
        }[]
        actions?: { id: string; kind: string; props: Record<string, any> }[]
        webviews?: { id: string; options: Record<string, any>; hidden: boolean; html: string }[]
    }
}

// GET /api/catalog/schedule: episodes of the shows on the list.
export type ScheduleItem = AiringEpisode & { media: Media; listStatus?: string }

export type AutoRule = {
    id?: number
    enabled: boolean
    mediaId: number
    title: string
    releaseGroups: string[]
    resolutions: string[]
    additionalTerms: string[]
    episodeType: "recent" | "all"
    minSeeders: number
    provider: string
}

// A library folder as found on disk (Library tools, manual matching).
export type FolderInfo = {
    dir: string
    label: string // path below its library folder
    videos: number // video files directly inside
    notIndexed: number // of those, not in the library index yet
    problem?: string // why it has nothing to match (still downloading, unreadable…)
}

// KumoBox's own updates (GET /api/update, and the "update-status" event).
export type UpdateVersion = { version: string; commit: string; date?: string; url?: string }

export type UpdateState = "idle" | "downloading" | "building" | "installing" | "ready" | "failed"

export type UpdateStatus = {
    current: UpdateVersion
    latest: UpdateVersion | null // once a check found it
    available: boolean
    changes: string[] | null // commit subjects, newest first
    changesTotal: number
    note?: string
    checkedAt: number // unix seconds, 0 before the first check
    checking: boolean
    error?: string // the last check failed
    hint?: string
    canApply: boolean // this copy installs updates itself (applyNote: how, or why not)
    applyNote?: string
    state: UpdateState
    progress: number // 0-100, -1 when unknown
    message?: string
    log: string[] | null // the last output lines
    manualCommand?: string // a command to run in a terminal
}

// Library sharing with other KumoBox apps on the network.
export type SharingPeer = {
    id: string
    name: string
    address: string
    online: boolean
    lastSeen: number
    version: string
    allowed: boolean // this KumoBox shares its library with it
    shares: boolean // it shares its library with this KumoBox
    files: number
    manual: boolean
    error?: string
}

export type SharingStatus = { enabled: boolean; id: string; name: string; listening: boolean; peers: SharingPeer[]; addresses: string[] }

export type SharedLibrary = { host: SharingPeer; files: LocalFile[] }
