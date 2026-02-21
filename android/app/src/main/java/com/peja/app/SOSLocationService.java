package com.peja.app;

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
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Log.d(TAG, "Stop action received");
            // Cancel SOS in Supabase
            cancelSOSInSupabase();
            clearState();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null) {
            sosId = intent.getStringExtra(EXTRA_SOS_ID) != null ? intent.getStringExtra(EXTRA_SOS_ID) : "";
            supabaseUrl = intent.getStringExtra(EXTRA_SUPABASE_URL) != null ? intent.getStringExtra(EXTRA_SUPABASE_URL) : "";
            supabaseKey = intent.getStringExtra(EXTRA_SUPABASE_KEY) != null ? intent.getStringExtra(EXTRA_SUPABASE_KEY) : "";
            accessToken = intent.getStringExtra(EXTRA_ACCESS_TOKEN) != null ? intent.getStringExtra(EXTRA_ACCESS_TOKEN) : "";
            mode = intent.getStringExtra(EXTRA_MODE) != null ? intent.getStringExtra(EXTRA_MODE) : "activator";
            helperId = intent.getStringExtra(EXTRA_HELPER_ID) != null ? intent.getStringExtra(EXTRA_HELPER_ID) : "";
            sosOwnerId = intent.getStringExtra(EXTRA_SOS_OWNER_ID) != null ? intent.getStringExtra(EXTRA_SOS_OWNER_ID) : "";
            helperName = intent.getStringExtra(EXTRA_HELPER_NAME) != null ? intent.getStringExtra(EXTRA_HELPER_NAME) : "";
        }

        if (sosId.isEmpty() || supabaseUrl.isEmpty() || supabaseKey.isEmpty()) {
            Log.e(TAG, "Missing required data, stopping");
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

        Notification notification = buildNotification();
        startForeground(NOTIFICATION_ID, notification);

        startLocationUpdates();

        Log.d(TAG, "Service started - mode: " + mode + ", sosId: " + sosId);

        return START_STICKY;
    }

    private void startLocationUpdates() {
        LocationRequest locationRequest = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                10_000L
        )
                .setMinUpdateDistanceMeters(20f)
                .setMinUpdateIntervalMillis(5_000L)
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