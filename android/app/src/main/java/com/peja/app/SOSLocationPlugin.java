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

@CapacitorPlugin(name = "SOSLocation")
public class SOSLocationPlugin extends Plugin {

    private static final String TAG = "SOSLocationPlugin";

    @PluginMethod
    public void startTracking(PluginCall call) {
        String sosId = call.getString("sosId", "");
        String supabaseUrl = call.getString("supabaseUrl", "");
        String supabaseKey = call.getString("supabaseKey", "");
        String accessToken = call.getString("accessToken", "");
        String mode = call.getString("mode", "activator");
        String helperId = call.getString("helperId", "");
        String sosOwnerId = call.getString("sosOwnerId", "");
        String helperName = call.getString("helperName", "");

        if (sosId.isEmpty() || supabaseUrl.isEmpty() || supabaseKey.isEmpty()) {
            call.reject("Missing required parameters");
            return;
        }

        Log.d(TAG, "Starting tracking - mode: " + mode + ", sosId: " + sosId);

        Intent intent = new Intent(getContext(), SOSLocationService.class);
        intent.putExtra(SOSLocationService.EXTRA_SOS_ID, sosId);
        intent.putExtra(SOSLocationService.EXTRA_SUPABASE_URL, supabaseUrl);
        intent.putExtra(SOSLocationService.EXTRA_SUPABASE_KEY, supabaseKey);
        intent.putExtra(SOSLocationService.EXTRA_ACCESS_TOKEN, accessToken);
        intent.putExtra(SOSLocationService.EXTRA_MODE, mode);
        intent.putExtra(SOSLocationService.EXTRA_HELPER_ID, helperId);
        intent.putExtra(SOSLocationService.EXTRA_SOS_OWNER_ID, sosOwnerId);
        intent.putExtra(SOSLocationService.EXTRA_HELPER_NAME, helperName);

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
        Log.d(TAG, "Stopping tracking");

        Intent intent = new Intent(getContext(), SOSLocationService.class);
        intent.setAction(SOSLocationService.ACTION_STOP);
        getContext().startService(intent);

        getContext().getSharedPreferences(SOSLocationService.PREFS_NAME, Context.MODE_PRIVATE)
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
                .getSharedPreferences(SOSLocationService.PREFS_NAME, Context.MODE_PRIVATE)
                .getBoolean("is_active", false);

        JSObject result = new JSObject();
        result.put("tracking", isActive);
        call.resolve(result);
    }
}