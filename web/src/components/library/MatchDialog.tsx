import { useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Link2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "@/lib/toast"
import { api } from "@/lib/api"
import { episodeKey, episodeKeys, formatKey, keyAtIndex, MOVIE_EPISODE, mediaIsShow } from "@/lib/ids"
import type { LocalFile, Media } from "@/lib/types"
import { cn, cover, mediaSummary, title } from "@/lib/utils"
import { MediaPicker } from "../MediaPicker"
import { Button, Dialog, Input } from "../ui"

type Numbering = "names" | "offset" | "order"

// Natural order for file names ("Ep 2" before "Ep 10"), like the server.
export function naturalCompare(a: string, b: string) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}

// The episode key each file gets with the chosen numbering (mirrors the
// server): from the names, the season and episode they carry (season 1 when
// a name has only an episode number); counted, the number in the name (or
// the file's place in name order) is the n-th episode of the show, so a
// show numbered 1-24 across two seasons lands on S01-S02. A movie's file
// is the movie. 0: no episode (bonus material, or no number).
function episodesFor(files: LocalFile[], target: Media | null, numbering: Numbering, offset: number) {
    const order = new Map<string, number>()
    if (numbering === "order") {
        files
            .filter(f => f.kind === "main")
            .slice()
            .sort((a, b) => naturalCompare(a.name, b.name))
            .forEach((f, i) => order.set(f.path, i + 1))
    }
    const movie = !!target && !mediaIsShow(target)
    const counted = (n: number) => (n > 0 ? keyAtIndex(target, n) || (target && episodeKeys(target).length ? 0 : episodeKey(1, n)) : 0)
    return new Map(
        files.map(f => {
            if (f.kind === "nc") return [f.path, 0]
            if (movie) return [f.path, f.kind === "main" ? MOVIE_EPISODE : 0]
            if (numbering === "order") return [f.path, counted(order.get(f.path) ?? 0)]
            const ep = f.parsed.episode
            if (ep < 0) return [f.path, 0]
            if (numbering === "offset") return [f.path, counted(ep + offset)]
            const season = f.parsed.season > 0 ? f.parsed.season : f.kind === "special" ? 0 : 1
            return [f.path, ep > 0 ? episodeKey(season, ep) : 0]
        }),
    )
}

// Matches local files to a movie or show by hand (the match is locked, so
// later scans keep it). Without a target it's searched on TMDB first.
export function MatchDialog({
    open,
    onOpenChange,
    files,
    target: fixedTarget,
    initialQuery = "",
    onDone,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    files: LocalFile[]
    target?: Media | null
    initialQuery?: string
    onDone?: () => void
}) {
    const qc = useQueryClient()
    const [picked, setPicked] = useState<Media | null>(null)
    const [numbering, setNumbering] = useState<Numbering>("names")
    const [offset, setOffset] = useState(0)
    const [saving, setSaving] = useState(false)
    const justPicked = useRef(false)
    const target = fixedTarget ?? picked

    const main = files.filter(f => f.kind === "main")
    const parsedEps = main.map(f => f.parsed.episode).filter(e => e > 0)
    const unnumbered = main.length > 0 && parsedEps.length < main.length

    // Reset when opened for another set of files, and suggest a numbering:
    // files without numbers -> file order; numbers without a season past the
    // end of season 1 (13-24 for a 12-episode first season) -> counted from
    // the first episode.
    useEffect(() => {
        if (!open) return
        setPicked(null)
        setSaving(false)
        setNumbering(unnumbered ? "order" : "names")
        setOffset(0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, files])
    useEffect(() => {
        if (!target || unnumbered || !mediaIsShow(target)) return
        const first = target.seasons?.find(x => x.seasonNumber === 1)?.episodeCount ?? 0
        const seasonless = main.filter(f => f.parsed.season <= 0 && f.parsed.episode > 0)
        if (first > 0 && seasonless.some(f => f.parsed.episode > first)) {
            setNumbering("offset")
            setOffset(0)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target?.id])

    const eps = useMemo(() => episodesFor(files, target, numbering, offset), [files, target, numbering, offset])
    const show = !!target && mediaIsShow(target)
    const known = useMemo(() => new Set(target && show ? episodeKeys(target) : []), [target, show])
    // Episodes the show doesn't have (when its seasons are known).
    const unknown = (key: number) => show && known.size > 0 && key >= 1000 && !known.has(key)
    const outOfRange = main.filter(f => unknown(eps.get(f.path) ?? 0)).length
    const label = (f: LocalFile) => {
        if (f.kind === "nc") return "Bonus"
        const key = eps.get(f.path) ?? 0
        if (!key) return f.kind === "special" ? "Extra" : "No number"
        return show ? formatKey(key) : "Movie"
    }

    const save = async () => {
        if (!target) return
        setSaving(true)
        try {
            await api.post("/api/library/match", {
                paths: files.map(f => f.path),
                mediaId: target.id,
                // Shows only: numbers counted from the first episode (absolute),
                // shifted by episodeOffset, or the files' order.
                absolute: show && numbering === "offset",
                episodeOffset: show && numbering === "offset" ? offset : 0,
                renumber: show && numbering === "order",
            })
            toast.success(`Matched ${files.length} ${files.length === 1 ? "file" : "files"} to ${title(target)}`)
            qc.invalidateQueries({ queryKey: ["library"] })
            qc.invalidateQueries({ queryKey: ["collection"] })
            qc.invalidateQueries({ queryKey: ["entry"] })
            onOpenChange(false)
            onDone?.()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setSaving(false)
        }
    }

    // Step 1: choose the movie or show.
    if (open && !target) {
        return (
            <MediaPicker
                open
                // The picker closes itself right after a pick: that isn't a cancel.
                onOpenChange={v => {
                    if (!v && !justPicked.current) onOpenChange(false)
                    justPicked.current = false
                }}
                onPick={m => {
                    justPicked.current = true
                    setPicked(m)
                }}
                initialQuery={initialQuery}
                heading={`Match ${files.length} ${files.length === 1 ? "file" : "files"} to…`}
                description="Search TMDB for the right movie or show. The match is locked, so later scans keep it."
            />
        )
    }

    // Step 2: episode numbering and confirm.
    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title="Confirm match"
            description="Check the episode numbers before saving."
            className="w-[min(94vw,720px)]"
            footer={
                <>
                    {!fixedTarget && (
                        <Button variant="ghost" onClick={() => setPicked(null)}>
                            Pick another title
                        </Button>
                    )}
                    <Button variant="primary" loading={saving} icon={<Link2 className="size-4" />} onClick={save}>
                        Match {files.length} {files.length === 1 ? "file" : "files"}
                    </Button>
                </>
            }
        >
            {target && (
                <div className="flex items-center gap-4 rounded-xl border border-line bg-surface-2/60 p-3">
                    <img src={cover(target)} alt="" className="h-20 w-14 rounded-lg object-cover" />
                    <div className="min-w-0">
                        <p className="truncate font-semibold">{title(target)}</p>
                        <p className="text-sm text-muted">{mediaSummary(target)}</p>
                    </div>
                </div>
            )}

            {show && (
                <div className="mt-5 flex flex-col gap-2">
                    <p className="text-sm font-medium">Episode numbers</p>
                    {(
                        [
                            ["names", "From the file names (S01E02)"],
                            ["offset", "Counted from the first episode (absolute numbers)"],
                            ["order", "1, 2, 3… in file-name order"],
                        ] as [Numbering, string][]
                    ).map(([v, text]) => (
                        <label key={v} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition", numbering === v ? "border-brand/50 bg-brand-soft" : "border-line hover:bg-white/[0.03]")}>
                            <input type="radio" name="numbering" checked={numbering === v} onChange={() => setNumbering(v)} className="accent-[var(--brand)]" />
                            <span className="flex-1">{text}</span>
                            {v === "offset" && numbering === "offset" && (
                                <span className="flex items-center gap-2 text-xs text-muted">
                                    shifted by
                                    <div className="w-20">
                                        <Input type="number" value={offset} onChange={e => setOffset(Number(e.target.value) || 0)} />
                                    </div>
                                </span>
                            )}
                        </label>
                    ))}
                    {outOfRange > 0 && (
                        <p className="text-xs text-amber-300">
                            {outOfRange} {outOfRange === 1 ? "file gets an episode" : "files get episodes"} {title(target)} doesn't have. If the files are numbered from the first
                            episode of the show, count from the first episode.
                        </p>
                    )}
                </div>
            )}

            <div className="mt-5 max-h-64 overflow-y-auto rounded-xl border border-line">
                {files
                    .slice()
                    .sort((a, b) => naturalCompare(a.name, b.name))
                    .map(f => (
                        <div key={f.path} className="flex items-center gap-3 border-b border-line px-3 py-2 text-sm last:border-b-0">
                            <span className="min-w-0 flex-1 truncate text-fg/85" title={f.path}>
                                {f.name}
                            </span>
                            <ArrowRight className="size-3.5 shrink-0 text-subtle" />
                            <span className={cn("w-24 shrink-0 text-right font-semibold tabular-nums", unknown(eps.get(f.path) ?? 0) && "text-amber-300")}>{label(f)}</span>
                        </div>
                    ))}
            </div>
        </Dialog>
    )
}
