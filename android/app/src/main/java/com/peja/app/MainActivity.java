package com.peja.app;

import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String REMOTE_URL = "https://peja.vercel.app";
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            WebView webView = this.bridge.getWebView();
            WebSettings webSettings = webView.getSettings();

            webSettings.setDomStorageEnabled(true);
            webSettings.setDatabaseEnabled(true);
            webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);

            String dbPath = getApplicationContext().getDir("database", MODE_PRIVATE).getPath();
            webSettings.setDatabasePath(dbPath);

            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(webView, true);
            cookieManager.flush();

            // Use custom WebViewClient that extends Capacitor's own
            webView.setWebViewClient(new PejaWebViewClient(this.bridge));

            // Auto-reload when network comes back
            registerNetworkCallback(webView);

        } catch (Exception e) {
            // Bridge may not be ready yet
        }
    }

    private void registerNetworkCallback(WebView webView) {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return;

            NetworkRequest request = new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                    .build();

            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    super.onAvailable(network);
                    runOnUiThread(() -> {
                        try {
                            String currentUrl = webView.getUrl();
                            if (currentUrl != null && currentUrl.contains("offline.html")) {
                                webView.loadUrl(REMOTE_URL);
                            }
                        } catch (Exception e) {
                            // ignore
                        }
                    });
                }
            };

            cm.registerNetworkCallback(request, networkCallback);
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

    @Override
    public void onDestroy() {
        super.onDestroy();
        try {
            if (networkCallback != null) {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
                if (cm != null) {
                    cm.unregisterNetworkCallback(networkCallback);
                }
            }
        } catch (Exception e) {
            // ignore
        }
    }
}