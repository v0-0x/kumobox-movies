package app.kumobox;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.ActivityInfo;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * KumoBox for Android, made for TVs (a Fire TV Stick) and the libraries the
 * computers at home share: it runs KumoBox's server (KumoBoxServer) and shows its
 * web UI, which on a TV is driven by the remote (TV mode, web/src/lib/tv.ts).
 */
public class MainActivity extends Activity {
    private final Handler main = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private TextView message;
    private ScrollView messageScroll;
    // The starting screen's logo and spinner (gone for an error).
    private ImageView logo;
    private ProgressBar spinner;
    // The page didn't load (it isn't shown, see onPageFinished).
    private boolean pageFailed;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenDone;
    private WifiManager.MulticastLock multicast;
    private boolean loaded;
    private boolean starting;
    private boolean resumed;
    // Checks the server runs, while KumoBox shows (see watch).
    private final Runnable watcher = this::watch;

    // The window's color: the page's (its --frame), so nothing flashes a
    // different black between the start and KumoBox showing.
    static final int FRAME = Color.rgb(10, 10, 11);

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(FRAME);
        web = newWebView();
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // The starting screen: the logo, a spinner and what's happening;
        // or why KumoBox didn't start (scrolling, with the server's last lines).
        float dp = getResources().getDisplayMetrics().density;
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        logo = new ImageView(this);
        logo.setImageDrawable(getApplicationInfo().loadIcon(getPackageManager()));
        box.addView(logo, new LinearLayout.LayoutParams((int) (72 * dp), (int) (72 * dp)));
        spinner = new ProgressBar(this);
        spinner.setIndeterminate(true);
        spinner.setIndeterminateTintList(ColorStateList.valueOf(Color.rgb(124, 108, 242)));
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams((int) (28 * dp), (int) (28 * dp));
        sp.topMargin = (int) (28 * dp);
        box.addView(spinner, sp);
        message = new TextView(this);
        message.setTextColor(Color.rgb(230, 230, 235));
        message.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        message.setGravity(Gravity.CENTER);
        int pad = (int) (32 * dp);
        message.setPadding(pad, (int) (16 * dp), pad, pad);
        message.setText("Starting KumoBox…");
        // A tap tries again (phones have no OK key).
        message.setOnClickListener(v -> retry());
        box.addView(message, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        messageScroll = new ScrollView(this);
        messageScroll.setFillViewport(true);
        messageScroll.setBackgroundColor(FRAME);
        messageScroll.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(messageScroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // The other KumoBox apps announce themselves by multicast, which Wi-Fi
        // drops for apps without this.
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) {
            multicast = wifi.createMulticastLock("kumobox");
            multicast.setReferenceCounted(false);
            multicast.acquire();
        }
        startServer();
        onNewIntent(getIntent());
    }

    private WebView newWebView() {
        WebView w = new WebView(this);
        w.setBackgroundColor(FRAME);
        w.setVisibility(View.INVISIBLE);
        setUpWebView(w);
        return w;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setUpWebView(final WebView web) {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // The page's viewport decides the layout width (on a TV, wider than
        // the WebView's own: everything smaller, see web/src/lib/tv.ts),
        // scaled to fit the screen.
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        // A TV has its own text size (tv.ts): Android's font size setting
        // would only make the labels overflow their buttons.
        if (isTV()) s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " KumoBoxAndroid/" + versionName() + (isTV() ? " KumoBoxTV" : ""));
        web.addJavascriptInterface(new Bridge(), "KumoBoxAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return leave(req.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return leave(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Not the WebView's own error page, if KumoBox's didn't load.
                if (!loaded && !pageFailed && url.startsWith(KumoBoxServer.URL)) {
                    loaded = true;
                    web.setVisibility(View.VISIBLE);
                    messageScroll.setVisibility(View.GONE);
                    web.requestFocus();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame() || loaded) return;
                pageFailed = true;
                if (!KumoBoxServer.get(MainActivity.this).running()) restartServer("Starting KumoBox…");
                else failed("KumoBox's page didn't open: " + err.getDescription());
            }

            // The page's process crashed (or Android ended it for memory):
            // a new WebView, the page opened again, rather than KumoBox closing.
            @TargetApi(26)
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view != MainActivity.this.web) return true;
                Log.e("kumobox", "the page stopped" + (detail.didCrash() ? " (crashed)" : "") + ": opening it again");
                exitFullscreen();
                letScreenSleep();
                root.removeView(view);
                view.destroy();
                MainActivity.this.web = newWebView();
                root.addView(MainActivity.this.web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                loaded = false;
                messageScroll.setVisibility(View.VISIBLE);
                showMessage("Opening KumoBox again…", false);
                if (KumoBoxServer.get(MainActivity.this).running()) openPage(KumoBoxServer.get(MainActivity.this));
                else startServer();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // Black until a video's first frame (Android draws a grey
            // picture with a play button otherwise).
            @Override
            public Bitmap getDefaultVideoPoster() {
                Bitmap b = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
                b.eraseColor(Color.BLACK);
                return b;
            }

            // The player's fullscreen (on a phone; a TV is all screen).
            @Override
            public void onShowCustomView(View view, CustomViewCallback done) {
                exitFullscreen();
                fullscreen = view;
                fullscreenDone = done;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                web.setVisibility(View.INVISIBLE);
                // The whole screen, sideways: the bars hide until swiped in.
                if (!isTV()) {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                    hideSystemBars(true);
                }
            }

            @Override
            public void onHideCustomView() {
                exitFullscreen();
            }
        });
    }

    /** Only KumoBox's pages show here: anything else (TMDB, Letterboxd, GitHub…) opens in a browser, if there's one, so the bridge stays KumoBox's own. */
    private boolean leave(Uri u) {
        if ("127.0.0.1".equals(u.getHost()) && u.getPort() == KumoBoxServer.PORT) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (Exception e) {
            Toast.makeText(this, "No app here opens " + u.getHost(), Toast.LENGTH_LONG).show();
        }
        return true;
    }

    private void exitFullscreen() {
        if (fullscreen == null) return;
        root.removeView(fullscreen);
        fullscreen = null;
        if (fullscreenDone != null) fullscreenDone.onCustomViewHidden();
        fullscreenDone = null;
        web.setVisibility(View.VISIBLE);
        if (!isTV()) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            hideSystemBars(false);
        }
    }

    /** The system's bars hidden (a video's fullscreen on a phone), or back. */
    @SuppressWarnings("deprecation")
    private void hideSystemBars(boolean on) {
        getWindow().getDecorView().setSystemUiVisibility(on
                ? View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                : 0);
    }

    /** Starts the server if needed, and shows KumoBox once it answers. */
    private void startServer() {
        if (starting) return;
        starting = true;
        final KumoBoxServer server = KumoBoxServer.get(this);
        new Thread(() -> {
            String failure = null;
            try {
                server.start();
                long until = System.currentTimeMillis() + 40_000;
                while (!server.ready()) {
                    if (!server.running()) {
                        failure = "KumoBox's server stopped.\n\n" + server.whyStopped();
                        break;
                    }
                    if (System.currentTimeMillis() > until) {
                        String lines = server.lastLines();
                        failure = "KumoBox's server doesn't answer." + (lines.isEmpty() ? "" : "\n\n" + lines);
                        break;
                    }
                    Thread.sleep(250);
                }
            } catch (Exception e) {
                failure = "KumoBox's server couldn't start: " + e.getMessage();
            }
            final String error = failure;
            main.post(() -> {
                starting = false;
                if (error != null) {
                    failed(error);
                    return;
                }
                showMessage("Starting KumoBox…", false);
                openPage(server);
            });
        }, "kumobox-start").start();
    }

    /** The screen may turn off again: the player that kept it on is gone with
     * its page (it says so itself when it closes, but a page that stopped or
     * is opened again can't). */
    private void letScreenSleep() {
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /** Why KumoBox didn't open, and how to try again: first, then the details. */
    private void failed(String why) {
        Log.e("kumobox", why);
        String how = isTV() ? "Press OK to try again, or Back to close." : "Tap here to try again, or go back to close.";
        showMessage("KumoBox couldn't start.\n" + how + "\n\n" + why, true);
    }

    /** OK, or a tap, on why KumoBox didn't start: again. */
    private void retry() {
        if (loaded || starting) return;
        showMessage("Starting KumoBox…", false);
        startServer();
    }

    /** Opens KumoBox's page (the server answers). */
    private void openPage(KumoBoxServer server) {
        pageFailed = false;
        letScreenSleep();
        // The cookie that proves the WebView is KumoBox's (KumoBoxServer.token).
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setCookie(KumoBoxServer.URL, "kumobox_shell=" + server.token() + "; Path=/; HttpOnly; SameSite=Strict");
        cookies.flush();
        web.loadUrl(KumoBoxServer.URL);
    }

    /** The server stopped: the starting screen, and the server again. */
    private void restartServer(String why) {
        letScreenSleep();
        loaded = false;
        web.setVisibility(View.INVISIBLE);
        messageScroll.setVisibility(View.VISIBLE);
        showMessage(why, false);
        startServer();
    }

    /** While KumoBox shows: the server stopped (crashed, or Android ended it), it's started again. */
    private void watch() {
        main.removeCallbacks(watcher);
        if (!resumed) return;
        if (loaded && !starting && !KumoBoxServer.get(this).running()) {
            Log.e("kumobox", "the server stopped: starting it again");
            restartServer("KumoBox's server stopped: starting it again…");
        }
        main.postDelayed(watcher, 5000);
    }

    /** The screen before KumoBox shows: starting, or why it didn't. */
    private void showMessage(String text, boolean error) {
        message.setText(text);
        // An error has the details (the server's last lines): smaller, from the top, scrolling.
        message.setTextSize(TypedValue.COMPLEX_UNIT_SP, error ? 15 : 18);
        message.setGravity(error ? Gravity.START | Gravity.TOP : Gravity.CENTER);
        logo.setVisibility(error ? View.GONE : View.VISIBLE);
        spinner.setVisibility(error ? View.GONE : View.VISIBLE);
        ((LinearLayout) message.getParent()).setGravity(error ? Gravity.START | Gravity.TOP : Gravity.CENTER);
        messageScroll.scrollTo(0, 0);
        // The remote's Up and Down scroll it.
        if (error) messageScroll.requestFocus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        web.onResume();
        // Back from the home screen: the page syncs with the computers (Auto-Sync).
        js("window.kumoboxResumed&&window.kumoboxResumed()");
        // Android may have stopped it while KumoBox was in the background.
        if (!starting && !KumoBoxServer.get(this).running()) restartServer("Starting KumoBox…");
        main.postDelayed(watcher, 5000);
    }

    /** Home pressed, or another app on top: a video playing pauses (its position is saved). */
    @Override
    protected void onPause() {
        resumed = false;
        main.removeCallbacks(watcher);
        js("document.querySelectorAll('video').forEach(function(v){v.pause()})");
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacks(watcher);
        if (multicast != null && multicast.isHeld()) multicast.release();
        if (isFinishing()) KumoBoxServer.get(this).stop();
        web.destroy();
        super.onDestroy();
    }

    // ------------------------------------------------------------------ keys

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        switch (code) {
            case KeyEvent.KEYCODE_BACK:
                // On release, once: a long press doesn't go back twice.
                if (!down && !e.isCanceled()) back();
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                if (down && e.getRepeatCount() == 0) js("window.kumoboxKey&&window.kumoboxKey('playpause')");
                return true;
            // Play and Pause, on remotes that have both: only that.
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                if (down && e.getRepeatCount() == 0) js("window.kumoboxKey&&window.kumoboxKey('play')");
                return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                if (down && e.getRepeatCount() == 0) js("window.kumoboxKey&&window.kumoboxKey('pause')");
                return true;
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                // The next episode.
                if (down && e.getRepeatCount() == 0) js("window.kumoboxKey&&window.kumoboxKey('next')");
                return true;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                // The episode from its start.
                if (down && e.getRepeatCount() == 0) js("window.kumoboxKey&&window.kumoboxKey('previous')");
                return true;
            case KeyEvent.KEYCODE_MEDIA_STOP:
                // The player closes.
                if (down && e.getRepeatCount() == 0) js("window.kumoboxKey&&window.kumoboxKey('stop')");
                return true;
            case KeyEvent.KEYCODE_CAPTIONS:
                // Subtitles on or off.
                if (down && e.getRepeatCount() == 0) js("window.kumoboxKey&&window.kumoboxKey('captions')");
                return true;
            case KeyEvent.KEYCODE_MENU:
                // ☰: what a right-click opens.
                if (down && e.getRepeatCount() == 0) js("window.kumoboxKey&&window.kumoboxKey('menu')");
                return true;
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                if (down) js("window.kumoboxKey&&window.kumoboxKey('rewind')");
                return true;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                if (down) js("window.kumoboxKey&&window.kumoboxKey('forward')");
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                // KumoBox didn't start: OK tries again.
                if (!loaded && !starting && down) {
                    retry();
                    return true;
                }
                // Held down: pressed once, not again and again.
                if (loaded && down && e.getRepeatCount() > 0) return true;
                break;
            default:
                break;
        }
        return super.dispatchKeyEvent(e);
    }

    /**
     * Back: the page closes what's open or goes back; at Home, KumoBox goes to
     * the background (to the TV's home), its server still there: opened
     * again, it's as it was, and the other devices still reach it.
     */
    private void back() {
        if (fullscreen != null) {
            exitFullscreen();
            return;
        }
        if (!loaded) {
            finish();
            return;
        }
        web.evaluateJavascript("(window.kumoboxBack&&window.kumoboxBack())?1:0", v -> {
            if (!"1".equals(v)) moveTaskToBack(true);
        });
    }

    private void js(String code) {
        if (loaded) web.evaluateJavascript(code, null);
    }

    // ------------------------------------------------------------ the bridge

    /** What the page asks of the app (window.KumoBoxAndroid). */
    private final class Bridge {
        /** Keeps the screen on while a video plays. */
        @JavascriptInterface
        public void keepAwake(final boolean on) {
            main.post(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        /** Installs an update the server downloaded (Android asks first). */
        @JavascriptInterface
        public void installApk(final String path) {
            main.post(() -> Installer.install(MainActivity.this, path));
        }
    }

    // Android answers an install here (Installer).
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null || !Installer.ACTION.equals(intent.getAction())) return;
        // Only the answer to an install KumoBox asked for: any app may start
        // this activity, and have it start what it gives (EXTRA_INTENT).
        if (!Installer.isOurs(this, intent)) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) startActivity(confirm);
        } else {
            String msg = Installer.explain(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
            if (msg != null) Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
        }
    }

    private boolean isTV() {
        UiModeManager ui = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        PackageManager pm = getPackageManager();
        return (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION)
                || pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
                || pm.hasSystemFeature("amazon.hardware.fire_tv");
    }

    private String versionName() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "0";
        }
    }
}
