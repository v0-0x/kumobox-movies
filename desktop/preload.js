// Exposes a tiny, safe bridge to the web UI.
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("kumoboxDesktop", {
    platform: process.platform,
    // Opens a web page (TMDB, Letterboxd, a provider's site…) in the system
    // browser.
    openExternal: url => ipcRenderer.send("kumobox:open-external", url),
    // The desktop app's own settings (Settings › Desktop app & programs).
    getPrefs: () => ipcRenderer.invoke("kumobox:get-prefs"),
    setPref: (name, value) => ipcRenderer.invoke("kumobox:set-pref", name, value),
    // Quits KumoBox, server and all.
    quit: () => ipcRenderer.send("kumobox:quit"),
    // Picture in picture: the small player window (web/src/lib/pip.ts).
    openMiniPlayer: page => ipcRenderer.invoke("kumobox:mini-open", page),
    closeMiniPlayer: () => ipcRenderer.send("kumobox:mini-close"),
    expandMiniPlayer: req => ipcRenderer.send("kumobox:mini-expand", req),
    // An episode handed back by the small window, for this one to play.
    takePendingPlay: () => ipcRenderer.invoke("kumobox:take-play"),
    onPlay: fn => ipcRenderer.on("kumobox:play", (_e, req) => fn(req)),
})
