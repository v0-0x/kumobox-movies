package app.kumobox;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * Installs an update: the APK of a newer KumoBox, which the server downloaded
 * (and checked) into the app's own files. Android shows what it installs and
 * asks first; the answer comes back to MainActivity (ACTION).
 */
final class Installer {
    static final String ACTION = "app.kumobox.INSTALL_STATUS";

    // The answer carries a secret only this app knows (other apps can start
    // MainActivity with ACTION too).
    private static final String EXTRA_SECRET = "app.kumobox.SECRET";

    private Installer() {
    }

    /** Whether an install answer comes from an install KumoBox asked for. */
    static boolean isOurs(Context ctx, Intent intent) {
        String got = intent.getStringExtra(EXTRA_SECRET);
        return got != null && MessageDigest.isEqual(got.getBytes(), secret(ctx).getBytes());
    }

    private static synchronized String secret(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences("kumobox", Context.MODE_PRIVATE);
        String s = prefs.getString("install-secret", null);
        if (s == null) {
            byte[] b = new byte[16];
            new SecureRandom().nextBytes(b);
            StringBuilder hex = new StringBuilder();
            for (byte x : b) hex.append(String.format("%02x", x));
            s = hex.toString();
            prefs.edit().putString("install-secret", s).commit();
        }
        return s;
    }

    static void install(Activity a, String path) {
        File apk;
        try {
            apk = new File(path).getCanonicalFile();
            // Only an APK in KumoBox's own files.
            String own = a.getApplicationInfo().dataDir;
            String ownCache = a.getCacheDir().getCanonicalPath();
            String p = apk.getPath();
            if (!p.endsWith(".apk") || !(p.startsWith(new File(own).getCanonicalPath() + File.separator) || p.startsWith(ownCache + File.separator)) || !apk.isFile()) {
                Toast.makeText(a, "That isn't an KumoBox update.", Toast.LENGTH_LONG).show();
                return;
            }
        } catch (IOException e) {
            Toast.makeText(a, "Can't read the update: " + e.getMessage(), Toast.LENGTH_LONG).show();
            return;
        }
        // Android 8+: KumoBox needs the user's permission to install apps.
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
            try {
                a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
                Toast.makeText(a, "Allow KumoBox to install apps, then press Install again.", Toast.LENGTH_LONG).show();
            } catch (Exception e) {
                // No such screen (a Fire TV): where it is, said until OK is
                // pressed (a toast goes before it's read on a TV).
                new AlertDialog.Builder(a)
                        .setTitle("Allow KumoBox to install its updates")
                        .setMessage("Turn on installing unknown apps for KumoBox. On a Fire TV: Settings › My Fire TV › Developer options › Install unknown apps › KumoBox.\n\nThen press Install again.")
                        .setPositiveButton("OK", null)
                        .show();
            }
            return;
        }
        // Once at a time: pressed twice, Android would ask twice.
        if (copying) {
            Toast.makeText(a, "Handing the update to Android…", Toast.LENGTH_SHORT).show();
            return;
        }
        copying = true;
        // Copied to Android's installer away from the screen's thread (an
        // APK of tens of MB takes a while on a TV), which then asks.
        final File file = apk;
        final Context app = a.getApplicationContext();
        Toast.makeText(a, "Handing the update to Android…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            String failed;
            try {
                failed = copy(app, file);
            } finally {
                copying = false;
            }
            if (failed != null) {
                final String why = failed;
                new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(app, why, Toast.LENGTH_LONG).show());
            }
        }, "kumobox-install").start();
    }

    // An APK being handed to Android's installer.
    private static volatile boolean copying;

    /** Android's answer to an install, said plainly; null: nothing to say (it was cancelled, or worked). */
    static String explain(int status, String detail) {
        switch (status) {
            case PackageInstaller.STATUS_SUCCESS:
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                return null;
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                return "This update can't replace the KumoBox installed here (it was signed differently). Uninstall KumoBox, then install the new one.";
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                return "There isn't enough space for the update. Free some, then press Install again.";
            case PackageInstaller.STATUS_FAILURE_BLOCKED:
                return "Android blocked the update.";
            default:
                return "The update wasn't installed" + (detail == null || detail.isEmpty() ? "." : ": " + detail);
        }
    }

    /** Hands the APK to Android's installer; what went wrong, or null. */
    private static String copy(Context a, File apk) {
        PackageInstaller installer = a.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(a.getPackageName());
        PackageInstaller.Session session = null;
        try {
            int id = installer.createSession(params);
            session = installer.openSession(id);
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("kumobox.apk", 0, apk.length())) {
                byte[] buf = new byte[256 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent back = new Intent(a, MainActivity.class).setAction(ACTION).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(EXTRA_SECRET, secret(a));
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            // The installer adds the result to it.
            if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent result = PendingIntent.getActivity(a, id, back, flags);
            session.commit(result.getIntentSender());
            session.close();
            session = null;
            return null;
        } catch (IOException | RuntimeException e) {
            if (session != null) session.abandon();
            return "The update couldn't be installed: " + e.getMessage();
        }
    }
}
