// KumoBox desktop shell.
//
// Starts the KumoBox server (bound to 127.0.0.1) or attaches to one that is
// already running, then shows the UI in a native window. Every request the
// window makes carries the per-run shell token, which is how the server
// recognises its own desktop window when the browser Web UI is turned off.

const { app, BrowserWindow, ipcMain, shell, session, Menu, dialog, nativeImage, nativeTheme, Tray, Notification, powerMonitor, screen, clipboard } = require("electron")
const { spawn, execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const http = require("node:http")

const isWindows = process.platform === "win32"
const isMac = process.platform === "darwin"

// Exit codes of the server (server/internal/lifecycle): restart the app into
// a new version, or quit for the installer that updates it.
const EXIT_RESTART = 75
const EXIT_INSTALLING = 76

// On Windows this is the AppUserModelID, which must match "appId" in
// electron-builder.yml: the installer's shortcuts carry it, and the taskbar
// groups the window with them.
const APP_ID = isWindows ? "app.kumobox.desktop" : "kumobox"
app.setName("KumoBox")
app.setAppUserModelId?.(APP_ID)
// The window mostly talks to KumoBox's own server, on this computer: run
// Chromium's network service inside the app instead of a process of its
// own, which saves about 80 MB.
const features = ["NetworkServiceInProcess2"]
if (process.platform === "linux") {
    // Smooth video and scrolling on Linux.
    features.push("VaapiVideoDecodeLinuxGL", "VaapiVideoDecoder")
    app.commandLine.appendSwitch("ignore-gpu-blocklist")
}
app.commandLine.appendSwitch("enable-features", features.join(","))
if (isWindows && process.env.LOCALAPPDATA) {
    // Electron would keep the window's browser data (caches, local storage)
    // in %APPDATA%\KumoBox, which is the server's data folder on Windows: keep
    // it apart, with KumoBox's other local files.
    app.setPath("userData", path.join(process.env.LOCALAPPDATA, "KumoBox", "electron"))
}
if (isMac) {
    // Electron would keep them in ~/Library/Application Support/KumoBox, which
    // is the server's data folder on macOS: keep them in a folder of their
    // own in it.
    app.setPath("userData", path.join(app.getPath("appData"), "KumoBox", "electron"))
}

// --smoke: the release workflows' check that the packaged app starts at all
// (with its fuses and asar integrity check on, a damaged package doesn't
// even get this far). It starts the bundled server with a throwaway data
// folder, waits until it answers, prints a line and exits: 0 when it
// answered, 1 otherwise. No window, no tray, no single-instance lock.
const SMOKE = process.argv.includes("--smoke")
if (SMOKE) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kumobox-smoke-"))
    process.env.KUMOBOX_DATA_DIR = path.join(tmp, "data")
    app.setPath("userData", path.join(tmp, "electron"))
}

const runtimeDir = serverRuntimeDir()
let serverProc = null
let mainWindow = null
let baseUrl = null
let tray = null

// The desktop app's own preferences (Settings › Desktop app & programs),
// kept next to its browser data.
//   keepRunning     closing the window leaves KumoBox running (tray icon, or the
//                   Dock on a Mac): streaming to other devices, downloads and
//                   the auto downloader keep going without the window's
//                   memory. Off unless turned on (keepRunningChosen: it was
//                   on by default for a while, and that doesn't count).
//   freeWhenLocked  a few minutes after the computer is locked, the window
//                   lets go of its page, and loads it again on unlocking.
//   toldKeepRunning the notice about it was shown (the first time).
//   window, mini    where KumoBox's window and the small player were, and how
//                   big (the window: whether maximized): they open there.
//   zoom            the pages' zoom (Ctrl + and -), kept between runs.
const prefs = { keepRunning: false, keepRunningChosen: false, freeWhenLocked: true, toldKeepRunning: false, window: null, mini: null, zoom: 1 }
const prefsFile = () => path.join(app.getPath("userData"), "desktop.json")

function loadPrefs() {
    const saved = readJSON(prefsFile()) || {}
    for (const k of Object.keys(prefs)) if (typeof saved[k] === typeof prefs[k]) prefs[k] = saved[k]
    if (!prefs.keepRunningChosen) prefs.keepRunning = false
    if (!(prefs.zoom >= 0.5 && prefs.zoom <= 2)) prefs.zoom = 1
}

function savePrefs() {
    try {
        fs.mkdirSync(path.dirname(prefsFile()), { recursive: true })
        fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2))
    } catch (err) {
        console.error("desktop preferences:", err)
    }
}

// Starting with the computer (Settings › Desktop app & programs), off unless
// turned on: the system's own login items on Windows and macOS, an autostart
// entry on Linux. Started that way, KumoBox opens in the background (tray, or
// the Dock on a Mac) when it keeps running without its window; otherwise
// with its window, so it's never running unseen.
const BACKGROUND = "--background"
const autostartFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "autostart", "kumobox.desktop")

function startsAtLogin() {
    if (process.platform === "linux") return fs.existsSync(autostartFile())
    return app.getLoginItemSettings(isWindows ? { args: [BACKGROUND] } : undefined).openAtLogin
}

// setStartAtLogin turns starting with the computer on or off; it returns
// what went wrong, if anything.
function setStartAtLogin(on) {
    if (process.platform === "linux") {
        const file = autostartFile()
        try {
            if (!on) {
                fs.rmSync(file, { force: true })
                return null
            }
            // The package's launcher, else this Electron with this app.
            const exec = fs.existsSync("/usr/bin/kumobox") ? "/usr/bin/kumobox" : `"${process.execPath}" "${app.getAppPath()}"`
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, ["[Desktop Entry]", "Type=Application", "Name=KumoBox", "Comment=KumoBox in the background", `Exec=${exec} ${BACKGROUND}`, "Icon=kumobox", "Terminal=false", "X-GNOME-Autostart-enabled=true", ""].join("\n"))
            return null
        } catch (err) {
            return String(err?.message || err)
        }
    }
    app.setLoginItemSettings(isWindows ? { openAtLogin: on, args: [BACKGROUND] } : { openAtLogin: on })
    if (isMac && on && app.getLoginItemSettings().status === "requires-approval") {
        return "macOS asks you to allow it: in System Settings › General › Login Items (Login Items & Extensions), turn on KumoBox."
    }
    return startsAtLogin() === on ? null : "The system didn't take the change."
}

// startedAtLogin reports a launch by the system at login.
function startedAtLogin() {
    if (process.argv.includes(BACKGROUND)) return true
    return isMac && app.getLoginItemSettings().wasOpenedAtLogin
}

// Where the server writes server.json and the shell token: the same folder
// as its config.RuntimeDir(). On Linux and macOS the server falls back to
// <user cache dir>/kumobox/run when the usual folder ($XDG_RUNTIME_DIR/kumobox
// or $TMPDIR/kumobox) isn't a real directory this user owns — a symlink, or
// one another user made in a shared /tmp, whose shell token could be planted
// or read by them. The window must look in the same place, so it mirrors the
// check (config/paths_unix.go, paths_darwin.go). Windows is unchanged.
function serverRuntimeDir() {
    if (isWindows) {
        const local = process.env.LOCALAPPDATA
        return local ? path.join(local, "KumoBox", "run") : path.join(os.tmpdir(), "kumobox")
    }
    // macOS: $TMPDIR, the user's own temporary folder.
    const base = isMac ? os.tmpdir() : process.env.XDG_RUNTIME_DIR || os.tmpdir()
    const primary = path.join(base, "kumobox")
    if (ownRuntimeDir(primary)) return primary
    const cache = isMac ? path.join(os.homedir(), "Library", "Caches") : process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache")
    return path.join(cache, "kumobox", "run")
}

// ownRuntimeDir reports whether dir is safe to read the shell token from: it
// must be a real directory (not a symlink or other file) that this user owns,
// or not exist yet (the server creates it owned by this user). Anything else
// is another user's, and its token can't be trusted.
function ownRuntimeDir(dir) {
    try {
        const st = fs.lstatSync(dir)
        if (!st.isDirectory()) return false
        return typeof process.getuid !== "function" || st.uid === process.getuid()
    } catch (err) {
        return err.code === "ENOENT"
    }
}

function serverCandidates() {
    if (isWindows) {
        return [
            process.env.KUMOBOX_SERVER,
            path.join(process.resourcesPath, "kumobox.exe"), // installed or portable app: resources\kumobox.exe
            path.join(__dirname, "..", "dist", "windows", "kumobox.exe"), // development checkout
        ]
    }
    if (isMac) {
        return [
            process.env.KUMOBOX_SERVER,
            path.join(process.resourcesPath, "kumobox"), // KumoBox.app/Contents/Resources/kumobox
            path.join(__dirname, "..", "dist", "kumobox"), // development checkout
        ]
    }
    return [
        process.env.KUMOBOX_SERVER,
        path.join(__dirname, "..", "kumobox"), // /usr/lib/kumobox/app -> /usr/lib/kumobox/kumobox
        path.join(__dirname, "..", "dist", "kumobox"), // development checkout
        "/usr/lib/kumobox/kumobox",
    ]
}

function findServerBinary() {
    const candidates = serverCandidates().filter(Boolean)
    // X_OK is only an existence check on Windows.
    return candidates.find(p => {
        try {
            fs.accessSync(p, fs.constants.X_OK)
            return true
        } catch {
            return false
        }
    })
}

function readJSON(p) {
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"))
    } catch {
        return null
    }
}

function ping(url) {
    return new Promise(resolve => {
        const req = http.get(url + "/api/status", { timeout: 1500, headers: { "X-KumoBox-Shell": readToken() || "" } }, res => {
            res.resume()
            resolve(res.statusCode < 500)
        })
        req.on("error", () => resolve(false))
        req.on("timeout", () => {
            req.destroy()
            resolve(false)
        })
    })
}

function readToken() {
    try {
        return fs.readFileSync(path.join(runtimeDir, "shell-token"), "utf8").trim()
    } catch {
        return ""
    }
}

async function existingServer() {
    const info = readJSON(path.join(runtimeDir, "server.json"))
    if (!info?.port) return null
    try {
        process.kill(info.pid, 0)
    } catch {
        return null
    }
    const url = `http://127.0.0.1:${info.port}`
    return (await ping(url)) ? url : null
}

// The server's last lines (without their timestamps): what went wrong, for
// the box that says KumoBox couldn't start.
const serverLines = []
function noteServerOutput(text) {
    for (const line of text.split(/\r?\n/)) {
        const l = line.replace(/^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d(\.\d+)? /, "").trim()
        if (l) serverLines.push(l)
    }
    serverLines.splice(0, Math.max(0, serverLines.length - 30))
}

function startServer() {
    return new Promise((resolve, reject) => {
        const bin = findServerBinary()
        if (!bin) {
            const msg = isWindows
                ? "KumoBox's server (kumobox.exe) is missing from its folder. Install KumoBox again."
                : isMac
                  ? "KumoBox's server is missing from the app. Download KumoBox again."
                  : "KumoBox's server (kumobox) is missing. Install the package again."
            return reject(new Error(msg))
        }
        // windowsHide: on Windows the server, and the ffmpeg, ffprobe and
        // yt-dlp processes it starts (they share its console), never pop up a
        // console window. Elsewhere it does nothing. Windows has no signals
        // to ask the server to stop: there it stops when its input closes
        // (see before-quit).
        const args = isWindows ? ["--desktop", "--exit-with-stdin"] : ["--desktop"]
        serverProc = spawn(bin, args, { stdio: [isWindows ? "pipe" : "ignore", "pipe", "pipe"], env: process.env, windowsHide: true })
        let resolved = false
        const onData = buf => {
            const text = buf.toString()
            process.stdout.write(text)
            noteServerOutput(text)
            const m = /listening on http:\/\/([\d.]+):(\d+)/.exec(text)
            if (m && !resolved) {
                resolved = true
                resolve(`http://127.0.0.1:${m[2]}`)
            }
            if (/could not start the server/.test(text) && !resolved) {
                resolved = true
                // Its port taken: by another program (KumoBox itself would have
                // been found running).
                const port = /:(\d+): bind/.exec(text)?.[1]
                reject(
                    new Error(
                        /address already in use|only one usage of each socket address/i.test(text)
                            ? `Another program is using KumoBox's port${port ? ` (${port})` : ""}. Close it, then try again.`
                            : "KumoBox's server couldn't start.",
                    ),
                )
            }
        }
        serverProc.stdout.on("data", onData)
        serverProc.stderr.on("data", onData)
        serverProc.on("exit", (code, signal) => {
            // The server stopped for an update: no error box. After an
            // update was installed, the whole app starts again, so that its
            // window loads the new main.js too. On Windows an installer is
            // replacing KumoBox, and starts it when it's done; on macOS the
            // server has put the new app in place, and a helper opens it once
            // this one has quit.
            if (code === EXIT_RESTART || code === EXIT_INSTALLING) {
                serverProc = null
                app.isQuitting = true
                // Windows: the installer works unseen for a moment; said, so
                // KumoBox doesn't just vanish.
                if (code === EXIT_INSTALLING && Notification.isSupported()) new Notification({ title: "Updating KumoBox", body: "KumoBox opens again in a moment." }).show()
                // With its window: not as started with the computer.
                if (code === EXIT_RESTART) app.relaunch({ args: process.argv.slice(1).filter(a => a !== BACKGROUND) })
                app.exit(0)
                return
            }
            if (!resolved) reject(new Error("KumoBox's server stopped while starting."))
            serverProc = null
            if (resolved && !app.isQuitting) {
                // Stopped, not crashed (the computer shutting down or signing
                // out stops it first): KumoBox quits with it, quietly.
                if (code === 0 || ["SIGTERM", "SIGINT", "SIGHUP"].includes(signal)) {
                    app.isQuitting = true
                    app.quit()
                    return
                }
                const msg = "KumoBox's server stopped unexpectedly."
                if (mainWindow) {
                    const answer = dialog.showMessageBoxSync(mainWindow, {
                        type: "error",
                        title: "KumoBox",
                        message: msg,
                        detail: serverLines.slice(-6).join("\n"),
                        buttons: ["Restart KumoBox", "Quit"],
                        defaultId: 0,
                        cancelId: 1,
                    })
                    app.isQuitting = true
                    if (answer === 0) app.relaunch()
                    app.exit(0)
                    return
                }
                // Running without a window: no box that would hold up
                // anything, just a notice.
                if (Notification.isSupported()) new Notification({ title: "KumoBox stopped", body: msg + " Open it again to restart it." }).show()
                app.isQuitting = true
                app.quit()
            }
        })
        setTimeout(() => {
            if (!resolved) {
                resolved = true
                reject(new Error("KumoBox's server took too long to start."))
            }
        }, 30000)
    })
}

// KumoBox's address now: its port can be changed in Settings, the server moves
// to it at once and writes it in server.json.
let serverRead = 0
function serverUrl() {
    // At most once a second (it's asked about each request).
    if (Date.now() - serverRead < 1000) return baseUrl
    serverRead = Date.now()
    const info = readJSON(path.join(runtimeDir, "server.json"))
    if (info?.port) baseUrl = `http://127.0.0.1:${info.port}`
    return baseUrl
}

function installShellHeader() {
    const filter = { urls: ["http://127.0.0.1/*", "http://127.0.0.1:*/*"] }
    session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
        // Only to KumoBox: not to another program listening on this computer.
        const token = isInternal(details.url) ? readToken() : ""
        if (token) details.requestHeaders["X-KumoBox-Shell"] = token
        cb({ requestHeaders: details.requestHeaders })
    })
}

// A page of KumoBox's: at its address (the one it had when it started, or the
// one it moved to).
function isInternal(url) {
    try {
        const u = new URL(url)
        if (u.protocol !== "http:" || u.hostname !== "127.0.0.1") return false
        const at = b => !!b && new URL(b).port === u.port
        return at(baseUrl) || at(serverUrl())
    } catch {
        return false
    }
}

// macOS keeps the app's menu in the menu bar, and the standard shortcuts
// (copy and paste, Cmd+Q, Cmd+W, full screen…) only work through its items.
// Linux and Windows show no menu. Set once, at the start.
function appMenu() {
    if (!isMac) return null
    const open = page => () => showWindowAt(page).catch(() => {})
    return Menu.buildFromTemplate([
        {
            label: "KumoBox",
            submenu: [
                { role: "about" },
                { type: "separator" },
                { label: "Settings…", accelerator: "Cmd+,", click: open("/settings") },
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
            ],
        },
        { role: "fileMenu" },
        { role: "editMenu" },
        {
            label: "View",
            submenu: [
                // Kept between runs (zoomBy), unlike the menu's own zoom.
                { label: "Actual Size", accelerator: "Cmd+0", click: () => zoomTo(1) },
                { label: "Zoom In", accelerator: "Cmd+Plus", click: () => zoomBy(0.1) },
                { label: "Zoom In", accelerator: "Cmd+=", click: () => zoomBy(0.1), visible: false, acceleratorWorksWhenHidden: true },
                { label: "Zoom Out", accelerator: "Cmd+-", click: () => zoomBy(-0.1) },
                { type: "separator" },
                { role: "togglefullscreen" },
            ],
        },
        { role: "windowMenu" },
    ])
}

// The pages' zoom: Ctrl (Cmd) with + and - or the mouse wheel, 0 back to
// normal; kept between runs, and the same in each page of KumoBox's.
function zoomTo(f) {
    prefs.zoom = Math.round(Math.min(2, Math.max(0.5, f)) * 100) / 100
    savePrefs()
    mainWindow?.webContents.setZoomFactor(prefs.zoom)
}
function zoomBy(d) {
    zoomTo(prefs.zoom + d)
}

// Where KumoBox's window opens: where it was, if that's still on a screen;
// else in the middle of the main one, as big as fits (up to 1600×1000).
function windowBounds() {
    const w = prefs.window
    if (w && [w.x, w.y, w.width, w.height].every(Number.isFinite)) {
        const area = screen.getDisplayMatching(w).workArea
        const visible = w.x < area.x + area.width - 80 && w.x + w.width > area.x + 80 && w.y < area.y + area.height - 80 && w.y + w.height > area.y
        if (visible) return { x: w.x, y: w.y, width: Math.min(w.width, area.width), height: Math.min(w.height, area.height) }
    }
    const area = screen.getPrimaryDisplay().workArea
    const width = Math.min(1600, Math.round(area.width * 0.9))
    const height = Math.min(1000, Math.round(area.height * 0.9))
    return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height }
}

// What the window shows while KumoBox's server starts (a first start can take
// a few seconds), and if its page didn't load: in the app's colors.
function waitingPage(text) {
    const logo =
        '<svg viewBox="0 0 64 64" width="56" height="56"><rect width="64" height="64" rx="15" fill="#e2e2e6"/><path d="M12 42V28A9 9 0 0 1 22.53 19.13A12 12 0 0 1 45.46 23.02A7 7 0 0 1 52 30V42A6 6 0 0 1 46 48H18A6 6 0 0 1 12 42ZM30.26 26.68A2.5 2.5 0 0 0 26.5 28.84L26.5 38.16A2.5 2.5 0 0 0 30.26 40.32L38.28 35.66A2.5 2.5 0 0 0 38.28 31.34Z" fill="#141416" fill-rule="evenodd"/></svg>'
    const html = `<!doctype html><meta charset="utf-8"><title>KumoBox</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0a0a0b;color:#a1a1a8;font:14px system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-user-select:none;user-select:none"><div style="display:grid;justify-items:center;gap:18px">${logo}<div>${text}</div></div></body>`
    return "data:text/html;charset=utf-8," + encodeURIComponent(html)
}

// The window's own icon. On Linux it's invisible: KDE and other desktops draw
// it in the window's title bar, where KumoBox shows none, while the taskbar and
// the app menu take KumoBox's icon from its desktop entry. On Windows the
// window's icon is also the taskbar's.
function windowIcon() {
    if (process.platform === "linux") return nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4), { width: 32, height: 32 })
    const iconPath = [path.join(__dirname, "icon.png")].find(p => fs.existsSync(p))
    return iconPath ? nativeImage.createFromPath(iconPath) : undefined
}

// createWindow opens KumoBox's window, at a page of it (page, "" for Home);
// waiting: while the server starts, which shows it when it's ready (load).
// (Not named path: that's the path module, used here.)
function createWindow(page = "", waiting = false) {
    if (mainWindow) return
    mainWindow = new BrowserWindow({
        ...windowBounds(),
        minWidth: 960,
        minHeight: 620,
        title: "KumoBox",
        backgroundColor: "#0a0a0b",
        autoHideMenuBar: true,
        show: false,
        icon: windowIcon(),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: false,
        },
    })
    if (prefs.window?.maximized) mainWindow.maximize()
    mainWindow.once("ready-to-show", () => mainWindow?.show())

    const wc = mainWindow.webContents
    keepInside(wc)
    wc.on("before-input-event", (e, input) => {
        if (input.type !== "keyDown") return
        const key = input.key.toLowerCase()
        if (key === "f11") mainWindow.setFullScreen(!mainWindow.isFullScreen())
        if (input.control && input.shift && key === "i") wc.toggleDevTools()
        if (input.control && key === "r") wc.reload()
        // Zoom (on a Mac, its View menu's).
        if (!isMac && input.control && !input.alt) {
            const by = key === "=" || key === "+" ? 0.1 : key === "-" ? -0.1 : 0
            if (by) zoomBy(by)
            if (key === "0") zoomTo(1)
            if (by || key === "0") e.preventDefault()
        }
        // Back and forward through the pages: Alt+Left and Right (Cmd+[ and ] on a Mac).
        const back = isMac ? input.meta && key === "[" : input.alt && key === "arrowleft"
        const forward = isMac ? input.meta && key === "]" : input.alt && key === "arrowright"
        if (back || forward) {
            go(wc, back ? -1 : 1)
            e.preventDefault()
        }
    })
    // Ctrl and the mouse wheel.
    wc.on("zoom-changed", (_e, dir) => zoomBy(dir === "in" ? 0.1 : -0.1))
    wc.on("did-finish-load", () => wc.setZoomFactor(prefs.zoom))
    // The mouse's back and forward buttons (Windows and Linux).
    mainWindow.on("app-command", (_e, cmd) => {
        if (cmd === "browser-backward") go(wc, -1)
        if (cmd === "browser-forward") go(wc, 1)
    })
    // KumoBox's page didn't load (the server busy, restarting): said, and
    // tried again in a moment, instead of a blank window.
    wc.on("did-fail-load", (_e, code, _desc, url, mainFrame) => {
        if (!mainFrame || code === -3 || !isInternal(url)) return
        wc.loadURL(waitingPage("KumoBox isn't answering yet: trying again…")).catch(() => {})
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed() && !parkedUrl) mainWindow.loadURL(url).catch(() => {})
        }, 2000)
    })
    // The page's process ended (a crash, the system short of memory): it's
    // opened again.
    wc.on("render-process-gone", (_e, details) => {
        if (details.reason === "clean-exit") return
        console.error("KumoBox's page stopped:", details.reason)
        setTimeout(() => mainWindow?.webContents.reload(), 500)
    })
    // Where it is and how big, for the next time it opens.
    const remember = () => {
        if (!mainWindow || mainWindow.isMinimized() || mainWindow.isFullScreen()) return
        prefs.window = { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() }
    }
    mainWindow.on("resize", remember)
    mainWindow.on("move", remember)
    mainWindow.on("close", () => {
        remember()
        savePrefs()
    })
    mainWindow.on("closed", () => {
        mainWindow = null
        parkedUrl = null
        // KumoBox quits with its window (not kept running): the small player
        // too, or nothing would be left to close it with.
        if (!prefs.keepRunning && !app.isQuitting) miniWindow?.close()
    })
    // Windows is shutting down or signing out, which stops the server too:
    // that isn't worth an error box (the event only exists on Windows).
    mainWindow.on("query-session-end", () => (app.isQuitting = true))
    mainWindow.loadURL(waiting ? waitingPage("Starting KumoBox…") : serverUrl() + page).catch(() => {})
}

// go moves through the window's pages (-1 back, 1 forward), where there's one.
function go(wc, step) {
    const h = wc.navigationHistory
    if (step < 0 ? h.canGoBack() : h.canGoForward()) step < 0 ? h.goBack() : h.goForward()
}

// External links open in the system browser; KumoBox's windows never navigate
// away from KumoBox.
function keepInside(contents) {
    // Right-click: cut, copy and paste in text fields, copy what's selected,
    // and a link's own items. KumoBox's own menus (a card's) come first: the
    // page handles those clicks itself.
    contents.on("context-menu", (_e, p) => {
        const items = []
        if (p.isEditable) {
            items.push(
                { role: "cut", enabled: p.editFlags.canCut },
                { role: "copy", enabled: p.editFlags.canCopy },
                { role: "paste", enabled: p.editFlags.canPaste },
                { type: "separator" },
                { role: "selectAll" },
            )
        } else if (p.selectionText.trim()) items.push({ role: "copy" })
        if (/^https?:\/\//.test(p.linkURL) && !isInternal(p.linkURL)) {
            if (items.length) items.push({ type: "separator" })
            items.push({ label: "Open link in browser", click: () => shell.openExternal(p.linkURL) }, { label: "Copy link", click: () => clipboard.writeText(p.linkURL) })
        }
        if (items.length) Menu.buildFromTemplate(items).popup()
    })
    contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url) && !isInternal(url)) shell.openExternal(url)
        return { action: "deny" }
    })
    contents.on("will-navigate", (e, url) => {
        if (!isInternal(url)) {
            e.preventDefault()
            if (/^https?:\/\//.test(url)) shell.openExternal(url)
        }
    })
    // A navigation to a scheme the app never uses — smb:, file:, ms-msdt:, a
    // custom protocol handler… — would otherwise be handed to the OS to
    // open, which on Windows and macOS is a way to reach the shell. A
    // sandboxed plugin webview (untrusted HTML) can start one by itself (an
    // <a href="smb://…"> it clicks, a location change), and will-navigate
    // only covers the top frame, so guard every frame. The web schemes the
    // UI and plugin webviews legitimately load (http(s) and the in-page
    // about:/data:/blob: documents) are left to proceed; the top frame
    // opening an external web link is handled in will-navigate above.
    contents.on("will-frame-navigate", details => {
        if (!/^(https?|about|data|blob):/i.test(details.url)) details.preventDefault()
    })
}

// Picture in picture: KumoBox's player in a small window on top of the others
// (its /mini page, the episode in its address), at the bottom right of the
// screen KumoBox's window is on, or where the last one was. Its button to go back hands the episode, where
// it's at, to KumoBox's window (pendingPlay until that window asks for it).
let miniWindow = null
let pendingPlay = null

ipcMain.handle("kumobox:mini-open", (_e, page) => {
    const base = serverUrl()
    if (!base || typeof page !== "string" || !/^\/mini#/.test(page)) return false
    // One open already: a new one where it was (only its address's end would
    // change, which doesn't load the page again).
    let bounds = null
    if (miniWindow) {
        bounds = miniWindow.getBounds()
        const old = miniWindow
        miniWindow = null
        old.destroy()
    }
    // Else where the last one was (still on a screen), else in the corner.
    if (!bounds && prefs.mini && [prefs.mini.x, prefs.mini.y, prefs.mini.width, prefs.mini.height].every(Number.isFinite)) {
        const a = screen.getDisplayMatching(prefs.mini).workArea
        if (prefs.mini.x >= a.x - 40 && prefs.mini.y >= a.y - 40 && prefs.mini.x + prefs.mini.width <= a.x + a.width + 40 && prefs.mini.y + prefs.mini.height <= a.y + a.height + 40) bounds = prefs.mini
    }
    const area = screen.getDisplayMatching(mainWindow?.getBounds() ?? screen.getPrimaryDisplay().bounds).workArea
    const width = bounds?.width ?? 480
    const height = bounds?.height ?? 270
    const win = new BrowserWindow({
        width,
        height,
        x: bounds?.x ?? area.x + area.width - width - 24,
        y: bounds?.y ?? area.y + area.height - height - 24,
        minWidth: 320,
        minHeight: 180,
        title: "KumoBox",
        frame: false,
        alwaysOnTop: true,
        fullscreenable: false,
        backgroundColor: "#000000",
        icon: windowIcon(),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: false,
        },
    })
    // Above other apps' windows too (on a Mac, also over full-screen ones).
    win.setAlwaysOnTop(true, "floating")
    if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setAspectRatio(16 / 9)
    keepInside(win.webContents)
    win.on("close", () => {
        prefs.mini = win.getBounds()
        savePrefs()
    })
    win.on("closed", () => {
        if (miniWindow === win) miniWindow = null
    })
    miniWindow = win
    win.loadURL(base + page).catch(() => {})
    return true
})
ipcMain.on("kumobox:mini-close", () => miniWindow?.close())
ipcMain.on("kumobox:mini-expand", (_e, req) => {
    // An episode (see web/src/lib/pip.ts asRequest), small.
    if (!req || typeof req !== "object" || JSON.stringify(req).length > 4096) return
    miniWindow?.close()
    if (mainWindow && !mainWindow.webContents.isLoading()) {
        mainWindow.webContents.send("kumobox:play", req)
        showWindow()
    } else {
        // Opened (or loading): it asks when it's ready.
        pendingPlay = req
        showWindow()
    }
})
ipcMain.handle("kumobox:take-play", () => {
    const req = pendingPlay
    pendingPlay = null
    return req
})

ipcMain.on("kumobox:open-external", (_e, url) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) shell.openExternal(url)
})

ipcMain.handle("kumobox:get-prefs", () => ({ keepRunning: prefs.keepRunning, freeWhenLocked: prefs.freeWhenLocked, startAtLogin: startsAtLogin() }))
// set-pref returns true, or { error } when it couldn't be done.
ipcMain.handle("kumobox:set-pref", (_e, name, value) => {
    if (typeof value !== "boolean") return { error: "not a setting" }
    if (name === "startAtLogin") {
        const error = setStartAtLogin(value)
        return error ? { error } : true
    }
    if (!["keepRunning", "freeWhenLocked"].includes(name)) return { error: "not a setting" }
    prefs[name] = value
    if (name === "keepRunning") prefs.keepRunningChosen = true
    savePrefs()
    updateTray()
    return true
})

ipcMain.on("kumobox:quit", () => app.quit())

// ---------------------------------------------------------------------------
// Updated while running: a package update (makepkg) replaces KumoBox's files
// but not the KumoBox running in the background. Opened again, it restarts into
// the version installed: the server stops asking to be started again
// (exit code 75), and the app does, with its new files.

// installedVersion is the version of the server program on disk ("1.0.94"),
// or "" when it can't be told.
function installedVersion() {
    const bin = findServerBinary()
    if (!bin) return ""
    try {
        const out = execFileSync(bin, ["--version"], { timeout: 5000, windowsHide: true }).toString()
        return (/(\d+\.\d+\.\d+)/.exec(out) || [])[1] || ""
    } catch {
        return ""
    }
}

// serverCall makes a request to a running KumoBox server as its desktop window.
function serverCall(url, method, p) {
    return new Promise(resolve => {
        const req = http.request(url + p, { method, timeout: 3000, headers: { "X-KumoBox-Shell": readToken() || "", "Content-Type": "application/json" } }, res => {
            let body = ""
            res.setEncoding("utf8")
            res.on("data", c => (body += c))
            res.on("end", () => {
                try {
                    resolve(res.statusCode < 300 ? JSON.parse(body || "null") ?? true : null)
                } catch {
                    resolve(null)
                }
            })
        })
        req.on("error", () => resolve(null))
        req.on("timeout", () => {
            req.destroy()
            resolve(null)
        })
        req.end(method === "POST" ? "{}" : undefined)
    })
}

// restartIfOutdated restarts the KumoBox running at url when it's another
// version than the one installed, and reports whether it did.
async function restartIfOutdated(url) {
    // Only a package (Arch) is updated under a running KumoBox: Windows and
    // macOS updates restart it themselves. Not asked there, then (it runs
    // the server program, a moment on each click of the tray or the Dock).
    if (!url || process.platform !== "linux") return false
    const installed = installedVersion()
    const running = (await serverCall(url, "GET", "/api/status"))?.version
    // 1.0.0: built by hand, its version unknown.
    if (!installed || !running || running === "1.0.0" || !olderVersion(running, installed)) return false
    console.log(`KumoBox ${running} is running, ${installed} is installed: restarting into it`)
    return !!(await serverCall(url, "POST", "/api/update/restart"))
}

// olderVersion: a before b ("1.0.139" before "2.0.0").
function olderVersion(a, b) {
    const pa = a.split(".").map(Number)
    const pb = b.split(".").map(Number)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0
        const y = pb[i] || 0
        if (x !== y) return x < y
    }
    return false
}

let restarting = false

// showWindow brings KumoBox's window back, or opens a new one after it was
// closed while KumoBox kept running (the tray's and the Dock's handlers: what
// they pass isn't a page).
function showWindow() {
    return showWindowAt("").catch(err => console.error("couldn't show KumoBox's window:", err))
}

// showWindowAt does, at a page of it when one is given ("/entry?id=1").
async function showWindowAt(page) {
    const base = serverUrl()
    // Still starting: its window (saying so) comes to the front.
    if (!base && mainWindow) {
        mainWindow.show()
        mainWindow.focus()
        return
    }
    if (!base || restarting) return
    // Updated since it started: the new version opens instead (this app
    // starts again with its own server; one it found running restarts by
    // itself, and is back in a moment).
    if (await restartIfOutdated(base)) {
        if (serverProc) {
            restarting = true
            return
        }
        for (let i = 0; i < 40 && !(await ping(base)); i++) await new Promise(r => setTimeout(r, 250))
    }
    if (!mainWindow) return createWindow(page)
    if (page) {
        parkedUrl = null
        mainWindow.loadURL(base + page).catch(() => {})
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
}

// Alerts from the server (a new episode of a show being watched aired, one
// is ready in the library) while the window is closed, or its page let go
// (the computer locked): the page shows them itself otherwise.
let alertsListening = false
function listenForAlerts() {
    if (alertsListening || !baseUrl) return
    alertsListening = true
    let done = false
    const again = () => {
        if (done) return
        done = true
        alertsListening = false
        if (!app.isQuitting) setTimeout(listenForAlerts, 5000)
    }
    const req = http.get(serverUrl() + "/api/events", { headers: { "X-KumoBox-Shell": readToken() || "", Accept: "text/event-stream" } }, res => {
        if (res.statusCode !== 200) {
            res.resume()
            return again()
        }
        res.setEncoding("utf8")
        let buf = ""
        res.on("data", chunk => {
            buf += chunk
            for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
                const data = buf
                    .slice(0, i)
                    .split("\n")
                    .filter(l => l.startsWith("data:"))
                    .map(l => l.slice(5).trimStart())
                    .join("\n")
                buf = buf.slice(i + 2)
                try {
                    const ev = JSON.parse(data)
                    if (ev?.type === "notify") backgroundAlert(ev.payload)
                } catch {
                    // a keep-alive, or not an event
                }
            }
        })
        res.on("end", again)
        res.on("error", again)
    })
    req.on("error", again)
}

function backgroundAlert(a) {
    if ((mainWindow && !parkedUrl) || !Notification.isSupported() || typeof a?.title !== "string") return
    const n = new Notification({ title: a.title, body: String(a.body || "") })
    const id = Number(a.mediaId)
    n.on("click", () => showWindowAt(id > 0 ? `/entry?id=${id}` : "/local").catch(() => {}))
    n.show()
}

// The tray icon, while KumoBox keeps running with its window closed (Windows
// and Linux: on a Mac the Dock icon does it). Without a tray on the
// desktop (GNOME without an extension), opening KumoBox again shows its window.
function updateTray() {
    if (isMac) return
    if (prefs.keepRunning && !tray) {
        const icon = nativeImage.createFromPath(path.join(__dirname, "icon.png"))
        tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 32, height: 32, quality: "best" }))
        tray.setToolTip("KumoBox")
        tray.setContextMenu(
            Menu.buildFromTemplate([
                { label: "Open KumoBox", click: showWindow },
                { type: "separator" },
                { label: "Quit KumoBox", click: () => app.quit() },
            ]),
        )
        tray.on("click", showWindow)
    } else if (!prefs.keepRunning && tray) {
        tray.destroy()
        tray = null
    }
}

// The window was closed and KumoBox keeps running: said once, in a box (a
// notification may be turned off, or missed), with where to find it.
function wentToBackground() {
    if (prefs.toldKeepRunning) return
    prefs.toldKeepRunning = true
    savePrefs()
    const where = isMac
        ? "Click KumoBox in the Dock to open it again, or quit it with Cmd+Q."
        : isWindows
          ? "Open or quit it from its icon at the right of the taskbar (under ^ when it's hidden there). Opening KumoBox again also brings its window back."
          : "Open or quit it from its tray icon (on GNOME, the AppIndicator extension shows it). Opening KumoBox again also brings its window back."
    const answer = dialog.showMessageBoxSync({
        type: "info",
        title: "KumoBox",
        message: "KumoBox keeps running",
        detail: `Streaming to your other devices, downloads and the auto downloader keep going while its window is closed. ${where}\n\nYou can change this in Settings › Desktop app & programs.`,
        buttons: ["OK", "Quit KumoBox"],
        defaultId: 0,
        cancelId: 0,
    })
    if (answer === 1) app.quit()
}

// Locked computer: after a few minutes the window lets go of its page (the
// app's memory, cached images…) and loads it again when the computer is
// unlocked. Not while a video or Settings are open, so nothing is lost.
const PARK_AFTER = 5 * 60_000
const PARKED_PAGE = "data:text/html,<body style='background:%230a0a0b'></body>"
let lockTimer = null
let parkedUrl = null

async function parkPage() {
    if (!prefs.freeWhenLocked || !mainWindow || parkedUrl) return
    const wc = mainWindow.webContents
    let busy = true
    try {
        busy = await wc.executeJavaScript("!!document.querySelector('video') || /^\\/(settings|webview)/.test(location.pathname)")
    } catch {
        /* keep it */
    }
    if (busy || !mainWindow || parkedUrl) return
    parkedUrl = wc.getURL()
    wc.loadURL(PARKED_PAGE).catch(() => {})
}

function unparkPage() {
    clearTimeout(lockTimer)
    if (!parkedUrl) return
    const url = parkedUrl
    parkedUrl = null
    if (mainWindow && isInternal(url)) mainWindow.loadURL(url).catch(() => {})
}

// KumoBox couldn't start: why, the server's last lines, and Try again.
function startupFailed(err) {
    serverProc?.kill()
    serverProc = null
    const detail = [String(err?.message || err), serverLines.length ? "\n" + serverLines.slice(-8).join("\n") : ""].join("\n").trim()
    const answer = dialog.showMessageBoxSync({
        type: "error",
        title: "KumoBox",
        message: "KumoBox couldn't start",
        detail,
        buttons: ["Try again", "Copy details", "Quit"],
        defaultId: 0,
        cancelId: 2,
    })
    if (answer === 1) clipboard.writeText(detail)
    app.isQuitting = true
    if (answer === 0) app.relaunch()
    app.exit(1)
}

async function boot() {
    // Started with the computer: in the background, if KumoBox runs without
    // its window (the tray icon or the Dock opens it). Otherwise the window
    // shows at once, saying KumoBox is starting.
    const withWindow = !(startedAtLogin() && prefs.keepRunning)
    if (withWindow) createWindow("", true)
    try {
        baseUrl = (await existingServer()) || (await startServer())
    } catch (err) {
        startupFailed(err)
        return
    }
    // Wait until the token file exists (written right after startup).
    for (let i = 0; i < 50 && !readToken(); i++) await new Promise(r => setTimeout(r, 100))
    installShellHeader()
    // (Closed while it was starting: it stays closed.)
    if (mainWindow) mainWindow.loadURL(serverUrl()).catch(() => {})
    listenForAlerts()
    updateTray()
    powerMonitor.on("lock-screen", () => {
        clearTimeout(lockTimer)
        lockTimer = setTimeout(parkPage, PARK_AFTER)
    })
    powerMonitor.on("unlock-screen", unparkPage)
    // Brought back some other way (the screen was never locked by the
    // system's own lock, a missed event…).
    app.on("browser-window-focus", unparkPage)
}

// smoke runs the --smoke check (see SMOKE).
async function smoke() {
    const done = code => {
        app.isQuitting = true
        const proc = serverProc
        if (!proc) return app.exit(code)
        const timer = setTimeout(() => {
            proc.kill()
            app.exit(code)
        }, 5000)
        proc.once("exit", () => {
            clearTimeout(timer)
            app.exit(code)
        })
        if (isWindows) proc.stdin?.end()
        else proc.kill("SIGTERM")
    }
    const timer = setTimeout(() => {
        console.error("KumoBox smoke test failed: the server didn't answer within 60 seconds")
        done(1)
    }, 60000)
    try {
        const url = await startServer()
        for (let i = 0; i < 50 && !readToken(); i++) await new Promise(r => setTimeout(r, 100))
        if (!(await ping(url))) throw new Error(`the server at ${url} didn't answer`)
        clearTimeout(timer)
        console.log(`KumoBox smoke test passed: the server answers at ${url} (Electron ${process.versions.electron})`)
        done(0)
    } catch (err) {
        clearTimeout(timer)
        console.error(`KumoBox smoke test failed: ${err?.message || err}`)
        done(1)
    }
}

if (SMOKE) {
    app.whenReady().then(smoke)
} else if (!app.requestSingleInstanceLock()) {
    // KumoBox is running already and shows its window. When it's an older
    // version (updated while it ran in the background), it's asked to
    // restart into this one: versions before this check only know that.
    existingServer()
        .then(restartIfOutdated)
        .catch(() => {})
        .finally(() => app.quit())
} else {
    // Opening KumoBox again shows its window, also after it was closed while
    // KumoBox kept running.
    app.on("second-instance", (_e, argv) => {
        // Started with the computer while already running: nothing to show.
        if (!argv.includes(BACKGROUND)) showWindow()
    })
    app.on("activate", showWindow) // the Dock icon (macOS)
    app.whenReady()
        .then(() => {
            loadPrefs()
            // The title bar and the system's menus in the app's dark colors,
            // whatever the system's own are.
            nativeTheme.themeSource = "dark"
            Menu.setApplicationMenu(appMenu())
            return boot()
        })
        .catch(startupFailed)
    app.on("window-all-closed", () => {
        if (!prefs.keepRunning || app.isQuitting) return app.quit()
        wentToBackground()
    })
    app.on("before-quit", event => {
        app.isQuitting = true
        if (!serverProc) return
        if (!isWindows) {
            serverProc.kill("SIGTERM")
            return
        }
        // Windows: closing its input lets the server stop what it started
        // (mpv, ffmpeg) and save; quit once it's gone, or after 5 seconds.
        // kill() would end it at once.
        event.preventDefault()
        const proc = serverProc
        const timer = setTimeout(() => proc.kill(), 5000)
        proc.once("exit", () => {
            clearTimeout(timer)
            serverProc = null
            app.quit()
        })
        proc.stdin?.end()
    })
}
