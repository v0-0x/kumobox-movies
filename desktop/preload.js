// Exposes a tiny, safe bridge to the web UI.
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("kumoboxDesktop", {
    platform: process.platform,
    // Opens a web page (TMDB, Letterboxd, a provider's site…) in the system
    // browser.
    openExternal: url => ipcRenderer.send("kumobox:open-external", url),
    // The desktop app's own settings (Settings › App › Desktop app).
    getPrefs: () => ipcRenderer.invoke("kumobox:get-prefs"),
    setPref: (name, value) => ipcRenderer.invoke("kumobox:set-pref", name, value),
    // Quits KumoBox, server and all.
    quit: () => ipcRenderer.send("kumobox:quit"),
})
