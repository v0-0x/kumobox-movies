import { AtSign, ExternalLink, RefreshCw, Settings2, Unplug } from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "@/lib/toast"
import { resultSummary, useLetterboxd, useLetterboxdStatus, useStatus } from "@/lib/queries"
import { img, relativeTime } from "@/lib/utils"
import { Button, Dialog, Field, Input } from "./ui"

// Letterboxd's orange, green and blue dots.
export function LetterboxdMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 30 12" className={className} aria-hidden>
            <circle cx="6" cy="6" r="5" fill="#ff8000" />
            <circle cx="15" cy="6" r="5" fill="#00e054" fillOpacity="0.9" />
            <circle cx="24" cy="6" r="5" fill="#40bcf4" fillOpacity="0.9" />
        </svg>
    )
}

// Connecting a Letterboxd account takes only its username: KumoBox reads the
// member's public diary and exports what's watched here for Letterboxd's
// importer. Connected, the dialog shows the account and syncs it.
export function LetterboxdDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const { data: status } = useStatus()
    const { data: lb } = useLetterboxdStatus(open)
    const actions = useLetterboxd()
    const [username, setUsername] = useState("")
    useEffect(() => {
        if (open) setUsername("")
    }, [open])
    const viewer = status?.letterboxd
    const connected = !!viewer || !!lb?.connected

    const connect = () => {
        const name = username.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?letterboxd\.com\//, "").replace(/\/.*$/, "")
        if (!name) return
        actions.connect.mutate(name, {
            onSuccess: s => {
                toast.success(`Connected to Letterboxd as ${s.displayName || s.username || name}`)
                onOpenChange(false)
            },
        })
    }
    const sync = () => actions.sync.mutate(undefined, { onSuccess: r => toast.success(`Synced with Letterboxd: ${resultSummary(r)}`) })
    const disconnect = () => actions.disconnect.mutate(undefined, { onSuccess: () => toast.success("Disconnected from Letterboxd") })

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={connected ? "Letterboxd" : "Connect Letterboxd"}
            description={connected ? undefined : "Bring your diary, ratings and watchlist to KumoBox, and send back what you watch here."}
        >
            {connected ? (
                <div className="flex flex-col gap-5">
                    <div className="flex items-center gap-4 rounded-lg bg-white/[0.03] p-4">
                        {viewer?.avatar?.large ? (
                            <img src={img(viewer.avatar.large)} alt="" className="size-12 rounded-full object-cover" />
                        ) : (
                            <span className="grid size-12 place-items-center rounded-full bg-surface-3">
                                <LetterboxdMark className="w-7" />
                            </span>
                        )}
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">{lb?.displayName || viewer?.name || lb?.username}</p>
                            <p className="truncate text-xs text-subtle">
                                {lb?.lastSync ? `Synced ${relativeTime(lb.lastSync)}` : "Not synced yet"}
                                {!!lb?.pending && ` · ${lb.pending} ${lb.pending === 1 ? "film" : "films"} to send`}
                            </p>
                            {lb?.lastError && <p className="mt-1 text-xs text-rose-300">{lb.lastError}</p>}
                        </div>
                        {(viewer?.letterboxd || lb?.username) && (
                            <a href={viewer?.letterboxd || `https://letterboxd.com/${lb?.username}/`} target="_blank" rel="noopener noreferrer">
                                <Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />}>
                                    Profile
                                </Button>
                            </a>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="primary" icon={<RefreshCw className="size-4" />} loading={actions.sync.isPending} onClick={sync}>
                            Sync now
                        </Button>
                        <Link to="/settings?tab=letterboxd" onClick={() => onOpenChange(false)}>
                            <Button icon={<Settings2 className="size-4" />}>Import, export & options</Button>
                        </Link>
                        <Button variant="danger" className="ml-auto" icon={<Unplug className="size-4" />} loading={actions.disconnect.isPending} onClick={disconnect}>
                            Disconnect
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-5">
                    <div className="flex items-start gap-4 rounded-lg bg-white/[0.03] p-5">
                        <LetterboxdMark className="mt-1 w-9 shrink-0" />
                        <p className="text-sm text-muted">
                            KumoBox reads your public Letterboxd diary and adds the films you watched, with your ratings and likes, to your list. Films you watch in KumoBox are
                            logged in its diary, ready to export to Letterboxd. No password needed.
                        </p>
                    </div>
                    <Field label="Letterboxd username" help="As in letterboxd.com/username. Your profile and diary must be public.">
                        <Input
                            autoFocus
                            icon={<AtSign className="size-4" />}
                            placeholder="username"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && connect()}
                        />
                    </Field>
                    <Button variant="white" loading={actions.connect.isPending} disabled={!username.trim()} onClick={connect}>
                        Connect
                    </Button>
                </div>
            )}
        </Dialog>
    )
}
