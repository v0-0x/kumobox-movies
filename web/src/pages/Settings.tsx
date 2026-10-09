import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
    AppWindow,
    ArrowDown,
    ArrowUp,
    ChevronDown,
    Clapperboard,
    Copy,
    Cpu,
    Download,
    FileClock,
    Gamepad2,
    HardDrive,
    Info,
    KeyRound,
    LibraryBig,
    Magnet,
    MonitorPlay,
    Network,
    Palette,
    Plus,
    RefreshCw,
    Save,
    Terminal,
    Trash2,
    Tv,
    X,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "@/lib/toast"
import { LetterboxdMark } from "@/components/LetterboxdDialog"
import { Badge, Button, Input, Select, Switch } from "@/components/ui"
import { versionName } from "@/components/UpdateBanner"
import { api, desktop, type DesktopPrefs } from "@/lib/api"
import { useCheckUpdate, useSaveSettings, useSharing, useStatus, useUpdateStatus } from "@/lib/queries"
import { exampleMpvPath, installHint, installSource, platformName } from "@/lib/platform"
import type { Tool } from "@/lib/platform"
import { canInstallPrograms, useInstallPrograms, useWatchSetup } from "@/lib/programs"
import { accentPreviewStore } from "@/lib/store"
import type { Settings, SharingPeer, Status } from "@/lib/types"
import { cn, copyText, formatBytes, HOME_SECTIONS, relativeTime } from "@/lib/utils"
import { LetterboxdSection } from "./settings/Letterboxd"
import { MetadataSection } from "./settings/Metadata"
import { Collapsible, Detect, Group, LinesInput, Password, PathInput, Row, type SectionProps, Stack } from "./settings/parts"
import { ProvidersSection, TorrentSourcesSection } from "./settings/Sources"

type SectionId =
    | "app"
    | "ui"
    | "library"
    | "metadata"
    | "letterboxd"
    | "playback"
    | "mpv"
    | "transcode"
    | "providers"
    | "torrent-sources"
    | "torrent-client"
    | "discord"
    | "logs"
    | "about"

const NAV: { items: { id: SectionId; label: string; icon: React.ReactNode }[] }[] = [
    {
        items: [
            { id: "app", label: "App", icon: <AppWindow /> },
            { id: "ui", label: "User Interface", icon: <Palette /> },
            { id: "library", label: "Local Library", icon: <LibraryBig /> },
        ],
    },
    {
        items: [
            { id: "metadata", label: "Metadata (TMDB)", icon: <KeyRound /> },
            { id: "letterboxd", label: "Letterboxd", icon: <LetterboxdMark className="w-[18px]" /> },
        ],
    },
    {
        items: [
            { id: "playback", label: "Video Playback", icon: <Clapperboard /> },
            { id: "mpv", label: "Desktop Media Player", icon: <MonitorPlay /> },
            { id: "transcode", label: "Transcoding / Direct Play", icon: <Cpu /> },
        ],
    },
    {
        items: [
            { id: "providers", label: "Providers", icon: <Tv /> },
            { id: "torrent-sources", label: "Torrent Sources", icon: <Magnet /> },
            { id: "torrent-client", label: "Torrent Client", icon: <Download /> },
        ],
    },
    {
        items: [
            { id: "discord", label: "Discord", icon: <Gamepad2 /> },
            { id: "logs", label: "Logs & Cache", icon: <FileClock /> },
            { id: "about", label: "About & updates", icon: <Info /> },
        ],
    },
]

// Older links and other names.
const ALIASES: Record<string, SectionId> = {
    anicli: "providers",
    streaming: "providers",
    "online-streaming": "providers",
    downloads: "providers",
    "torrent-provider": "torrent-sources",
    tmdb: "metadata",
}
const SECTION_IDS: string[] = NAV.flatMap(g => g.items.map(i => i.id))

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Puts the fields edited in draft (compared with base, the server copy the
// draft was made from) on top of a newer server copy.
function rebase(draft: Settings, base: Settings, server: Settings): Settings {
    const out: Record<string, any> = structuredClone(server)
    const old: Record<string, any> = base
    for (const [key, value] of Object.entries(draft) as [string, any][]) {
        if (same(value, old[key])) continue
        if (value && typeof value === "object" && !Array.isArray(value) && old[key] && typeof old[key] === "object") {
            for (const field of Object.keys(value)) if (!same(value[field], old[key][field])) out[key] = { ...out[key], [field]: value[field] }
        } else out[key] = value
    }
    return out as Settings
}

export default function SettingsPage() {
    const { data: status } = useStatus()
    const [params, setParams] = useSearchParams()
    const raw = params.get("tab") ?? "app"
    const tab = ALIASES[raw] ?? raw
    // Unknown tabs (old links, typos) open the first one instead of nothing.
    const section = (SECTION_IDS.includes(tab) ? tab : "app") as SectionId
    const save = useSaveSettings()
    const server = status?.settings
    // draft is what the form edits, base the server copy it was made from.
    const [draft, setDraft] = useState<Settings | null>(null)
    const [base, setBase] = useState<Settings | null>(null)
    const reset = (s: Settings) => {
        setDraft(structuredClone(s))
        setBase(s)
    }
    useEffect(() => {
        if (!server) return
        if (!draft || !base) {
            reset(server)
            return
        }
        if (same(server, base)) return
        // Saved somewhere else meanwhile (another tab or device, the auto
        // downloader switch…): follow it, keeping what was edited here so a
        // save doesn't put the old values back.
        const next = rebase(draft, base, server)
        if (!same(draft, base) && !same(next, draft)) toast.info("Settings were changed somewhere else. Your unsaved changes here were kept.")
        setDraft(next)
        setBase(server)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [server])
    const dirty = useMemo(() => !!draft && !!server && !same(draft, server), [draft, server])

    // Preview the accent color being edited; App shows the saved one again
    // once the preview ends (Discard, leaving the page).
    const accent = draft?.ui.accentColor
    useEffect(() => {
        accentPreviewStore.set(accent || null)
    }, [accent])
    useEffect(() => () => accentPreviewStore.set(null), [])

    if (!draft || !status) return null
    const set = <K extends keyof Settings>(k: K, v: Partial<Settings[K]>) => setDraft(d => (d ? { ...d, [k]: { ...d[k], ...v } } : d))
    const current = NAV.flatMap(g => g.items).find(i => i.id === section) ?? NAV[0].items[0]

    const onSave = () => {
        const oldPort = status.settings.server.port
        save.mutate(draft, {
            onSuccess: s => {
                reset(s)
                // The server moves to the new port; follow it.
                if (s.server.port !== oldPort && ["127.0.0.1", "localhost"].includes(location.hostname)) {
                    setTimeout(() => {
                        location.href = `${location.protocol}//${location.hostname}:${s.server.port}${location.pathname}${location.search}`
                    }, 1500)
                }
            },
        })
    }

    return (
        <div className="flex min-h-full flex-col gap-8 px-6 pt-8 pb-24 md:px-8 lg:flex-row lg:gap-12 xl:px-10">
            <aside className="w-full shrink-0 lg:sticky lg:top-8 lg:w-56 lg:self-start">
                <h1 className="mb-5 px-2.5 text-[1.75rem] font-semibold tracking-tight">Settings</h1>
                <div className="flex flex-col gap-4">
                    {NAV.map((g, i) => (
                        <div key={i} className="flex flex-col gap-0.5">
                            {g.items.map(it => (
                                <button
                                    key={it.id}
                                    onClick={() => setParams({ tab: it.id }, { replace: true })}
                                    className={cn(
                                        "focus-ring flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium transition-colors [&>svg]:size-4 [&>svg]:stroke-[1.75]",
                                        section === it.id ? "bg-white/[0.08] text-fg" : "text-muted hover:bg-white/[0.04] hover:text-fg",
                                    )}
                                >
                                    {it.icon}
                                    {it.label}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
                <p className="mt-6 px-2.5 text-xs text-subtle">
                    KumoBox {status.version} · {platformName(status.platform)} · {status.client === "desktop" ? "Desktop" : status.client === "lan" ? "LAN" : "Web UI"}
                </p>
            </aside>

            <section className="min-w-0 flex-1 lg:max-w-4xl">
                <div className="mb-7 border-b border-line pb-5 lg:mt-[3.25rem]">
                    <h2 className="text-xl font-semibold tracking-tight">{current.label}</h2>
                    <p className="mt-0.5 text-sm text-muted">{SUBTITLES[current.id]}</p>
                </div>
                <div key={section} className="flex flex-col gap-8 fade-in">
                    {section === "app" && <AppSection draft={draft} set={set} />}
                    {section === "ui" && <UISection draft={draft} set={set} />}
                    {section === "library" && <LibrarySection draft={draft} set={set} />}
                    {section === "metadata" && <MetadataSection draft={draft} set={set} />}
                    {section === "letterboxd" && <LetterboxdSection draft={draft} set={set} />}
                    {section === "playback" && <PlaybackSection draft={draft} set={set} />}
                    {section === "mpv" && <MpvSection draft={draft} set={set} />}
                    {section === "transcode" && <TranscodeSection draft={draft} set={set} />}
                    {section === "providers" && <ProvidersSection draft={draft} set={set} />}
                    {section === "torrent-sources" && <TorrentSourcesSection draft={draft} set={set} />}
                    {section === "torrent-client" && <TorrentClientSection draft={draft} set={set} />}
                    {section === "discord" && <DiscordSection draft={draft} set={set} />}
                    {section === "logs" && <LogsSection />}
                    {section === "about" && <AboutSection />}
                </div>
                {section !== "logs" && section !== "about" && (
                    <div className={cn("mt-8 flex items-center gap-3", dirty && "sticky bottom-6 z-20")}>
                        <Button variant="white" icon={<Save className="size-4" />} loading={save.isPending} onClick={onSave} disabled={!dirty}>
                            Save
                        </Button>
                        {dirty && (
                            <>
                                <span className="rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[13px] text-muted shadow-lg shadow-black/30">Unsaved changes</span>
                                <Button variant="ghost" size="sm" onClick={() => reset(status.settings)}>
                                    Discard
                                </Button>
                            </>
                        )}
                    </div>
                )}
            </section>
        </div>
    )
}

const SUBTITLES: Record<SectionId, string> = {
    app: "Accounts, server and network access",
    ui: "Make KumoBox look the way you like",
    library: "Your movie and TV folders",
    metadata: "Where titles, posters and episodes come from",
    letterboxd: "Sync your diary, ratings and watchlist",
    playback: "How movies and episodes are played and tracked",
    mpv: "Configure mpv, the desktop media player",
    transcode: "Play every video format in the in-app player",
    providers: "Streaming providers and downloads",
    "torrent-sources": "Where torrents are searched",
    "torrent-client": "Configure the torrent client",
    discord: "Show what you're watching on Discord",
    logs: "Server logs and cached data",
    about: "KumoBox's version and updates",
}


// Where other devices open KumoBox, once LAN access is saved.
function LanAddresses({ status }: { status?: Status }) {
    const urls = status?.lanUrls ?? []
    if (!status?.settings.server.allowLan) return <p className="px-4 py-3.5 text-sm text-muted">Save, and the address to open on your other devices shows up here.</p>
    if (!urls.length)
        return (
            <p className="px-4 py-3.5 text-sm text-amber-200/80">
                KumoBox can't find this computer's address on your network. Is it connected to your router (by cable or Wi-Fi)?
            </p>
        )
    return (
        <div className="px-4 py-3.5">
            <p className="text-sm font-medium">On your other devices, open</p>
            <div className="mt-2 flex flex-wrap gap-2">
                {urls.map(u => (
                    <button
                        key={u}
                        onClick={() => copyText(u).then(ok => (ok ? toast.success("Address copied") : toast.error("Couldn't copy it")))}
                        className="flex items-center gap-2 rounded-lg bg-black/30 px-3 py-1.5 font-mono text-sm transition hover:bg-black/45"
                        title="Copy"
                    >
                        {u}
                        <Copy className="size-3.5 text-subtle" />
                    </button>
                ))}
            </div>
            <p className="mt-2 text-xs text-subtle">
                Type it with http://, not https://. On a Mac, Chrome, Brave and Firefox first need Local Network access (System Settings › Privacy & Security ›
                Local Network); Safari works right away. A VPN on this computer can block other devices too: in Mullvad, turn on Local network sharing.
            </p>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Sections

function AppSection({ draft, set }: SectionProps) {
    const { data: status } = useStatus()
    const [, setSearchParams] = useSearchParams()
    const isDesktop = status?.client === "desktop"
    const lan = status?.client === "lan"
    return (
        <>
            <Group title="Accounts">
                <Row label="TMDB" help={status?.tmdbConfigured ? "Movies, shows and episodes come from TMDB." : "Add a free API key to search and browse movies and shows."}>
                    <Button size="sm" variant={status?.tmdbConfigured ? "ghost" : "primary"} onClick={() => setSearchParams({ tab: "metadata" })}>
                        {status?.tmdbConfigured ? "Settings" : "Set up"}
                    </Button>
                </Row>
                <Row label="Letterboxd" help={status?.letterboxd ? `Connected as ${status.letterboxd.name}` : "Not connected: your list stays on this computer."}>
                    <Button size="sm" variant={status?.letterboxd ? "ghost" : "primary"} onClick={() => setSearchParams({ tab: "letterboxd" })}>
                        {status?.letterboxd ? "Settings" : "Connect"}
                    </Button>
                </Row>
            </Group>

            <Group title="Web UI & network" description="KumoBox only ever talks to this computer and — if you allow it — your home network. Connections from the internet are always refused.">
                <Row
                    label="Web UI"
                    help={
                        status?.webUiForced
                            ? "Running without the desktop app, so the browser UI is always on."
                            : `Use KumoBox from any browser at http://127.0.0.1:${draft.server.port}`
                    }
                >
                    <Switch checked={draft.server.webUi || !!status?.webUiForced} disabled={!isDesktop || status?.webUiForced} onChange={v => set("server", { webUi: v })} />
                </Row>
                <Row label="Allow devices on my network" help="Phones, tablets, TVs and other computers on your home network can open KumoBox in a browser.">
                    <Switch checked={draft.server.allowLan} disabled={lan} onChange={v => set("server", { allowLan: v, webUi: v ? true : draft.server.webUi })} />
                </Row>
                {draft.server.allowLan && <LanAddresses status={status} />}
                {draft.server.allowLan && (
                    <Stack label="Network password" help="Asked once per device on your network. This computer never needs it.">
                        <Password value={draft.server.password} onChange={v => set("server", { password: v })} placeholder="Leave empty for no password" />
                    </Stack>
                )}
                <Row label="Port" help="Restart-free: KumoBox moves to the new port when you save.">
                    <Input type="number" className="w-28" disabled={lan} value={draft.server.port} onChange={e => set("server", { port: Number(e.target.value) })} />
                </Row>
                {!isDesktop && !lan && <p className="px-4 py-3 text-xs text-amber-200/80">Turning the Web UI off is only possible from the desktop app, so you can't lock yourself out.</p>}
            </Group>

            <Group title="Library sharing">
                <Row label="Share libraries with KumoBox on your other computers" help={draft.sharing.enabled ? "On: who gets this computer's library, and the libraries shared with it, are in Local Library." : "In Local Library: turn it on there, on each computer."}>
                    <Button size="sm" variant="ghost" onClick={() => setSearchParams({ tab: "library" })}>
                        Open
                    </Button>
                </Row>
            </Group>

            <DesktopGroup />

            <ProgramsGroup />

            <Group title="Extensions">
                <Stack label="Marketplace URL" help="Any compatible extension index works.">
                    <Input value={draft.extensions.marketplaceUrl} onChange={e => set("extensions", { marketplaceUrl: e.target.value })} />
                </Stack>
            </Group>

            <Group title="Data">
                <Row label="Data folder" help="Database, cache and extension storage" wide>
                    <code title={status?.dataDir} className="min-w-0 rounded-lg bg-black/30 px-2 py-1 text-xs break-all">
                        {status?.dataDir}
                    </code>
                </Row>
            </Group>
        </>
    )
}

// The desktop app's own settings, saved by the app itself (they take effect
// at once, no Save).
function DesktopGroup() {
    const bridge = desktop()
    const [prefs, setPrefs] = useState<DesktopPrefs | null>(null)
    useEffect(() => {
        bridge?.getPrefs?.().then(setPrefs, () => {})
    }, [bridge])
    if (!bridge?.setPref || !prefs) return null
    const mac = bridge.platform === "darwin"
    const change = async (name: keyof DesktopPrefs, value: boolean) => {
        setPrefs({ ...prefs, [name]: value })
        const res = await bridge.setPref!(name, value).catch(() => false as const)
        if (res !== true) {
            setPrefs(prefs)
            toast.error(typeof res === "object" && res.error ? res.error : "Couldn't change that setting")
        }
    }
    return (
        <Group title="Desktop app">
            <Row
                label="Keep running when the window is closed"
                help={
                    mac
                        ? "Off: closing the window quits KumoBox. On: streaming to your other devices, downloads and the auto downloader keep going, without the window's memory; click KumoBox in the Dock to open it again, quit with Cmd+Q or the button below."
                        : "Off: closing the window quits KumoBox. On: streaming to your other devices, downloads and the auto downloader keep going, without the window's memory; open or quit KumoBox from its tray icon, or open it again from the app menu and quit with the button below."
                }
            >
                <Switch checked={prefs.keepRunning} onChange={v => change("keepRunning", v)} />
            </Row>
            {prefs.startAtLogin !== undefined && (
                <Row
                    label="Start KumoBox when you log in"
                    help={
                        prefs.keepRunning
                            ? `In the background, ${mac ? "in the Dock" : "with its tray icon"}: ready for your other devices, downloads and the auto downloader without opening its window.`
                            : "It opens its window. Turn on keeping it running to start it in the background instead."
                    }
                >
                    <Switch checked={prefs.startAtLogin} onChange={v => change("startAtLogin", v)} />
                </Row>
            )}
            <Row
                label="Free memory while the computer is locked"
                help="After 5 minutes locked, the window lets go of the page and loads it again when you unlock. Never while a video or Settings is open."
            >
                <Switch checked={prefs.freeWhenLocked} onChange={v => change("freeWhenLocked", v)} />
            </Row>
            {bridge.quit && (
                <Row label="Quit KumoBox" help="Closes the window and stops the server: streaming to other devices, downloads and library sharing stop until KumoBox is opened again.">
                    <Button size="sm" variant="ghost" onClick={() => bridge.quit!()}>
                        Quit
                    </Button>
                </Row>
            )}
        </Group>
    )
}

function InstallProgramsButton() {
    const { data: status } = useStatus()
    const install = useInstallPrograms(status)
    return (
        <Button variant="primary" size="sm" loading={install.isPending} disabled={status?.setupRunning} onClick={() => install.mutate()}>
            {status?.setupRunning ? "Installing…" : "Install"}
        </Button>
    )
}

// What KumoBox found of the programs it uses and, on Windows and macOS, the
// setup that installs them.
function ProgramsGroup() {
    const { data: status } = useStatus()
    useWatchSetup(status)
    const f = status?.features
    const programs: { tool: Tool; ok?: boolean; use: string }[] = [
        { tool: "ffmpeg", ok: f?.ffmpeg, use: "The in-app player (most files) and downloads of streams" },
        { tool: "mpv", ok: f?.mpv, use: "The external player" },
        { tool: "yt-dlp", ok: f?.ytDlp, use: "Faster, more reliable downloads of streams" },
    ]
    return (
        <Group title="Programs" description="KumoBox uses these programs for some of what it does.">
            {programs.map(p => (
                <Row
                    key={p.tool}
                    label={p.tool}
                    help={
                        p.ok || canInstallPrograms(status) ? (
                            p.use
                        ) : (
                            <>
                                {p.use}. {installSource(status?.platform)} <code className="rounded bg-black/30 px-1.5 py-0.5">{installHint(status?.platform, p.tool)}</code>
                            </>
                        )
                    }
                >
                    <Badge tone={p.ok ? "green" : "red"}>{p.ok ? "Found" : "Not found"}</Badge>
                </Row>
            ))}
            {canInstallPrograms(status) && (
                <Row
                    label="Install missing programs"
                    help={
                        status?.platform === "darwin"
                            ? "Downloads ffmpeg and yt-dlp for this Mac (Apple silicon or Intel) into KumoBox's folder, in a Terminal window: no Homebrew or password needed. mpv, the external player, comes from Homebrew on Apple silicon Macs that have it. Programs you already have are skipped."
                            : "Installs ffmpeg, mpv, yt-dlp and the rest of what KumoBox uses with Scoop, for your Windows user (no administrator rights), in a PowerShell window. Programs you already have are skipped. It also offers to sign you in to GitHub, for KumoBox's updates."
                    }
                >
                    <InstallProgramsButton />
                </Row>
            )}
        </Group>
    )
}

const ACCENTS = ["#7c6cf2", "#5b8cff", "#22c3a6", "#f2557a", "#f59e0b", "#e879f9", "#38bdf8", "#a3e635"]

function UISection({ draft, set }: SectionProps) {
    return (
        <>
            <Group title="Theme">
                <Stack label="Accent color">
                    <div className="flex flex-wrap items-center gap-2.5">
                        {ACCENTS.map(c => (
                            <button
                                key={c}
                                onClick={() => set("ui", { accentColor: c })}
                                className={cn("size-9 rounded-full ring-2 ring-offset-2 ring-offset-[var(--surface-1)] transition", draft.ui.accentColor === c ? "ring-white" : "ring-transparent hover:ring-white/30")}
                                style={{ background: c }}
                                aria-label={c}
                            />
                        ))}
                        <input
                            type="color"
                            value={draft.ui.accentColor}
                            onChange={e => set("ui", { accentColor: e.target.value })}
                            className="size-9 cursor-pointer rounded-full border border-line bg-transparent"
                        />
                    </div>
                </Stack>
                <Row label="Card size">
                    <Select
                        className="w-36"
                        value={draft.ui.cardSize}
                        onChange={v => set("ui", { cardSize: v })}
                        options={[
                            { value: "sm", label: "Compact" },
                            { value: "md", label: "Comfortable" },
                            { value: "lg", label: "Large" },
                        ]}
                    />
                </Row>
                <Row label="Reduce motion" help="Turn off animations">
                    <Switch checked={draft.ui.reducedMotion} onChange={v => set("ui", { reducedMotion: v })} />
                </Row>
            </Group>
            <HomeSectionsGroup draft={draft} set={set} />
            <Group title="Content">
                <Row label="Hide spoilers" help="Blur the stills and overviews of episodes you haven't watched yet">
                    <Switch checked={draft.ui.blurUnwatched} onChange={v => set("ui", { blurUnwatched: v })} />
                </Row>
                <Row label="Show adult content" help="Include 18+ entries in search and discover">
                    <Switch checked={draft.ui.showAdult} onChange={v => set("ui", { showAdult: v })} />
                </Row>
            </Group>
        </>
    )
}

// Which sections Home shows, in which order.
function HomeSectionsGroup({ draft, set }: SectionProps) {
    const on = draft.ui.homeSections ?? []
    const known = new Set(HOME_SECTIONS.map(s => s.id))
    // Shown ones in their order, then the hidden ones.
    const order = [...on.filter(id => known.has(id)), ...HOME_SECTIONS.map(s => s.id).filter(id => !on.includes(id))]
    const save = (ids: string[]) => set("ui", { homeSections: [...ids, ...on.filter(id => !known.has(id))] })
    const toggle = (id: string, v: boolean) => save(v ? order.filter(x => x === id || on.includes(x)) : on.filter(x => known.has(x) && x !== id))
    const move = (id: string, dir: -1 | 1) => {
        const shown = on.filter(x => known.has(x))
        const i = shown.indexOf(id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= shown.length) return
        const next = [...shown]
        ;[next[i], next[j]] = [next[j], next[i]]
        save(next)
    }
    return (
        <Group title="Home page" description="The rows of your list on Home. Your library and Discover's trending rows come after them.">
            {order.map(id => {
                const s = HOME_SECTIONS.find(x => x.id === id)!
                const shown = on.includes(id)
                const at = on.filter(x => known.has(x)).indexOf(id)
                return (
                    <div key={id} className="flex items-center justify-between gap-4 px-4 py-3">
                        <div className={cn("min-w-0", !shown && "opacity-60")}>
                            <p className="text-sm font-medium">{s.label}</p>
                            <p className="mt-0.5 text-xs text-subtle">{s.help}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            {shown && (
                                <>
                                    <button disabled={at === 0} onClick={() => move(id, -1)} className="grid size-8 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg disabled:opacity-30" aria-label="Move up">
                                        <ArrowUp className="size-4" />
                                    </button>
                                    <button disabled={at === on.filter(x => known.has(x)).length - 1} onClick={() => move(id, 1)} className="grid size-8 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg disabled:opacity-30" aria-label="Move down">
                                        <ArrowDown className="size-4" />
                                    </button>
                                </>
                            )}
                            <span className="ml-2">
                                <Switch checked={shown} onChange={v => toggle(id, v)} />
                            </span>
                        </div>
                    </div>
                )
            })}
        </Group>
    )
}

// Library sharing with the KumoBox apps on the other computers at home. Turning
// it on or off and the name are saved with the rest; who gets this
// computer's library changes at once.
function SharingGroup({ draft, set }: SectionProps) {
    const { data: status } = useStatus()
    const saved = status?.settings.sharing
    const trusted = status?.client !== "lan"
    const { data: sharing } = useSharing(!!saved?.enabled)
    const qc = useQueryClient()
    const [address, setAddress] = useState("")
    const [adding, setAdding] = useState(false)
    const call = async (fn: () => Promise<unknown>) => {
        try {
            await fn()
            qc.invalidateQueries({ queryKey: ["sharing"] })
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    const add = async () => {
        if (!address.trim()) return
        setAdding(true)
        await call(async () => {
            const p = await api.post<SharingPeer>("/api/sharing/connect", { address })
            toast.success(`Found ${p.name}`)
            setAddress("")
        })
        setAdding(false)
    }
    const peers = sharing?.peers ?? []
    return (
        <Group
            title="Library sharing"
            description="Watch the libraries of KumoBox on your other computers at home, and share yours with them. Each computer decides who gets its library. Watching updates the list (and Letterboxd diary) of the computer you watch on, never the other's. Connected to the same Letterboxd account, Continue watching carries over to the second: to the computer whose files you watch as you watch, and back."
        >
            <Row label="Library sharing" help="Find the KumoBox apps on this network, and let them find this one. Turn it on on both computers.">
                <Switch checked={draft.sharing.enabled} disabled={!trusted} onChange={v => set("sharing", { enabled: v })} />
            </Row>
            {draft.sharing.enabled && (
                <Stack label="Name on the network" help="What the other KumoBox apps call this one.">
                    <Input value={draft.sharing.name} disabled={!trusted} placeholder={sharing?.name || "This computer's name"} onChange={e => set("sharing", { name: e.target.value })} />
                </Stack>
            )}
            {draft.sharing.enabled !== !!saved?.enabled && <p className="px-4 py-3 text-xs text-amber-200/80">Save to turn library sharing {draft.sharing.enabled ? "on" : "off"}.</p>}
            {saved?.enabled && sharing && (
                <>
                    <div className="px-4 pt-3.5 pb-1">
                        <p className="text-sm font-medium">KumoBox apps on this network</p>
                        <p className="mt-0.5 text-xs text-subtle">
                            Turn on <b>Share my library</b> for those that may watch this computer's movies and shows.
                            {sharing.addresses.length > 0 && <> This computer is at {sharing.addresses.join(", ")}.</>}
                        </p>
                    </div>
                    {peers.length === 0 && (
                        <p className="px-4 py-3 text-sm text-muted">
                            {sharing.listening ? "Looking for KumoBox apps… Turn on library sharing on the other computer too." : "This computer can't listen for the others (another program uses the network port): add them by address below."}
                        </p>
                    )}
                    {peers.map(p => (
                        <div key={p.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                            <div className="min-w-0">
                                <p className="flex items-center gap-2 text-sm font-medium">
                                    <span className={cn("size-2 shrink-0 rounded-full", p.online ? "bg-emerald-400" : "bg-white/20")} />
                                    <span className="truncate">{p.name}</span>
                                </p>
                                <p className="mt-0.5 text-xs text-subtle">
                                    {[
                                        p.address,
                                        !p.online && p.lastSeen > 0 && `seen ${relativeTime(p.lastSeen)}`,
                                        p.shares && `shares its library with you${p.files ? ` (${p.files} ${p.files === 1 ? "file" : "files"})` : ""}`,
                                        p.error,
                                    ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                                <span className="text-xs text-muted">Share my library</span>
                                <Switch checked={p.allowed} disabled={!trusted} onChange={v => call(() => api.post(`/api/sharing/peers/${p.id}`, { allowed: v }))} />
                                {!p.online && trusted && (
                                    <button
                                        onClick={() => call(() => api.del(`/api/sharing/peers/${p.id}`))}
                                        className="grid size-8 place-items-center rounded-lg text-muted hover:bg-white/[0.06] hover:text-rose-300"
                                        aria-label={`Remove ${p.name}`}
                                        title="Remove"
                                    >
                                        <X className="size-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                    {trusted && (
                        <Stack label="Add by address" help="When the computers don't find each other by themselves (some routers block it): the other computer's address, shown in its settings here.">
                            <div className="flex gap-2">
                                <Input value={address} onChange={e => setAddress(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="192.168.1.20:43311" />
                                <Button onClick={add} loading={adding} disabled={!address.trim()}>
                                    Add
                                </Button>
                            </div>
                        </Stack>
                    )}
                </>
            )}
        </Group>
    )
}

function LibrarySection({ draft, set }: SectionProps) {
    const extra = draft.library.extraDirs ?? []
    return (
        <>
            <Group title="Local library">
                <Stack label="Library directory" help="Where your movies and shows are, e.g. Movie (2010)/Movie (2010).mkv or Show/Season 01/Show S01E02.mkv.">
                    <PathInput value={draft.library.dir} onChange={v => set("library", { dir: v })} placeholder="/mnt/media/Movies" />
                </Stack>
                <Stack label="Additional library directories" help="Include additional directory paths if your library is spread across multiple locations.">
                    <div className="flex flex-col gap-2">
                        {extra.map((d, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <div className="flex-1">
                                    <PathInput value={d} onChange={v => set("library", { extraDirs: extra.map((x, j) => (j === i ? v : x)) })} />
                                </div>
                                <button onClick={() => set("library", { extraDirs: extra.filter((_, j) => j !== i) })} className="grid size-10 place-items-center rounded-xl text-muted hover:bg-white/[0.06] hover:text-rose-300">
                                    <X className="size-4" />
                                </button>
                            </div>
                        ))}
                        <button onClick={() => set("library", { extraDirs: [...extra, ""] })} className="grid size-9 place-items-center rounded-full bg-white/[0.07] text-fg hover:bg-white/[0.12]" aria-label="Add directory">
                            <Plus className="size-4" />
                        </button>
                    </div>
                </Stack>
            </Group>
            <Group title="Scanning">
                <Row label="Automatically refresh library" help="Watch the folders and pick up new or removed files on their own">
                    <Switch checked={draft.library.autoRefresh} onChange={v => set("library", { autoRefresh: v })} />
                </Row>
                <Row label="Refresh library on startup">
                    <Switch checked={draft.library.refreshOnStartup} onChange={v => set("library", { refreshOnStartup: v })} />
                </Row>
            </Group>
            <SharingGroup draft={draft} set={set} />
            <Collapsible title="Advanced">
                <Stack label={`Matching threshold — ${Math.round(draft.library.matchThreshold * 100)}%`} help="How similar a file name must be to a TMDB title to match automatically.">
                    <input type="range" min={0.3} max={0.95} step={0.05} value={draft.library.matchThreshold} onChange={e => set("library", { matchThreshold: Number(e.target.value) })} className="accent-[var(--brand)]" />
                </Stack>
                <Row label="Match movies and shows that aren't on my list" help="Search all of TMDB when a title isn't on your list">
                    <Switch checked={draft.library.matchOutsideList} onChange={v => set("library", { matchOutsideList: v })} />
                </Row>
                <Stack label="Ignore patterns" help="One glob per line, matched against file and folder names (e.g. *sample*, *trailer*).">
                    <LinesInput value={draft.library.ignorePatterns ?? []} onChange={v => set("library", { ignorePatterns: v })} />
                </Stack>
            </Collapsible>
        </>
    )
}

const LANGS = [
    { value: "eng,en", label: "English" },
    { value: "spa,es", label: "Spanish" },
    { value: "por,pt", label: "Portuguese" },
    { value: "fre,fra,fr", label: "French" },
    { value: "ger,deu,de", label: "German" },
    { value: "ita,it", label: "Italian" },
    { value: "ara,ar", label: "Arabic" },
    { value: "rus,ru", label: "Russian" },
    { value: "jpn,ja", label: "Japanese" },
    { value: "kor,ko", label: "Korean" },
    { value: "chi,zho,zh", label: "Chinese" },
    { value: "hin,hi", label: "Hindi" },
    { value: "dut,nld,nl", label: "Dutch" },
    { value: "swe,sv", label: "Swedish" },
    { value: "pol,pl", label: "Polish" },
    { value: "tur,tr", label: "Turkish" },
    { value: "", label: "File default" },
]

function PlaybackSection({ draft, set }: SectionProps) {
    const p = draft.playback
    return (
        <>
            <Group title="Player">
                <Row label="Default player for local files" help="mpv opens in its own window; the in-app player works everywhere (and on other devices).">
                    <Select
                        className="w-48"
                        value={p.defaultPlayer}
                        onChange={v => set("playback", { defaultPlayer: v as "mpv" })}
                        options={[
                            { value: "builtin", label: "In-app player" },
                            { value: "mpv", label: "mpv" },
                        ]}
                    />
                </Row>
                <Row label="Resume where I left off" help="Movies and episodes continue from the saved position in mpv and the in-app player">
                    <Switch checked={p.resumePlayback} onChange={v => set("playback", { resumePlayback: v })} />
                </Row>
                <Row label="Auto play next episode">
                    <Switch checked={p.autoPlayNext} onChange={v => set("playback", { autoPlayNext: v })} />
                </Row>
                <Row label="Skip intros and recaps (chapters)" help="Jumps past chapters named intro, opening, title sequence or previously on, when the file has them">
                    <Switch checked={p.skipIntro} onChange={v => set("playback", { skipIntro: v })} />
                </Row>
                <Row
                    label="Skip end credits (chapters)"
                    help="Jumps past chapters named credits, ending or next episode preview. Credits at the very end are only skipped when the next episode plays then; scenes after the credits play."
                >
                    <Switch checked={p.skipCredits} onChange={v => set("playback", { skipCredits: v })} />
                </Row>
            </Group>
            <Group title="Progress">
                <Row label="Update progress automatically" help="Mark the movie or episode as watched when you finish it (a watched movie is logged in your diary)">
                    <Switch checked={p.autoUpdateProgress} onChange={v => set("playback", { autoUpdateProgress: v })} />
                </Row>
                <Stack label={`Count as watched at ${Math.round(p.completionThreshold * 100)}%`}>
                    <input type="range" min={0.5} max={1} step={0.01} value={p.completionThreshold} onChange={e => set("playback", { completionThreshold: Number(e.target.value) })} className="accent-[var(--brand)]" />
                </Stack>
            </Group>
            <Group
                title="Audio & subtitles"
                description="Movies and shows play in their original language, with forced subtitles (signs, foreign dialogue) when there are some. KumoBox remembers the audio and subtitle track you pick for each show and uses it for the next episodes."
            >
                <Row label="Remember my track choice per movie or show">
                    <Switch checked={p.rememberTracks} onChange={v => set("playback", { rememberTracks: v })} />
                </Row>
                <Row label="Preferred audio language" help="Play a dub in this language when the file has one">
                    <Select
                        className="w-44"
                        value={p.preferredAudioLang}
                        onChange={v => set("playback", { preferredAudioLang: v })}
                        options={LANGS.map(l => (l.value ? l : { ...l, label: "Original language" }))}
                    />
                </Row>
                <Row label="Preferred subtitle language" help="Your language for subtitles (English when not set)">
                    <Select
                        className="w-44"
                        value={p.preferredSubLang}
                        onChange={v => set("playback", { preferredSubLang: v })}
                        options={LANGS.map(l => (l.value ? l : { ...l, label: "Not set" }))}
                    />
                </Row>
                <Row
                    label="Subtitles only for foreign languages"
                    help="Turn subtitles on when the audio isn't in your subtitle or audio language. Off: subtitles whenever there are some in your preferred subtitle language."
                >
                    <Switch checked={p.subtitlesForForeign} onChange={v => set("playback", { subtitlesForForeign: v })} />
                </Row>
            </Group>
        </>
    )
}

function MpvSection({ draft, set }: SectionProps) {
    const { data: status } = useStatus()
    return (
        <Group title="mpv">
            <Row label="Status">
                <Detect ok={status?.features.mpv} label="mpv" />
            </Row>
            <Stack
                label="Executable"
                help={`Name or full path, e.g. mpv or ${exampleMpvPath(status?.platform)} (install with: ${installHint(status?.platform, "mpv")})`}
            >
                <Input value={draft.mpv.path} onChange={e => set("mpv", { path: e.target.value })} icon={<Terminal className="size-4" />} />
            </Stack>
            <Stack label="Extra arguments" help="Passed to every mpv launch, e.g. --profile=gpu-hq --hwdec=auto">
                <Input value={draft.mpv.extraArgs} onChange={e => set("mpv", { extraArgs: e.target.value })} />
            </Stack>
            <Row label="Start in fullscreen">
                <Switch checked={draft.mpv.fullscreen} onChange={v => set("mpv", { fullscreen: v })} />
            </Row>
        </Group>
    )
}

function TranscodeSection({ draft, set }: SectionProps) {
    const { data: status } = useStatus()
    const t = draft.transcode
    return (
        <>
            <Group title="In-app player" description="Browsers can't decode every format (HEVC, AC3/DTS audio, MKV with multiple tracks…). KumoBox repackages or converts those with ffmpeg on the fly so every file plays.">
                <Row label="Status">
                    <div className="flex gap-2">
                        <Detect ok={status?.features.ffmpeg} label="ffmpeg" />
                        <Detect ok={status?.features.ffprobe} label="ffprobe" />
                    </div>
                </Row>
                <Row label="Mode">
                    <Select
                        className="w-56"
                        value={t.mode}
                        onChange={v => set("transcode", { mode: v })}
                        options={[
                            { value: "auto", label: "Automatic (recommended)" },
                            { value: "direct", label: "Always direct play" },
                            { value: "transcode", label: "Always transcode" },
                        ]}
                    />
                </Row>
                <Row label="Hardware acceleration">
                    <Select
                        className="w-56"
                        value={t.hwAccel}
                        onChange={v => set("transcode", { hwAccel: v })}
                        options={[
                            { value: "", label: "None (CPU, libx264)" },
                            { value: "vaapi", label: "VA-API (AMD / Intel)" },
                            { value: "nvenc", label: "NVENC (NVIDIA)" },
                            { value: "qsv", label: "Quick Sync (Intel)" },
                        ]}
                    />
                </Row>
                {t.hwAccel === "vaapi" && (
                    <Stack label="VA-API device">
                        <Input value={t.vaapiNode} onChange={e => set("transcode", { vaapiNode: e.target.value })} />
                    </Stack>
                )}
                <Row label="x264 preset" help="Faster presets use less CPU">
                    <Select className="w-40" value={t.preset} onChange={v => set("transcode", { preset: v })} options={["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"].map(p => ({ value: p, label: p }))} />
                </Row>
            </Group>
            <Group title="Paths">
                <Stack label="ffmpeg">
                    <Input value={t.ffmpegPath} onChange={e => set("transcode", { ffmpegPath: e.target.value })} />
                </Stack>
                <Stack label="ffprobe">
                    <Input value={t.ffprobePath} onChange={e => set("transcode", { ffprobePath: e.target.value })} />
                </Stack>
            </Group>
        </>
    )
}

function ClientFields({ value, onChange, showTags }: { value: Settings["qbittorrent"]; onChange: (v: Partial<Settings["qbittorrent"]>) => void; showTags?: boolean }) {
    return (
        <div className="flex flex-col gap-4 p-4">
            <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Host</span>
                <Input value={value.host} onChange={e => onChange({ host: e.target.value })} />
            </label>
            <div className="grid gap-4 md:grid-cols-3">
                <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Username</span>
                    <Input value={value.username} onChange={e => onChange({ username: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Password</span>
                    <Password value={value.password} onChange={v => onChange({ password: v })} />
                </label>
                <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Port</span>
                    <Input type="number" value={value.port} onChange={e => onChange({ port: Number(e.target.value) })} />
                </label>
            </div>
            <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Executable</span>
                <Input value={value.executable} onChange={e => onChange({ executable: e.target.value })} placeholder="/usr/bin/qbittorrent" />
            </label>
            <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Tags</span>
                <Input value={value.tags} onChange={e => onChange({ tags: e.target.value })} />
                <span className="text-xs text-subtle">Comma separated tags to apply to downloaded torrents. e.g. kumobox,movies</span>
            </label>
            {showTags && (
                <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Category</span>
                    <Input value={value.category} onChange={e => onChange({ category: e.target.value })} />
                    <span className="text-xs text-subtle">Category to apply to downloaded torrents.</span>
                </label>
            )}
            <label className="flex items-center gap-3 text-sm">
                <Switch checked={value.useHttps} onChange={v => onChange({ useHttps: v })} /> Use HTTPS
            </label>
        </div>
    )
}

function TorrentClientSection({ draft, set }: SectionProps) {
    const [open, setOpen] = useState<string>(draft.torrent.defaultClient === "transmission" ? "transmission" : "qbittorrent")
    const [testing, setTesting] = useState(false)
    const save = useSaveSettings()
    const test = async () => {
        setTesting(true)
        try {
            await save.mutateAsync(draft)
            const s = await api.get<{ connected: boolean; version: string; error?: string }>("/api/torrent-client/status")
            s.connected ? toast.success(`Connected — version ${s.version}`) : toast.error(s.error ?? "Not reachable")
        } finally {
            setTesting(false)
        }
    }
    return (
        <>
            <div className="card p-4">
                <p className="mb-2 text-sm font-medium">Default Torrent Client</p>
                <Select
                    value={draft.torrent.defaultClient}
                    onChange={v => set("torrent", { defaultClient: v })}
                    options={[
                        { value: "qbittorrent", label: "qBittorrent" },
                        { value: "transmission", label: "Transmission" },
                        { value: "none", label: "None" },
                    ]}
                />
            </div>
            <div className="card divide-y divide-line">
                {(["qbittorrent", "transmission"] as const).map(c => (
                    <div key={c}>
                        <button onClick={() => setOpen(o => (o === c ? "" : c))} className="flex w-full items-center justify-between px-4 py-4">
                            <span className="flex items-center gap-2.5 text-lg font-semibold">
                                <HardDrive className="size-5 text-brand-strong" />
                                {c === "qbittorrent" ? "qBittorrent" : "Transmission"}
                            </span>
                            <ChevronDown className={cn("size-5 text-muted transition-transform", open === c && "rotate-180")} />
                        </button>
                        {open === c && <ClientFields value={draft[c]} onChange={v => set(c, v)} showTags={c === "qbittorrent"} />}
                    </div>
                ))}
            </div>
            <div>
                <Button icon={<Network className="size-4" />} loading={testing} onClick={test} disabled={draft.torrent.defaultClient === "none"}>
                    Save & test connection
                </Button>
            </div>
            <Group title="Integration">
                <Row label="Show active torrent count" help="Show the number of active torrents in the sidebar.">
                    <Switch checked={draft.torrent.showActiveCount} onChange={v => set("torrent", { showActiveCount: v })} />
                </Row>
                <Row label="Create a folder per movie or show" help="Save each into its own folder inside the library, e.g. Movie (2010)/">
                    <Switch checked={draft.torrent.createSubfolder} onChange={v => set("torrent", { createSubfolder: v })} />
                </Row>
                <Row label="Auto downloader" help="Look for new episodes of your shows periodically">
                    <Switch checked={draft.torrent.autoDownloader} onChange={v => set("torrent", { autoDownloader: v })} />
                </Row>
                <Row label="Check every (minutes)">
                    <Input type="number" min={5} className="w-24" value={draft.torrent.autoDownloadMinutes} onChange={e => set("torrent", { autoDownloadMinutes: Number(e.target.value) })} />
                </Row>
            </Group>
        </>
    )
}

function DiscordSection({ draft, set }: SectionProps) {
    return (
        <Group
            title="Rich presence"
            description="Talks to the Discord app on this computer. Shows “Watching <title>” with the episode or the year, the poster (Discord loads it from TMDB) and the time left."
        >
            <Row label="Show what I'm watching">
                <Switch checked={draft.discord.richPresence} onChange={v => set("discord", { richPresence: v })} />
            </Row>
            <Stack
                label="Discord application ID"
                help="Create an application at discord.com/developers (its name shows as “Watching <name>” in the activity's header) and paste its Application ID. Upload an image named kumobox under Rich Presence › Art Assets for the badge and for titles without a poster."
            >
                <Input value={draft.discord.clientId} onChange={e => set("discord", { clientId: e.target.value })} />
            </Stack>
        </Group>
    )
}

function LogsSection() {
    const { data: logs, refetch } = useQuery({ queryKey: ["logs"], queryFn: () => api.get<string[]>("/api/logs"), refetchInterval: 4000 })
    const { data: cache, refetch: refetchCache } = useQuery({ queryKey: ["cache-size"], queryFn: () => api.get<{ entries: number }>("/api/cache/size") })
    const { data: imgs, refetch: refetchImgs } = useQuery({ queryKey: ["image-cache"], queryFn: () => api.get<{ files: number; bytes: number }>("/api/images/stats") })
    const clear = async () => {
        try {
            await api.post("/api/cache/clear")
            toast.success("Cache cleared")
            refetchCache()
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    const clearImages = async () => {
        try {
            await api.post("/api/images/clear")
            toast.success("Artwork cache cleared — covers will be downloaded again")
            refetchImgs()
        } catch (e: any) {
            toast.error(e.message)
        }
    }
    return (
        <>
            <Group title="Cache" description="Cached TMDB data, season details, search results and probes.">
                <Row label={`${cache?.entries ?? 0} cached entries`}>
                    <Button variant="danger" size="sm" icon={<Trash2 className="size-4" />} onClick={clear}>
                        Clear cache
                    </Button>
                </Row>
                <Row label={`Artwork: ${imgs?.files ?? 0} images (${formatBytes(imgs?.bytes ?? 0)})`} help="Posters, backdrops and episode stills downloaded for offline use">
                    <Button variant="danger" size="sm" icon={<Trash2 className="size-4" />} onClick={clearImages}>
                        Clear artwork
                    </Button>
                </Row>
            </Group>
            <div>
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold">Server logs</h3>
                    <Button size="sm" variant="ghost" onClick={() => refetch()}>
                        Refresh
                    </Button>
                </div>
                <pre className="card max-h-[60vh] overflow-auto p-4 text-xs leading-relaxed text-fg/80">{(logs ?? []).slice(-400).join("\n") || "No logs yet."}</pre>
            </div>
        </>
    )
}

// The version, and KumoBox's own updates: the Home page offers and installs
// them, this says where things stand.
function AboutSection() {
    const { data: status } = useStatus()
    const { data: u } = useUpdateStatus()
    const check = useCheckUpdate()
    const lan = status?.client === "lan"
    const commit = u?.current.commit
    const latest = versionName(u?.latest)
    const busy = ["downloading", "building", "installing"].includes(u?.state ?? "")
    let state: { tone: "green" | "brand" | "amber" | "gray"; label: string; help?: string }
    if (!u || u.checking) state = { tone: "gray", label: "Checking…" }
    else if (busy) state = { tone: "brand", label: `Updating to ${latest}`, help: u.message }
    else if (u.state === "ready") state = { tone: "green", label: `${latest} installed`, help: u.message }
    else if (u.available) state = { tone: "brand", label: `${latest} available`, help: lan ? undefined : u.canApply ? "Update from the Home page." : u.applyNote }
    else if (u.latest) state = { tone: "green", label: "Up to date", help: u.note }
    else if (u.error) state = { tone: "amber", label: "Couldn't check" }
    else state = { tone: "gray", label: "Not checked yet", help: "KumoBox checks shortly after it starts, then every 6 hours." }
    if (u?.state === "failed" && !busy) state.help = [u.message, state.help].filter(Boolean).join(" ")
    return (
        <>
            <Group title="KumoBox">
                <Row label="Version" help={`${platformName(status?.platform)} · ${status?.client === "desktop" ? "Desktop" : status?.client === "lan" ? "LAN" : "Web UI"}`}>
                    <span className="flex items-center gap-2 text-sm">
                        {status?.version}
                        {commit && (
                            <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs" title={commit}>
                                {commit.slice(0, 7)}
                            </code>
                        )}
                    </span>
                </Row>
            </Group>
            <Group title="Updates" description="KumoBox looks for a newer version on GitHub and shows it on the Home page, where you can install it.">
                <Row label="Status" help={state.help}>
                    <Badge tone={state.tone}>{state.label}</Badge>
                </Row>
                {u?.latest && (
                    <Row label="Newest version">
                        <a href={u.latest.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm hover:underline">
                            {latest}
                            {u.latest.commit && u.latest.version && <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">{u.latest.commit.slice(0, 7)}</code>}
                        </a>
                    </Row>
                )}
                <Row label="Last check" help={u?.checking ? "Checking now…" : u?.checkedAt ? `${relativeTime(u.checkedAt)}. KumoBox checks every 6 hours.` : "Never"}>
                    {!lan && (
                        <Button size="sm" icon={<RefreshCw className="size-4" />} loading={check.isPending || u?.checking} onClick={() => check.mutate()}>
                            Check for updates
                        </Button>
                    )}
                </Row>
                {u?.error && (
                    <div className="px-4 py-3.5 text-sm">
                        <p className="text-rose-300">{u.error}</p>
                        {u.hint && <p className="mt-1 text-muted">{u.hint}</p>}
                    </div>
                )}
            </Group>
        </>
    )
}
