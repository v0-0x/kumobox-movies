import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/toast"
import { api, qs } from "./api"
import { formatKey, mediaIsShow } from "./ids"
import type {
    AutoItem,
    AutoRule,
    CollectionView,
    DiaryEntry,
    Discover,
    DownloadItem,
    EntryUpdate,
    EntryView,
    EpisodesView,
    EpisodeView,
    ExtensionInfo,
    FolderInfo,
    LetterboxdResult,
    LetterboxdStatus,
    LocalFile,
    MarketEntry,
    Media,
    MediaPage,
    OnlineProvider,
    PluginState,
    RawCollection,
    ScheduleItem,
    SeasonDetail,
    Settings,
    SharedLibrary,
    SharingStatus,
    Status,
    StreamEpisodes,
    Torrent,
    TorrentProviderInfo,
    TorrentSearchResponse,
    UpdateStatus,
} from "./types"

export function useStatus() {
    return useQuery({ queryKey: ["status"], queryFn: () => api.get<Status>("/api/status"), staleTime: 30_000 })
}

export function useSettings() {
    const q = useStatus()
    return q.data?.settings
}

export function useSaveSettings() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (s: Settings) => api.put<Settings>("/api/settings", s),
        onSuccess: s => {
            qc.setQueryData<Status>(["status"], old => (old ? { ...old, settings: s } : old))
            qc.invalidateQueries({ queryKey: ["status"] })
            // Torrent sources may have been turned on or off.
            qc.invalidateQueries({ queryKey: ["torrent-providers"] })
            toast.success("Settings saved")
        },
        onError: (e: Error) => toast.error(e.message),
    })
}

// What changed when the list did: the library views, the raw list and the
// Letterboxd diary and status (watching a movie logs it).
export function invalidateList(qc: QueryClient, mediaId?: number) {
    qc.invalidateQueries({ queryKey: mediaId ? ["entry", mediaId] : ["entry"] })
    qc.invalidateQueries({ queryKey: ["collection"] })
    qc.invalidateQueries({ queryKey: ["list"] })
    qc.invalidateQueries({ queryKey: ["letterboxd"] })
}

// The list with what the library has, asked again when KumoBox's window
// comes back to the front: what was watched on another KumoBox sharing its
// library shows up in Continue watching.
export function useCollection() {
    return useQuery({
        queryKey: ["collection"],
        queryFn: () => api.get<CollectionView>("/api/media/collection?fresh=1"),
        staleTime: 60_000,
        refetchOnWindowFocus: true,
    })
}

export function useEntry(id: number) {
    return useQuery({
        queryKey: ["entry", id],
        queryFn: () => api.get<EntryView>(`/api/media/${id}`),
        enabled: id > 0,
        staleTime: 30_000,
    })
}

// A show's episodes with what the library and the watch history know
// (files, watched, resume positions). The server may answer with the lists
// (EpisodesView) or the bare episode array.
export function useEpisodes(id: number, enabled = true) {
    return useQuery({
        queryKey: ["entry", id, "episodes"],
        queryFn: async () => {
            const res = await api.get<EpisodesView | EpisodeView[] | null>(`/api/media/${id}/episodes`)
            return (Array.isArray(res) ? { episodes: res } : (res ?? { episodes: [] })) as EpisodesView
        },
        enabled: enabled && id > 0,
        staleTime: 30_000,
        retry: false,
    })
}

// One season of a show, with its episodes' titles, stills and overviews.
export function useSeason(id: number, season: number, enabled = true) {
    return useQuery({
        queryKey: ["season", id, season],
        queryFn: () => api.get<SeasonDetail>(`/api/media/${id}/season/${season}`),
        enabled: enabled && id > 0 && season >= 0,
        staleTime: 30 * 60_000,
    })
}

// Every genre TMDB has, movies' and shows'.
export function useGenres() {
    return useQuery({ queryKey: ["genres"], queryFn: () => api.get<string[] | null>("/api/catalog/genres"), staleTime: 24 * 3600_000 })
}

export function useUpdateEntry(mediaId: number) {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (body: EntryUpdate) => api.post(`/api/media/${mediaId}/entry`, body),
        onSuccess: () => invalidateList(qc, mediaId),
        onError: (e: Error) => toast.error(e.message),
    })
}

// Marks single episodes (or a movie) as watched or unwatched. The list only
// stores how far you got (the key of the last episode watched), so marking
// S01E07 watched raises progress to it (everything before counts as watched
// too) and unwatched lowers it to the episode before. The server works it
// out from the current list entry: watched never lowers progress, unwatched
// never raises it; the last episode completes the show and an earlier one
// reopens it.
export function useEpisodeMarker(media: Media | undefined) {
    const qc = useQueryClient()
    const m = useMutation({
        mutationFn: (v: { episode: number; watched: boolean }) => api.post<{ changed: boolean; progress: number; status: string }>(`/api/media/${media?.id ?? 0}/episode`, v),
        onSuccess: (res, v) => {
            invalidateList(qc, media?.id)
            const what = mediaIsShow(media) ? formatKey(v.episode) : "Movie"
            if (!res.changed) toast.info(`${what} is already ${v.watched ? "watched" : "unwatched"}`)
            else toast.success(`${what} marked as ${v.watched ? "watched" : "unwatched"}${res.status === "COMPLETED" && mediaIsShow(media) ? " — show completed!" : ""}`)
        },
        onError: (e: Error) => toast.error(e.message),
    })
    const mark = (episode: number, watched: boolean) => {
        if (media) m.mutate({ episode, watched })
    }
    return { mark, pending: m.isPending }
}

// Original audio or a dub, remembered per movie or show (server-side, so
// every device and every way of starting an episode uses it).
export type LanguageMode = { mode: "sub" | "dub"; saved: boolean }

export function useLanguageMode(mediaId: number) {
    const qc = useQueryClient()
    const query = useQuery({
        queryKey: ["language", mediaId],
        queryFn: () => api.get<LanguageMode>(`/api/media/${mediaId}/language`),
        enabled: mediaId > 0,
        staleTime: 60_000,
    })
    const set = useMutation({
        mutationFn: (mode: "sub" | "dub") => api.put<LanguageMode>(`/api/media/${mediaId}/language`, { mode }),
        onMutate: mode => qc.setQueryData<LanguageMode>(["language", mediaId], { mode, saved: true }),
        onSettled: () => qc.invalidateQueries({ queryKey: ["language", mediaId] }),
        onError: (e: Error) => toast.error(e.message),
    })
    return { mode: query.data?.mode, saved: query.data?.saved ?? false, loaded: query.isSuccess || query.isError, set: set.mutate }
}

// For click handlers outside a component that has the hook.
export async function fetchLanguageMode(mediaId: number, fallbackDub: boolean): Promise<boolean> {
    try {
        return (await api.get<LanguageMode>(`/api/media/${mediaId}/language`)).mode === "dub"
    } catch {
        return fallbackDub
    }
}

export function useDeleteEntry(mediaId: number) {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: () => api.del(`/api/media/${mediaId}/entry`),
        onSuccess: () => {
            toast.success("Removed from your list")
            invalidateList(qc, mediaId)
        },
        onError: (e: Error) => toast.error(e.message),
    })
}

// POST /api/catalog/search. type: MOVIE, TV or empty for both; sort one of
// POPULARITY_DESC, SCORE_DESC, START_DATE_DESC, START_DATE, TITLE,
// TRENDING_DESC; language the original language (ISO 639-1); minScore 0-100.
export type SearchParams = {
    page?: number
    perPage?: number
    search?: string
    type?: string
    genres?: string[]
    year?: number
    status?: string
    sort?: string[]
    language?: string
    minScore?: number
    ids?: number[]
}

export function useSearch(params: SearchParams, enabled = true) {
    return useQuery({
        queryKey: ["search", params],
        queryFn: () => api.post<MediaPage>("/api/catalog/search", params),
        enabled,
        placeholderData: keepPreviousData,
        staleTime: 5 * 60_000,
    })
}

export function useDiscover(enabled = true) {
    return useQuery({
        queryKey: ["discover"],
        queryFn: () => api.get<Discover>("/api/catalog/discover"),
        enabled,
        staleTime: 10 * 60_000,
        // The server answers at once with the page it saved last, and fetches
        // a fresh one when that's over 30 minutes old: pick it up shortly
        // (a few tries, in case TMDB can't be reached).
        refetchInterval: q => {
            const d = q.state.data
            return d && Date.now() / 1000 - d.fetchedAt > 30 * 60 && q.state.dataUpdateCount < 4 ? 4000 : false
        },
    })
}

// Library sharing: the KumoBox apps on the network (asked again while shown).
export function useSharing(enabled = true) {
    return useQuery({ queryKey: ["sharing", "status"], queryFn: () => api.get<SharingStatus>("/api/sharing"), enabled, refetchInterval: 4000 })
}

// The libraries other KumoBox apps share with this one.
export function useSharedLibraries() {
    return useQuery({ queryKey: ["sharing", "libraries"], queryFn: () => api.get<SharedLibrary[]>("/api/sharing/libraries"), refetchInterval: 30_000 })
}

// The episodes of the shows on the list airing between start and end (unix
// seconds).
export function useSchedule(start: number, end: number) {
    return useQuery({
        queryKey: ["schedule", start, end],
        queryFn: () => api.get<ScheduleItem[] | null>(`/api/catalog/schedule${qs({ start, end })}`),
        staleTime: 10 * 60_000,
        placeholderData: keepPreviousData,
    })
}

// The list as it's stored (no library data). type: MOVIE, TV or "" for both.
export function useRawList(type: "" | "MOVIE" | "TV" = "") {
    return useQuery({
        queryKey: ["list", type],
        queryFn: () => api.get<RawCollection>(`/api/catalog/list${qs({ type })}`),
        staleTime: 60_000,
    })
}

export function useScan() {
    return useMutation({
        mutationFn: (full: boolean) => api.post("/api/library/scan", { full }),
        onSuccess: () => toast.info("Scanning your library…"),
        onError: (e: Error) => toast.error(e.message),
    })
}

export function useUnmatched() {
    return useQuery({
        queryKey: ["library", "unmatched"],
        queryFn: () => api.get<{ dir: string; title: string; files: LocalFile[] }[]>("/api/library/unmatched"),
    })
}

export function useLibraryFolders(enabled = true) {
    return useQuery({ queryKey: ["library", "folders"], queryFn: () => api.get<FolderInfo[] | null>("/api/library/folders"), enabled })
}

// Also for reading the files outside a component (qc.ensureQueryData).
export const libraryFilesQuery = { queryKey: ["library", "files"], queryFn: () => api.get<LocalFile[] | null>("/api/library/files") }

export function useLibraryFiles() {
    return useQuery(libraryFilesQuery)
}

// ---------------------------------------------------------------------------
// Streaming providers (Internet Archive, Stremio addons, Nuvio repositories,
// extensions).

export function useOnlineProviders() {
    return useQuery({ queryKey: ["os-providers"], queryFn: () => api.get<OnlineProvider[]>("/api/providers/providers"), staleTime: 5 * 60_000 })
}

// only: the version listed is the only one there is, not a choice to remember.
export function useStreamEpisodes(provider: string, mediaId: number, dub: boolean, enabled = true, only = false) {
    return useQuery({
        queryKey: ["os-episodes", provider, mediaId, dub],
        queryFn: () => api.get<StreamEpisodes>(`/api/providers/episodes${qs({ provider, mediaId, dub, only: only ? 1 : undefined })}`),
        enabled: enabled && mediaId > 0 && !!provider,
        retry: false,
        staleTime: 10 * 60_000,
    })
}

// Whether the provider has the original audio and a dub (both while it's
// not known).
export function useStreamModes(provider: string, mediaId: number, enabled = true) {
    return useQuery({
        queryKey: ["os-modes", provider, mediaId],
        queryFn: () => api.get<{ sub: boolean; dub: boolean }>(`/api/providers/modes${qs({ provider, mediaId })}`),
        enabled: enabled && mediaId > 0 && !!provider,
        retry: false,
        staleTime: 30 * 60_000,
    })
}

export function useDownloads() {
    return useQuery({ queryKey: ["downloads"], queryFn: () => api.get<DownloadItem[]>("/api/downloads") })
}

export function useTorrentList(enabled = true) {
    return useQuery({
        queryKey: ["torrents"],
        queryFn: () => api.get<Torrent[]>("/api/torrent-client/list"),
        refetchInterval: 3000,
        retry: false,
        enabled,
    })
}

// A torrent search. episode is a key; batch asks for the pack of season, or
// of the whole show when season is 0; query replaces the searches made
// from the title; provider is a source id or "all".
export type TorrentSearchBody = {
    provider: string
    mediaId?: number
    query?: string
    episode?: number
    season?: number
    batch?: boolean
    resolution?: string
}

export function useTorrentSearch() {
    return useMutation({
        mutationFn: (body: TorrentSearchBody) => api.post<TorrentSearchResponse>("/api/torrents/search", body),
    })
}

// The torrent search sources: indexers, public sites, extensions.
export function useTorrentProviders() {
    return useQuery({ queryKey: ["torrent-providers"], queryFn: () => api.get<TorrentProviderInfo[]>("/api/torrents/providers"), staleTime: 60_000 })
}

export function useExtensions() {
    return useQuery({ queryKey: ["extensions"], queryFn: () => api.get<ExtensionInfo[]>("/api/extensions") })
}

export function useMarketplace(url: string) {
    return useQuery({
        queryKey: ["marketplace", url],
        queryFn: () => api.get<MarketEntry[]>(`/api/extensions/marketplace${qs({ url })}`),
        staleTime: 30 * 60_000,
        retry: false,
    })
}

export function usePluginStates() {
    return useQuery({ queryKey: ["plugins-ui"], queryFn: () => api.get<PluginState[]>("/api/plugins/ui") })
}

export function useAutoRules() {
    return useQuery({ queryKey: ["auto-rules"], queryFn: () => api.get<AutoRule[]>("/api/autodownloader/rules") })
}

// What the auto downloader grabbed, newest first.
export function useAutoItems() {
    return useQuery({ queryKey: ["auto-items"], queryFn: () => api.get<AutoItem[]>("/api/autodownloader/items") })
}

// The episodes (keys) a rule looks for now.
export function useRuleWanted(id: number | undefined, enabled = true) {
    return useQuery({
        queryKey: ["auto-rules", id, "wanted"],
        queryFn: () => api.get<{ episodes: number[] }>(`/api/autodownloader/rules/${id}/wanted`),
        enabled: enabled && !!id,
        retry: false,
        staleTime: 60_000,
    })
}

// ---------------------------------------------------------------------------
// Letterboxd

export function useLetterboxdStatus(enabled = true) {
    return useQuery({ queryKey: ["letterboxd", "status"], queryFn: () => api.get<LetterboxdStatus>("/api/letterboxd/status"), enabled, staleTime: 15_000 })
}

// The diary: every viewing logged here or imported from Letterboxd, the
// newest first; of one movie with mediaId.
export function useDiary(mediaId?: number, limit = 50, enabled = true) {
    return useQuery({
        queryKey: ["letterboxd", "diary", mediaId ?? 0, limit],
        queryFn: () => api.get<DiaryEntry[] | null>(`/api/letterboxd/diary${qs({ mediaId, limit })}`),
        enabled,
        staleTime: 30_000,
    })
}

// "3 added, 1 updated, 2 skipped".
export function resultSummary(r: LetterboxdResult) {
    const parts = [r.added && `${r.added} added`, r.updated && `${r.updated} updated`, r.skipped && `${r.skipped} skipped`].filter(Boolean)
    return parts.length ? parts.join(", ") : "Nothing new"
}

// The Letterboxd actions; every one refreshes what it may have changed.
export function useLetterboxd() {
    const qc = useQueryClient()
    const refresh = () => {
        invalidateList(qc)
        qc.invalidateQueries({ queryKey: ["status"] })
    }
    const onError = (e: Error) => toast.error(e.message)
    return {
        connect: useMutation({ mutationFn: (username: string) => api.post<LetterboxdStatus>("/api/letterboxd/connect", { username }), onSuccess: refresh, onError }),
        disconnect: useMutation({ mutationFn: () => api.post("/api/letterboxd/disconnect"), onSuccess: refresh, onError }),
        sync: useMutation({ mutationFn: () => api.post<LetterboxdResult>("/api/letterboxd/sync"), onSuccess: refresh, onError }),
        importFile: useMutation({
            mutationFn: (file: File) => {
                const form = new FormData()
                form.append("file", file)
                return api.upload<LetterboxdResult>("/api/letterboxd/import", form)
            },
            onSuccess: refresh,
            onError,
        }),
        markExported: useMutation({ mutationFn: () => api.post<{ marked: number }>("/api/letterboxd/mark-exported"), onSuccess: refresh, onError }),
        push: useMutation({ mutationFn: () => api.post<LetterboxdResult>("/api/letterboxd/push"), onSuccess: refresh, onError }),
        apiLogin: useMutation({ mutationFn: (v: { username: string; password: string }) => api.post<LetterboxdStatus>("/api/letterboxd/api-login", v), onSuccess: refresh, onError }),
        deleteDiary: useMutation({ mutationFn: (id: number) => api.del(`/api/letterboxd/diary/${id}`), onSuccess: refresh, onError }),
    }
}

// KumoBox's own updates. The "update-status" event keeps ["update"] current
// (lib/events.ts), also while one is being installed.
export function useUpdateStatus() {
    return useQuery({ queryKey: ["update"], queryFn: () => api.get<UpdateStatus>("/api/update"), staleTime: 5 * 60_000 })
}

export function useCheckUpdate() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: () => api.post<UpdateStatus>("/api/update/check"),
        onSuccess: s => qc.setQueryData(["update"], s),
        onError: (e: Error) => toast.error(e.message),
    })
}

export function useApplyUpdate() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: () => api.post<UpdateStatus>("/api/update/apply"),
        onSuccess: s => qc.setQueryData(["update"], s),
        onError: (e: Error) => toast.error(e.message),
    })
}
