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

@CapacitorPlugin(name = "AmbientLocation")
public class AmbientLocationPlugin extends Plugin {

    private static final String TAG = "AmbientLocationPlugin";

    @PluginMethod
    public void start(PluginCall call) {
        String endpoint = call.getString("endpoint", "");
        String key = call.getString("key", "");
        if (endpoint.isEmpty() || key.isEmpty()) {
            call.reject("Missing endpoint or key");
            return;
        }

        Intent intent = new Intent(getContext(), AmbientLocationService.class);
        intent.putExtra(AmbientLocationService.EXTRA_ENDPOINT, endpoint);
        intent.putExtra(AmbientLocationService.EXTRA_KEY, key);

        JSObject result = new JSObject();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            result.put("started", true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start ambient service", e);
            result.put("started", false);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), AmbientLocationService.class);
            intent.setAction(AmbientLocationService.ACTION_STOP);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop ambient service", e);
        }
        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }

    @PluginMethod
    public void isTracking(PluginCall call) {
        boolean active = getContext()
                .getSharedPreferences(AmbientLocationService.PREFS_NAME, Context.MODE_PRIVATE)
                .getBoolean("is_active", false);
        JSObject result = new JSObject();
        result.put("tracking", active);
        call.resolve(result);
    }
}
