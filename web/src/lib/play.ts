import { useNavigate } from "react-router-dom"
import { toast } from "@/lib/toast"
import { api } from "./api"
import { fetchLanguageMode, useStatus } from "./queries"
import { playerStore } from "./store"

// The streaming provider last used for a movie or show (remembered by this
// browser), or "".
export function rememberedProvider(mediaId: number) {
    try {
        return localStorage.getItem(`kumobox-provider-${mediaId}`) ?? ""
    } catch {
        return ""
    }
}

// Central place deciding between mpv and the in-app player.
export function usePlay() {
    const { data: status } = useStatus()
    const navigate = useNavigate()
    const settings = status?.settings
    const remote = status?.client === "lan" // LAN devices can't use this PC's mpv

    const localPlayer = (override?: "mpv" | "builtin") => (remote ? "builtin" : (override ?? settings?.playback.defaultPlayer ?? "builtin"))
    const streamPlayer = localPlayer

    const playLocal = async (path: string, mediaId: number, episode: number, opts: { player?: "mpv" | "builtin"; start?: number } = {}) => {
        if (localPlayer(opts.player) === "builtin") {
            playerStore.set({ kind: "local", path, mediaId, episode, start: opts.start })
            return
        }
        const t = toast.loading("Opening mpv…")
        try {
            await api.post("/api/playback/local", { path, mediaId, episode, player: "mpv", start: opts.start })
            toast.success("Playing in mpv", { id: t })
        } catch (e: any) {
            toast.error(e.message, { id: t })
        }
    }

    const playStream = async (provider: string, mediaId: number, episode: number, dub: boolean, opts: { player?: "mpv" | "builtin"; server?: string } = {}) => {
        if (streamPlayer(opts.player) === "builtin") {
            playerStore.set({ kind: "stream", provider, mediaId, episode, dub, server: opts.server })
            return
        }
        const t = toast.loading("Finding a stream…")
        try {
            await api.post("/api/providers/play", { provider, mediaId, episode, dub, server: opts.server })
            toast.success("Playing in mpv", { id: t })
        } catch (e: any) {
            toast.error(e.message, { id: t })
        }
    }

    // Plays an episode (key; 1 for a movie): its file when there is one,
    // otherwise a stream from the provider used last for it, or the default
    // one, in the version (original or dub) chosen for it. Without a
    // provider, its page opens where to find one.
    const watch = async (mediaId: number, episode: number, filePath?: string | null) => {
        if (filePath) return playLocal(filePath, mediaId, episode)
        const online = settings?.onlineStream.enabled !== false
        const provider = online ? rememberedProvider(mediaId) || settings?.onlineStream.defaultProvider || "" : ""
        if (!provider) {
            navigate(`/entry?id=${mediaId}&tab=${online ? "stream" : "torrents"}`)
            return
        }
        const dub = await fetchLanguageMode(mediaId, !!settings?.onlineStream.preferDub)
        return playStream(provider, mediaId, episode, dub)
    }

    return { playLocal, playStream, watch, localPlayer, streamPlayer, remote }
}
