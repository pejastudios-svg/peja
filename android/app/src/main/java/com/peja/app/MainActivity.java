package com.peja.app;

import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SOSLocationPlugin.class);
        super.onCreate(savedInstanceState);

        try {
            WebView webView = this.bridge.getWebView();
            WebSettings webSettings = webView.getSettings();

            webSettings.setDomStorageEnabled(true);
            webSettings.setDatabaseEnabled(true);
            webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);

            String dbPath = getApplicationContext().getDir("database", MODE_PRIVATE).getPath();
            webSettings.setDatabasePath(dbPath);
            webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(webView, true);
            cookieManager.flush();

            // Set dark background so no white/ugly flash ever shows
            webView.setBackgroundColor(Color.parseColor("#0c0818"));
            getWindow().getDecorView().setBackgroundColor(Color.parseColor("#0c0818"));

            // Check connectivity IMMEDIATELY — if offline, load our branded
            // page before the WebView can render "Webpage not available"
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            boolean online = false;
            Network network = cm.getActiveNetwork();
            if (network != null) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(network);
                online = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            }

            if (!online) {
                webView.stopLoading();
                webView.loadUrl("file:///android_asset/public/offline.html");
            }

        } catch (Exception e) {
            // Bridge may not be ready yet
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