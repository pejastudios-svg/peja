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

        if (checkinId.isEmpty() || supabaseUrl.isEmpty() || supabaseKey.isEmpty()) {
            call.reject("Missing required parameters");
            return;
        }

        Log.d(TAG, "Starting SML tracking, checkinId: " + checkinId);

        Intent intent = new Intent(getContext(), SMLLocationService.class);
        intent.putExtra(SMLLocationService.EXTRA_CHECKIN_ID, checkinId);
        intent.putExtra(SMLLocationService.EXTRA_SUPABASE_URL, supabaseUrl);
        intent.putExtra(SMLLocationService.EXTRA_SUPABASE_KEY, supabaseKey);
        intent.putExtra(SMLLocationService.EXTRA_ACCESS_TOKEN, accessToken);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
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
    public void isTracking(PluginCall call) {
        boolean isActive = getContext()
                .getSharedPreferences(SMLLocationService.PREFS_NAME, Context.MODE_PRIVATE)
                .getBoolean("is_active", false);

        JSObject result = new JSObject();
        result.put("tracking", isActive);
        call.resolve(result);
    }
}
