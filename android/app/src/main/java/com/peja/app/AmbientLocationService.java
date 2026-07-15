package com.peja.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
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
 * Always-on ambient presence: the Life360 layer. Keeps the user's circle
 * updated with a fresh last-known location even when the app is closed.
 *
 * Deliberately GENTLE, unlike the SOS/SML services:
 *  - balanced-power fixes every ~3 min (batched up to 8 min) - no 15s
 *    high-accuracy hammering, no wake lock. Battery drain is the #1
 *    uninstall reason for location apps on low-end Androids.
 *  - authenticates with a long-lived device key against /api/presence/beat
 *    (session tokens die in ~1h; this service lives for days).
 *  - same accuracy gates as everything else: junk fixes never leave the
 *    phone.
 *
 * Lifecycle: AmbientLocationPlugin start/stop (settings toggle), sticky
 * restart, boot receiver, and task-removal alarm mirror the SML service.
 */
public class AmbientLocationService extends Service {

    public static final String TAG = "AmbientLocationService";
    public static final String CHANNEL_ID = "peja_ambient_channel";
    public static final int NOTIFICATION_ID = 9003;
    public static final String PREFS_NAME = "peja_ambient_prefs";

    public static final String EXTRA_ENDPOINT = "endpoint";
    public static final String EXTRA_KEY = "device_key";

    public static final String ACTION_STOP = "com.peja.app.STOP_AMBIENT_TRACKING";

    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    // Cadence: fixes ~3 min apart, allowed to batch to 8 min for battery.
    private static final long INTERVAL_MS = 180_000L;
    private static final long MAX_DELAY_MS = 480_000L;
    // Never send beats closer than this (batch bursts).
    private static final long MIN_SEND_GAP_MS = 90_000L;

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private boolean tracking = false;
    private volatile long lastSentMs = 0L;

    // Accuracy gate + motion state (mirrors src/lib/motion.ts semantics).
    private volatile long lastGoodFixMs = 0L;
    private volatile double lastLat = 0, lastLng = 0;
    private volatile long lastAtMs = 0L;
    private volatile double anchorLat = 0, anchorLng = 0;
    private volatile long anchorAtMs = 0L;

    private final OkHttpClient httpClient = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build();

    private String endpoint = "";
    private String deviceKey = "";

    @Override
    public void onCreate() {
        super.onCreate();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // startForeground() must run on EVERY path within ~5s of a
        // startForegroundService() (see SMLLocationService for the war
        // story), so promote first, branch after.
        try {
            startForeground(NOTIFICATION_ID, buildNotification());
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed, stopping service", e);
            clearState();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            clearState();
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null && intent.getStringExtra(EXTRA_KEY) != null) {
            endpoint = intent.getStringExtra(EXTRA_ENDPOINT) != null ? intent.getStringExtra(EXTRA_ENDPOINT) : "";
            deviceKey = intent.getStringExtra(EXTRA_KEY);
        } else {
            // Sticky/boot restart: recover config from prefs.
            android.content.SharedPreferences prefs =
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            if (prefs.getBoolean("is_active", false)) {
                endpoint = prefs.getString("endpoint", "");
                deviceKey = prefs.getString("device_key", "");
                Log.d(TAG, "Recovered ambient tracking from prefs");
            }
        }

        if (endpoint.isEmpty() || deviceKey.isEmpty()) {
            Log.e(TAG, "No ambient config, stopping");
            clearState();
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        saveState();
        startLocationUpdates();
        Log.d(TAG, "Ambient service started");
        return START_STICKY;
    }

    private void startLocationUpdates() {
        if (tracking) return;
        tracking = true;

        LocationRequest locationRequest = new LocationRequest.Builder(
                Priority.PRIORITY_BALANCED_POWER_ACCURACY,
                INTERVAL_MS
        )
                .setMinUpdateIntervalMillis(120_000L)
                .setMaxUpdateDelayMillis(MAX_DELAY_MS)
                .setMinUpdateDistanceMeters(0f)
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (result == null) return;
                for (Location loc : result.getLocations()) {
                    if (loc != null) onNewLocation(loc);
                }
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(
                    locationRequest,
                    locationCallback,
                    Looper.getMainLooper()
            ).addOnFailureListener(e -> Log.e(TAG, "Ambient requestLocationUpdates failed", e));
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission denied (ambient)", e);
        }

        // Immediate last-known so the circle sees something right away.
        try {
            fusedLocationClient.getLastLocation().addOnSuccessListener(loc -> {
                if (loc != null) onNewLocation(loc);
            });
        } catch (SecurityException ignored) {
        }
    }

    private void onNewLocation(Location location) {
        long now = System.currentTimeMillis();

        // Accuracy gate, same thresholds as the web filter and SML.
        float acc = location.hasAccuracy() ? location.getAccuracy() : 100f;
        // Hard gate with a desperation valve (see SMLLocationService).
        if (acc > 800f && (acc > 5000f || now - lastSentMs < 180_000L)) return;
        if (acc > 150f && acc <= 800f && now - lastGoodFixMs < 60_000L) return;
        if (acc <= 150f) lastGoodFixMs = now;

        if (now - lastSentMs < MIN_SEND_GAP_MS) return;
        lastSentMs = now;

        double lat = location.getLatitude();
        double lng = location.getLongitude();

        // Motion: chipset speed if fresh; stillness anchor at 30m.
        boolean freshFix = now - location.getTime() < 60_000L;
        Double speedKmh = null;
        if (freshFix && location.hasSpeed() && location.getSpeed() >= 0f) {
            speedKmh = location.getSpeed() * 3.6d;
            if (speedKmh > 300d) speedKmh = null;
        }
        lastLat = lat;
        lastLng = lng;
        lastAtMs = now;
        if (anchorAtMs == 0L || haversineM(anchorLat, anchorLng, lat, lng) > 30d) {
            anchorLat = lat;
            anchorLng = lng;
            anchorAtMs = now;
        }

        sendBeat(lat, lng, acc, speedKmh, anchorAtMs);
    }

    private void sendBeat(double lat, double lng, float acc, Double speedKmh, long stillSinceMs) {
        new Thread(() -> {
            try {
                Integer battery = readBatteryPct();
                String speedStr = speedKmh != null
                        ? String.format(java.util.Locale.US, "%.1f", speedKmh)
                        : "null";
                String json = "{" +
                        "\"key\":\"" + deviceKey + "\"," +
                        "\"lat\":" + lat + "," +
                        "\"lng\":" + lng + "," +
                        "\"accuracy_m\":" + Math.round(acc) + "," +
                        "\"speed_kmh\":" + speedStr + "," +
                        "\"still_since\":\"" + isoTimestamp(stillSinceMs) + "\"," +
                        "\"battery_pct\":" + (battery != null ? battery : "null") +
                        "}";

                Request request = new Request.Builder()
                        .url(endpoint)
                        .post(RequestBody.create(json, JSON_TYPE))
                        .addHeader("Content-Type", "application/json")
                        .build();

                Response response = httpClient.newCall(request).execute();
                int code = response.code();
                if (code == 401) {
                    // Key revoked (logout / toggle-off elsewhere): stop for
                    // good, don't hammer the server forever.
                    Log.w(TAG, "Device key revoked, stopping ambient tracking");
                    clearState();
                    stopForegroundCompat();
                    stopSelf();
                } else if (code >= 400) {
                    Log.e(TAG, "Ambient beat failed: " + code);
                } else {
                    Log.d(TAG, "Ambient beat ok");
                }
                response.close();
            } catch (Exception e) {
                Log.e(TAG, "Failed to send ambient beat", e);
            }
        }).start();
    }

    private Integer readBatteryPct() {
        try {
            BatteryManager bm = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
            if (bm == null) return null;
            int pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            return pct > 0 && pct <= 100 ? pct : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static double haversineM(double lat1, double lng1, double lat2, double lng2) {
        double r = 6371000d;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * r * Math.asin(Math.sqrt(a));
    }

    private static String isoTimestamp(long epochMs) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return Instant.ofEpochMilli(epochMs).toString();
        }
        java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        fmt.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return fmt.format(new java.util.Date(epochMs));
    }

    private Notification buildNotification() {
        Intent openIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openPending = PendingIntent.getActivity(
                this, 0, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent stopIntent = new Intent(this, AmbientLocationService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(
                this, 1, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Sharing with your circle")
                .setContentText("Your people can see your latest location")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setContentIntent(openPending)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Pause", stopPending)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Circle updates",
                    NotificationManager.IMPORTANCE_MIN
            );
            channel.setDescription("Shows while peja keeps your circle updated with your location");
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private void saveState() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putString("endpoint", endpoint)
                .putString("device_key", deviceKey)
                .putBoolean("is_active", true)
                .apply();
    }

    private void clearState() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putBoolean("is_active", false)
                .apply();
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(Service.STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiped from recents: reschedule if still enabled (best-effort;
        // OEM battery managers may block, battery exemption improves odds).
        try {
            boolean active = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .getBoolean("is_active", false);
            if (active) {
                Intent restart = new Intent(getApplicationContext(), AmbientLocationService.class);
                PendingIntent pi;
                int flags = PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    pi = PendingIntent.getForegroundService(this, 3, restart, flags);
                } else {
                    pi = PendingIntent.getService(this, 3, restart, flags);
                }
                AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (am != null) {
                    long at = System.currentTimeMillis() + 2000;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                    } else {
                        am.set(AlarmManager.RTC_WAKEUP, at, pi);
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule ambient restart", e);
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        try {
            if (locationCallback != null) {
                fusedLocationClient.removeLocationUpdates(locationCallback);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error removing ambient updates", e);
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
