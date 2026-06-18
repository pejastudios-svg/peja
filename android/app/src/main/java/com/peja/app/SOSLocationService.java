package com.peja.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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

import java.io.IOException;
import java.time.Instant;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class SOSLocationService extends Service {

    public static final String TAG = "SOSLocationService";
    public static final String CHANNEL_ID = "peja_sos_channel";
    public static final int NOTIFICATION_ID = 9001;
    public static final String PREFS_NAME = "peja_sos_prefs";

    public static final String EXTRA_SOS_ID = "sos_id";
    public static final String EXTRA_SUPABASE_URL = "supabase_url";
    public static final String EXTRA_SUPABASE_KEY = "supabase_key";
    public static final String EXTRA_ACCESS_TOKEN = "access_token";
    public static final String EXTRA_MODE = "mode";
    public static final String EXTRA_HELPER_ID = "helper_id";
    public static final String EXTRA_SOS_OWNER_ID = "sos_owner_id";
    public static final String EXTRA_HELPER_NAME = "helper_name";

    public static final String ACTION_STOP = "com.peja.app.STOP_SOS_TRACKING";

    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private PowerManager.WakeLock wakeLock;
    // Guards against re-registering updates when onStartCommand is delivered
    // again to an already-running service (e.g. a revive push).
    private boolean tracking = false;

    private final OkHttpClient httpClient = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build();

    private String sosId = "";
    private String supabaseUrl = "";
    private String supabaseKey = "";
    private String accessToken = "";
    private String mode = "activator";
    private String helperId = "";
    private String sosOwnerId = "";
    private String helperName = "";

    @Override
    public void onCreate() {
        super.onCreate();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // CRITICAL: once started via startForegroundService(), Android requires
        // startForeground() within ~5s on EVERY path — even the stop/invalid
        // paths. Returning (even via stopSelf) without it crashes with
        // ForegroundServiceDidNotStartInTimeException. Promote to foreground
        // FIRST, before any branching, then stop afterward if needed.
        try {
            startForeground(NOTIFICATION_ID, buildNotification());
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed, stopping service", e);
            clearState();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Log.d(TAG, "Stop action received");
            // Cancel SOS in Supabase
            cancelSOSInSupabase();
            clearState();
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null && intent.getStringExtra(EXTRA_SOS_ID) != null) {
            sosId = intent.getStringExtra(EXTRA_SOS_ID);
            supabaseUrl = intent.getStringExtra(EXTRA_SUPABASE_URL) != null ? intent.getStringExtra(EXTRA_SUPABASE_URL) : "";
            supabaseKey = intent.getStringExtra(EXTRA_SUPABASE_KEY) != null ? intent.getStringExtra(EXTRA_SUPABASE_KEY) : "";
            accessToken = intent.getStringExtra(EXTRA_ACCESS_TOKEN) != null ? intent.getStringExtra(EXTRA_ACCESS_TOKEN) : "";
            mode = intent.getStringExtra(EXTRA_MODE) != null ? intent.getStringExtra(EXTRA_MODE) : "activator";
            helperId = intent.getStringExtra(EXTRA_HELPER_ID) != null ? intent.getStringExtra(EXTRA_HELPER_ID) : "";
            sosOwnerId = intent.getStringExtra(EXTRA_SOS_OWNER_ID) != null ? intent.getStringExtra(EXTRA_SOS_OWNER_ID) : "";
            helperName = intent.getStringExtra(EXTRA_HELPER_NAME) != null ? intent.getStringExtra(EXTRA_HELPER_NAME) : "";
        } else {
            // Restart with no extras — START_STICKY restart after the process
            // was killed (e.g. the user swiped the app from recents). Recover
            // the in-flight SOS from prefs and resume tracking.
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            if (prefs.getBoolean("is_active", false)) {
                sosId = prefs.getString("sos_id", "");
                supabaseUrl = prefs.getString("supabase_url", "");
                supabaseKey = prefs.getString("supabase_key", "");
                accessToken = prefs.getString("access_token", "");
                mode = prefs.getString("mode", "activator");
                helperId = prefs.getString("helper_id", "");
                sosOwnerId = prefs.getString("sos_owner_id", "");
                helperName = prefs.getString("helper_name", "");
                Log.d(TAG, "Recovered SOS from prefs: " + sosId);
            }
        }

        if (sosId.isEmpty() || supabaseUrl.isEmpty() || supabaseKey.isEmpty()) {
            Log.e(TAG, "No active SOS to track, stopping");
            clearState();
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        saveState();

        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "peja:sos_location_lock"
        );
        wakeLock.acquire(5 * 60 * 60 * 1000L); // 5 hours max

        startLocationUpdates();

        Log.d(TAG, "Service started - mode: " + mode + ", sosId: " + sosId);

        return START_STICKY;
    }

    private void startLocationUpdates() {
        if (tracking) return; // already registered — avoid duplicate listeners
        tracking = true;

        // Strict 15s cadence regardless of movement. Previously this was
        // 10s preferred / 20m distance filter, which meant a stationary
        // user got no updates at all. SOS requires continuous tracking even
        // when motionless — pinning interval == minInterval == maxDelay
        // forces an update every ~15s as long as a fresh fix is available.
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
                double bearing = result.getLastLocation().hasBearing()
                        ? result.getLastLocation().getBearing()
                        : 0.0;

                Log.d(TAG, "Location update: " + lat + ", " + lng + " (mode: " + mode + ")");

                if ("activator".equals(mode)) {
                    updateSOSLocation(lat, lng, bearing);
                } else {
                    updateHelperLocation(lat, lng);
                }
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

    private void updateSOSLocation(double lat, double lng, double bearing) {
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
                        "\"bearing\":" + bearing + "," +
                        "\"last_updated\":\"" + timestamp + "\"" +
                        "}";

                Request request = new Request.Builder()
                        .url(supabaseUrl + "/rest/v1/sos_alerts?id=eq." + sosId)
                        .patch(RequestBody.create(json, JSON_TYPE))
                        .addHeader("apikey", supabaseKey)
                        .addHeader("Authorization", "Bearer " + accessToken)
                        .addHeader("Content-Type", "application/json")
                        .addHeader("Prefer", "return=minimal")
                        .build();

                Response response = httpClient.newCall(request).execute();
                Log.d(TAG, "SOS location updated: " + response.code());
                response.close();
            } catch (Exception e) {
                Log.e(TAG, "Failed to update SOS location", e);
            }
        }).start();
    }

    private void updateHelperLocation(double lat, double lng) {
        new Thread(() -> {
            try {
                Request getRequest = new Request.Builder()
                        .url(supabaseUrl + "/rest/v1/sos_alerts?id=eq." + sosId + "&select=latitude,longitude,status")
                        .get()
                        .addHeader("apikey", supabaseKey)
                        .addHeader("Authorization", "Bearer " + accessToken)
                        .build();

                Response getResponse = httpClient.newCall(getRequest).execute();
                String body = getResponse.body() != null ? getResponse.body().string() : "[]";
                getResponse.close();

                if (body.contains("\"status\":\"active\"")) {
                    Double sosLat = extractDouble(body, "latitude");
                    Double sosLng = extractDouble(body, "longitude");

                    if (sosLat != null && sosLng != null) {
                        double distanceKm = haversineKm(lat, lng, sosLat, sosLng);
                        long etaMinutes = Math.max(1, Math.round((distanceKm / 30.0) * 60.0));

                        String notifJson = "{" +
                                "\"user_id\":\"" + sosOwnerId + "\"," +
                                "\"type\":\"sos_alert\"," +
                                "\"title\":\"Helper update\"," +
                                "\"body\":\"" + helperName + " is " + etaMinutes + " min away\"," +
                                "\"is_read\":false," +
                                "\"data\":{" +
                                "\"sos_id\":\"" + sosId + "\"," +
                                "\"helper_id\":\"" + helperId + "\"," +
                                "\"helper_name\":\"" + helperName + "\"," +
                                "\"helper_lat\":" + lat + "," +
                                "\"helper_lng\":" + lng + "," +
                                "\"eta_minutes\":" + etaMinutes + "," +
                                "\"is_location_update\":true" +
                                "}" +
                                "}";

                        Request notifRequest = new Request.Builder()
                                .url(supabaseUrl + "/rest/v1/notifications")
                                .post(RequestBody.create(notifJson, JSON_TYPE))
                                .addHeader("apikey", supabaseKey)
                                .addHeader("Authorization", "Bearer " + accessToken)
                                .addHeader("Content-Type", "application/json")
                                .addHeader("Prefer", "return=minimal")
                                .build();

                        Response notifResponse = httpClient.newCall(notifRequest).execute();
                        Log.d(TAG, "Helper location sent: " + notifResponse.code() + ", ETA: " + etaMinutes + " min");
                        notifResponse.close();

                        if (distanceKm <= 0.3) {
                            Log.d(TAG, "Helper arrived! Stopping tracking.");
                            clearState();
                            stopSelf();
                        }
                    }
                } else {
                    Log.d(TAG, "SOS no longer active, stopping");
                    clearState();
                    stopSelf();
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to update helper location", e);
            }
        }).start();
    }

    private double haversineKm(double lat1, double lng1, double lat2, double lng2) {
        double R = 6371.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                        Math.sin(dLng / 2) * Math.sin(dLng / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private Double extractDouble(String json, String key) {
        Pattern pattern = Pattern.compile("\"" + key + "\"\\s*:\\s*([\\d.\\-]+)");
        Matcher matcher = pattern.matcher(json);
        if (matcher.find()) {
            try {
                return Double.parseDouble(matcher.group(1));
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private Notification buildNotification() {
        Intent openIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openPending = PendingIntent.getActivity(
                this, 0, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent stopIntent = new Intent(this, SOSLocationService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(
                this, 1, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String title = "activator".equals(mode) ? "SOS Active" : "Helping Someone";
        String text = "activator".equals(mode)
                ? "Your location is being shared with helpers"
                : "Tracking your location to help";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setOngoing(true)
                .setContentIntent(openPending)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPending)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "SOS Location Tracking",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Shows when SOS location tracking is active");
            channel.setShowBadge(false);

            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private void saveState() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putString("sos_id", sosId)
                .putString("supabase_url", supabaseUrl)
                .putString("supabase_key", supabaseKey)
                .putString("access_token", accessToken)
                .putString("mode", mode)
                .putString("helper_id", helperId)
                .putString("sos_owner_id", sosOwnerId)
                .putString("helper_name", helperName)
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

        private void cancelSOSInSupabase() {
        // Read saved state to get credentials
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String savedSosId = prefs.getString("sos_id", "");
        String savedUrl = prefs.getString("supabase_url", "");
        String savedKey = prefs.getString("supabase_key", "");
        String savedToken = prefs.getString("access_token", "");
        String savedMode = prefs.getString("mode", "activator");

        // Only cancel the SOS if this is the activator (not a helper)
        if (!"activator".equals(savedMode) || savedSosId.isEmpty() || savedUrl.isEmpty()) {
            return;
        }

        new Thread(() -> {
            try {
                String timestamp;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    timestamp = java.time.Instant.now().toString();
                } else {
                    timestamp = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                            java.util.Locale.US).format(new java.util.Date());
                }

                String json = "{" +
                        "\"status\":\"cancelled\"," +
                        "\"resolved_at\":\"" + timestamp + "\"" +
                        "}";

                Request request = new Request.Builder()
                        .url(savedUrl + "/rest/v1/sos_alerts?id=eq." + savedSosId)
                        .patch(RequestBody.create(json, JSON_TYPE))
                        .addHeader("apikey", savedKey)
                        .addHeader("Authorization", "Bearer " + savedToken)
                        .addHeader("Content-Type", "application/json")
                        .addHeader("Prefer", "return=minimal")
                        .build();

                Response response = httpClient.newCall(request).execute();
                Log.d(TAG, "SOS cancelled in Supabase: " + response.code());
                response.close();
            } catch (Exception e) {
                Log.e(TAG, "Failed to cancel SOS in Supabase", e);
            }
        }).start();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The user swiped Peja out of recents. If an SOS is still active,
        // schedule a near-immediate restart so location sharing survives the
        // swipe. Best-effort: aggressive OEM battery managers may still block
        // the relaunch; the battery-optimization exemption greatly improves the
        // odds. START_STICKY + the prefs recovery above resume tracking.
        try {
            boolean active = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .getBoolean("is_active", false);
            if (active) {
                Intent restart = new Intent(getApplicationContext(), SOSLocationService.class);
                PendingIntent pi;
                int flags = PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    pi = PendingIntent.getForegroundService(this, 3, restart, flags);
                } else {
                    pi = PendingIntent.getService(this, 3, restart, flags);
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
        Log.d(TAG, "Service destroyed");
        try {
            if (locationCallback != null) {
                fusedLocationClient.removeLocationUpdates(locationCallback);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error removing location updates", e);
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