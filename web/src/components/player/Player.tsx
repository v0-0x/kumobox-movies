import Hls from "hls.js"
import {
    ArrowLeft,
    Captions,
    Copy,
    FastForward,
    Gauge,
    Languages,
    Loader2,
    Maximize,
    Minimize,
    MonitorPlay,
    Pause,
    Play,
    RotateCcw,
    RotateCw,
    SkipForward,
    Volume1,
    Volume2,
    VolumeX,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "@/lib/toast"
import { api, qs } from "@/lib/api"
import { episodeIndex, formatKey, mediaIsShow, nextEpisode } from "@/lib/ids"
import { prefersHls, randomId, videoCaps } from "@/lib/playback"
import { useSettings, useStatus } from "@/lib/queries"
import { skipAt, skipName, skipOn, skipRun, isSkippable } from "@/lib/skips"
import { playerStore, type PlayerRequest } from "@/lib/store"
import type { EntryView, EpisodeView, PlayResult, Probe, Settings, SkipInterval, StreamSource, StreamSubtitle, TrackPrefs } from "@/lib/types"
import { cn, copyText, formatDuration } from "@/lib/utils"
import { parseVTT, type Cue } from "@/lib/vtt"
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "../ui"

type SubOption = { key: string; label: string; lang: string; title: string; index: number; url: string; bitmap?: boolean }
// What the server picked to open a file with (player.ChooseTracks): the
// audio track's index (-1: the file's default) and the subtitles' key.
type TrackChoice = { audio: number; sub: string; note?: string }

const langNames: Record<string, string> = {
    jpn: "Japanese", ja: "Japanese", eng: "English", en: "English", spa: "Spanish", es: "Spanish", fre: "French", fra: "French", fr: "French",
    ger: "German", deu: "German", de: "German", ita: "Italian", it: "Italian", por: "Portuguese", pt: "Portuguese", rus: "Russian", ru: "Russian",
    chi: "Chinese", zho: "Chinese", zh: "Chinese", kor: "Korean", ko: "Korean", ara: "Arabic", ar: "Arabic", und: "Unknown",
}
const langName = (l?: string) => (l ? langNames[l.toLowerCase()] ?? l.toUpperCase() : "")
// Language codes and names, as the server compares them (player/lang.go):
// "fre", "fra", "fr-FR" and "French" are all French. Streams name their
// subtitles anyhow ("English", "en", "Português (Brasil)").
const LANGS: Record<string, string> = {}
for (const [code, ...aliases] of [
    ["en", "eng", "english"],
    ["fr", "fre", "fra", "french", "français", "francais"],
    ["de", "ger", "deu", "german", "deutsch"],
    ["es", "spa", "spanish", "español", "espanol", "castellano", "latino"],
    ["it", "ita", "italian", "italiano"],
    ["pt", "por", "portuguese", "português", "portugues"],
    ["ja", "jpn", "jp", "japanese"],
    ["ko", "kor", "korean"],
    ["zh", "chi", "zho", "cmn", "yue", "cn", "chinese", "mandarin", "cantonese"],
    ["ru", "rus", "russian"],
    ["ar", "ara", "arabic"],
    ["hi", "hin", "hindi"],
    ["nl", "dut", "nld", "dutch"],
    ["sv", "swe", "swedish"],
    ["no", "nor", "nob", "nb", "norwegian"],
    ["da", "dan", "danish"],
    ["fi", "fin", "finnish"],
    ["pl", "pol", "polish"],
    ["tr", "tur", "turkish"],
] as string[][])
    for (const a of [code, ...aliases]) LANGS[a] = code
const langOf = (l?: string) => {
    const x = (l ?? "").trim().toLowerCase()
    if (!x || x === "und" || x === "mul") return ""
    if (LANGS[x]) return LANGS[x]
    for (const part of x.split(/[^\p{L}]+/u)) if (LANGS[part]) return LANGS[part]
    return x
}
const langIn = (lang: string, list: string) => !!langOf(lang) && list.split(",").some(l => langOf(l) === langOf(lang))

export function PlayerOverlay() {
    const [req, setReq] = useState<PlayerRequest | null>(playerStore.get())
    useEffect(
        () =>
            playerStore.subscribe(() => {
                // The episode that's playing asked for again: it goes on
                // playing (a new request object would reload the stream).
                const next = playerStore.get()
                setReq(prev => (prev && next && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
            }),
        [],
    )
    if (!req) return null
    return <Player key={JSON.stringify(req)} req={req} onClose={() => playerStore.set(null)} />
}

function Player({ req, onClose }: { req: PlayerRequest; onClose: () => void }) {
    const settings = useSettings()
    // A device on the network: mpv would open on the computer KumoBox runs
    // on (the server refuses it, or plays the file here instead).
    const status = useStatus().data
    const remote = status?.client === "lan"
    const videoRef = useRef<HTMLVideoElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const hlsRef = useRef<Hls | null>(null)
    const trackRef = useRef<TextTrack | null>(null)

    const [title, setTitle] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(true)
    const [buffering, setBuffering] = useState(false)

    // local
    const [probe, setProbe] = useState<Probe | null>(null)
    const [method, setMethod] = useState<"direct" | "remux" | "transcode">("direct")
    const [offset, setOffset] = useState(0) // where the converted stream was asked to start
    const [audioIndex, setAudioIndex] = useState(0)
    // The converted stream: base is where it really starts (copied video can
    // only start at a keyframe), so subtitles and times stay in sync.
    const [stream, setStream] = useState<{ url: string; base: number; hls: boolean; id?: string } | null>(null)
    const [restart, setRestart] = useState(0)
    // stream
    const [sources, setSources] = useState<StreamSource[]>([])
    const [sourceIdx, setSourceIdx] = useState(0)
    // The source whose way of playing is decided (as is, or converted).
    const [decided, setDecided] = useState(-1)
    // Why the last source couldn't be read, to say when none plays.
    const sourceError = useRef("")
    // The providers were asked again for fresh links (once).
    const refreshed = useRef(false)

    const [subs, setSubs] = useState<SubOption[]>([])
    const [subKey, setSubKey] = useState<string>("off")
    // The subtitles of this stream were picked by hand.
    const subPicked = useRef(false)
    const [cues, setCues] = useState<Cue[]>([])
    const [skips, setSkips] = useState<SkipInterval[]>([])

    const [paused, setPaused] = useState(true)
    const [time, setTime] = useState(0) // absolute time
    const [duration, setDuration] = useState(0)
    const [buffered, setBuffered] = useState(0)
    const [volume, setVolume] = useState(() => Number(localStorage.getItem("kumobox-volume") ?? 1))
    const [muted, setMuted] = useState(false)
    const [rate, setRate] = useState(1)
    const [fullscreen, setFullscreen] = useState(false)
    const [controls, setControls] = useState(true)
    const [hoverTime, setHoverTime] = useState<{ x: number; t: number } | null>(null)
    // The next episode: its file, or for a stream the episode to ask the
    // provider for (as this one was asked for).
    const [nextEp, setNextEp] = useState<{ path?: string; episode: number } | null>(null)

    const startAt = useRef(0)
    const lastReport = useRef(0)
    const ended = useRef(false)
    const skipped = useRef<Set<string>>(new Set())
    const prefsRef = useRef<TrackPrefs | null>(null)
    const originalRef = useRef("") // the title's original language

    const mediaId = req.mediaId
    // The episode's key. A stream's request may number it as its provider
    // does: the server says which key that is.
    const [episode, setEpisode] = useState(req.episode)
    const source = req.kind === "local" ? "local" : "stream"
    // Safari and iPhone/iPad get converted files as HLS (see lib/playback).
    const hlsMode = useMemo(() => prefersHls(), [])
    const caps = useMemo(() => videoCaps(hlsMode && Hls.isSupported() ? "mse" : "element"), [hlsMode])
    const clientId = useMemo(() => randomId(), [])
    // What ffmpeg converts when the browser can't play it as it is: the file,
    // or the stream's link as the server named it.
    const convertPath = req.kind === "local" ? req.path : sources[sourceIdx]?.remote
    const base = method !== "direct" && stream ? stream.base : offset
    const absTime = (v: HTMLVideoElement) => v.currentTime + base

    // ------------------------------------------------------------------ load
    useEffect(() => {
        let cancelled = false
        // The movie or show: its original language, title and episodes.
        const entryP = api.get<EntryView>(`/api/media/${mediaId}`).catch(() => null)
        ;(async () => {
            try {
                setLoading(true)
                let key = req.episode
                if (req.kind === "local") {
                    const res = await api.post<{ probe: Probe; title: string; resumeAt: number; tracks: TrackPrefs | null; skips?: SkipInterval[]; choice?: TrackChoice }>(
                        "/api/playback/local",
                        {
                            path: req.path,
                            mediaId: req.mediaId,
                            episode: req.episode,
                            player: "builtin",
                            start: req.start,
                            caps,
                        },
                    )
                    if (cancelled) return
                    prefsRef.current = res.tracks
                    setTitle(res.title)
                    setProbe(res.probe)
                    setDuration(res.probe.duration)
                    setSkips(res.skips ?? [])
                    // The tracks to start with, as the server chose them: the
                    // ones picked for the title before, else as the settings say.
                    const audioCount = res.probe.audio?.length ?? 0
                    let ai = res.choice && res.choice.audio >= 0 ? res.choice.audio : (res.probe.audio?.findIndex(a => a.default) ?? 0)
                    if (ai < 0 || ai >= audioCount) ai = 0
                    setAudioIndex(ai)
                    if (res.choice?.note) toast.info(res.choice.note)
                    const m = ai === 0 && res.probe.method === "direct" ? "direct" : res.probe.method === "direct" ? "remux" : res.probe.method
                    setMethod(m)
                    // Ignore saved positions past the end of this file.
                    startAt.current = res.resumeAt && res.resumeAt < res.probe.duration - 10 ? res.resumeAt : 0
                    if (m !== "direct") setOffset(startAt.current)

                    const subOpts: SubOption[] = [
                        ...(res.probe.subtitles ?? []).map(s => ({
                            key: `e${s.typeIndex}`,
                            label: [langName(s.language), s.title].filter(Boolean).join(" · ") || `Track ${s.typeIndex + 1}`,
                            lang: s.language,
                            title: s.title,
                            index: s.typeIndex,
                            bitmap: s.bitmap,
                            url: `/api/local/subtitle${qs({ path: req.path, index: s.typeIndex })}`,
                        })),
                        ...(res.probe.externalSubs ?? []).map((s, i) => ({
                            key: `x${i}`,
                            label: `${s.language || "External"} · ${s.name}`,
                            lang: s.language,
                            title: s.name,
                            index: 1000 + i,
                            url: `/api/local/subtitle${qs({ path: req.path, external: s.path })}`,
                        })),
                    ]
                    setSubs(subOpts)
                    const sub = res.choice?.sub ?? ""
                    setSubKey(subOpts.some(o => o.key === sub && !o.bitmap) ? sub : "off")
                } else {
                    // The stream picked (or the provider's best link), then
                    // the other direct links to fall back on, in that order.
                    const res = await api.post<PlayResult>("/api/providers/play", {
                        mediaId: req.mediaId,
                        episode: req.episode,
                        streamId: req.streamId,
                        stream: req.stream,
                        provider: req.provider,
                        player: "builtin",
                        start: req.start,
                    })
                    if (cancelled) return
                    if (res.action !== "builtin") throw new Error("This source can't be played in the app")
                    prefsRef.current = res.tracks
                    key = res.key || req.episode
                    setEpisode(key)
                    const e = await entryP
                    originalRef.current = e?.media.originalLanguage ?? ""
                    setTitle(res.title || playerTitle(e, key, ""))
                    setSources(res.sources)
                    setSourceIdx(0)
                    setDecided(-1)
                    startAt.current = res.resumeAt || 0
                    applyStreamSubs(res.sources[0])
                }
                // The next episode (across seasons): its file, or for a stream
                // the one after, asked for as this one was (by key, or as the
                // provider numbers them). Like the server's auto play next
                // (app.nextKey): none after a special or an extra, and past
                // the episodes the file just played holds too (S01E01E02).
                entryP
                    .then(e => {
                        if (cancelled || !e || !mediaIsShow(e.media) || key < 1000) return
                        const episodes = e.episodes ?? []
                        let next = nextEpisode(e.media, key)
                        let n = episodes.find(x => keyOf(x) === next)
                        if (req.kind === "local" && n?.file?.path === req.path && (n.file.episodeEnd ?? 0) >= next) {
                            next = nextEpisode(e.media, n.file.episodeEnd!)
                            n = episodes.find(x => keyOf(x) === next)
                        }
                        if (!next || !n) return
                        if (req.kind === "local") n.file && setNextEp({ path: n.file.path, episode: next })
                        else if (n.aired) setNextEp({ episode: req.episode === key ? next : episodeIndex(e.media, next) })
                    })
                    .catch(() => {})
            } catch (e: any) {
                if (!cancelled) setError(e.message || String(e))
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // A stream's subtitles: its own, then the subtitle addons', those found
    // for the very file playing (matched) first. They're told apart by
    // their links, so the one picked stays picked when more come.
    const setStreamSubs = (src: StreamSource | undefined, matched: StreamSubtitle[]) => {
        const all = src?.subtitles ?? []
        const seen = new Set<string>()
        const named: Record<string, number> = {}
        const opts: SubOption[] = []
        for (const s of [...all.filter(x => !x.addon), ...matched, ...all.filter(x => x.addon)]) {
            const key = `s:${s.original || s.url}`
            if (seen.has(key)) continue
            seen.add(key)
            // By language ("English", "English 2"...), unless it has a
            // label of its own.
            let label = (s.label && s.label !== s.language ? s.label : langName(s.language)) || `Subtitle ${opts.length + 1}`
            named[label] = (named[label] ?? 0) + 1
            if (named[label] > 1) label += ` ${named[label]}`
            opts.push({ key, label, lang: s.language, title: s.language, index: opts.length, url: s.url })
        }
        setSubs(opts)
        // Providers' streams are in the original version (a dub is another
        // stream). Subtitles picked by hand stay.
        if (!subPicked.current) setSubKey(streamSub(opts, settings?.playback.rememberTracks ? prefsRef.current : null, settings?.playback, originalRef.current, false))
    }
    const applyStreamSubs = (src?: StreamSource) => {
        subPicked.current = false
        setStreamSubs(src, [])
    }

    // Subtitles made for the very file playing: once the way a stream plays
    // is decided, the subtitle addons are asked again with its size and
    // hash (which the server reads from the stream) and its name.
    useEffect(() => {
        if (req.kind !== "stream" || decided !== sourceIdx) return
        const src = sources[sourceIdx]
        if (!src?.remote) return
        let cancelled = false
        api.get<StreamSubtitle[]>(`/api/providers/subtitles${qs({ mediaId, episode, remote: src.remote, filename: src.filename })}`)
            .then(matched => {
                if (!cancelled && matched?.length) setStreamSubs(src, matched)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sources, sourceIdx, decided])

    // ---------------------------------------------------------- stream source
    // How to play a stream: as it is when the browser decodes what's in it,
    // else converted like a file (most providers link to Matroska, HEVC,
    // AC-3/DTS audio...). HLS too: hls.js plays it as it is, unless its
    // video or audio is one the browser can't decode (HEVC, AC-3, E-AC-3,
    // DTS...). A link that can't be read is tried as it is all the same.
    useEffect(() => {
        if (req.kind !== "stream" || !sources.length || decided === sourceIdx) return
        const src = sources[sourceIdx]
        const asIs = () => {
            setProbe(null)
            setMethod("direct")
            setOffset(0)
            setDecided(sourceIdx)
            setLoading(false)
        }
        if (!src?.remote) {
            asIs()
            return
        }
        let cancelled = false
        setLoading(true)
        api.get<Probe>(`/api/local/probe${qs({ path: src.remote, caps: caps.join(",") })}`)
            .then(p => {
                if (cancelled) return
                setProbe(p)
                if (p.duration > 0) setDuration(p.duration)
                const ai = Math.max(0, p.audio?.findIndex(a => a.default) ?? 0)
                setAudioIndex(ai)
                // hls.js picks an HLS stream's default audio by itself.
                const m = p.method === "direct" && (ai === 0 || p.container === "hls") ? "direct" : p.method === "direct" ? "remux" : p.method
                setMethod(m)
                setOffset(m === "direct" ? 0 : startAt.current)
                setDecided(sourceIdx)
                api.get<SkipInterval[]>(`/api/playback/skips${qs({ path: src.remote })}`)
                    .then(s => !cancelled && setSkips(s ?? []))
                    .catch(() => {})
            })
            .catch((e: any) => {
                if (cancelled) return
                sourceError.current = e?.message || ""
                asIs()
            })
            .finally(() => !cancelled && setLoading(false))
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sources, sourceIdx, decided])

    // The next source, when this one can't be played at all.
    const nextSource = () => {
        if (sourceIdx + 1 < sources.length) {
            toast.warning(`Source failed, trying ${sources[sourceIdx + 1].quality || "the next one"}…`)
            setStream(null)
            applyStreamSubs(sources[sourceIdx + 1])
            setSourceIdx(i => i + 1)
        } else if (!refreshed.current) {
            // Links expire, often within minutes: ask the providers again.
            refreshed.current = true
            toast.info("Asking the providers for fresh links…")
            setStream(null)
            setDecided(-1)
            setLoading(true)
            api.post<PlayResult>("/api/providers/play", { mediaId, episode, provider: "", player: "builtin", refresh: true })
                .then(res => {
                    if (res.action !== "builtin" || !res.sources?.length) throw new Error("no direct link found")
                    sourceError.current = ""
                    setSources(res.sources)
                    setSourceIdx(0)
                    applyStreamSubs(res.sources[0])
                })
                .catch((e: any) => {
                    setLoading(false)
                    setError(`None of the sources could be played.${sourceError.current ? ` ${sourceError.current}` : ` ${e?.message ?? ""}`}`)
                })
        } else setError(sources.length > 1 ? `None of the ${sources.length} sources could be played.${sourceError.current ? ` ${sourceError.current}` : ""}` : `This video could not be played.${sourceError.current ? ` ${sourceError.current}` : ""}`)
    }

    // ------------------------------------------------------------ video src
    // A converted file or stream: ask the server where the stream will start
    // (or start an HLS session), then load it.
    useEffect(() => {
        if (!convertPath || !probe || method === "direct" || (req.kind === "stream" && decided !== sourceIdx)) {
            setStream(null)
            return
        }
        let cancelled = false
        ;(async () => {
            try {
                if (hlsMode) {
                    const s = await api.post<{ id: string; url: string; start: number }>("/api/local/hls", {
                        path: convertPath,
                        start: offset,
                        audio: audioIndex,
                        method,
                        caps,
                        client: clientId,
                    })
                    if (!cancelled) setStream({ url: s.url, base: s.start, hls: true, id: s.id })
                } else {
                    const c = caps.join(",")
                    const sp = await api
                        .get<{ start: number }>(`/api/local/seekpoint${qs({ path: convertPath, t: offset.toFixed(3), audio: audioIndex, method, caps: c })}`)
                        .catch(() => ({ start: offset }))
                    if (!cancelled)
                        setStream({ url: `/api/local/transcode${qs({ path: convertPath, start: sp.start.toFixed(3), audio: audioIndex, method, caps: c })}`, base: sp.start, hls: false })
                }
            } catch (e: any) {
                if (!cancelled) setError(e.message || String(e))
            }
        })()
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [req, convertPath, decided, probe, method, offset, audioIndex, restart])

    // End the HLS session when the player closes.
    const sessionRef = useRef<string | undefined>(undefined)
    useEffect(() => {
        sessionRef.current = stream?.id
    }, [stream])
    useEffect(
        () => () => {
            if (sessionRef.current) api.del(`/api/local/hls/${sessionRef.current}`).catch(() => {})
        },
        [],
    )

    const videoSrc = useMemo(() => {
        if (req.kind === "local") {
            if (!probe) return ""
            if (method === "direct") return `/api/local/file${qs({ path: req.path })}`
            return stream?.url ?? ""
        }
        if (decided !== sourceIdx) return ""
        if (method !== "direct") return stream?.url ?? ""
        return sources[sourceIdx]?.url ?? ""
    }, [req, probe, method, stream, sources, sourceIdx, decided])

    useEffect(() => {
        const v = videoRef.current
        if (!v || !videoSrc) return
        hlsRef.current?.destroy()
        hlsRef.current = null
        const src = sources[sourceIdx]
        // A converted file or stream, as HLS (Safari) or progressive.
        const convHls = method !== "direct" && !!stream?.hls
        // HLS can start right where asked; the progressive stream starts at
        // its keyframe (stream.base).
        const resume = convHls ? Math.max(0, offset - stream!.base) : method !== "direct" ? 0 : startAt.current
        const isHls = convHls || (req.kind === "stream" && method === "direct" && (src?.type === "m3u8" || /m3u8/i.test(src?.originalUrl ?? "")))
        if (isHls && Hls.isSupported()) {
            // A local session's playlist grows while it's converted: give a
            // start, or players begin at its end like a live stream.
            // Memory: hls.js keeps everything already watched (the whole
            // episode by the end); keep the last 90s for going back, and up
            // to 30 MB (at least 60s) ahead.
            const hls = new Hls({
                startPosition: convHls ? resume : resume > 0 ? resume : -1,
                maxBufferLength: 60,
                maxBufferSize: 30 * 1000 * 1000,
                backBufferLength: 90,
            })
            hls.loadSource(videoSrc)
            hls.attachMedia(v)
            hls.on(Hls.Events.ERROR, (_, data) => {
                if (!data.fatal) return
                if (convHls) {
                    // The session ended (e.g. paused for a long time): start
                    // a new one here. Anything else: convert everything.
                    const at = v.currentTime + (stream?.base ?? 0)
                    startAt.current = 0
                    setOffset(at)
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) setRestart(n => n + 1)
                    else if (method === "remux") setMethod("transcode")
                    else if (req.kind === "stream") nextSource()
                    else setError("This video could not be played (" + data.details + ")")
                    return
                }
                if (method === "direct" && convertPath && probe && data.type !== Hls.ErrorTypes.NETWORK_ERROR) {
                    // The browser couldn't play the stream as it is (a
                    // codec it doesn't decode): convert it.
                    toast.info("Switching to compatibility mode…")
                    const at = v.currentTime > 0 ? v.currentTime : startAt.current
                    startAt.current = 0
                    setOffset(at)
                    setMethod("remux")
                    return
                }
                if (sourceIdx + 1 < sources.length) nextSource()
                else setError("The stream could not be played (" + data.details + ")")
            })
            hlsRef.current = hls
        } else {
            v.src = videoSrc
            if (resume > 0) {
                const onMeta = () => {
                    v.currentTime = resume
                    v.removeEventListener("loadedmetadata", onMeta)
                }
                v.addEventListener("loadedmetadata", onMeta)
            }
        }
        v.volume = volume
        v.playbackRate = rate
        v.play().catch(() => {})
        return () => {
            hlsRef.current?.destroy()
            hlsRef.current = null
        }
        // A seek within one keyframe interval sets up the same stream again:
        // it still has to reload.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoSrc, stream])

    // ------------------------------------------------------------- subtitles
    // Loaded again only when another file is picked (not when more
    // subtitles come for a stream).
    const selectedSub = subs.find(s => s.key === subKey)
    useEffect(() => {
        const sub = selectedSub
        if (!sub) {
            setCues([])
            return
        }
        if (sub.bitmap) {
            toast.warning("Image-based subtitles (PGS/VobSub) can only be shown in mpv")
            setCues([])
            return
        }
        let cancelled = false
        fetch(sub.url)
            .then(r => {
                if (!r.ok) throw new Error("subtitle unavailable")
                return r.text()
            })
            .then(t => !cancelled && setCues(parseVTT(t)))
            .catch(() => {
                if (!cancelled) {
                    setCues([])
                    toast.error("Could not load these subtitles")
                }
            })
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSub?.url, selectedSub?.bitmap])

    useEffect(() => {
        const v = videoRef.current
        if (!v) return
        if (!trackRef.current) {
            trackRef.current = v.addTextTrack("subtitles", "KumoBox", "und")
        }
        const tr = trackRef.current
        tr.mode = "showing"
        while (tr.cues && tr.cues.length) tr.removeCue(tr.cues[0])
        for (const c of cues) {
            const s = c.start - base
            const e = c.end - base
            if (e <= 0) continue
            try {
                const cue = new VTTCue(Math.max(0, s), e, c.text.replace(/<[^>]+>/g, m => (/^<\/?(i|b|u)>$/i.test(m) ? m : "")))
                cue.line = -2
                tr.addCue(cue)
            } catch {
                /* ignore bad cue */
            }
        }
    }, [cues, base])

    // -------------------------------------------------------------- progress
    const report = useCallback(
        (force = false, didEnd = false) => {
            const v = videoRef.current
            if (!v || mediaId <= 0) return
            const now = Date.now()
            if (!force && now - lastReport.current < 5000) return
            lastReport.current = now
            const position = absTime(v)
            const dur = duration || v.duration || 0
            if (position < 3 && !didEnd) return
            api.post("/api/playback/progress", { mediaId, episode, position, duration: dur, source, ended: didEnd, title, paused: v.paused }).catch(() => {})
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [mediaId, episode, source, duration, base, title],
    )

    const saveTrackPrefs = (next: { audio?: number; sub?: string }) => {
        if (!settings?.playback.rememberTracks || mediaId <= 0) return
        const a = next.audio ?? audioIndex
        const sk = next.sub ?? subKey
        const audio = probe?.audio?.[a]
        const sub = subs.find(s => s.key === sk)
        const body: TrackPrefs = {
            mediaId,
            audioLang: audio?.language ?? prefsRef.current?.audioLang ?? "",
            audioTitle: audio?.title ?? prefsRef.current?.audioTitle ?? "",
            audioIndex: audio ? a + 1 : prefsRef.current?.audioIndex ?? 0,
            subLang: sub?.lang ?? "",
            subTitle: sub?.title ?? "",
            subIndex: sub ? (sub.index >= 1000 ? 0 : sub.index + 1) : 0,
            subOff: sk === "off",
        }
        prefsRef.current = body
        api.put(`/api/playback/tracks/${mediaId}`, body).catch(() => {})
    }

    // --------------------------------------------------------------- actions
    const seekTo = (t: number) => {
        const v = videoRef.current
        if (!v) return
        const total = duration || v.duration || 0
        t = Math.max(0, Math.min(total > 0 ? total - 0.5 : t, t))
        if (method !== "direct" && stream) {
            // HLS can seek within what's converted so far.
            if (stream?.hls && v.seekable.length) {
                const rel = t - stream.base
                if (rel >= 0 && rel < v.seekable.end(v.seekable.length - 1) - 1) {
                    v.currentTime = rel
                    return
                }
            }
            // Otherwise the stream starts over from there.
            v.pause()
            startAt.current = 0
            setOffset(t)
            setRestart(n => n + 1)
            setTime(t)
        } else {
            v.currentTime = t
        }
    }
    const seekBy = (d: number) => {
        const v = videoRef.current
        if (v) seekTo(absTime(v) + d)
    }
    const togglePlay = () => {
        const v = videoRef.current
        if (!v) return
        if (v.paused) v.play().catch(() => {})
        else v.pause()
    }
    const toggleFullscreen = () => {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
        else containerRef.current?.requestFullscreen().catch(() => {})
    }
    const changeAudio = (i: number) => {
        const v = videoRef.current
        const at = v ? absTime(v) : 0
        setAudioIndex(i)
        if (method === "direct") setMethod("remux")
        startAt.current = 0
        setOffset(at)
        saveTrackPrefs({ audio: i })
    }
    const changeSub = (key: string) => {
        subPicked.current = true
        setSubKey(key)
        saveTrackPrefs({ sub: key })
    }
    const changeSource = (i: number) => {
        const v = videoRef.current
        startAt.current = v ? absTime(v) : 0
        setStream(null)
        setSourceIdx(i)
        applyStreamSubs(sources[i])
    }
    const close = () => {
        report(true)
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
        onClose()
    }
    const playNext = () => {
        if (!nextEp) return
        report(true)
        if (req.kind === "local" && nextEp.path) playerStore.set({ kind: "local", path: nextEp.path, mediaId, episode: nextEp.episode })
        // The next episode: the best link of the provider playing this one.
        else if (req.kind === "stream") playerStore.set({ kind: "stream", mediaId, episode: nextEp.episode, provider: sources[sourceIdx]?.provider ?? req.provider })
    }
    const openInMpv = async () => {
        const v = videoRef.current
        const at = v ? absTime(v) : 0
        try {
            if (req.kind === "local") await api.post("/api/playback/local", { path: req.path, mediaId, episode, player: "mpv", start: at })
            else {
                const src = sources[sourceIdx]
                await api.post("/api/playback/stream", {
                    mediaId,
                    episode,
                    url: src.originalUrl,
                    headers: src.headers,
                    referrer: src.referrer,
                    subtitles: src.subtitles.map(s => s.original),
                    title,
                    source,
                    start: at,
                    // mpv plays the next episode from the same provider.
                    provider: src.provider ?? req.provider,
                })
            }
            v?.pause()
            onClose()
        } catch (e: any) {
            toast.error(e.message)
        }
    }

    // ------------------------------------------------------ playback failed
    // What the provider's host answers for the source that failed (through
    // the proxy), for the details to copy.
    const [failStatus, setFailStatus] = useState<number | null>(null)
    useEffect(() => {
        setFailStatus(null)
        const src = sources[sourceIdx]
        if (!error || req.kind !== "stream" || !src?.url) return
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 10_000)
        fetch(src.url, { headers: { Range: "bytes=0-0" }, signal: ctrl.signal, credentials: "same-origin" })
            .then(r => {
                setFailStatus(r.status)
                ctrl.abort() // the status is all that's wanted
            })
            .catch(() => {})
            .finally(() => clearTimeout(timer))
        return () => {
            clearTimeout(timer)
            ctrl.abort()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [error])
    const canTryNext = req.kind === "stream" && sourceIdx + 1 < sources.length
    const tryNextSource = () => {
        const v = videoRef.current
        if (v && v.currentTime > 0) startAt.current = absTime(v)
        sourceError.current = ""
        setError("")
        setStream(null)
        applyStreamSubs(sources[sourceIdx + 1])
        setSourceIdx(i => i + 1)
    }
    const copyDetails = async () => {
        const src = req.kind === "stream" ? sources[sourceIdx] : undefined
        let host = ""
        try {
            host = src ? new URL(src.originalUrl).host : ""
        } catch {
            /* not a URL */
        }
        const code = failStatus ?? (Number(/\banswered (\d{3})\b/.exec(error)?.[1]) || null)
        const lines = [`KumoBox ${status?.version ?? ""}: playback failed`.replace(" :", ":"), `Error: ${redactLinks(error)}`, `Title: ${title}`]
        if (src) {
            lines.push(
                `Provider: ${src.server}${src.provider ? ` (${src.provider})` : ""}`,
                `Source: ${redactLinks([src.label, src.quality, src.type].filter(Boolean).join(" · "))} (${sourceIdx + 1} of ${sources.length})`,
                `Host: ${host || "unknown"}`,
                `HTTP status: ${code ?? "unknown"}`,
            )
        } else if (req.kind === "local") lines.push(`File: ${req.path.split(/[\\/]/).pop()}`)
        const tracks = [probe?.container, probe?.video?.[0]?.codec, probe?.audio?.[audioIndex]?.codec].filter(Boolean).join(", ")
        lines.push(`Playback: ${method}${tracks ? ` (${tracks})` : ""}`)
        if (await copyText(lines.join("\n"))) toast.success("Details copied")
        else toast.error("Couldn't copy the details: the browser blocked the clipboard")
    }

    // The parts of the file its chapters name as an intro, a recap, the
    // credits or a preview (from the server, with the file; streams have
    // none). Each is skipped once a viewing, as the settings say: going back
    // to one plays it.
    const skippable = skips.filter(isSkippable)
    const currentSkip = skipAt(skippable, time)
    const skipWhat = currentSkip && skipName(currentSkip.type)
    const autoSkip = !!currentSkip && skipOn(settings?.playback, currentSkip.type)
    useEffect(() => {
        if (!currentSkip || !autoSkip) return
        const id = `${currentSkip.type}@${currentSkip.start}`
        if (skipped.current.has(id)) return
        skipped.current.add(id)
        // Past the parts right after it skipped too (credits, then the
        // preview). Parts going on to the end are only skipped when the
        // next episode plays then.
        const run = skipRun(skippable, currentSkip, t => skipOn(settings?.playback, t))
        const total = duration || videoRef.current?.duration || 0
        if (total > 0 && run.end >= total - 1 && !(settings?.playback.autoPlayNext && nextEp)) return
        seekTo(run.end)
        toast.info(`Skipped ${run.names}`)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentSkip?.start, autoSkip])

    // -------------------------------------------------------------- keyboard
    // Keys go to the player, not to what had the focus on the page behind it:
    // the episode card that opened it plays it again on Space or Enter.
    useEffect(() => {
        containerRef.current?.focus({ preventScroll: true })
    }, [])
    useEffect(() => {
        // Typing, or in one of the player's menus: the keys are theirs.
        const theirs = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable], [role=menu], [role=listbox]")
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey || e.altKey || theirs(e.target)) return
            const v = videoRef.current
            let handled = true
            switch (e.key) {
                case " ":
                case "k":
                    if (!e.repeat) togglePlay()
                    break
                case "ArrowLeft":
                    seekBy(-5)
                    break
                case "ArrowRight":
                    seekBy(5)
                    break
                case "j":
                    seekBy(-10)
                    break
                case "l":
                    seekBy(10)
                    break
                case "ArrowUp":
                    setVolume(x => Math.min(1, x + 0.05))
                    break
                case "ArrowDown":
                    setVolume(x => Math.max(0, x - 0.05))
                    break
                case "f":
                    toggleFullscreen()
                    break
                case "m":
                    setMuted(m => !m)
                    break
                case "s":
                    if (currentSkip) seekTo(currentSkip.end)
                    break
                case "n":
                    playNext()
                    break
                case "Escape":
                    if (document.fullscreenElement) handled = false
                    else close()
                    break
                default:
                    if (/^[0-9]$/.test(e.key) && v) seekTo(((duration || v.duration) * Number(e.key)) / 10)
                    else handled = false
            }
            if (handled) {
                // The player hears keys first (capture phase): not the page
                // behind it too, nor a focused button (Space would click it).
                e.preventDefault()
                e.stopPropagation()
            }
            poke()
        }
        // Firefox clicks a focused button when Space comes back up anyway.
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey && !theirs(e.target)) e.preventDefault()
        }
        window.addEventListener("keydown", onKey, true)
        window.addEventListener("keyup", onKeyUp, true)
        return () => {
            window.removeEventListener("keydown", onKey, true)
            window.removeEventListener("keyup", onKeyUp, true)
        }
    })

    useEffect(() => {
        const v = videoRef.current
        if (!v) return
        v.volume = volume
        v.muted = muted
        try {
            localStorage.setItem("kumobox-volume", String(volume))
        } catch {
            /* ignore */
        }
    }, [volume, muted])
    useEffect(() => {
        if (videoRef.current) videoRef.current.playbackRate = rate
    }, [rate])
    useEffect(() => {
        const onFs = () => setFullscreen(!!document.fullscreenElement)
        document.addEventListener("fullscreenchange", onFs)
        return () => document.removeEventListener("fullscreenchange", onFs)
    }, [])

    // auto-hide controls
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const poke = () => {
        setControls(true)
        if (hideTimer.current) clearTimeout(hideTimer.current)
        hideTimer.current = setTimeout(() => {
            if (!videoRef.current?.paused) setControls(false)
        }, 2600)
    }
    useEffect(() => () => void (hideTimer.current && clearTimeout(hideTimer.current)), [])
    useEffect(() => () => report(true), [report])

    const total = duration || 0
    const pct = total > 0 ? (time / total) * 100 : 0
    const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

    return (
        <div
            ref={containerRef}
            tabIndex={-1}
            className={cn("fixed inset-0 z-[80] bg-black outline-none fade-in", !controls && !paused && "cursor-none")}
            onMouseMove={poke}
            onClick={e => e.target === e.currentTarget && togglePlay()}
        >
            <video
                ref={videoRef}
                className="absolute inset-0 size-full"
                playsInline
                crossOrigin="anonymous"
                onClick={togglePlay}
                onDoubleClick={toggleFullscreen}
                onPlay={() => {
                    setPaused(false)
                    poke()
                }}
                onPause={() => {
                    setPaused(true)
                    setControls(true)
                    report(true)
                }}
                onWaiting={() => setBuffering(true)}
                onPlaying={() => setBuffering(false)}
                onCanPlay={() => setBuffering(false)}
                onTimeUpdate={e => {
                    const v = e.currentTarget
                    setTime(absTime(v))
                    if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1) + base)
                    report()
                }}
                onLoadedMetadata={e => {
                    const v = e.currentTarget
                    if (method === "direct") setDuration(v.duration || duration)
                }}
                onEnded={() => {
                    if (ended.current) return
                    ended.current = true
                    report(true, true)
                    if (settings?.playback.autoPlayNext && nextEp) playNext()
                }}
                onError={() => {
                    const v = videoRef.current
                    if (method === "direct" && convertPath && probe) {
                        // The browser couldn't play it as it is: convert it.
                        toast.info("Switching to compatibility mode…")
                        const at = v && v.currentTime > 0 ? v.currentTime : startAt.current
                        startAt.current = 0
                        setOffset(at)
                        setMethod("remux")
                    } else if (method === "remux" && convertPath && !hlsRef.current) {
                        setOffset(v ? absTime(v) : offset)
                        setMethod("transcode")
                    } else if (req.kind === "local" && !hlsRef.current) {
                        // Converted and still not playable: say so rather
                        // than spin forever.
                        setError("This video could not be played, even converted.")
                    } else if (req.kind === "stream" && !hlsRef.current) {
                        nextSource()
                    }
                }}
            />

            {(loading || buffering) && !error && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    <Loader2 className="size-12 animate-spin text-white/80" />
                </div>
            )}
            {error && (
                <div className="absolute inset-0 grid place-items-center p-6">
                    <div className="max-w-md rounded-xl border border-line-strong bg-surface-1 p-6 text-center">
                        <p className="text-lg font-semibold">Playback failed</p>
                        <p className="mt-2 text-sm text-muted">{error}</p>
                        <div className="mt-5 flex flex-wrap justify-center gap-2">
                            <button className="h-10 rounded-xl bg-white/10 px-4 text-sm font-medium hover:bg-white/15" onClick={close}>
                                Close
                            </button>
                            <button className="flex h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-medium hover:bg-white/15" onClick={copyDetails}>
                                <Copy className="size-4" /> Copy details
                            </button>
                            {!remote && !!status?.features.mpv && (req.kind === "local" || sources.length > 0) && (
                                <button
                                    className={cn("h-10 rounded-xl px-4 text-sm font-medium", canTryNext ? "bg-white/10 hover:bg-white/15" : "bg-brand text-white")}
                                    onClick={openInMpv}
                                >
                                    Open in mpv
                                </button>
                            )}
                            {canTryNext && (
                                <button className="h-10 rounded-xl bg-brand px-4 text-sm font-medium text-white" onClick={tryNextSource}>
                                    Try next source
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* top bar */}
            <div className={cn("absolute inset-x-0 top-0 flex items-center gap-4 bg-gradient-to-b from-black/80 to-transparent px-6 pt-5 pb-14 transition-opacity duration-300", controls || paused ? "opacity-100" : "pointer-events-none opacity-0")}>
                <button onClick={close} className="grid size-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20" aria-label="Close player">
                    <ArrowLeft className="size-5" />
                </button>
                <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-white">{title}</p>
                    {probe && (
                        <p className="text-xs text-white/60">
                            {method === "direct" ? "Direct play" : method === "remux" ? "Direct stream (remuxed)" : "Transcoding"} · {probe.video?.[0]?.codec?.toUpperCase()}{" "}
                            {probe.video?.[0]?.height ? `${probe.video[0].height}p` : ""}
                        </p>
                    )}
                    {req.kind === "stream" && sources[sourceIdx] && (
                        <p className="text-xs text-white/60">
                            {sources[sourceIdx].server} · {sources[sourceIdx].quality || "auto"}
                        </p>
                    )}
                </div>
            </div>

            {/* bottom controls */}
            <div className={cn("absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-6 pt-20 pb-5 transition-opacity duration-300", controls || paused ? "opacity-100" : "pointer-events-none opacity-0")}>
                {/* scrubber */}
                <div
                    className="group/seek relative mb-3 h-5 cursor-pointer"
                    onMouseMove={e => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setHoverTime({ x: e.clientX - r.left, t: ((e.clientX - r.left) / r.width) * total })
                    }}
                    onMouseLeave={() => setHoverTime(null)}
                    onClick={e => {
                        const r = e.currentTarget.getBoundingClientRect()
                        seekTo(((e.clientX - r.left) / r.width) * total)
                    }}
                >
                    <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20 transition-all group-hover/seek:h-1.5">
                        <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${total ? Math.min(100, (buffered / total) * 100) : 0}%` }} />
                        {skippable.map(s => (
                            <div key={`${s.type}@${s.start}`} className="absolute inset-y-0 bg-amber-300/50" style={{ left: `${(s.start / total) * 100}%`, width: `${((s.end - s.start) / total) * 100}%` }} />
                        ))}
                        <div className="absolute inset-y-0 left-0 bg-brand" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-white shadow transition-transform group-hover/seek:scale-100" style={{ left: `${pct}%` }} />
                    {hoverTime && (
                        <div className="absolute -top-8 -translate-x-1/2 rounded-md bg-black/80 px-2 py-1 text-xs font-medium text-white" style={{ left: hoverTime.x }}>
                            {formatDuration(hoverTime.t)}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2 text-white">
                    <CtrlButton onClick={togglePlay} label={paused ? "Play (k)" : "Pause (k)"}>
                        {paused ? <Play className="size-6 fill-white" /> : <Pause className="size-6 fill-white" />}
                    </CtrlButton>
                    <CtrlButton onClick={() => seekBy(-10)} label="Back 10s (j)">
                        <RotateCcw className="size-5" />
                    </CtrlButton>
                    <CtrlButton onClick={() => seekBy(10)} label="Forward 10s (l)">
                        <RotateCw className="size-5" />
                    </CtrlButton>
                    {nextEp && (
                        <CtrlButton onClick={playNext} label="Next episode (n)">
                            <SkipForward className="size-5" />
                        </CtrlButton>
                    )}
                    <div className="group/vol flex items-center">
                        <CtrlButton onClick={() => setMuted(m => !m)} label="Mute (m)">
                            <VolumeIcon className="size-5" />
                        </CtrlButton>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={muted ? 0 : volume}
                            onChange={e => {
                                setVolume(Number(e.target.value))
                                setMuted(false)
                            }}
                            className="w-0 accent-white opacity-0 transition-all duration-200 group-hover/vol:w-24 group-hover/vol:opacity-100"
                        />
                    </div>
                    <span className="ml-2 text-sm font-medium text-white/85 tabular-nums">
                        {formatDuration(time)} <span className="text-white/45">/ {formatDuration(total)}</span>
                    </span>

                    <div className="ml-auto flex items-center gap-1">
                        {/* subtitles */}
                        <Dropdown>
                            <DropdownTrigger asChild>
                                <button className={cn("grid size-10 place-items-center rounded-full hover:bg-white/15", subKey !== "off" && "text-brand-strong")} aria-label="Subtitles">
                                    <Captions className="size-5" />
                                </button>
                            </DropdownTrigger>
                            <DropdownContent className="z-[90] max-h-80 overflow-y-auto">
                                <DropdownLabel>Subtitles</DropdownLabel>
                                <DropdownItem onSelect={() => changeSub("off")}>{subKey === "off" ? "● " : ""}Off</DropdownItem>
                                {subs.map(s => (
                                    <DropdownItem key={s.key} onSelect={() => changeSub(s.key)} disabled={s.bitmap}>
                                        {subKey === s.key ? "● " : ""}
                                        {s.label}
                                        {s.bitmap ? " (mpv only)" : ""}
                                    </DropdownItem>
                                ))}
                            </DropdownContent>
                        </Dropdown>
                        {/* audio */}
                        {!!convertPath && (probe?.audio?.length ?? 0) > 1 && (
                            <Dropdown>
                                <DropdownTrigger asChild>
                                    <button className="grid size-10 place-items-center rounded-full hover:bg-white/15" aria-label="Audio track">
                                        <Languages className="size-5" />
                                    </button>
                                </DropdownTrigger>
                                <DropdownContent className="z-[90]">
                                    <DropdownLabel>Audio</DropdownLabel>
                                    {(probe?.audio ?? []).map((a, i) => (
                                        <DropdownItem key={i} onSelect={() => changeAudio(i)}>
                                            {audioIndex === i ? "● " : ""}
                                            {[langName(a.language), a.title, a.codec?.toUpperCase(), a.channels ? `${a.channels}ch` : ""].filter(Boolean).join(" · ") || `Track ${i + 1}`}
                                        </DropdownItem>
                                    ))}
                                </DropdownContent>
                            </Dropdown>
                        )}
                        {/* quality / speed */}
                        <Dropdown>
                            <DropdownTrigger asChild>
                                <button className="grid size-10 place-items-center rounded-full hover:bg-white/15" aria-label="Settings">
                                    <Gauge className="size-5" />
                                </button>
                            </DropdownTrigger>
                            <DropdownContent className="z-[90] max-h-96 overflow-y-auto">
                                {req.kind === "stream" && sources.length > 1 && (
                                    <>
                                        <DropdownLabel>Source</DropdownLabel>
                                        {sources.map((s, i) => (
                                            <DropdownItem key={i} onSelect={() => changeSource(i)}>
                                                {sourceIdx === i ? "● " : ""}
                                                {[s.server, s.quality, s.label].filter(Boolean).join(" · ")}
                                            </DropdownItem>
                                        ))}
                                        <DropdownSeparator />
                                    </>
                                )}
                                {!!convertPath && !!probe && method !== "transcode" && (
                                    <>
                                        <DropdownItem
                                            onSelect={() => {
                                                const v = videoRef.current
                                                setOffset(v ? absTime(v) : 0)
                                                setMethod("transcode")
                                            }}
                                        >
                                            Force transcoding
                                        </DropdownItem>
                                        <DropdownSeparator />
                                    </>
                                )}
                                <DropdownLabel>Speed</DropdownLabel>
                                {[0.75, 1, 1.25, 1.5, 2].map(r => (
                                    <DropdownItem key={r} onSelect={() => setRate(r)}>
                                        {rate === r ? "● " : ""}
                                        {r}×
                                    </DropdownItem>
                                ))}
                            </DropdownContent>
                        </Dropdown>
                        {!remote && (
                            <CtrlButton onClick={openInMpv} label="Continue in mpv">
                                <MonitorPlay className="size-5" />
                            </CtrlButton>
                        )}
                        <CtrlButton onClick={toggleFullscreen} label="Fullscreen (f)">
                            {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
                        </CtrlButton>
                    </div>
                </div>
            </div>

            {/* skip (the next episode is in the controls, and n). Above the
                controls: their gradient reaches up behind the button and
                would otherwise take its clicks while the controls show. */}
            <div className="absolute right-8 bottom-32 z-10 flex flex-col items-end gap-3">
                {currentSkip && (
                    <button onClick={() => seekTo(currentSkip.end)} className="flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-black shadow-2xl rise-in hover:bg-white/90">
                        <FastForward className="size-4 fill-black" /> Skip {skipWhat}
                    </button>
                )}
            </div>
        </div>
    )
}

function CtrlButton({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
    return (
        <button onClick={onClick} title={label} aria-label={label} className="grid size-10 place-items-center rounded-full transition hover:bg-white/15 active:scale-95">
            {children}
        </button>
    )
}

// The key of an episode of the title page (the server sends key, season
// and number; older views had the key as number).
const keyOf = (e: EpisodeView) => (e as EpisodeView & { key?: number }).key ?? e.number

// How the player titles what plays, like the server (app.PlayerTitle):
// "Show — S01E02 · Pilot", "Movie (2010)".
function playerTitle(e: EntryView | null, key: number, fallback: string) {
    const m = e?.media
    const name = m?.title.userPreferred || m?.title.english || fallback || "Stream"
    if (!e || !m) return name
    if (!mediaIsShow(m)) {
        const year = m.startDate?.year ?? m.seasonYear
        return year ? `${name} (${year})` : name
    }
    const ep = (e.episodes ?? []).find(x => keyOf(x) === key)
    return `${name} — ${formatKey(key)}${ep?.title ? ` · ${ep.title}` : ""}`
}

// The subtitles a stream opens with, by the server's rules for files
// (player.ChooseTracks): the ones picked for the title before; else in the
// preferred subtitle language (English if none) when the audio, the
// original language or the dub's, isn't in a language of the user's (with
// "subtitles for foreign audio" off: whenever a language is set); else
// off, but forced subtitles.
function streamSub(opts: SubOption[], prefs: TrackPrefs | null, p: Settings["playback"] | undefined, original: string, dub: boolean): string {
    if (prefs?.subOff) return "off"
    if (prefs && (prefs.subLang || prefs.subTitle || prefs.subIndex)) {
        const m =
            opts.find(o => langOf(o.lang) === langOf(prefs.subLang) && o.title === prefs.subTitle) ??
            opts.find(o => prefs.subTitle && o.title === prefs.subTitle) ??
            opts.find(o => prefs.subLang && langIn(o.lang, prefs.subLang) && !forcedSub(o)) ??
            (prefs.subIndex ? opts.find(o => o.index === prefs.subIndex! - 1) : undefined)
        if (m && !m.bitmap) return m.key
    }
    const subLang = p?.preferredSubLang || "eng,en"
    const audio = dub ? langOf((p?.preferredAudioLang || "eng").split(",")[0]) : langOf(original)
    const foreign = !!audio && !langIn(audio, subLang) && !(p?.preferredAudioLang && langIn(audio, p.preferredAudioLang))
    const want = p?.subtitlesForForeign === false ? !!p.preferredSubLang : foreign
    if (want) {
        const full = opts.find(o => !o.bitmap && !forcedSub(o) && langIn(o.lang, subLang)) ?? opts.find(o => !o.bitmap && !forcedSub(o) && !langOf(o.lang))
        if (full) return full.key
    }
    const forced = opts.find(o => !o.bitmap && forcedSub(o) && (!langOf(o.lang) || !audio || langOf(o.lang) === audio))
    return forced ? forced.key : "off"
}

const forcedSub = (o: SubOption) => /forced|signs?\b.*songs?/i.test(`${o.title} ${o.label}`)

// What a text may say of links, to be copied and shared: their scheme,
// host and path, which help tell what went wrong, but not what gives
// access to a stream (query strings, fragments, user names and
// passwords, path parts that look like tokens). KumoBox's own links
// (/api/proxy?u=…) carry the provider's link in theirs.
function redactLinks(text: string) {
    const tokenLike = (s: string) =>
        s.length >= 20 && /[a-z]/i.test(s) && /\d/.test(s) && (!s.includes(".") || (s.length >= 40 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(s)))
    return text
        .replace(/\b([a-z][a-z\d+.-]*:\/\/)([^\s/?#"'<>]*)([^\s?#"'<>]*)(?:[?#][^\s"'<>]*)?/gi, (_m, scheme: string, host: string, path: string) => {
            // Punctuation after a link isn't part of it ("…/x.m3u8: 404").
            const end = /[.,:;!)\]]*$/.exec(path)?.[0] ?? ""
            const parts = path.slice(0, path.length - end.length).split("/").map(p => (tokenLike(p) ? "…" : p))
            return scheme + host.replace(/^[^@]*@/, "") + parts.join("/") + end
        })
        .replace(/(\/api\/[^\s?#"'<>]*)[?#][^\s"'<>]*/g, "$1")
        .replace(/\bremote:[\da-f]{8,}/gi, "remote:…")
}
