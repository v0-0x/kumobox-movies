import { BookOpenCheck, Heart, Repeat2, Trash2 } from "lucide-react"
import { useDiary, useLetterboxd } from "@/lib/queries"
import { formatDate } from "@/lib/utils"
import { Badge, IconButton } from "../ui"
import { StarRating } from "./ListEditor"

// The times a movie was watched: logged here when it plays to the end, or
// imported from Letterboxd.
export function Diary({ mediaId }: { mediaId: number }) {
    const { data } = useDiary(mediaId, 50)
    const { deleteDiary } = useLetterboxd()
    const entries = data ?? []
    if (entries.length === 0) return null
    return (
        <section>
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight">
                <BookOpenCheck className="size-4 text-subtle" /> Diary
                <span className="text-sm font-normal text-subtle tabular-nums">{entries.length}</span>
            </h3>
            <div className="card divide-y divide-line">
                {entries.map(d => (
                    <div key={d.id} className="group/diary flex items-start gap-4 px-4 py-3">
                        <div className="w-28 shrink-0 pt-0.5 text-sm font-medium tabular-nums">{formatDate(d.watchedDate)}</div>
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2.5">
                                {d.rating > 0 && <StarRating value={d.rating} size="sm" />}
                                {d.liked && <Heart className="size-3.5 fill-[#ff8000] text-[#ff8000]" aria-label="Liked" />}
                                {d.rewatch && (
                                    <span className="flex items-center gap-1 text-xs text-muted">
                                        <Repeat2 className="size-3.5" /> Rewatch
                                    </span>
                                )}
                                <Badge tone={d.source === "letterboxd" ? "green" : "gray"}>{d.source === "letterboxd" ? "From Letterboxd" : "Watched in KumoBox"}</Badge>
                                {d.source !== "letterboxd" && (d.exportedAt ? <Badge tone="blue">On Letterboxd</Badge> : <Badge tone="amber">Not on Letterboxd yet</Badge>)}
                            </div>
                            {d.review && <p className="mt-1.5 line-clamp-3 text-sm whitespace-pre-line text-muted">{d.review}</p>}
                        </div>
                        <IconButton
                            label="Delete this diary entry"
                            size="sm"
                            className="opacity-0 group-hover/diary:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                            disabled={deleteDiary.isPending}
                            onClick={() => deleteDiary.mutate(d.id)}
                        >
                            <Trash2 className="size-4" />
                        </IconButton>
                    </div>
                ))}
            </div>
        </section>
    )
}
