import { useQueryClient } from "@tanstack/react-query"
import { EyeOff, FileVideo, FolderSync, Link2, Link2Off, Lock, RefreshCw, Search, Undo2, Wand2 } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "@/lib/toast"
import { LibraryFolders } from "@/components/library/LibraryFolders"
import { MediaPicker } from "@/components/MediaPicker"
import { Badge, Button, EmptyState, IconButton, Input, Select, Tabs } from "@/components/ui"
import { api } from "@/lib/api"
import { episodeKey, formatKey, isShow, mediaRef, splitKey } from "@/lib/ids"
import { useCollection, useLibraryFiles, useScan, useUnmatched } from "@/lib/queries"
import { scanStore, useStore } from "@/lib/store"
import type { LocalFile } from "@/lib/types"
import { cn, formatBytes, title } from "@/lib/utils"

type Tab = "folders" | "unmatched" | "files" | "ignored"
const TABS: string[] = ["folders", "unmatched", "files", "ignored"]

export default function LibraryPage() {
    const [params, setParams] = useSearchParams()
    const raw = params.get("tab") ?? ""
    // Unknown tabs (old links, typos) open the first one instead of nothing.
    const tab = (TABS.includes(raw) ? raw : "folders") as Tab
    const { data: coll } = useCollection()
    const scan = useScan()
    const scanning = useStore(scanStore, s => s.running)
    return (
        <div className="min-h-full px-6 pt-8 pb-24 md:px-8 xl:px-10">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-[1.75rem] font-semibold tracking-tight">Library tools</h1>
                    <p className="mt-1 text-muted">Fix matches, season and episode numbers, and ignored files.</p>
                </div>
                <div className="flex gap-2">
                    <Button icon={<FolderSync className="size-4" />} loading={scanning} onClick={() => scan.mutate(false)}>
                        Scan for new files
                    </Button>
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => scan.mutate(true)} disabled={scanning}>
                        Re-match everything
                    </Button>
                </div>
            </div>
            <Tabs
                className="mb-8"
                value={tab}
                onChange={t => setParams({ tab: t }, { replace: true })}
                tabs={[
                    { value: "folders", label: "Folders & matches" },
                    { value: "unmatched", label: "Unmatched", count: coll?.unmatchedCount ?? 0 },
                    { value: "files", label: "All files" },
                    { value: "ignored", label: "Ignored", count: coll?.ignoredCount ?? 0 },
                ]}
            />
            {tab === "folders" && <LibraryFolders />}
            {tab === "unmatched" && <Unmatched />}
            {tab === "files" && <AllFiles />}
            {tab === "ignored" && <Ignored />}
        </div>
    )
}

function Unmatched() {
    const { data, isLoading } = useUnmatched()
    const [picking, setPicking] = useState<{ paths: string[]; title: string } | null>(null)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const qc = useQueryClient()
    const refresh = () => {
        qc.invalidateQueries({ queryKey: ["library"] })
        qc.invalidateQueries({ queryKey: ["collection"] })
    }
    const ignore = async (paths: string[]) => {
        try {
            await api.post("/api/library/ignore", { paths, ignored: true })
            toast.success(`Ignored ${paths.length} file(s)`)
            refresh()
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    const match = async (mediaId: number, paths: string[]) => {
        try {
            await api.post("/api/library/match", { paths, mediaId })
            toast.success(`Matched ${paths.length} file(s)`)
            setSelected(new Set())
            refresh()
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    if (isLoading) return <div className="card h-40 shimmer" />
    if (!data?.length)
        return (
            <EmptyState icon={<Link2 className="size-6" />} title="Everything is matched">
                All video files in your library are linked to a movie or show.
            </EmptyState>
        )
    return (
        <div className="flex flex-col gap-5">
            {data.map(g => {
                const paths = g.files.map(f => f.path)
                const chosen = paths.filter(p => selected.has(p))
                return (
                    <div key={g.dir} className="card overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white/[0.02] px-5 py-4">
                            <div className="min-w-0">
                                <p className="truncate text-lg font-semibold">{g.title}</p>
                                <p className="truncate text-xs text-subtle">{g.dir}</p>
                            </div>
                            <div className="flex gap-2">
                                <Button size="sm" variant="primary" icon={<Wand2 className="size-4" />} onClick={() => setPicking({ paths: chosen.length ? chosen : paths, title: g.title })}>
                                    Match {chosen.length ? `${chosen.length} selected` : "all"}
                                </Button>
                                <Button size="sm" variant="subtle" icon={<EyeOff className="size-4" />} onClick={() => ignore(chosen.length ? chosen : paths)}>
                                    Ignore
                                </Button>
                            </div>
                        </div>
                        <div className="divide-y divide-line">
                            {g.files.map(f => (
                                <label key={f.path} className="flex cursor-pointer items-center gap-4 px-5 py-2.5 text-sm hover:bg-white/[0.02]">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(f.path)}
                                        onChange={() =>
                                            setSelected(s => {
                                                const n = new Set(s)
                                                n.has(f.path) ? n.delete(f.path) : n.add(f.path)
                                                return n
                                            })
                                        }
                                        className="size-4 accent-[var(--brand)]"
                                    />
                                    <FileVideo className="size-4 shrink-0 text-subtle" />
                                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                                    {f.parsed.episode > 0 && <Badge>{f.parsed.season > 0 ? formatKey(episodeKey(f.parsed.season, f.parsed.episode)) : `E${String(f.parsed.episode).padStart(2, "0")}`}</Badge>}
                                    {f.parsed.year > 0 && <Badge>{f.parsed.year}</Badge>}
                                    {f.parsed.releaseGroup && <Badge tone="brand">{f.parsed.releaseGroup}</Badge>}
                                    <span className="w-20 text-right text-xs text-subtle">{formatBytes(f.size)}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                )
            })}
            <MediaPicker
                open={!!picking}
                onOpenChange={v => !v && setPicking(null)}
                initialQuery={picking?.title ?? ""}
                heading="Match files"
                description={picking ? `${picking.paths.length} file(s) will be linked to the movie or show you choose.` : undefined}
                onPick={m => picking && match(m.id, picking.paths)}
            />
        </div>
    )
}

function AllFiles() {
    const { data, isLoading } = useLibraryFiles()
    const { data: coll } = useCollection()
    const [q, setQ] = useState("")
    const [kind, setKind] = useState("all")
    const qc = useQueryClient()
    const titles = useMemo(() => {
        const m = new Map<number, string>()
        for (const l of coll?.lists ?? []) for (const i of l.items) m.set(i.media.id, title(i.media))
        for (const i of coll?.localOnly ?? []) m.set(i.media.id, title(i.media))
        return m
    }, [coll])
    const files = (data ?? []).filter(f => !f.ignored && (kind === "all" || f.kind === kind) && (!q || f.name.toLowerCase().includes(q.toLowerCase()) || (titles.get(f.mediaId) ?? "").toLowerCase().includes(q.toLowerCase())))
    const patch = async (f: LocalFile, body: Record<string, unknown>) => {
        try {
            await api.patch("/api/library/file", { path: f.path, ...body })
            qc.invalidateQueries({ queryKey: ["library"] })
            qc.invalidateQueries({ queryKey: ["entry", f.mediaId] })
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    const unmatch = async (f: LocalFile) => {
        try {
            await api.post("/api/library/unmatch", { paths: [f.path] })
            qc.invalidateQueries({ queryKey: ["library"] })
            qc.invalidateQueries({ queryKey: ["collection"] })
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    if (isLoading) return <div className="card h-40 shimmer" />
    return (
        <div className="flex flex-col gap-4">
            <div className="flex gap-3">
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by file or title…" icon={<Search className="size-4" />} />
                <Select
                    className="w-44"
                    value={kind}
                    onChange={setKind}
                    options={[
                        { value: "all", label: "All kinds" },
                        { value: "main", label: "Movies & episodes" },
                        { value: "part", label: "Movie parts" },
                        { value: "special", label: "Specials" },
                        { value: "extra", label: "Extras" },
                    ]}
                />
            </div>
            <p className="text-sm text-subtle">{files.length} files</p>
            <div className="card divide-y divide-line overflow-hidden">
                {files.slice(0, 500).map(f => (
                    <div key={f.path} className="flex items-center gap-4 px-4 py-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-medium" title={f.path}>
                                {f.name}
                            </p>
                            {f.mediaId > 0 ? (
                                <Link to={`/entry?id=${f.mediaId}`} className="text-xs text-brand-strong hover:underline">
                                    {titles.get(f.mediaId) ?? mediaRef(f.mediaId)}
                                </Link>
                            ) : (
                                <span className="text-xs text-amber-300">Unmatched</span>
                            )}
                        </div>
                        {f.locked && (
                            <span title="Locked: re-scans won't change this file">
                                <Lock className="size-3.5 text-subtle" />
                            </span>
                        )}
                        <select value={f.kind} onChange={e => patch(f, { kind: e.target.value })} className="h-8 rounded-lg border border-line bg-surface-2 px-2 text-xs">
                            <option value="main">{isShow(f.mediaId) ? "Episode" : "Movie"}</option>
                            {!isShow(f.mediaId) && <option value="part">Later part</option>}
                            {isShow(f.mediaId) && <option value="special">Special</option>}
                            <option value="extra">Extra</option>
                        </select>
                        {isShow(f.mediaId) && <KeyInput value={f.episode} onChange={k => patch(f, { episode: k })} />}
                        {f.mediaId > 0 && (
                            <IconButton size="sm" label="Unmatch" onClick={() => unmatch(f)}>
                                <Link2Off className="size-4" />
                            </IconButton>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}

// A show's season and episode, saved as the episode key when the focus
// leaves both boxes: typing the season then Tab and the episode saves
// S01E03, not S01E00 then S00E03 (a special).
function KeyInput({ value, onChange }: { value: number; onChange: (key: number) => void }) {
    const [s, e] = splitKey(value)
    const season = useRef<HTMLInputElement>(null)
    const episode = useRef<HTMLInputElement>(null)
    const commit = (ev: React.FocusEvent<HTMLDivElement>) => {
        if (ev.currentTarget.contains(ev.relatedTarget as Node | null)) return
        const key = episodeKey(Math.max(0, Number(season.current?.value) || 0), Math.max(0, Number(episode.current?.value) || 0))
        if (key !== value) onChange(key)
    }
    const cls = "h-8 w-14 rounded-lg border border-line bg-surface-2 px-2 text-xs"
    return (
        <div key={value} className="flex items-center gap-1.5" onBlur={commit}>
            <span className="text-xs text-subtle">S</span>
            <input ref={season} type="number" min={0} defaultValue={s} aria-label="Season" className={cls} />
            <span className="text-xs text-subtle">E</span>
            <input ref={episode} type="number" min={0} defaultValue={e} aria-label="Episode" className={cls} />
        </div>
    )
}

function Ignored() {
    const { data, isLoading } = useLibraryFiles()
    const qc = useQueryClient()
    const files = (data ?? []).filter(f => f.ignored)
    const restore = async (paths: string[]) => {
        try {
            await api.post("/api/library/ignore", { paths, ignored: false })
            toast.success("Restored — run a scan to match them")
            qc.invalidateQueries({ queryKey: ["library"] })
            qc.invalidateQueries({ queryKey: ["collection"] })
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    if (isLoading) return <div className="card h-40 shimmer" />
    if (!files.length)
        return (
            <EmptyState icon={<EyeOff className="size-6" />} title="No ignored files">
                Files you ignore won’t be matched or shown anywhere.
            </EmptyState>
        )
    return (
        <div className="flex flex-col gap-4">
            <div>
                <Button size="sm" icon={<Undo2 className="size-4" />} onClick={() => restore(files.map(f => f.path))}>
                    Restore all
                </Button>
            </div>
            <div className="card divide-y divide-line">
                {files.map(f => (
                    <div key={f.path} className={cn("flex items-center gap-4 px-4 py-2.5 text-sm")}>
                        <FileVideo className="size-4 text-subtle" />
                        <span className="min-w-0 flex-1 truncate" title={f.path}>
                            {f.name}
                        </span>
                        <Button size="xs" variant="ghost" onClick={() => restore([f.path])}>
                            Restore
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    )
}
