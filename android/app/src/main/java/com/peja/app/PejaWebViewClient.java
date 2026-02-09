package com.peja.app;

import android.graphics.Bitmap;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;

public class PejaWebViewClient extends Bridge.WebViewClient {

    private static final String OFFLINE_PAGE = "file:///android_asset/public/offline.html";
    private boolean isShowingOffline = false;

    public PejaWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        // Only intercept main frame errors (not images, scripts, etc.)
        if (request.isForMainFrame() && !isShowingOffline) {
            isShowingOffline = true;
            view.post(() -> {
                view.stopLoading();
                view.loadUrl(OFFLINE_PAGE);
            });
            return;
        }
        super.onReceivedError(view, request, error);
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        if (url != null && !url.contains("offline.html")) {
            isShowingOffline = false;
        }
    }
}