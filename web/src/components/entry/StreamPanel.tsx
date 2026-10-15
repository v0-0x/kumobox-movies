import { useQueryClient } from "@tanstack/react-query"
import {
    AlertTriangle,
    Captions,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Copy,
    Download,
    ExternalLink,
    Magnet,
    MonitorPlay,
    Play,
    Puzzle,
    RefreshCw,
    Search,
    Tv,
    Users,
    SquarePlay,
    Wand2,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "@/lib/toast"
import { api, qs } from "@/lib/api"
import { episodeKey, firstEpisode, formatKey, mediaIsShow, MOVIE_EPISODE, nextEpisode, prevEpisode, splitKey } from "@/lib/ids"
import { usePlay } from "@/lib/play"
import { useProviders, useProviderStreams, useSeason, useStatus } from "@/lib/queries"
import type { EntryView, ProviderInfo, ProviderStream, Season, StreamsResult } from "@/lib/types"
import { cn, copyText, formatBytes, plural } from "@/lib/utils"
import { Badge, Button, Dialog, EmptyState, Field, IconButton, Input, Select, Skeleton, Tabs, Tooltip } from "../ui"

// "Watch online": the streams of the movie, or of the episode picked, from
// every provider (Internet Archive, Stremio addons, Nuvio providers,
// extensions), best first as the server ranks them.
export function StreamPanel({ entry }: { entry: EntryView }) {
    const media = entry.media
    const show = mediaIsShow(media)
    const { data: status } = useStatus()
    const { data: providers } = useProviders()
    const [params, setParams] = useSearchParams()
    const qc = useQueryClient()

    // A show's episode: the one asked for in the URL, else the next one to
    // watch (never a special).
    const progress = entry.listEntry?.progress ?? 0
    const serverNext = entry.nextEpisode?.key ?? 0
    const upNext = (serverNext >= 1000 ? serverNext : 0) || nextEpisode(media, progress) || firstEpisode(media)
    const asked = Number(params.get("episode"))
    const key = show ? (asked > 0 && splitKey(asked)[1] > 0 ? asked : upNext) : MOVIE_EPISODE
    const setKey = (k: number) =>
        setParams(
            p => {
                p.set("episode", String(k))
                p.set("season", String(splitKey(k)[0]))
                return p
            },
            { replace: true },
        )

    const usable = (providers ?? []).filter(p => p.enabled && p.types.includes(show ? "tv" : "movie"))
    const { data, isLoading, isFetching, error, refetch } = useProviderStreams(media.id, key, "", !providers || usable.length > 0)
    const [refreshing, setRefreshing] = useState(false)
    const refresh = async () => {
        setRefreshing(true)
        try {
            const res = await api.post<StreamsResult>("/api/providers/streams/refresh", { mediaId: media.id, episode: key })
            qc.setQueryData(["provider-streams", media.id, key, ""], res)
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setRefreshing(false)
        }
    }

    const [filter, setFilter] = useState("all")
    useEffect(() => setFilter("all"), [key])
    const [matchFor, setMatchFor] = useState<{ provider: string; name: string } | null>(null)
    const [dlOpen, setDlOpen] = useState(false)

    if (providers && usable.length === 0) return <NoProviders show={show} />

    const streams = data?.streams ?? []
    const byProvider = new Map<string, number>()
    for (const s of streams) byProvider.set(s.provider, (byProvider.get(s.provider) ?? 0) + 1)
    const shown = filter === "all" ? streams : streams.filter(s => s.provider === filter)
    const info = (id: string) => providers?.find(p => p.id === id)
    const timeout = status?.settings.providers?.timeoutSeconds ?? 20
    const chips = byProvider.size > 1 && (
        <Tabs
            className="self-start"
            value={filter}
            onChange={setFilter}
            tabs={[{ value: "all", label: "All", count: streams.length }, ...[...byProvider].map(([id, n]) => ({ value: id, label: info(id)?.name ?? streams.find(s => s.provider === id)?.providerName ?? id, count: n }))]}
        />
    )
    const answered = data ? data.providers.length - data.errors.length : 0
    const summary = data && streams.length > 0 && (
        <p className="text-[13px] text-subtle">
            {plural(streams.length, "source")} from {answered} of {plural(data.providers.length, "provider")}
            {data.subtitles.length > 0 && ` · ${plural(data.subtitles.length, "subtitle")} from subtitle addons`}
        </p>
    )

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
                {show ? (
                    <EpisodePicker entry={entry} value={key} onChange={setKey} progress={progress} />
                ) : (
                    <>
                        {chips}
                        {summary}
                    </>
                )}
                <div className="ml-auto flex items-center gap-2">
                    {show && (
                        <Button variant="subtle" icon={<Download className="size-4" />} onClick={() => setDlOpen(true)}>
                            Download episodes
                        </Button>
                    )}
                    <IconButton label="Look again" variant="subtle" onClick={refresh} disabled={refreshing || isFetching}>
                        <RefreshCw className={cn("size-4", (refreshing || isFetching) && "animate-spin")} />
                    </IconButton>
                </div>
            </div>

            {show && (chips || summary) && (
                <div className="-mt-1 flex flex-wrap items-center gap-4">
                    {chips}
                    {summary}
                </div>
            )}

            {(isLoading || (refreshing && !data)) && (
                <div className="flex flex-col gap-3">
                    <p className="flex items-center gap-2 text-sm text-muted">
                        <RefreshCw className="size-3.5 animate-spin" /> Asking {plural(usable.length || 1, "provider")}… (up to {timeout} s)
                    </p>
                    <div className="card divide-y divide-line overflow-hidden">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                                <Skeleton className="size-9 rounded-lg" />
                                <div className="flex flex-1 flex-col gap-2">
                                    <Skeleton className="h-4 w-2/3" />
                                    <Skeleton className="h-3 w-1/3" />
                                </div>
                                <Skeleton className="h-8 w-20" />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {error && !data && (
                <EmptyState icon={<AlertTriangle className="size-6" />} title="Couldn't look for streams" action={<Button onClick={() => refetch()}>Try again</Button>}>
                    {(error as Error).message}
                </EmptyState>
            )}

            {data && <Matches result={data} onFix={setMatchFor} />}

            {data && streams.length === 0 && (
                <EmptyState icon={<Search className="size-6" />} title="No streams found" action={<ProvidersLink />}>
                    {data.errors.length > 0
                        ? `${plural(data.providers.length, "provider")} asked, none had ${show ? formatKey(key) : "this movie"}.`
                        : `None of your providers has ${show ? formatKey(key) : "this movie"}.`}{" "}
                    Stremio addons and Nuvio repositories add more sources.
                </EmptyState>
            )}

            {shown.length > 0 && (
                <div className="card divide-y divide-line overflow-hidden">
                    {shown.map(s => (
                        <StreamRow key={s.id} s={s} provider={info(s.provider)} result={data!} mediaId={media.id} episode={key} />
                    ))}
                </div>
            )}

            {data && data.errors.length > 0 && <ProviderErrors result={data} onFix={setMatchFor} />}

            {matchFor && (
                <ManualMatchDialog
                    open
                    onOpenChange={v => !v && setMatchFor(null)}
                    provider={matchFor.provider}
                    providerName={matchFor.name}
                    mediaId={media.id}
                    defaultQuery={media.title.english || media.title.userPreferred || media.title.romaji || ""}
                    onPicked={refresh}
                />
            )}
            {show && <DownloadDialog open={dlOpen} onOpenChange={setDlOpen} entry={entry} from={key} streams={streams} providers={usable} />}
        </div>
    )
}

function ProvidersLink() {
    return (
        <Link to="/extensions">
            <Button variant="primary" icon={<Puzzle className="size-4" />}>
                Providers & extensions
            </Button>
        </Link>
    )
}

function NoProviders({ show }: { show: boolean }) {
    return (
        <EmptyState icon={<Puzzle className="size-6" />} title="No streaming providers" action={<ProvidersLink />}>
            Turn on the Internet Archive (public-domain films), install Stremio addons or Nuvio providers, or add extensions to watch {show ? "shows" : "movies"} online.
        </EmptyState>
    )
}

// ---------------------------------------------------------------------------
// Episode picker: season, episode, previous and next.

const seasonName = (s: Season) => (s.seasonNumber === 0 ? "Specials" : s.name && !/^season \d+$/i.test(s.name) ? s.name : `Season ${s.seasonNumber}`)

function EpisodePicker({ entry, value, onChange, progress }: { entry: EntryView; value: number; onChange: (k: number) => void; progress: number }) {
    const media = entry.media
    const [season, ep] = splitKey(value)
    const listed = (media.seasons ?? []).filter(s => s.episodeCount > 0)
    const seasons = [...listed.filter(s => s.seasonNumber > 0).sort((a, b) => a.seasonNumber - b.seasonNumber), ...listed.filter(s => s.seasonNumber === 0)]
    const { data: detail } = useSeason(media.id, season, seasons.length > 0)
    const seasonEpisodes = detail?.episodes ?? []
    const count = seasons.find(s => s.seasonNumber === season)?.episodeCount || seasonEpisodes.length || ep
    const episodes =
        seasonEpisodes.length && seasonEpisodes.length >= count
            ? seasonEpisodes.map(e => ({ key: e.key || episodeKey(e.season, e.number), number: e.number, title: e.title }))
            : Array.from({ length: Math.max(count, ep) }, (_, i) => ({ key: episodeKey(season, i + 1), number: i + 1, title: "" }))
    const prev = season > 0 ? prevEpisode(media, value) : value - 1 >= 1 ? value - 1 : 0
    const next = season > 0 ? nextEpisode(media, value) : splitKey(value)[1] < count ? value + 1 : 0
    return (
        <div className="flex flex-wrap items-center gap-2">
            {seasons.length > 0 && (
                <Select
                    className="w-44"
                    value={String(season)}
                    onChange={v => onChange(episodeKey(Number(v), 1))}
                    options={(seasons.some(s => s.seasonNumber === season) ? seasons : [...seasons, { seasonNumber: season, name: `Season ${season}`, episodeCount: count }]).map(s => ({
                        value: String(s.seasonNumber),
                        label: seasonName(s),
                    }))}
                />
            )}
            <Select
                className="w-72"
                value={String(value)}
                onChange={v => onChange(Number(v))}
                options={episodes.map(e => ({
                    value: String(e.key),
                    label: `${formatKey(e.key)}${e.title ? ` · ${e.title}` : ""}${season > 0 && e.key <= progress ? " ✓" : ""}`,
                }))}
            />
            <IconButton label={prev ? `Previous: ${formatKey(prev)}` : "Previous"} variant="subtle" disabled={!prev} onClick={() => prev && onChange(prev)}>
                <ChevronLeft className="size-4" />
            </IconButton>
            <IconButton label={next ? `Next: ${formatKey(next)}` : "Next"} variant="subtle" disabled={!next} onClick={() => next && onChange(next)}>
                <ChevronRight className="size-4" />
            </IconButton>
            {season > 0 && value <= progress && <Badge tone="green">Watched</Badge>}
        </div>
    )
}

// ---------------------------------------------------------------------------
// A stream

const kindLabel: Record<ProviderStream["kind"], string> = { direct: "Direct", torrent: "Torrent", youtube: "YouTube", external: "Web page" }

function ProviderIcon({ src, className }: { src?: string; className?: string }) {
    const [err, setErr] = useState(false)
    if (!src || err)
        return (
            <span className={cn("grid shrink-0 place-items-center rounded-lg bg-white/[0.06] text-muted", className)}>
                <Tv className="size-4" />
            </span>
        )
    return <img src={src} alt="" onError={() => setErr(true)} className={cn("shrink-0 rounded-lg bg-white/5 object-cover", className)} />
}

function StreamRow({ s, provider, result, mediaId, episode }: { s: ProviderStream; provider?: ProviderInfo; result: StreamsResult; mediaId: number; episode: number }) {
    const { playStream, sendTorrent, remote } = usePlay()
    const [busy, setBusy] = useState(false)
    const lines = s.title
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
    const main = lines[0] || s.filename || s.providerName
    const more = lines
        .slice(1)
        .join(" · ")
        .replace(/(👤|👥)\s*\d+/gu, "")
        .replace(/💾\s*[\d.,]+\s*[KMGT]i?B/giu, "")
        .replace(/\s+/g, " ")
        .replace(/^[\s·|]+|[\s·|]+$/g, "")
    const subs = (s.subtitles?.length ?? 0) + (s.kind === "direct" ? result.subtitles.length : 0)
    const download = async () => {
        setBusy(true)
        try {
            await api.post("/api/providers/download", { mediaId, episodes: [episode], provider: s.provider, quality: s.quality })
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className="flex items-center gap-4 px-4 py-3 transition hover:bg-white/[0.03]">
            <Tooltip content={s.providerName}>
                <span>
                    <ProviderIcon src={provider?.icon} className="size-9" />
                </span>
            </Tooltip>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={s.title}>
                    {main}
                </p>
                {more && (
                    <p className="mt-0.5 truncate text-xs text-subtle" title={more}>
                        {more}
                    </p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge>{s.providerName}</Badge>
                    {s.quality && <Badge tone="brand">{s.quality === "2160p" ? "4K" : s.quality}</Badge>}
                    {s.kind !== "direct" && <Badge tone={s.kind === "torrent" ? "blue" : "gray"}>{kindLabel[s.kind]}</Badge>}
                    {s.kind === "direct" && s.type && s.type !== "unknown" && <Badge>{s.type === "m3u8" ? "HLS" : s.type.toUpperCase()}</Badge>}
                    {s.notWebReady && s.kind === "direct" && (
                        <Tooltip content="The browser may not play this one as it is: mpv plays it">
                            <span>
                                <Badge tone="amber">Not web-ready</Badge>
                            </span>
                        </Tooltip>
                    )}
                    {subs > 0 && (
                        <Tooltip content={`${plural(subs, "subtitle")}${s.kind === "direct" && result.subtitles.length ? ", from subtitle addons too" : ""}`}>
                            <span className="flex items-center gap-1 text-xs text-subtle">
                                <Captions className="size-3.5" /> {subs}
                            </span>
                        </Tooltip>
                    )}
                    {!!s.size && <span className="text-xs text-subtle">{formatBytes(s.size)}</span>}
                </div>
            </div>
            {s.kind === "torrent" && (
                <div className="flex w-16 shrink-0 items-center justify-end gap-1 text-sm" title="Seeders">
                    <Users className="size-3.5 text-subtle" />
                    <span className={cn("font-semibold tabular-nums", (s.seeders ?? 0) > 20 ? "text-emerald-300" : (s.seeders ?? 0) > 0 ? "text-amber-300" : "text-subtle")}>{s.seeders ?? "?"}</span>
                </div>
            )}
            <div className="flex shrink-0 items-center gap-1">
                {s.kind === "direct" && (
                    <>
                        <Button size="sm" variant="white" icon={<Play className="size-3.5 fill-current" />} onClick={() => playStream(mediaId, episode, { stream: s, player: "builtin" })}>
                            Play
                        </Button>
                        {!remote && (
                            <IconButton size="sm" label="Play in mpv" onClick={() => playStream(mediaId, episode, { stream: s, player: "mpv" })}>
                                <MonitorPlay className="size-4" />
                            </IconButton>
                        )}
                        <IconButton size="sm" label="Download to the library" loading={busy} onClick={download}>
                            <Download className="size-4" />
                        </IconButton>
                    </>
                )}
                {s.kind === "torrent" && (
                    <>
                        {s.magnet && (
                            <IconButton
                                size="sm"
                                label="Copy magnet link"
                                onClick={async () => {
                                    if (await copyText(s.magnet!)) toast.success("Magnet link copied")
                                    else toast.error("Couldn't copy the magnet link: the browser blocked the clipboard")
                                }}
                            >
                                <Copy className="size-4" />
                            </IconButton>
                        )}
                        <Button size="sm" variant="white" icon={<Magnet className="size-3.5" />} onClick={() => sendTorrent(mediaId, episode, s)}>
                            Send to torrent client
                        </Button>
                    </>
                )}
                {(s.kind === "youtube" || s.kind === "external") && (
                    <Button size="sm" variant="white" icon={s.kind === "youtube" ? <SquarePlay className="size-3.5" /> : <ExternalLink className="size-3.5" />} onClick={() => playStream(mediaId, episode, { stream: s })}>
                        Open
                    </Button>
                )}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Matches of extensions (they search by title) and providers' errors

function Matches({ result, onFix }: { result: StreamsResult; onFix: (p: { provider: string; name: string }) => void }) {
    const matches = result.matches ?? []
    if (!matches.length) return null
    return (
        <div className="flex flex-col gap-1.5">
            {matches.map(m => (
                <p key={m.provider} className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span>
                        {m.name} {m.manual ? "uses" : "matched"} <span className="font-semibold text-fg">{m.title}</span>
                    </span>
                    {!m.manual && m.score < 0.8 && <Badge tone="amber">low confidence</Badge>}
                    <button onClick={() => onFix(m)} className="flex items-center gap-1 text-[13px] font-medium text-fg/80 transition-colors hover:text-fg">
                        <Wand2 className="size-3.5" /> Wrong match? Find manually
                    </button>
                </p>
            ))}
        </div>
    )
}

function ProviderErrors({ result, onFix }: { result: StreamsResult; onFix: (p: { provider: string; name: string }) => void }) {
    const [open, setOpen] = useState(result.streams.length === 0)
    return (
        <div className="rounded-xl bg-white/[0.025]">
            <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-muted transition-colors hover:text-fg">
                <AlertTriangle className="size-4 text-amber-300" />
                {plural(result.errors.length, "provider")} found nothing
                <ChevronDown className={cn("ml-auto size-4 transition-transform", open && "rotate-180")} />
            </button>
            {open && (
                <div className="flex flex-col gap-2 px-4 pb-4">
                    {result.errors.map(e => (
                        <div key={e.provider} className="flex flex-wrap items-start gap-x-3 gap-y-1 text-[13px]">
                            <span className="w-44 shrink-0 truncate font-medium">{e.name}</span>
                            <span className="min-w-0 flex-1 break-words text-subtle">{e.error}</span>
                            {e.provider.startsWith("ext:") && (
                                <button onClick={() => onFix({ provider: e.provider, name: e.name })} className="flex items-center gap-1 text-[13px] font-medium text-fg/80 hover:text-fg">
                                    <Wand2 className="size-3.5" /> Find manually
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function ManualMatchDialog({
    open,
    onOpenChange,
    provider,
    providerName,
    mediaId,
    defaultQuery,
    onPicked,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    provider: string
    providerName: string
    mediaId: number
    defaultQuery: string
    onPicked: () => void
}) {
    const [q, setQ] = useState(defaultQuery)
    const [results, setResults] = useState<{ id: string; title: string; subOrDub?: string }[]>([])
    const [busy, setBusy] = useState(false)
    const search = async () => {
        setBusy(true)
        try {
            setResults(await api.get(`/api/providers/search${qs({ provider, q, mediaId })}`))
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(false)
        }
    }
    const pick = async (r: (typeof results)[number]) => {
        try {
            await api.post("/api/providers/mapping", { provider, mediaId, id: r.id, title: r.title })
            toast.success(`${providerName} now uses “${r.title}”`)
            onPicked()
            onOpenChange(false)
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={`Pick the right title on ${providerName}`} description="Search the provider and choose the matching entry. KumoBox remembers your choice.">
            <div className="flex gap-2">
                <Input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Search…" icon={<Search className="size-4" />} />
                <Button variant="primary" loading={busy} onClick={search}>
                    Search
                </Button>
            </div>
            <div className="mt-4 flex flex-col gap-1">
                {results.map(r => (
                    <button key={r.id} onClick={() => pick(r)} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.06]">
                        <span className="font-medium">{r.title}</span>
                        {r.subOrDub && <Badge tone="brand">{r.subOrDub}</Badge>}
                    </button>
                ))}
                {!busy && results.length === 0 && <p className="py-6 text-center text-sm text-subtle">Search to see results</p>}
            </div>
        </Dialog>
    )
}

// ---------------------------------------------------------------------------
// Downloading several episodes of a show

function DownloadDialog({
    open,
    onOpenChange,
    entry,
    from,
    streams,
    providers,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    entry: EntryView
    from: number
    streams: ProviderStream[]
    providers: ProviderInfo[]
}) {
    const media = entry.media
    const [season] = splitKey(from)
    const count = media.seasons?.find(s => s.seasonNumber === season)?.episodeCount || splitKey(from)[1]
    const keys = Array.from({ length: count }, (_, i) => episodeKey(season, i + 1))
    const [start, setStart] = useState(from)
    const [end, setEnd] = useState(keys.at(-1) ?? from)
    // The provider of the best direct link, by default.
    const best = streams.find(s => s.kind === "direct")
    const [provider, setProvider] = useState(best?.provider ?? "")
    const [quality, setQuality] = useState(best?.quality || "1080p")
    const [busy, setBusy] = useState(false)
    useEffect(() => {
        if (!open) return
        setStart(from)
        setEnd(keys.at(-1) ?? from)
        setProvider(best?.provider ?? "")
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, from])
    const chosen = keys.filter(k => k >= start && k <= end)
    const options = keys.map(k => ({ value: String(k), label: formatKey(k) }))
    const go = async () => {
        setBusy(true)
        try {
            await api.post("/api/providers/download", { mediaId: media.id, episodes: chosen, provider, quality })
            onOpenChange(false)
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(false)
        }
    }
    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title="Download episodes"
            description="Each episode's link is looked up when its download starts (links expire), from the provider picked, in the closest quality. Saved into your downloads folder and matched automatically."
            footer={
                <>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button variant="primary" loading={busy} disabled={chosen.length === 0} icon={<Download className="size-4" />} onClick={go}>
                        Download {plural(chosen.length, "episode")}
                    </Button>
                </>
            }
        >
            <div className="grid grid-cols-2 gap-4">
                <Field label="From">
                    <Select value={String(start)} onChange={v => setStart(Number(v))} options={options} />
                </Field>
                <Field label="To">
                    <Select value={String(end)} onChange={v => setEnd(Number(v))} options={options.filter(o => Number(o.value) >= start)} />
                </Field>
                <Field label="Provider">
                    <Select value={provider} onChange={setProvider} options={[{ value: "", label: "Any provider" }, ...providers.map(p => ({ value: p.id, label: p.name }))]} />
                </Field>
                <Field label="Quality">
                    <Select
                        value={quality}
                        onChange={setQuality}
                        options={[
                            { value: "best", label: "Best available" },
                            { value: "2160p", label: "2160p (4K)" },
                            { value: "1080p", label: "1080p" },
                            { value: "720p", label: "720p" },
                            { value: "480p", label: "480p" },
                        ]}
                    />
                </Field>
            </div>
        </Dialog>
    )
}
