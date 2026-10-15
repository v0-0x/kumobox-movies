// KumoBox desktop shell.
//
// Starts the KumoBox server (bound to 127.0.0.1) or attaches to one that is
// already running, then shows the UI in a native window. Every request the
// window makes carries the per-run shell token, which is how the server
// recognises its own desktop window when the browser Web UI is turned off.

const { app, BrowserWindow, ipcMain, shell, session, Menu, dialog, nativeImage, Tray, Notification, powerMonitor } = require("electron")
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

// The desktop app's own preferences (Settings › App › Desktop app), kept
// next to its browser data.
//   keepRunning     closing the window leaves KumoBox running (tray icon, or the
//                   Dock on a Mac): streaming to other devices, downloads and
//                   the auto downloader keep going without the window's
//                   memory. Off unless turned on (keepRunningChosen: it was
//                   on by default for a while, and that doesn't count).
//   freeWhenLocked  a few minutes after the computer is locked, the window
//                   lets go of its page, and loads it again on unlocking.
//   toldKeepRunning the notice about it was shown (the first time).
const prefs = { keepRunning: false, keepRunningChosen: false, freeWhenLocked: true, toldKeepRunning: false }
const prefsFile = () => path.join(app.getPath("userData"), "desktop.json")

function loadPrefs() {
    const saved = readJSON(prefsFile()) || {}
    for (const k of Object.keys(prefs)) if (typeof saved[k] === typeof prefs[k]) prefs[k] = saved[k]
    if (!prefs.keepRunningChosen) prefs.keepRunning = false
}

function savePrefs() {
    try {
        fs.mkdirSync(path.dirname(prefsFile()), { recursive: true })
        fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2))
    } catch (err) {
        console.error("desktop preferences:", err)
    }
}

// Starting with the computer (Settings › App › Desktop app), off unless
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
        return "macOS asks you to allow it: System Settings › General › Login Items, turn on KumoBox."
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

function startServer() {
    return new Promise((resolve, reject) => {
        const bin = findServerBinary()
        if (!bin) {
            const msg = isWindows
                ? "Could not find the KumoBox server (kumobox.exe). Reinstall KumoBox or set KUMOBOX_SERVER."
                : isMac
                  ? "Could not find the KumoBox server in the app. Download KumoBox again or set KUMOBOX_SERVER."
                  : "Could not find the KumoBox server binary (kumobox). Reinstall the package or set KUMOBOX_SERVER."
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
            const m = /listening on http:\/\/([\d.]+):(\d+)/.exec(text)
            if (m && !resolved) {
                resolved = true
                resolve(`http://127.0.0.1:${m[2]}`)
            }
            if (/could not start the server/.test(text) && !resolved) {
                resolved = true
                reject(new Error(text.trim()))
            }
        }
        serverProc.stdout.on("data", onData)
        serverProc.stderr.on("data", onData)
        serverProc.on("exit", code => {
            // The server stopped for an update: no error box. After an
            // update was installed, the whole app starts again, so that its
            // window loads the new main.js too. On Windows an installer is
            // replacing KumoBox, and starts it when it's done; on macOS the
            // server has put the new app in place, and a helper opens it once
            // this one has quit.
            if (code === EXIT_RESTART || code === EXIT_INSTALLING) {
                serverProc = null
                app.isQuitting = true
                if (code === EXIT_RESTART) app.relaunch()
                app.exit(0)
                return
            }
            if (!resolved) reject(new Error(`The KumoBox server exited (code ${code}).`))
            serverProc = null
            if (resolved && !app.isQuitting) {
                const msg = "The KumoBox server stopped unexpectedly. Restart KumoBox to continue."
                if (mainWindow) {
                    dialog.showErrorBox("KumoBox", msg)
                    return
                }
                // Running without a window: no box that would hold up a
                // shutdown (Windows stops the server first), just a notice.
                if (Notification.isSupported()) new Notification({ title: "KumoBox stopped", body: msg }).show()
                app.isQuitting = true
                app.quit()
            }
        })
        setTimeout(() => {
            if (!resolved) {
                resolved = true
                reject(new Error("The KumoBox server did not start in time."))
            }
        }, 30000)
    })
}

// allowedTokenOrigin is the one origin the shell token may be sent to: the
// KumoBox server this window talks to. The port can change in Settings, so it
// is read from server.json (which the server keeps current) with a short
// cache, falling back to the origin the window booted from.
let allowedTokenOrigin = null
let allowedTokenAt = 0

function kumoboxOrigin() {
    const now = Date.now()
    if (now - allowedTokenAt > 1000) {
        allowedTokenAt = now
        const port = readJSON(path.join(runtimeDir, "server.json"))?.port
        if (port) allowedTokenOrigin = `http://127.0.0.1:${port}`
        else
            try {
                allowedTokenOrigin = baseUrl ? new URL(baseUrl).origin : null
            } catch {
                allowedTokenOrigin = null
            }
    }
    return allowedTokenOrigin
}

function installShellHeader() {
    const filter = { urls: ["http://127.0.0.1/*", "http://127.0.0.1:*/*"] }
    session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
        // Only KumoBox's own server gets the shell token, which grants full
        // desktop-window rights. Another local service the page or a plugin
        // makes the window request — a logo, script or stream at a different
        // 127.0.0.1 port — must never receive it, or it could turn around and
        // drive the API as the trusted window.
        let origin = null
        try {
            origin = new URL(details.url).origin
        } catch {
            /* leave null */
        }
        const token = readToken()
        if (token && origin && origin === kumoboxOrigin()) details.requestHeaders["X-KumoBox-Shell"] = token
        cb({ requestHeaders: details.requestHeaders })
    })
}

function isInternal(url) {
    // Any port on 127.0.0.1 is KumoBox (the port can be changed in Settings).
    return /^http:\/\/127\.0\.0\.1(:\d+)?\//.test(url)
}

// macOS keeps the app's menu in the menu bar, and the standard shortcuts
// (copy and paste, Cmd+Q, Cmd+W, full screen…) only work through its items.
// Linux and Windows show no menu.
function appMenu() {
    if (!isMac) return null
    return Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }])
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

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 1000,
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
    Menu.setApplicationMenu(appMenu())
    mainWindow.once("ready-to-show", () => mainWindow.show())

    // External links open in the system browser; the app never navigates away.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url) && !isInternal(url)) shell.openExternal(url)
        return { action: "deny" }
    })
    mainWindow.webContents.on("will-navigate", (e, url) => {
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
    mainWindow.webContents.on("will-frame-navigate", details => {
        if (!/^(https?|about|data|blob):/i.test(details.url)) details.preventDefault()
    })
    mainWindow.webContents.on("before-input-event", (_e, input) => {
        if (input.type === "keyDown" && input.key === "F11") mainWindow.setFullScreen(!mainWindow.isFullScreen())
        if (input.type === "keyDown" && input.control && input.shift && input.key.toLowerCase() === "i") mainWindow.webContents.toggleDevTools()
        if (input.type === "keyDown" && input.control && input.key.toLowerCase() === "r") mainWindow.webContents.reload()
    })
    mainWindow.on("closed", () => {
        mainWindow = null
        parkedUrl = null
    })
    // Windows is shutting down or signing out, which stops the server too:
    // that isn't worth an error box (the event only exists on Windows).
    mainWindow.on("query-session-end", () => (app.isQuitting = true))
    mainWindow.loadURL(baseUrl)
}

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
    if (!url) return false
    const installed = installedVersion()
    const running = (await serverCall(url, "GET", "/api/status"))?.version
    if (!installed || !running || installed === running) return false
    console.log(`KumoBox ${running} is running, ${installed} is installed: restarting into it`)
    return !!(await serverCall(url, "POST", "/api/update/restart"))
}

let restarting = false

// showWindow brings KumoBox's window back, or opens a new one after it was
// closed while KumoBox kept running.
async function showWindow() {
    if (!baseUrl || restarting) return
    // Updated since it started: the new version opens instead.
    if (await restartIfOutdated(baseUrl)) {
        restarting = true
        return
    }
    if (!mainWindow) return createWindow()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
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

// The window was closed and KumoBox keeps running: say so, the first time.
function wentToBackground() {
    if (prefs.toldKeepRunning || !Notification.isSupported()) return
    prefs.toldKeepRunning = true
    savePrefs()
    new Notification({
        title: "KumoBox is still running",
        body: isMac
            ? "Streaming to your other devices and downloads keep going. Click KumoBox in the Dock to open it, or quit it with Cmd+Q."
            : "Streaming to your other devices and downloads keep going. Open or quit KumoBox from its tray icon.",
    }).show()
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
    wc.loadURL(PARKED_PAGE)
}

function unparkPage() {
    clearTimeout(lockTimer)
    if (!parkedUrl) return
    const url = parkedUrl
    parkedUrl = null
    if (mainWindow && isInternal(url)) mainWindow.loadURL(url)
}

async function boot() {
    try {
        baseUrl = (await existingServer()) || (await startServer())
    } catch (err) {
        dialog.showErrorBox("KumoBox could not start", String(err?.message || err))
        app.exit(1)
        return
    }
    // Wait until the token file exists (written right after startup).
    for (let i = 0; i < 50 && !readToken(); i++) await new Promise(r => setTimeout(r, 100))
    installShellHeader()
    // Started with the computer: in the background, if KumoBox runs without
    // its window (the tray icon or the Dock opens it).
    if (!(startedAtLogin() && prefs.keepRunning)) createWindow()
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
    app.whenReady().then(() => {
        loadPrefs()
        return boot()
    })
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
