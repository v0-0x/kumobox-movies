import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Download, MonitorPlay, Play, Puzzle, RefreshCw, Search, Wand2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "@/lib/toast"
import { api, qs } from "@/lib/api"
import { formatKey, mediaIsShow } from "@/lib/ids"
import { rememberedProvider, usePlay } from "@/lib/play"
import { useEpisodeMarker, useLanguageMode, useOnlineProviders, useStatus, useStreamEpisodes, useStreamModes } from "@/lib/queries"
import type { EntryView } from "@/lib/types"
import { cn, title as mediaTitle } from "@/lib/utils"
import { EpisodeCard, WatchedToggle } from "../EpisodeCard"
import { Badge, Button, Dialog, EmptyState, Field, IconButton, Input, Select, Skeleton, Tooltip } from "../ui"

export function StreamPanel({ entry }: { entry: EntryView }) {
    const { data: status } = useStatus()
    const settings = status?.settings
    const { data: providers } = useOnlineProviders()
    const media = entry.media
    const show = mediaIsShow(media)
    const [provider, setProvider] = useState<string>(() => rememberedProvider(media.id) || settings?.onlineStream.defaultProvider || "")
    // Without a remembered or default provider (or one that's gone), the first one.
    useEffect(() => {
        if (providers?.length && !providers.some(p => p.id === provider)) setProvider(providers[0].id)
    }, [providers, provider])
    // Original audio or dub is remembered per title on the server (also used
    // by Continue watching, the Play button and local files).
    const language = useLanguageMode(media.id)
    const wantDub = language.mode ? language.mode === "dub" : !!settings?.onlineStream.preferDub
    const setDub = (d: boolean) => language.set(d ? "dub" : "sub")
    const prov = providers?.find(p => p.id === provider)
    const supportsDub = prov?.supportsDub ?? true
    // Only the versions the provider has: asked once the episodes of the
    // chosen one are in (the server then only looks for the other).
    const [modesFor, setModesFor] = useState("")
    const { data: modes, error: modesError } = useStreamModes(provider, media.id, supportsDub && modesFor === provider)
    const hasSub = !supportsDub || !modes || modes.sub
    const hasDub = supportsDub && (!modes || modes.dub)
    const dub = hasDub && (wantDub || !hasSub)
    const modesKnown = !supportsDub || !!modes || !!modesError
    const [matchOpen, setMatchOpen] = useState(false)
    const [dlOpen, setDlOpen] = useState(false)
    const { playStream, streamPlayer, remote } = usePlay()
    const marker = useEpisodeMarker(media)
    const qc = useQueryClient()

    useEffect(() => {
        if (!provider) return
        try {
            localStorage.setItem(`kumobox-provider-${media.id}`, provider)
        } catch {
            /* ignore */
        }
    }, [provider, media.id])

    // Wait for the remembered choice, or the first request would list (and
    // remember) the default mode instead. The only version there is isn't a
    // choice to remember.
    const { data, isLoading, error, refetch, isFetching } = useStreamEpisodes(provider, media.id, dub, language.loaded, dub !== wantDub)
    useEffect(() => {
        if (language.loaded && !isLoading) setModesFor(provider)
    }, [language.loaded, isLoading, provider])
    const progress = entry.listEntry?.progress ?? 0

    const episodes = useMemo(() => {
        const meta = new Map((entry.episodes ?? []).map(e => [e.number, e]))
        return (data?.episodes ?? []).map(e => {
            const m = meta.get(e.number)
            return {
                number: e.number,
                title: m?.title || e.title || "",
                image: m?.image || media.bannerImage || media.coverImage?.extraLarge,
                runtime: m?.runtime,
                watched: e.number <= progress,
                resumeAt: m?.resumeAt ?? 0,
                duration: m?.history?.duration ?? 0,
            }
        })
    }, [data, entry.episodes, media, progress])

    const refresh = async () => {
        await api.get(`/api/providers/episodes${qs({ provider, mediaId: media.id, dub, refresh: 1, only: dub !== wantDub ? 1 : undefined })}`).catch(e => toast.error(e.message))
        qc.invalidateQueries({ queryKey: ["os-episodes", provider, media.id, dub] })
        if (supportsDub)
            api.get<{ sub: boolean; dub: boolean }>(`/api/providers/modes${qs({ provider, mediaId: media.id, refresh: 1 })}`)
                .then(m => qc.setQueryData(["os-modes", provider, media.id], m))
                .catch(() => {})
    }

    const providerOptions = (providers ?? []).map(p => ({ value: p.id, label: p.name + (p.builtin ? " (built in)" : "") }))
    // "Original" / "Dub" for the two versions a provider can have.
    const versionName = (d: boolean) => (d ? "Dub" : "Original")

    if (providers && providers.length === 0)
        return (
            <EmptyState
                icon={<Puzzle className="size-6" />}
                title="No streaming providers"
                action={
                    <Link to="/extensions">
                        <Button variant="primary">Providers & extensions</Button>
                    </Link>
                }
            >
                Turn on the Internet Archive or add Stremio addons, Nuvio repositories or extensions to watch online.
            </EmptyState>
        )

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3">
                <Select value={provider} onChange={setProvider} options={providerOptions} className="w-60" />
                {hasSub && hasDub ? (
                    <div className="flex rounded-lg bg-white/[0.04] p-0.5">
                        {[false, true].map(d => (
                            <button
                                key={String(d)}
                                onClick={() => setDub(d)}
                                className={cn("h-8 rounded-md px-3.5 text-[13px] font-medium transition-colors", d === dub ? "bg-white/[0.1] text-fg" : "text-muted hover:text-fg")}
                            >
                                {versionName(d)}
                            </button>
                        ))}
                    </div>
                ) : (
                    supportsDub && (
                        <Tooltip content={`${prov?.name ?? provider} only has it ${dub ? "dubbed" : "in its original version"}`}>
                            <span className="flex rounded-lg bg-white/[0.04] p-0.5">
                                <span className="grid h-8 place-items-center rounded-md bg-white/[0.1] px-3.5 text-[13px] font-medium text-fg">{versionName(dub)}</span>
                            </span>
                        </Tooltip>
                    )
                )}
                <IconButton label={show ? "Refresh episode list" : "Look again"} variant="subtle" onClick={refresh}>
                    <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
                </IconButton>
                <Button variant="subtle" icon={<Wand2 className="size-4" />} onClick={() => setMatchOpen(true)}>
                    {data?.mapping ? "Change match" : "Find manually"}
                </Button>
                {show && (
                    <Button variant="subtle" icon={<Download className="size-4" />} disabled={!episodes.length} onClick={() => setDlOpen(true)}>
                        Download episodes
                    </Button>
                )}
                {data?.mapping && (
                    <span className="text-sm text-muted">
                        Matched <span className="font-semibold text-fg">{data.mapping.title}</span>
                        {data.mapping.score < 0.8 && (
                            <Badge tone="amber" className="ml-2">
                                low confidence
                            </Badge>
                        )}
                    </span>
                )}
                {!remote && (
                    <span className="ml-auto flex items-center gap-1.5 text-xs text-subtle">
                        <MonitorPlay className="size-3.5" /> Plays in {streamPlayer() === "mpv" ? "mpv" : "the in-app player"}
                    </span>
                )}
            </div>

            {(isLoading || (!error && data && episodes.length === 0 && !modesKnown)) && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="aspect-video" />
                    ))}
                </div>
            )}
            {error && (
                <EmptyState icon={<AlertTriangle className="size-6" />} title={show ? "Couldn't load episodes" : "Couldn't find streams"} action={<Button onClick={() => refetch()}>Try again</Button>}>
                    {(error as Error).message}
                </EmptyState>
            )}
            {!isLoading && !error && data && episodes.length === 0 && modesKnown && (
                <EmptyState icon={<Search className="size-6" />} title="No match found" action={<Button variant="primary" onClick={() => setMatchOpen(true)}>Search manually</Button>}>
                    {prov?.name ?? provider} has nothing for this {show ? "show" : "movie"}{dub ? " dubbed" : ""}.
                </EmptyState>
            )}

            {episodes.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-6 gap-y-8">
                    {episodes.map(ep => (
                        <EpisodeCard
                            key={ep.number}
                            image={ep.image}
                            label={show ? formatKey(ep.number) : "Movie"}
                            title={show ? ep.title || formatKey(ep.number) : mediaTitle(media)}
                            subtitle={`${show ? formatKey(ep.number) : prov?.name ?? provider}${supportsDub ? ` · ${versionName(dub)}` : ""}`}
                            runtime={ep.runtime}
                            watched={ep.watched}
                            resumeAt={ep.resumeAt}
                            progress={ep.duration ? ep.resumeAt / ep.duration : 0}
                            blur={settings?.ui.blurUnwatched}
                            onClick={() => playStream(provider, media.id, ep.number, dub)}
                            actions={
                                <div className="flex gap-1">
                                    <WatchedToggle watched={ep.watched} disabled={marker.pending} onToggle={() => marker.mark(ep.number, !ep.watched)} />
                                    {!remote && (
                                        <Tooltip content={streamPlayer() === "mpv" ? "Play in the in-app player" : "Play in mpv"}>
                                            <button
                                                className="grid size-8 place-items-center rounded-lg bg-black/60 text-white backdrop-blur hover:bg-black/80"
                                                onClick={e => {
                                                    e.stopPropagation()
                                                    playStream(provider, media.id, ep.number, dub, { player: streamPlayer() === "mpv" ? "builtin" : "mpv" })
                                                }}
                                            >
                                                {streamPlayer() === "mpv" ? <Play className="size-4" /> : <MonitorPlay className="size-4" />}
                                            </button>
                                        </Tooltip>
                                    )}
                                    <Tooltip content="Download to library">
                                        <button
                                            className="grid size-8 place-items-center rounded-lg bg-black/60 text-white backdrop-blur hover:bg-black/80"
                                            onClick={e => {
                                                e.stopPropagation()
                                                api.post("/api/providers/download", { provider, mediaId: media.id, episodes: [ep.number], dub }).catch(err => toast.error(err.message))
                                            }}
                                        >
                                            <Download className="size-4" />
                                        </button>
                                    </Tooltip>
                                </div>
                            }
                        />
                    ))}
                </div>
            )}

            <ManualMatchDialog
                open={matchOpen}
                onOpenChange={setMatchOpen}
                provider={provider}
                mediaId={media.id}
                dub={dub}
                canDub={supportsDub}
                onPicked={setDub}
                defaultQuery={media.title.english || media.title.romaji || ""}
            />
            <DownloadDialog
                open={dlOpen}
                onOpenChange={setDlOpen}
                provider={provider}
                mediaId={media.id}
                dub={dub}
                episodes={episodes.map(e => e.number)}
                from={Math.max(progress + 1, episodes[0]?.number ?? 1)}
            />
        </div>
    )
}

function ManualMatchDialog({
    open,
    onOpenChange,
    provider,
    mediaId,
    dub: pageDub,
    canDub,
    onPicked,
    defaultQuery,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    provider: string
    mediaId: number
    dub: boolean
    canDub: boolean
    onPicked: (dub: boolean) => void
    defaultQuery: string
}) {
    const [q, setQ] = useState(defaultQuery)
    const [results, setResults] = useState<{ id: string; title: string; subOrDub?: string; query?: string; index?: number; episodes?: number }[]>([])
    const [busy, setBusy] = useState(false)
    // Either version, also the one the page doesn't offer (not found).
    const [dub, setDubMode] = useState(pageDub)
    const qc = useQueryClient()
    useEffect(() => setQ(defaultQuery), [defaultQuery])
    useEffect(() => {
        if (open) setDubMode(pageDub)
    }, [open, pageDub])
    const search = async () => {
        setBusy(true)
        try {
            setResults(await api.get(`/api/providers/search${qs({ provider, q, dub })}`))
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(false)
        }
    }
    const pick = async (r: (typeof results)[number]) => {
        try {
            await api.post("/api/providers/mapping", { provider, mediaId, dub, id: r.id, title: r.title, query: r.query, index: r.index })
            toast.success(`Now using “${r.title}”`)
            qc.invalidateQueries({ queryKey: ["os-episodes", provider, mediaId, dub] })
            qc.invalidateQueries({ queryKey: ["os-modes", provider, mediaId] })
            onPicked(dub)
            onOpenChange(false)
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title="Pick the right title" description="Search the provider and choose the matching entry. KumoBox remembers your choice.">
            <div className="flex gap-2">
                <Input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Search…" icon={<Search className="size-4" />} />
                {canDub && (
                    <div className="flex shrink-0 rounded-lg bg-white/[0.04] p-0.5">
                        {[false, true].map(d => (
                            <button
                                key={String(d)}
                                onClick={() => {
                                    setDubMode(d)
                                    setResults([])
                                }}
                                className={cn("rounded-md px-3 text-xs font-medium transition-colors", d === dub ? "bg-white/[0.1] text-fg" : "text-muted hover:text-fg")}
                            >
                                {d ? "Dub" : "Original"}
                            </button>
                        ))}
                    </div>
                )}
                <Button variant="primary" loading={busy} onClick={search}>
                    Search
                </Button>
            </div>
            <div className="mt-4 flex flex-col gap-1">
                {results.map(r => (
                    <button key={r.id} onClick={() => pick(r)} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.06]">
                        <span className="font-medium">{r.title}</span>
                        <span className="flex shrink-0 gap-1.5">
                            {r.episodes ? <Badge>{r.episodes} eps</Badge> : null}
                            {r.subOrDub && <Badge tone="brand">{r.subOrDub}</Badge>}
                        </span>
                    </button>
                ))}
                {!busy && results.length === 0 && <p className="py-6 text-center text-sm text-subtle">Search to see results</p>}
            </div>
        </Dialog>
    )
}

function DownloadDialog({ open, onOpenChange, provider, mediaId, dub, episodes, from }: { open: boolean; onOpenChange: (v: boolean) => void; provider: string; mediaId: number; dub: boolean; episodes: number[]; from: number }) {
    const last = episodes[episodes.length - 1] ?? 0
    const [start, setStart] = useState(from)
    const [end, setEnd] = useState(last)
    const [quality, setQuality] = useState("best")
    const [busy, setBusy] = useState(false)
    // The list is a new array on every render of the panel: follow its content.
    const sig = episodes.join(",")
    useEffect(() => {
        setStart(episodes.find(k => k >= from) ?? last)
        setEnd(last)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [from, last, sig])
    const chosen = episodes.filter(k => k >= start && k <= end)
    const options = episodes.map(k => ({ value: String(k), label: formatKey(k) }))
    const go = async () => {
        setBusy(true)
        try {
            await api.post("/api/providers/download", { provider, mediaId, episodes: chosen, dub, quality })
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
            description={`Saved into your downloads folder (${dub ? "dubbed" : "original version"}) and matched automatically.`}
            footer={
                <>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button variant="primary" loading={busy} disabled={chosen.length === 0} icon={<Download className="size-4" />} onClick={go}>
                        Download {chosen.length} {chosen.length === 1 ? "episode" : "episodes"}
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
                <Field label="Quality" className="col-span-2">
                    <Select
                        value={quality}
                        onChange={setQuality}
                        options={[
                            { value: "best", label: "Best available" },
                            { value: "1080", label: "1080p" },
                            { value: "720", label: "720p" },
                            { value: "480", label: "480p" },
                            { value: "worst", label: "Smallest" },
                        ]}
                    />
                </Field>
            </div>
        </Dialog>
    )
}
