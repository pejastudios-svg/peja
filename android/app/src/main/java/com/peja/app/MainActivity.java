package com.peja.app;

import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String REMOTE_URL = "https://peja.vercel.app";
    private static final String OFFLINE_PAGE = "file:///android_asset/public/offline.html";
    private boolean isShowingOffline = false;
    private boolean hasLoadedSuccessfully = false;
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

            // Set up WebViewClient to catch loading errors
            webView.setWebViewClient(new WebViewClient() {

                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    super.onPageStarted(view, url, favicon);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    if (url != null && !url.contains("offline.html")) {
                        hasLoadedSuccessfully = true;
                        isShowingOffline = false;
                    }
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    super.onReceivedError(view, request, error);

                    // Only handle main frame errors (not subresource errors like images/scripts)
                    if (request.isForMainFrame()) {
                        showOfflinePage(view);
                    }
                }

                @Override
                public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                    super.onReceivedError(view, errorCode, description, failingUrl);
                    // Legacy callback for older Android versions
                    if (failingUrl != null && failingUrl.startsWith(REMOTE_URL)) {
                        showOfflinePage(view);
                    }
                }
            });

            // Listen for network connectivity changes
            registerNetworkCallback();

        } catch (Exception e) {
            // Bridge may not be ready yet
        }
    }

    private void showOfflinePage(WebView webView) {
        if (isShowingOffline) return;
        isShowingOffline = true;

        runOnUiThread(() -> {
            try {
                webView.stopLoading();
                webView.loadUrl(OFFLINE_PAGE);
            } catch (Exception e) {
                // ignore
            }
        });
    }

    private void registerNetworkCallback() {
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
                    // Internet is back — reload the app if we're showing the offline page
                    if (isShowingOffline) {
                        runOnUiThread(() -> {
                            try {
                                WebView webView = bridge.getWebView();
                                if (webView != null) {
                                    isShowingOffline = false;
                                    webView.loadUrl(REMOTE_URL);
                                }
                            } catch (Exception e) {
                                // ignore
                            }
                        });
                    }
                }

                @Override
                public void onLost(Network network) {
                    super.onLost(network);
                    // Optional: could show a toast here, but the WebView error handler
                    // will catch it if the user tries to navigate
                }
            };

            cm.registerNetworkCallback(request, networkCallback);
        } catch (Exception e) {
            // ignore — older devices may not support this
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