package com.peja.app;

import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SOSLocationPlugin.class);
        // SML (Share My Location) drives the safety check-in foreground
        // service. Without this registration the JS bridge call silently
        // rejects and CheckInMonitor falls back to foreground-only web
        // tracking — so location stopped updating once the app was
        // backgrounded. Mirror the SOS registration above.
        registerPlugin(SMLLocationPlugin.class);
        registerPlugin(AmbientLocationPlugin.class);
        // Battery-optimization + background-location helpers used by the
        // top banner and the session-start readiness prompt.
        registerPlugin(DeviceSettingsPlugin.class);

        // Read the user's saved theme (written by the web layer via
        // @capacitor/preferences, which stores under the "CapacitorStorage"
        // SharedPreferences file). Defaults to dark when nothing is saved yet
        // (e.g. first-ever launch). Must run BEFORE super.onCreate() so the
        // splash screen installs with the matching theme — otherwise
        // light-mode users see the hard-coded dark splash flash on every open.
        SharedPreferences capPrefs = getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
        boolean isLightTheme = "light".equals(capPrefs.getString("peja-theme", "dark"));
        if (isLightTheme) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Light);
        }

        super.onCreate(savedInstanceState);

        int themeBg = isLightTheme ? Color.parseColor("#ffffff") : Color.parseColor("#0c0818");

        try {
            WebView webView = this.bridge.getWebView();
            WebSettings webSettings = webView.getSettings();

            webSettings.setDomStorageEnabled(true);
            webSettings.setDatabaseEnabled(true);
            webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);

            // NOTE: we intentionally do NOT clearCache() on launch. New deploys
            // already propagate correctly — HTML is served no-store (always
            // refetched online) and JS/CSS are content-hash addressed (a new
            // build = new URLs, so stale chunks are never requested). Wiping the
            // cache only discarded the immutable assets the WebView could serve
            // offline, which the Service Worker's internal fetch() relies on —
            // a cause of the "raw / unstyled" offline cold-opens.

            String dbPath = getApplicationContext().getDir("database", MODE_PRIVATE).getPath();
            webSettings.setDatabasePath(dbPath);
            webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(webView, true);
            cookieManager.flush();

            // Paint the WebView + window background in the saved theme so the
            // brief gap between the splash hiding and the web content painting
            // matches (no dark flash on light mode, no white flash on dark).
            webView.setBackgroundColor(themeBg);
            getWindow().getDecorView().setBackgroundColor(themeBg);


        } catch (Exception e) {
            // Bridge may not be ready yet
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // `adjustResize` (see AndroidManifest windowSoftInputMode) shrinks the
        // window when the IME shows. If the app is backgrounded while the
        // keyboard is open (app switch, notification shade, recents), the OS
        // sometimes fails to grow the content back on resume, leaving the
        // WebView short with a dark band where the keyboard used to be — the
        // "black thing covering half the screen". A JS resize event can't fix
        // this: the bounds are owned by the native window, not the WebView.
        // Forcing a fresh window-insets dispatch + relayout recomputes the
        // content frame against the now-hidden IME and restores full height.
        try {
            final View decor = getWindow().getDecorView();
            decor.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        decor.requestApplyInsets();
                        decor.requestLayout();
                        if (bridge != null && bridge.getWebView() != null) {
                            bridge.getWebView().requestLayout();
                        }
                    } catch (Exception ignored) {
                    }
                }
            });
        } catch (Exception e) {
            // ignore
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        try {
            CookieManager.getInstance().flush();
        } catch (Exception e) {
            // ignore
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        try {
            CookieManager.getInstance().flush();
        } catch (Exception e) {
            // ignore
        }
    }
}