package com.peja.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.time.Instant;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Foreground service for Share My Location (SML) safety check-ins. Mirrors
 * SOSLocationService but writes to safety_checkins instead of sos_alerts.
 * Lifecycle is driven by CheckInMonitor.tsx — JS calls SMLLocation.startTracking
 * when a check-in is active and stopTracking when it ends or the user confirms.
 */
public class SMLLocationService extends Service {

    public static final String TAG = "SMLLocationService";
    public static final String CHANNEL_ID = "peja_sml_channel";
    public static final int NOTIFICATION_ID = 9002;
    public static final String PREFS_NAME = "peja_sml_prefs";

    public static final String EXTRA_CHECKIN_ID = "checkin_id";
    public static final String EXTRA_SUPABASE_URL = "supabase_url";
    public static final String EXTRA_SUPABASE_KEY = "supabase_key";
    public static final String EXTRA_ACCESS_TOKEN = "access_token";

    public static final String ACTION_STOP = "com.peja.app.STOP_SML_TRACKING";

    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private PowerManager.WakeLock wakeLock;

    private final OkHttpClient httpClient = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build();

    private String checkinId = "";
    private String supabaseUrl = "";
    private String supabaseKey = "";
    private String accessToken = "";

    @Override
    public void onCreate() {
        super.onCreate();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Log.d(TAG, "Stop action received");
            clearState();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null) {
            checkinId = intent.getStringExtra(EXTRA_CHECKIN_ID) != null ? intent.getStringExtra(EXTRA_CHECKIN_ID) : "";
            supabaseUrl = intent.getStringExtra(EXTRA_SUPABASE_URL) != null ? intent.getStringExtra(EXTRA_SUPABASE_URL) : "";
            supabaseKey = intent.getStringExtra(EXTRA_SUPABASE_KEY) != null ? intent.getStringExtra(EXTRA_SUPABASE_KEY) : "";
            accessToken = intent.getStringExtra(EXTRA_ACCESS_TOKEN) != null ? intent.getStringExtra(EXTRA_ACCESS_TOKEN) : "";
        }

        if (checkinId.isEmpty() || supabaseUrl.isEmpty() || supabaseKey.isEmpty()) {
            Log.e(TAG, "Missing required data, stopping");
            stopSelf();
            return START_NOT_STICKY;
        }

        saveState();

        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "peja:sml_location_lock"
        );
        // 8h cap — long enough for a 4h check-in plus a "I'm OK" reset that
        // extends it. Falls back to foreground-service-only after this expires;
        // accuracy may degrade in Doze but the process stays alive.
        wakeLock.acquire(8 * 60 * 60 * 1000L);

        Notification notification = buildNotification();
        startForeground(NOTIFICATION_ID, notification);

        startLocationUpdates();

        Log.d(TAG, "SML service started, checkinId: " + checkinId);

        return START_STICKY;
    }

    private void startLocationUpdates() {
        // Strict 15s cadence regardless of movement, matching SOS. Pinning
        // interval == minInterval == maxDelay forces a fresh fix every ~15s
        // even when the user is stationary, which is the whole point of the
        // safety check-in feature.
        LocationRequest locationRequest = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                15_000L
        )
                .setMinUpdateDistanceMeters(0f)
                .setMinUpdateIntervalMillis(15_000L)
                .setMaxUpdateDelayMillis(15_000L)
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (result == null || result.getLastLocation() == null) return;

                double lat = result.getLastLocation().getLatitude();
                double lng = result.getLastLocation().getLongitude();

                Log.d(TAG, "SML location: " + lat + ", " + lng);

                updateCheckinLocation(lat, lng);
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(
                    locationRequest,
                    locationCallback,
                    Looper.getMainLooper()
            );
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission denied", e);
            stopSelf();
        }
    }

    private void updateCheckinLocation(double lat, double lng) {
        new Thread(() -> {
            try {
                String timestamp;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    timestamp = Instant.now().toString();
                } else {
                    timestamp = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                            java.util.Locale.US).format(new java.util.Date());
                }

                String json = "{" +
                        "\"latitude\":" + lat + "," +
                        "\"longitude\":" + lng + "," +
                        "\"location_updated_at\":\"" + timestamp + "\"," +
                        "\"updated_at\":\"" + timestamp + "\"" +
                        "}";

                Request request = new Request.Builder()
                        .url(supabaseUrl + "/rest/v1/safety_checkins?id=eq." + checkinId)
                        .patch(RequestBody.create(json, JSON_TYPE))
                        .addHeader("apikey", supabaseKey)
                        .addHeader("Authorization", "Bearer " + accessToken)
                        .addHeader("Content-Type", "application/json")
                        .addHeader("Prefer", "return=minimal")
                        .build();

                Response response = httpClient.newCall(request).execute();
                Log.d(TAG, "SML location updated: " + response.code());
                response.close();
            } catch (Exception e) {
                Log.e(TAG, "Failed to update SML location", e);
            }
        }).start();
    }

    private Notification buildNotification() {
        Intent openIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openPending = PendingIntent.getActivity(
                this, 0, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent stopIntent = new Intent(this, SMLLocationService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(
                this, 1, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Location Sharing Active")
                .setContentText("Peja is tracking your location for safety")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setContentIntent(openPending)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPending)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Safety Location Sharing",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows while your location is shared during a safety check-in");
            channel.setShowBadge(false);

            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private void saveState() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putString("checkin_id", checkinId)
                .putString("supabase_url", supabaseUrl)
                .putString("supabase_key", supabaseKey)
                .putString("access_token", accessToken)
                .putBoolean("is_active", true)
                .apply();
    }

    private void clearState() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putBoolean("is_active", false)
                .apply();
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "SML service destroyed");
        try {
            if (locationCallback != null) {
                fusedLocationClient.removeLocationUpdates(locationCallback);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error removing SML location updates", e);
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
