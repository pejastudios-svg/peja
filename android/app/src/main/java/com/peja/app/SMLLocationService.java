package com.peja.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
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

    // Platform LocationManager as a GMS-independent fallback. On many low-end
    // MediaTek/Transsion devices the Google Play Services fused provider
    // silently delivers nothing, so we also listen to GPS + network providers
    // directly, which don't depend on GMS.
    private LocationManager locationManager;
    private LocationListener gpsListener;
    private LocationListener networkListener;
    // Throttle so the three sources (fused + GPS + network) don't flood the
    // backend; keeps the effective cadence near the intended 15s.
    private volatile long lastSentMs = 0L;
    // Guards against re-registering listeners when onStartCommand is delivered
    // again to an already-running service (e.g. a revive push that arrives
    // while tracking is still alive).
    private boolean tracking = false;

    // Motion state, mirroring the web tracker (src/lib/motion.ts) so native
    // and web SML sessions report identical semantics:
    //  - speed: chipset first (m/s), derived from successive fixes second
    //  - stillness: anchor point; moving >30m replants it; still_since is
    //    simply the anchor's timestamp (viewers only show it after 60s)
    private volatile double lastLat = 0, lastLng = 0;
    private volatile long lastAtMs = 0L;
    private volatile double anchorLat = 0, anchorLng = 0;
    private volatile long anchorAtMs = 0L;
    // Accuracy gate state: when the last GOOD (<=150m) fix arrived, so
    // coarse network-provider fixes only pass while we're blind.
    private volatile long lastGoodFixMs = 0L;

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
        // CRITICAL: once started via startForegroundService(), Android requires
        // startForeground() to be called within ~5s on EVERY path — even the
        // stop/invalid paths that immediately tear down. Returning (even via
        // stopSelf) without it crashes the process with
        // ForegroundServiceDidNotStartInTimeException. So promote to foreground
        // FIRST, before any branching, then stop afterward if needed.
        try {
            startForeground(NOTIFICATION_ID, buildNotification());
        } catch (Exception e) {
            // Android 12+ may refuse a background start (ForegroundServiceStart-
            // NotAllowedException); Android 14+ throws SecurityException without
            // location permission. Don't crash — stop and let JS keep the
            // foreground web fallback.
            Log.e(TAG, "startForeground failed, stopping service", e);
            clearState();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Log.d(TAG, "Stop action received");
            clearState();
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null && intent.getStringExtra(EXTRA_CHECKIN_ID) != null) {
            checkinId = intent.getStringExtra(EXTRA_CHECKIN_ID);
            supabaseUrl = intent.getStringExtra(EXTRA_SUPABASE_URL) != null ? intent.getStringExtra(EXTRA_SUPABASE_URL) : "";
            supabaseKey = intent.getStringExtra(EXTRA_SUPABASE_KEY) != null ? intent.getStringExtra(EXTRA_SUPABASE_KEY) : "";
            accessToken = intent.getStringExtra(EXTRA_ACCESS_TOKEN) != null ? intent.getStringExtra(EXTRA_ACCESS_TOKEN) : "";
        } else {
            // Restart with no extras — this is a START_STICKY restart after the
            // process was killed (e.g. the user swiped the app from recents).
            // Recover the in-flight check-in from prefs and resume tracking.
            android.content.SharedPreferences prefs =
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            if (prefs.getBoolean("is_active", false)) {
                checkinId = prefs.getString("checkin_id", "");
                supabaseUrl = prefs.getString("supabase_url", "");
                supabaseKey = prefs.getString("supabase_key", "");
                accessToken = prefs.getString("access_token", "");
                Log.d(TAG, "Recovered SML check-in from prefs: " + checkinId);
            }
        }

        if (checkinId.isEmpty() || supabaseUrl.isEmpty() || supabaseKey.isEmpty()) {
            Log.e(TAG, "No active check-in to track, stopping");
            clearState();
            stopForegroundCompat();
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

        startLocationUpdates();

        Log.d(TAG, "SML service started, checkinId: " + checkinId);

        return START_STICKY;
    }

    private void startLocationUpdates() {
        if (tracking) return; // already registered — avoid duplicate listeners
        tracking = true;

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
                onNewLocation(result.getLastLocation(), "fused");
            }
        };

        // 1) GMS fused provider — best accuracy/battery when it works.
        try {
            fusedLocationClient.requestLocationUpdates(
                    locationRequest,
                    locationCallback,
                    Looper.getMainLooper()
            ).addOnFailureListener(e -> Log.e(TAG, "Fused requestLocationUpdates failed", e));
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission denied (fused)", e);
        }

        // 2) Platform LocationManager — GMS-independent fallback so devices
        //    where fused delivers nothing still report location.
        startPlatformUpdates();

        // 3) Send an immediate last-known fix so the viewer doesn't wait for
        //    the first periodic update.
        sendLastKnownNow();
    }

    private void startPlatformUpdates() {
        try {
            if (locationManager == null) {
                locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            }
            if (locationManager == null) return;

            gpsListener = new SimpleLocationListener("gps");
            networkListener = new SimpleLocationListener("network");

            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER, 15_000L, 0f,
                        gpsListener, Looper.getMainLooper());
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER, 15_000L, 0f,
                        networkListener, Looper.getMainLooper());
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission denied (platform)", e);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start platform location updates", e);
        }
    }

    private void sendLastKnownNow() {
        try {
            if (locationManager == null) {
                locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            }
            Location best = null;
            if (locationManager != null) {
                Location gps = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                Location net = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                best = (gps != null) ? gps : net;
            }
            if (best != null) {
                onNewLocation(best, "last-known");
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission denied (last-known)", e);
        } catch (Exception e) {
            Log.e(TAG, "Failed to read last-known location", e);
        }
    }

    private class SimpleLocationListener implements LocationListener {
        private final String source;
        SimpleLocationListener(String source) { this.source = source; }
        @Override public void onLocationChanged(Location location) {
            if (location != null) {
                onNewLocation(location, source);
            }
        }
        // Required no-op overrides for older API levels.
        @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
        @Override public void onProviderEnabled(String provider) {}
        @Override public void onProviderDisabled(String provider) {}
    }

    /** Throttle the three location sources to ~one write per 12s. */
    private void onNewLocation(Location location, String source) {
        long now = System.currentTimeMillis();

        // ── accuracy gate: never ship cell-tower junk while GPS works.
        // Coarse fixes (150-800m) pass only after 60s without a good one
        // (stale-good beats fresh-garbage, but never go fully dark).
        // Worse than 800m is never trusted. This is what stops watchers
        // seeing the sharer teleport around weak-GPS neighborhoods. ──
        float acc = location.hasAccuracy() ? location.getAccuracy() : 100f;
        if (acc > 800f) return;
        if (acc > 150f && now - lastGoodFixMs < 60_000L) return;
        if (acc <= 150f) lastGoodFixMs = now;

        if (now - lastSentMs < 12_000L) return;
        lastSentMs = now;

        double lat = location.getLatitude();
        double lng = location.getLongitude();

        // A cached fix (last-known) can carry an hours-old speed; only trust
        // motion data from fixes taken in the last 30s.
        boolean freshFix = now - location.getTime() < 30_000L;

        // Speed: chipset value first (m/s -> km/h), derived second.
        Double speedKmh = null;
        if (freshFix && location.hasSpeed() && location.getSpeed() >= 0f) {
            speedKmh = location.getSpeed() * 3.6d;
        } else if (freshFix && lastAtMs > 0L) {
            double dt = (now - lastAtMs) / 1000.0;
            if (dt >= 1 && dt <= 60 && location.getAccuracy() < 100f) {
                speedKmh = haversineM(lastLat, lastLng, lat, lng) / dt * 3.6d;
            }
        }
        if (speedKmh != null && speedKmh > 300d) speedKmh = null; // GPS teleport
        lastLat = lat;
        lastLng = lng;
        lastAtMs = now;

        // Stillness anchor: replant after ~30m of real movement.
        if (anchorAtMs == 0L || haversineM(anchorLat, anchorLng, lat, lng) > 30d) {
            anchorLat = lat;
            anchorLng = lng;
            anchorAtMs = now;
        }

        Log.d(TAG, "SML location (" + source + "): " + lat + ", " + lng
                + (speedKmh != null ? " @ " + Math.round(speedKmh) + " km/h" : ""));
        updateCheckinLocation(lat, lng, speedKmh, anchorAtMs);
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

    /** ISO-8601 for an epoch, matching the format the PATCH already uses. */
    private static String isoTimestamp(long epochMs) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return Instant.ofEpochMilli(epochMs).toString();
        }
        java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        fmt.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return fmt.format(new java.util.Date(epochMs));
    }

    private void updateCheckinLocation(double lat, double lng, Double speedKmh, long stillSinceMs) {
        new Thread(() -> {
            try {
                String timestamp = isoTimestamp(System.currentTimeMillis());
                // speed_kmh rounded to one decimal; null when unknown.
                String speedStr = speedKmh != null
                        ? String.format(java.util.Locale.US, "%.1f", speedKmh)
                        : "null";

                String json = "{" +
                        "\"latitude\":" + lat + "," +
                        "\"longitude\":" + lng + "," +
                        "\"speed_kmh\":" + speedStr + "," +
                        "\"still_since\":\"" + isoTimestamp(stillSinceMs) + "\"," +
                        "\"location_updated_at\":\"" + timestamp + "\"," +
                        "\"updated_at\":\"" + timestamp + "\"" +
                        "}";

                // Read the freshest token from prefs (the JS layer pushes a
                // refreshed token here when Supabase rotates it), falling back
                // to the token captured at start.
                String token = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .getString("access_token", accessToken);

                Request request = new Request.Builder()
                        .url(supabaseUrl + "/rest/v1/safety_checkins?id=eq." + checkinId)
                        .patch(RequestBody.create(json, JSON_TYPE))
                        .addHeader("apikey", supabaseKey)
                        .addHeader("Authorization", "Bearer " + token)
                        .addHeader("Content-Type", "application/json")
                        .addHeader("Prefer", "return=minimal")
                        .build();

                Response response = httpClient.newCall(request).execute();
                int code = response.code();
                if (code >= 400) {
                    String body = response.body() != null ? response.body().string() : "";
                    Log.e(TAG, "SML location update failed: " + code + " " + body);
                } else {
                    Log.d(TAG, "SML location updated: " + code);
                }
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

    /** Remove the foreground notification across API levels (minSdk 24). */
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
        // The user swiped Peja out of recents. Android tears down the process
        // and this foreground service with it. If a check-in is still active,
        // schedule a near-immediate restart so location sharing survives the
        // swipe. Best-effort: aggressive OEM battery managers may still block
        // the relaunch, and the battery-optimization exemption greatly improves
        // the odds. START_STICKY + the prefs recovery above resume tracking.
        try {
            boolean active = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .getBoolean("is_active", false);
            if (active) {
                Intent restart = new Intent(getApplicationContext(), SMLLocationService.class);
                PendingIntent pi;
                int flags = PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    pi = PendingIntent.getForegroundService(this, 2, restart, flags);
                } else {
                    pi = PendingIntent.getService(this, 2, restart, flags);
                }
                AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (am != null) {
                    long at = System.currentTimeMillis() + 1000;
                    // setAndAllowWhileIdle fires even in Doze without needing
                    // the exact-alarm permission.
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                    } else {
                        am.set(AlarmManager.RTC_WAKEUP, at, pi);
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule restart on task removal", e);
        }
        super.onTaskRemoved(rootIntent);
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
        try {
            if (locationManager != null) {
                if (gpsListener != null) locationManager.removeUpdates(gpsListener);
                if (networkListener != null) locationManager.removeUpdates(networkListener);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error removing platform location updates", e);
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
