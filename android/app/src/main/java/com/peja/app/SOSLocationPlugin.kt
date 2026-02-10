package com.peja.app

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "SOSLocation")
class SOSLocationPlugin : Plugin() {

    companion object {
        const val TAG = "SOSLocationPlugin"
    }

    @PluginMethod
    fun startTracking(call: PluginCall) {
        val sosId = call.getString("sosId") ?: ""
        val supabaseUrl = call.getString("supabaseUrl") ?: ""
        val supabaseKey = call.getString("supabaseKey") ?: ""
        val accessToken = call.getString("accessToken") ?: ""
        val mode = call.getString("mode") ?: "activator"
        val helperId = call.getString("helperId") ?: ""
        val sosOwnerId = call.getString("sosOwnerId") ?: ""
        val helperName = call.getString("helperName") ?: ""

        if (sosId.isEmpty() || supabaseUrl.isEmpty() || supabaseKey.isEmpty()) {
            call.reject("Missing required parameters")
            return
        }

        Log.d(TAG, "Starting tracking - mode: $mode, sosId: $sosId")

        val intent = Intent(context, SOSLocationService::class.java).apply {
            putExtra(SOSLocationService.EXTRA_SOS_ID, sosId)
            putExtra(SOSLocationService.EXTRA_SUPABASE_URL, supabaseUrl)
            putExtra(SOSLocationService.EXTRA_SUPABASE_KEY, supabaseKey)
            putExtra(SOSLocationService.EXTRA_ACCESS_TOKEN, accessToken)
            putExtra(SOSLocationService.EXTRA_MODE, mode)
            putExtra(SOSLocationService.EXTRA_HELPER_ID, helperId)
            putExtra(SOSLocationService.EXTRA_SOS_OWNER_ID, sosOwnerId)
            putExtra(SOSLocationService.EXTRA_HELPER_NAME, helperName)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }

        call.resolve(JSObject().put("started", true))
    }

    @PluginMethod
    fun stopTracking(call: PluginCall) {
        Log.d(TAG, "Stopping tracking")

        val intent = Intent(context, SOSLocationService::class.java).apply {
            action = SOSLocationService.ACTION_STOP
        }
        context.startService(intent)

        // Clear saved state
        context.getSharedPreferences(SOSLocationService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("is_active", false)
            .apply()

        call.resolve(JSObject().put("stopped", true))
    }

    @PluginMethod
    fun isTracking(call: PluginCall) {
        val prefs = context.getSharedPreferences(
            SOSLocationService.PREFS_NAME,
            Context.MODE_PRIVATE
        )
        val isActive = prefs.getBoolean("is_active", false)
        call.resolve(JSObject().put("tracking", isActive))
    }
}