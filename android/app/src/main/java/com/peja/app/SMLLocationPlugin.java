package com.peja.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SMLLocation")
public class SMLLocationPlugin extends Plugin {

    private static final String TAG = "SMLLocationPlugin";

    @PluginMethod
    public void startTracking(PluginCall call) {
        String checkinId = call.getString("checkinId", "");
        String supabaseUrl = call.getString("supabaseUrl", "");
        String supabaseKey = call.getString("supabaseKey", "");
        String accessToken = call.getString("accessToken", "");
        String refreshToken = call.getString("refreshToken", "");

        if (checkinId.isEmpty() || supabaseUrl.isEmpty() || supabaseKey.isEmpty()) {
            call.reject("Missing required parameters");
            return;
        }

        // Seed the shared token store so the service can refresh the session
        // natively after the WebView is backgrounded or killed. This is what
        // keeps multi-hour tracking authenticated past token expiry. On a
        // background thread: storeTokens takes the auth lock, which a native
        // refresh can hold for a full network round trip, and the service
        // start must not wait on that. The service's first writes fall back
        // to the intent token until the seed lands.
        new Thread(() -> PejaSupabaseAuth.storeTokens(getContext(), accessToken, refreshToken)).start();

        Log.d(TAG, "Starting SML tracking, checkinId: " + checkinId);

        Intent intent = new Intent(getContext(), SMLLocationService.class);
        intent.putExtra(SMLLocationService.EXTRA_CHECKIN_ID, checkinId);
        intent.putExtra(SMLLocationService.EXTRA_SUPABASE_URL, supabaseUrl);
        intent.putExtra(SMLLocationService.EXTRA_SUPABASE_KEY, supabaseKey);
        intent.putExtra(SMLLocationService.EXTRA_ACCESS_TOKEN, accessToken);

        // Mark tracking active NOW, before the service's own saveState runs
        // on the main thread. The JS token-rotation push gates on isTracking;
        // without this a rotation landing in the start gap would be dropped
        // and the store left holding a consumed refresh token.
        getContext().getSharedPreferences(SMLLocationService.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean("is_active", true)
                .apply();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } catch (Exception e) {
            // Android 12+ can refuse a foreground-service start from the
            // background (ForegroundServiceStartNotAllowedException). Don't
            // crash — report not-started so JS keeps its web fallback.
            Log.e(TAG, "Failed to start SML service", e);
            getContext().getSharedPreferences(SMLLocationService.PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean("is_active", false)
                    .apply();
            JSObject result = new JSObject();
            result.put("started", false);
            call.resolve(result);
            return;
        }

        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stopTracking(PluginCall call) {
        Log.d(TAG, "Stopping SML tracking");

        Intent intent = new Intent(getContext(), SMLLocationService.class);
        intent.setAction(SMLLocationService.ACTION_STOP);
        getContext().startService(intent);

        getContext().getSharedPreferences(SMLLocationService.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean("is_active", false)
                .apply();

        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }

    @PluginMethod
    public void updateToken(PluginCall call) {
        String accessToken = call.getString("accessToken", "");
        String refreshToken = call.getString("refreshToken", "");
        if (!accessToken.isEmpty()) {
            // Keep the shared store in sync while the WebView is alive.
            // Supabase rotates the refresh token on every JS-side refresh, so
            // pushing the new pair here prevents the native refresher from
            // holding a stale, already-used refresh token. The running
            // services read this store on every Supabase write; no restart
            // is needed.
            PejaSupabaseAuth.storeTokens(getContext(), accessToken, refreshToken);
        }
        JSObject result = new JSObject();
        result.put("updated", !accessToken.isEmpty());
        call.resolve(result);
    }

    @PluginMethod
    public void isTracking(PluginCall call) {
        boolean isActive = getContext()
                .getSharedPreferences(SMLLocationService.PREFS_NAME, Context.MODE_PRIVATE)
                .getBoolean("is_active", false);

        JSObject result = new JSObject();
        result.put("tracking", isActive);
        call.resolve(result);
    }

    @PluginMethod
    public void getTokens(PluginCall call) {
        // Lets the WebView adopt a natively rotated session on resume
        // (supabase.auth.setSession) instead of replaying its own stale
        // refresh token, which would trip GoTrue reuse detection and revoke
        // the whole session family.
        JSObject result = new JSObject();
        result.put("accessToken", PejaSupabaseAuth.readAccess(getContext()));
        result.put("refreshToken", PejaSupabaseAuth.readRefresh(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        // Called on sign-out so a valid refresh token for the old account
        // never lingers on disk.
        PejaSupabaseAuth.clear(getContext());
        JSObject result = new JSObject();
        result.put("cleared", true);
        call.resolve(result);
    }
}
