package com.peja.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Surfaces the two OS-level settings that background location tracking
 * (SOS + SML) depends on but that the app cannot grant for itself:
 *
 *   1. Battery-optimization exemption — without it Doze/OEM battery
 *      managers throttle or kill the foreground service, so updates
 *      stop while the phone is idle or the app is swiped away.
 *   2. "Allow all the time" location — required on Android 10+ for the
 *      service to read location once the app is backgrounded.
 *
 * The web layer reads state via the "is"/"has" check methods and drives
 * the top banner + session-start readiness prompt; the "request" methods
 * open the relevant system flow.
 */
@CapacitorPlugin(name = "DeviceSettings")
public class DeviceSettingsPlugin extends Plugin {

    private static final String TAG = "DeviceSettingsPlugin";

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        boolean ignoring = true; // pre-M has no battery optimization to worry about
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            ignoring = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        }
        JSObject ret = new JSObject();
        ret.put("ignoring", ignoring);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // Direct system dialog ("Allow Peja to run in the background?").
            // Requires the REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission in
            // the manifest. If the device blocks it, fall back to the full
            // battery-optimization settings list.
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception e) {
                Log.w(TAG, "Direct battery dialog failed, opening settings list", e);
                try {
                    Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                } catch (Exception ignored) {
                    openAppDetails();
                }
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void hasBackgroundLocation(PluginCall call) {
        boolean granted;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            granted = ContextCompat.checkSelfPermission(
                    getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED;
        } else {
            // Before Android 10 foreground location permission also covers
            // background use, so fine/coarse being granted is enough.
            granted = ContextCompat.checkSelfPermission(
                    getContext(), Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
                    || ContextCompat.checkSelfPermission(
                    getContext(), Manifest.permission.ACCESS_COARSE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED;
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        // On Android 11+ "Allow all the time" cannot be granted from an
        // in-app dialog — the user must pick it on the app's permission
        // screen. Routing to the app details page is the reliable path
        // across OEMs and Android versions.
        openAppDetails();
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        openAppDetails();
        call.resolve();
    }

    private void openAppDetails() {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception e) {
            Log.w(TAG, "Failed to open app details settings", e);
        }
    }
}
