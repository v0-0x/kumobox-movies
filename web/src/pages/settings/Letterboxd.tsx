import { AtSign, CheckCheck, Download, ExternalLink, FileUp, LogIn, RefreshCw, Send, Unplug } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "@/lib/toast"
import { LetterboxdMark } from "@/components/LetterboxdDialog"
import { Badge, Button, Input, Switch } from "@/components/ui"
import { resultSummary, useLetterboxd, useLetterboxdStatus, useStatus } from "@/lib/queries"
import type { LetterboxdResult } from "@/lib/types"
import { img, plural, relativeTime } from "@/lib/utils"
import { Ext, Group, Password, Row, type SectionProps, Stack } from "./parts"

// Letterboxd: the account (connected at once, not with Save), how it syncs,
// importing an export and exporting what's watched here.
export function LetterboxdSection({ draft, set }: SectionProps) {
    const { data: status } = useStatus()
    const { data: lb } = useLetterboxdStatus()
    const actions = useLetterboxd()
    const [username, setUsername] = useState("")
    const viewer = status?.letterboxd
    const connected = !!viewer || !!lb?.connected
    const l = draft.letterboxd

    const connect = () => {
        const name = username.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?letterboxd\.com\//, "").replace(/\/.*$/, "")
        if (!name) return
        actions.connect.mutate(name, {
            onSuccess: s => {
                toast.success(`Connected to Letterboxd as ${s.displayName || s.username || name}`)
                setUsername("")
            },
        })
    }
    const sync = () => actions.sync.mutate(undefined, { onSuccess: r => toast.success(`Synced with Letterboxd: ${resultSummary(r)}`) })

    return (
        <>
            <Group title="Account">
                {connected ? (
                    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                            {viewer?.avatar?.large ? (
                                <img src={img(viewer.avatar.large)} alt="" className="size-11 rounded-full object-cover" />
                            ) : (
                                <span className="grid size-11 place-items-center rounded-full bg-surface-3">
                                    <LetterboxdMark className="w-6" />
                                </span>
                            )}
                            <div className="min-w-0">
                                <p className="truncate font-semibold">{lb?.displayName || viewer?.name || lb?.username}</p>
                                <p className="text-xs text-subtle">
                                    {lb?.lastSync ? `Last synced ${relativeTime(lb.lastSync)}` : "Not synced yet"}
                                    {(viewer?.letterboxd || lb?.username) && (
                                        <>
                                            {" · "}
                                            <Ext href={viewer?.letterboxd || `https://letterboxd.com/${lb?.username}/`}>profile</Ext>
                                        </>
                                    )}
                                </p>
                                {lb?.lastError && <p className="mt-1 text-xs text-rose-300">{lb.lastError}</p>}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" variant="primary" icon={<RefreshCw className="size-4" />} loading={actions.sync.isPending} onClick={sync}>
                                Sync now
                            </Button>
                            <Button
                                size="sm"
                                variant="danger"
                                icon={<Unplug className="size-4" />}
                                loading={actions.disconnect.isPending}
                                onClick={() => actions.disconnect.mutate(undefined, { onSuccess: () => toast.success("Disconnected from Letterboxd") })}
                            >
                                Disconnect
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Stack
                        label="Connect your Letterboxd account"
                        help="Your username, as in letterboxd.com/username. KumoBox reads your public diary: the films you log there, with your ratings and likes, come to your list. No password needed."
                    >
                        <div className="flex gap-2">
                            <Input icon={<AtSign className="size-4" />} placeholder="username" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && connect()} />
                            <Button variant="primary" loading={actions.connect.isPending} disabled={!username.trim()} onClick={connect}>
                                Connect
                            </Button>
                        </div>
                    </Stack>
                )}
            </Group>

            <Group title="Sync" description="What the diary brings and what KumoBox keeps for Letterboxd.">
                <Row label="Sync automatically" help="Read your Letterboxd diary in the background.">
                    <Switch checked={l?.autoSync ?? false} onChange={v => set("letterboxd", { autoSync: v })} />
                </Row>
                {l?.autoSync && (
                    <Row label="Every (minutes)" help="At least 15.">
                        <Input type="number" min={15} className="w-24" value={l.syncMinutes} onChange={e => set("letterboxd", { syncMinutes: Number(e.target.value) })} />
                    </Row>
                )}
                <Row label="Log the movies I watch" help="A movie watched to the end in KumoBox gets a diary entry, ready to send to Letterboxd.">
                    <Switch checked={l?.logWatched ?? false} onChange={v => set("letterboxd", { logWatched: v })} />
                </Row>
                <Row label="Import my watchlist" help="The films of your Letterboxd watchlist go on your KumoBox watchlist (from an export, below).">
                    <Switch checked={l?.importWatchlist ?? false} onChange={v => set("letterboxd", { importWatchlist: v })} />
                </Row>
            </Group>

            <ImportGroup />
            <ExportGroup pending={lb?.pending ?? 0} apiConnected={!!lb?.apiConnected} />
            <ApiGroup draft={draft} set={set} configured={!!lb?.apiConfigured} connected={!!lb?.apiConnected} />
        </>
    )
}

// Letterboxd's export (a ZIP of CSV files: diary, ratings, watched,
// watchlist, likes, reviews) brings everything at once; the diary RSS only
// has the last entries.
function ImportGroup() {
    const { importFile } = useLetterboxd()
    const input = useRef<HTMLInputElement>(null)
    const [result, setResult] = useState<LetterboxdResult | null>(null)
    const pick = (file?: File) => {
        if (!file) return
        setResult(null)
        importFile.mutate(file, {
            onSuccess: r => {
                setResult(r)
                toast.success(`Letterboxd import: ${resultSummary(r)}`)
            },
        })
    }
    const unmatched = result?.unmatched ?? []
    return (
        <Group title="Import from Letterboxd">
            <Stack
                label="Your Letterboxd data"
                help={
                    <>
                        On Letterboxd, open <Ext href="https://letterboxd.com/settings/data/">Settings › Data › Export your data</Ext> and upload the ZIP here (or one of its CSV
                        files): your diary, ratings, likes, reviews{" "}and watchlist come to KumoBox. Importing again only adds what's new.
                    </>
                }
            >
                <div className="flex flex-wrap items-center gap-3">
                    <input ref={input} type="file" accept=".zip,.csv,application/zip,text/csv" className="hidden" onChange={e => (pick(e.target.files?.[0]), (e.target.value = ""))} />
                    <Button icon={<FileUp className="size-4" />} loading={importFile.isPending} onClick={() => input.current?.click()}>
                        Choose ZIP or CSV…
                    </Button>
                    {importFile.isPending && <span className="text-sm text-muted">Importing… matching every film on TMDB can take a minute.</span>}
                </div>
            </Stack>
            {result && (
                <div className="px-4 py-3.5">
                    <div className="flex flex-wrap gap-2">
                        <Badge tone="green">{result.added} added</Badge>
                        <Badge tone="blue">{result.updated} updated</Badge>
                        <Badge>{result.skipped} skipped</Badge>
                        {unmatched.length > 0 && <Badge tone="amber">{unmatched.length} not found</Badge>}
                    </div>
                    {unmatched.length > 0 && (
                        <details className="mt-3 text-sm">
                            <summary className="cursor-pointer text-muted hover:text-fg">{plural(unmatched.length, "title")} couldn't be found on TMDB</summary>
                            <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg bg-black/25 p-3 text-xs leading-relaxed text-fg/80">
                                {unmatched.map((t, i) => (
                                    <li key={i}>{t}</li>
                                ))}
                            </ul>
                        </details>
                    )}
                </div>
            )}
        </Group>
    )
}

// What's watched in KumoBox goes to Letterboxd as a CSV its importer takes
// (or straight away, with API access).
function ExportGroup({ pending, apiConnected }: { pending: number; apiConnected: boolean }) {
    const { markExported, push } = useLetterboxd()
    return (
        <Group
            title="Send to Letterboxd"
            description="Movies you watch in KumoBox are logged in its diary. Download them as a CSV, import it at letterboxd.com/import, then mark them as sent so the next export only has new ones."
        >
            <Row label="Waiting to be sent" help={pending ? `${plural(pending, "diary entry", "diary entries")} not on Letterboxd yet` : "Everything is on Letterboxd"}>
                <Badge tone={pending ? "amber" : "green"}>{pending}</Badge>
            </Row>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
                <a href="/api/letterboxd/export.csv?all=0" download>
                    <Button size="sm" variant="primary" icon={<Download className="size-4" />} disabled={!pending}>
                        Download new entries
                    </Button>
                </a>
                <a href="/api/letterboxd/export.csv?all=1" download>
                    <Button size="sm" variant="subtle" icon={<Download className="size-4" />}>
                        Download all
                    </Button>
                </a>
                <a href="https://letterboxd.com/import/" target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />}>
                        Open letterboxd.com/import
                    </Button>
                </a>
                <Button
                    size="sm"
                    variant="subtle"
                    className="ml-auto"
                    icon={<CheckCheck className="size-4" />}
                    disabled={!pending}
                    loading={markExported.isPending}
                    onClick={() => markExported.mutate(undefined, { onSuccess: r => toast.success(`Marked ${plural(r.marked, "entry", "entries")} as sent`) })}
                >
                    Mark as sent
                </Button>
            </div>
            {apiConnected && (
                <Row label="Send with the API" help="Logs the waiting entries on your account right away.">
                    <Button
                        size="sm"
                        icon={<Send className="size-4" />}
                        disabled={!pending}
                        loading={push.isPending}
                        onClick={() => push.mutate(undefined, { onSuccess: r => toast.success(`Sent to Letterboxd: ${resultSummary(r)}`) })}
                    >
                        Send now
                    </Button>
                </Row>
            )}
        </Group>
    )
}

// Letterboxd's API is granted on request: with an app's credentials KumoBox
// logs straight to the account.
function ApiGroup({ draft, set, configured, connected }: SectionProps & { configured: boolean; connected: boolean }) {
    const { apiLogin } = useLetterboxd()
    const { data: status } = useStatus()
    const [user, setUser] = useState("")
    const [password, setPassword] = useState("")
    const l = draft.letterboxd
    const saved = status?.settings.letterboxd
    const changed = (l?.apiClientId ?? "") !== (saved?.apiClientId ?? "") || (l?.apiClientSecret ?? "") !== (saved?.apiClientSecret ?? "")
    const login = () =>
        apiLogin.mutate(
            { username: user.trim(), password },
            {
                onSuccess: () => {
                    toast.success("Signed in to the Letterboxd API")
                    setPassword("")
                },
            },
        )
    return (
        <Group
            title="API access (optional)"
            description="Letterboxd gives API access on request (letterboxd.com/api-beta). With an app's client ID and secret, KumoBox logs what you watch to your account directly, without CSV files."
        >
            <Stack label="Client ID">
                <Input value={l?.apiClientId ?? ""} onChange={e => set("letterboxd", { apiClientId: e.target.value.trim() })} />
            </Stack>
            <Stack label="Client secret" help={changed ? "Save, then sign in below." : undefined}>
                <Password value={l?.apiClientSecret ?? ""} onChange={v => set("letterboxd", { apiClientSecret: v.trim() })} />
            </Stack>
            {configured && !changed && (
                <>
                    {connected ? (
                        <Row label="Signed in" help="Diary entries can be sent with the API.">
                            <Badge tone="green">Connected</Badge>
                        </Row>
                    ) : (
                        <Stack label="Sign in to the API" help="Your password goes to Letterboxd only; KumoBox keeps the tokens it gets back, not the password.">
                            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                                <Input placeholder="Username or email" value={user} onChange={e => setUser(e.target.value)} />
                                <Password value={password} onChange={setPassword} placeholder="Password" />
                                <Button icon={<LogIn className="size-4" />} loading={apiLogin.isPending} disabled={!user.trim() || !password} onClick={login}>
                                    Sign in
                                </Button>
                            </div>
                        </Stack>
                    )}
                </>
            )}
        </Group>
    )
}
