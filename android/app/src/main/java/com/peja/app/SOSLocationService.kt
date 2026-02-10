package com.peja.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class SOSLocationService : Service() {

    companion object {
        const val TAG = "SOSLocationService"
        const val CHANNEL_ID = "peja_sos_channel"
        const val NOTIFICATION_ID = 9001
        const val PREFS_NAME = "peja_sos_prefs"

        const val EXTRA_SOS_ID = "sos_id"
        const val EXTRA_SUPABASE_URL = "supabase_url"
        const val EXTRA_SUPABASE_KEY = "supabase_key"
        const val EXTRA_ACCESS_TOKEN = "access_token"
        const val EXTRA_MODE = "mode" // "activator" or "helper"
        const val EXTRA_HELPER_ID = "helper_id"
        const val EXTRA_SOS_OWNER_ID = "sos_owner_id"
        const val EXTRA_HELPER_NAME = "helper_name"

        const val ACTION_STOP = "com.peja.app.STOP_SOS_TRACKING"
    }

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private var wakeLock: PowerManager.WakeLock? = null
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private var sosId: String = ""
    private var supabaseUrl: String = ""
    private var supabaseKey: String = ""
    private var accessToken: String = ""
    private var mode: String = "activator"
    private var helperId: String = ""
    private var sosOwnerId: String = ""
    private var helperName: String = ""

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Log.d(TAG, "Stop action received")
            stopSelf()
            return START_NOT_STICKY
        }

        // Extract data from intent
        sosId = intent?.getStringExtra(EXTRA_SOS_ID) ?: ""
        supabaseUrl = intent?.getStringExtra(EXTRA_SUPABASE_URL) ?: ""
        supabaseKey = intent?.getStringExtra(EXTRA_SUPABASE_KEY) ?: ""
        accessToken = intent?.getStringExtra(EXTRA_ACCESS_TOKEN) ?: ""
        mode = intent?.getStringExtra(EXTRA_MODE) ?: "activator"
        helperId = intent?.getStringExtra(EXTRA_HELPER_ID) ?: ""
        sosOwnerId = intent?.getStringExtra(EXTRA_SOS_OWNER_ID) ?: ""
        helperName = intent?.getStringExtra(EXTRA_HELPER_NAME) ?: ""

        if (sosId.isEmpty() || supabaseUrl.isEmpty() || supabaseKey.isEmpty()) {
            Log.e(TAG, "Missing required data, stopping")
            stopSelf()
            return START_NOT_STICKY
        }

        // Save to SharedPreferences for restart after kill
        saveState()

        // Acquire wake lock
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "peja:sos_location_lock"
        ).apply {
            acquire(5 * 60 * 60 * 1000L) // 5 hours max
        }

        // Start foreground with notification
        val notification = buildNotification()
        startForeground(NOTIFICATION_ID, notification)

        // Start location updates
        startLocationUpdates()

        Log.d(TAG, "Service started - mode: $mode, sosId: $sosId")

        return START_STICKY // Restart if killed
    }

    private fun startLocationUpdates() {
        val locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            10_000L // 10 seconds
        ).apply {
            setMinUpdateDistanceMeters(20f) // Only update if moved 20 meters
            setMinUpdateIntervalMillis(5_000L) // No faster than 5 seconds
            setMaxUpdateDelayMillis(15_000L)
        }.build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val location = result.lastLocation ?: return
                val lat = location.latitude
                val lng = location.longitude
                val bearing = if (location.hasBearing()) location.bearing.toDouble() else 0.0

                Log.d(TAG, "Location update: $lat, $lng (mode: $mode)")

                if (mode == "activator") {
                    updateSOSLocation(lat, lng, bearing)
                } else {
                    updateHelperLocation(lat, lng)
                }
            }
        }

        try {
            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                Looper.getMainLooper()
            )
        } catch (e: SecurityException) {
            Log.e(TAG, "Location permission denied", e)
            stopSelf()
        }
    }

    private fun updateSOSLocation(lat: Double, lng: Double, bearing: Double) {
        Thread {
            try {
                val json = """
                    {
                        "latitude": $lat,
                        "longitude": $lng,
                        "bearing": $bearing,
                        "last_updated": "${java.time.Instant.now()}"
                    }
                """.trimIndent()

                val request = Request.Builder()
                    .url("${supabaseUrl}/rest/v1/sos_alerts?id=eq.${sosId}")
                    .patch(json.toRequestBody("application/json".toMediaType()))
                    .addHeader("apikey", supabaseKey)
                    .addHeader("Authorization", "Bearer $accessToken")
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", "return=minimal")
                    .build()

                val response = httpClient.newCall(request).execute()
                Log.d(TAG, "SOS location updated: ${response.code}")
                response.close()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to update SOS location", e)
            }
        }.start()
    }

    private fun updateHelperLocation(lat: Double, lng: Double) {
        Thread {
            try {
                // First, get the current SOS location to calculate ETA
                val getRequest = Request.Builder()
                    .url("${supabaseUrl}/rest/v1/sos_alerts?id=eq.${sosId}&select=latitude,longitude,status")
                    .get()
                    .addHeader("apikey", supabaseKey)
                    .addHeader("Authorization", "Bearer $accessToken")
                    .build()

                val getResponse = httpClient.newCall(getRequest).execute()
                val body = getResponse.body?.string() ?: "[]"
                getResponse.close()

                // Parse SOS location (simple JSON parsing without library)
                if (body.contains("\"status\":\"active\"")) {
                    val sosLat = extractDouble(body, "latitude")
                    val sosLng = extractDouble(body, "longitude")

                    if (sosLat != null && sosLng != null) {
                        val distanceKm = haversineKm(lat, lng, sosLat, sosLng)
                        val etaMinutes = Math.max(1, Math.round((distanceKm / 30.0) * 60.0))

                        // Send location update notification to SOS owner
                        val notifJson = """
                            {
                                "user_id": "$sosOwnerId",
                                "type": "sos_alert",
                                "title": "Helper update",
                                "body": "$helperName is ${etaMinutes} min away",
                                "is_read": false,
                                "data": {
                                    "sos_id": "$sosId",
                                    "helper_id": "$helperId",
                                    "helper_name": "$helperName",
                                    "helper_lat": $lat,
                                    "helper_lng": $lng,
                                    "eta_minutes": $etaMinutes,
                                    "is_location_update": true
                                }
                            }
                        """.trimIndent()

                        val notifRequest = Request.Builder()
                            .url("${supabaseUrl}/rest/v1/notifications")
                            .post(notifJson.toRequestBody("application/json".toMediaType()))
                            .addHeader("apikey", supabaseKey)
                            .addHeader("Authorization", "Bearer $accessToken")
                            .addHeader("Content-Type", "application/json")
                            .addHeader("Prefer", "return=minimal")
                            .build()

                        val notifResponse = httpClient.newCall(notifRequest).execute()
                        Log.d(TAG, "Helper location sent: ${notifResponse.code}, ETA: $etaMinutes min")
                        notifResponse.close()

                        // If arrived (within 300 meters), stop tracking
                        if (distanceKm <= 0.3) {
                            Log.d(TAG, "Helper arrived! Stopping tracking.")
                            stopSelf()
                        }
                    }
                } else {
                    // SOS no longer active, stop tracking
                    Log.d(TAG, "SOS no longer active, stopping")
                    clearState()
                    stopSelf()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to update helper location", e)
            }
        }.start()
    }

    private fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val R = 6371.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2)
        val c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
    }

    private fun extractDouble(json: String, key: String): Double? {
        val pattern = "\"$key\"\\s*:\\s*([\\d.\\-]+)".toRegex()
        return pattern.find(json)?.groupValues?.get(1)?.toDoubleOrNull()
    }

    private fun buildNotification(): Notification {
        // Intent to open the app
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val openPending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Intent to stop tracking
        val stopIntent = Intent(this, SOSLocationService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = if (mode == "activator") "SOS Active" else "Helping Someone"
        val text = if (mode == "activator") {
            "Your location is being shared with helpers"
        } else {
            "Tracking your location to help"
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setOngoing(true)
            .setContentIntent(openPending)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SOS Location Tracking",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Shows when SOS location tracking is active"
                setShowBadge(false)
            }

            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun saveState() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply {
            putString("sos_id", sosId)
            putString("supabase_url", supabaseUrl)
            putString("supabase_key", supabaseKey)
            putString("access_token", accessToken)
            putString("mode", mode)
            putString("helper_id", helperId)
            putString("sos_owner_id", sosOwnerId)
            putString("helper_name", helperName)
            putBoolean("is_active", true)
            apply()
        }
    }

    private fun clearState() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply {
            putBoolean("is_active", false)
            apply()
        }
    }

    override fun onDestroy() {
        Log.d(TAG, "Service destroyed")
        try {
            fusedLocationClient.removeLocationUpdates(locationCallback)
        } catch (e: Exception) {
            Log.e(TAG, "Error removing location updates", e)
        }
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}