package com.peja.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class SOSBootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        Log.d("SOSBootReceiver", "Boot completed, checking for active SOS")

        val prefs = context.getSharedPreferences(
            SOSLocationService.PREFS_NAME,
            Context.MODE_PRIVATE
        )

        val isActive = prefs.getBoolean("is_active", false)
        if (!isActive) {
            Log.d("SOSBootReceiver", "No active SOS, skipping")
            return
        }

        val sosId = prefs.getString("sos_id", "") ?: ""
        val supabaseUrl = prefs.getString("supabase_url", "") ?: ""
        val supabaseKey = prefs.getString("supabase_key", "") ?: ""
        val accessToken = prefs.getString("access_token", "") ?: ""
        val mode = prefs.getString("mode", "activator") ?: "activator"
        val helperId = prefs.getString("helper_id", "") ?: ""
        val sosOwnerId = prefs.getString("sos_owner_id", "") ?: ""
        val helperName = prefs.getString("helper_name", "") ?: ""

        if (sosId.isEmpty() || supabaseUrl.isEmpty()) {
            Log.d("SOSBootReceiver", "Missing data, skipping")
            return
        }

        Log.d("SOSBootReceiver", "Restarting SOS tracking for: $sosId")

        val serviceIntent = Intent(context, SOSLocationService::class.java).apply {
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
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }
}