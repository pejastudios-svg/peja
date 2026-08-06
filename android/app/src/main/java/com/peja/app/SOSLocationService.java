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

    // Consecutive failed Supabase writes. At the threshold (~90s of dead
    // writes at the 15s cadence) the notification flips to an honest "needs
    // attention" state; any successful write flips it back.
    private static final int FAILURE_NOTIFY_THRESHOLD = 6;
    // Helper mode only: after ~20 min of nonstop failures (revoked session,
    // permanent auth loss) stop the service entirely. Helper tracking is
    // best-effort; without this cap a dead session would keep high-accuracy
    // GPS running for the full 5h wakelock with zero data reaching anyone.
    // Activator tracking is safety-critical and is never auto-stopped.
    private static final int HELPER_ABORT_THRESHOLD = 80;
    private final java.util.concurrent.atomic.AtomicInteger writeFailures =
            new java.util.concurrent.atomic.AtomicInteger(0);
    private volatile boolean degradedNotified = false;

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
            // Pass the LIVE degraded flag: onStartCommand is re-delivered to a
            // running instance (revive pushes, JS re-start after a WebView
            // reload), and hardcoding a healthy notification here would mask
            // an active "writes are failing" state with no way back.
            startForeground(NOTIFICATION_ID, buildNotification(degradedNotified));
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

        // The startForeground above ran before the intent extras or prefs
        // populated the mode field, so a helper session briefly shows the
        // activator wording. Re-post now that mode is known.
        refreshNotification(degradedNotified);

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

                Request.Builder builder = new Request.Builder()
                        .url(supabaseUrl + "/rest/v1/sos_alerts?id=eq." + sosId)
                        .patch(RequestBody.create(json, JSON_TYPE))
                        .addHeader("apikey", supabaseKey)
                        .addHeader("Content-Type", "application/json")
                        .addHeader("Prefer", "return=minimal");

                Response response = executeAuthed(builder);
                int code = response.code();
                if (code >= 400) {
                    String body = response.body() != null ? response.body().string() : "";
                    Log.e(TAG, "SOS location update failed: " + code + " " + body);
                } else {
                    Log.d(TAG, "SOS location updated: " + code);
                }
                response.close();
                noteWriteResult(code < 400);
            } catch (Exception e) {
                Log.e(TAG, "Failed to update SOS location", e);
                noteWriteResult(false);
            }
        }).start();
    }

    /**
     * Execute a Supabase request with a self-refreshing session. Uses the
     * shared token store (kept fresh by PejaSupabaseAuth, which refreshes
     * natively before expiry), and on a 401 forces one refresh and retries
     * once. This is what keeps a multi-hour SOS writing locations long
     * after the original one-hour token has expired.
     */
    private Response executeAuthed(Request.Builder builder) throws IOException {
        String token = PejaSupabaseAuth.getValidAccessToken(
                this, httpClient, supabaseUrl, supabaseKey, accessToken);
        Response response = httpClient.newCall(
                builder.header("Authorization", "Bearer " + token).build()).execute();
        // 401 only: PostgREST returns 403 for RLS denial with a perfectly
        // valid token, and refreshing on it would rotate the session on
        // every 15s tick without ever fixing the failure.
        if (response.code() == 401) {
            response.close();
            String fresh = PejaSupabaseAuth.forceRefresh(
                    this, httpClient, supabaseUrl, supabaseKey, token);
            String retryToken = (fresh != null && !fresh.isEmpty()) ? fresh : token;
            response = httpClient.newCall(
                    builder.header("Authorization", "Bearer " + retryToken).build()).execute();
        }
        return response;
    }

    /**
     * Track consecutive Supabase write failures so the notification stays
     * honest: after sustained failures the text flips to a "needs attention"
     * state instead of claiming the location is being shared, and flips back
     * the moment a write lands again.
     */
    private void noteWriteResult(boolean ok) {
        if (ok) {
            writeFailures.set(0);
            if (degradedNotified) {
                degradedNotified = false;
                refreshNotification(false);
            }
        } else {
            int failures = writeFailures.incrementAndGet();
            if (failures >= FAILURE_NOTIFY_THRESHOLD && !degradedNotified) {
                degradedNotified = true;
                refreshNotification(true);
            }
        }
    }

    private void refreshNotification(boolean degraded) {
        try {
            NotificationManager manager =
                    (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, buildNotification(degraded));
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to update notification state", e);
        }
    }

    private void updateHelperLocation(double lat, double lng) {
        new Thread(() -> {
            try {
                Request.Builder getBuilder = new Request.Builder()
                        .url(supabaseUrl + "/rest/v1/sos_alerts?id=eq." + sosId + "&select=latitude,longitude,status")
                        .get()
                        .addHeader("apikey", supabaseKey);

                Response getResponse = executeAuthed(getBuilder);
                int getCode = getResponse.code();
                String body = getResponse.body() != null ? getResponse.body().string() : "[]";
                getResponse.close();

                if (getCode >= 400) {
                    // An auth or network failure is NOT the same as "SOS
                    // ended". Before this guard, a 401 body (no status field)
                    // fell through to the else branch and silently killed the
                    // helper's tracking. Keep trying; the next tick retries.
                    Log.e(TAG, "SOS status check failed: " + getCode + " " + body);
                    noteWriteResult(false);
                    abortHelperIfDead();
                    return;
                }

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

                        Request.Builder notifBuilder = new Request.Builder()
                                .url(supabaseUrl + "/rest/v1/notifications")
                                .post(RequestBody.create(notifJson, JSON_TYPE))
                                .addHeader("apikey", supabaseKey)
                                .addHeader("Content-Type", "application/json")
                                .addHeader("Prefer", "return=minimal");

                        Response notifResponse = executeAuthed(notifBuilder);
                        int notifCode = notifResponse.code();
                        if (notifCode >= 400) {
                            String notifBody = notifResponse.body() != null ? notifResponse.body().string() : "";
                            Log.e(TAG, "Helper location send failed: " + notifCode + " " + notifBody);
                        } else {
                            Log.d(TAG, "Helper location sent: " + notifCode + ", ETA: " + etaMinutes + " min");
                        }
                        notifResponse.close();
                        noteWriteResult(notifCode < 400);
                        if (notifCode >= 400) abortHelperIfDead();

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
                noteWriteResult(false);
                abortHelperIfDead();
            }
        }).start();
    }

    /**
     * Helper mode only: stop the service after a sustained failure window.
     * noteWriteResult resets the counter on any success, so this fires only
     * when nothing has reached Supabase for ~20 minutes straight.
     */
    private void abortHelperIfDead() {
        if (!"helper".equals(mode)) return;
        if (writeFailures.get() < HELPER_ABORT_THRESHOLD) return;
        Log.e(TAG, "Helper status checks failing persistently, stopping best-effort helper tracking");
        clearState();
        stopForegroundCompat();
        stopSelf();
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

    private Notification buildNotification(boolean degraded) {
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
        if (degraded) {
            title = "activator".equals(mode)
                    ? "SOS needs attention"
                    : "Helper tracking needs attention";
            text = "Location updates are failing. Open Peja to fix this.";
        }

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

                // Same self-refreshing auth as the location writes, but built
                // from the saved prefs because the stop path can run before
                // the instance fields are populated.
                Request.Builder builder = new Request.Builder()
                        .url(savedUrl + "/rest/v1/sos_alerts?id=eq." + savedSosId)
                        .patch(RequestBody.create(json, JSON_TYPE))
                        .addHeader("apikey", savedKey)
                        .addHeader("Content-Type", "application/json")
                        .addHeader("Prefer", "return=minimal");

                String token = PejaSupabaseAuth.getValidAccessToken(
                        SOSLocationService.this, httpClient, savedUrl, savedKey, savedToken);
                Response response = httpClient.newCall(
                        builder.header("Authorization", "Bearer " + token).build()).execute();
                if (response.code() == 401) {
                    response.close();
                    String fresh = PejaSupabaseAuth.forceRefresh(
                            SOSLocationService.this, httpClient, savedUrl, savedKey, token);
                    String retryToken = (fresh != null && !fresh.isEmpty()) ? fresh : token;
                    response = httpClient.newCall(
                            builder.header("Authorization", "Bearer " + retryToken).build()).execute();
                }
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