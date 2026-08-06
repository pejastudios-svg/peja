package com.peja.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Shared Supabase session store + refresher for the native location services.
 *
 * Why this exists: the foreground services (SML + SOS) can outlive the WebView
 * by hours, but a Supabase access token expires after about one hour. Before
 * this class, the services kept PATCHing with the token captured at start and
 * every write silently 401'd once it expired, which is exactly the "location
 * frozen at one spot" bug. The services now refresh their own session natively
 * so tracking keeps working with the app backgrounded or killed.
 *
 * Design constraints this class enforces:
 *  - ONE token store for the whole app (peja_auth_prefs). Supabase rotates the
 *    refresh token on every use; if SML and SOS each kept their own copy, the
 *    first service to refresh would invalidate the other's copy and kill its
 *    session. A single store means there is only ever one current pair.
 *  - Single-flight refresh. All refreshes go through one static lock, and the
 *    winner re-checks the store first, so two services hitting a 401 in the
 *    same second perform ONE network refresh, not two racing ones.
 *  - Rate-limited failure. If Supabase rejects the refresh (network down,
 *    token revoked), we back off instead of hammering the auth endpoint every
 *    15s location tick.
 */
public final class PejaSupabaseAuth {

    private static final String TAG = "PejaSupabaseAuth";
    public static final String PREFS_NAME = "peja_auth_prefs";
    private static final String KEY_ACCESS = "access_token";
    private static final String KEY_REFRESH = "refresh_token";

    private static final MediaType JSON_TYPE = MediaType.get("application/json");

    /**
     * Refresh proactively when the token expires within this window. MUST
     * stay below supabase-js's auto refresh margin (~90s before expiry):
     * while the WebView is visible its refresher has to win the race and
     * push the rotated pair down via updateToken. If the native side rotated
     * first, the WebView would later replay the consumed refresh token and
     * GoTrue's reuse detection would revoke the whole session family.
     * NOTE: a backgrounded WebView is NOT race free. supabase-js stops its
     * refresh ticker when hidden and recovers with its persisted (stale)
     * pair on resume; the JS storage adapter in supabase.ts merges the
     * natively rotated pair into that read, and that merge is what makes
     * native rotations here safe. Do not widen this margin past 90s.
     */
    private static final long EXPIRY_MARGIN_SECONDS = 60;
    /** After a failed refresh, do not retry the auth endpoint for this long. */
    private static final long FAILURE_BACKOFF_MS = 20_000L;

    private static final Object LOCK = new Object();
    private static volatile long lastRefreshFailureMs = 0L;

    private PejaSupabaseAuth() {
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /**
     * Persist the current session pair. An empty/null refresh token keeps the
     * stored one (callers may only have a new access token in hand).
     *
     * Two guards protect the stored pair:
     *  - Recency: an incoming access token that expires EARLIER than the
     *    stored one is ignored. Without this, a relaunching WebView holding a
     *    cached pre-rotation session would clobber a fresher natively
     *    refreshed pair, orphaning the only live refresh token.
     *  - Account change: when the incoming token belongs to a different user
     *    (JWT sub differs), the old refresh token is dropped rather than
     *    kept, so a new sign-in can never get paired with a previous
     *    account's refresh token.
     */
    public static void storeTokens(Context ctx, String accessToken, String refreshToken) {
        if (accessToken == null || accessToken.isEmpty()) return;
        synchronized (LOCK) {
            SharedPreferences p = prefs(ctx);
            String stored = p.getString(KEY_ACCESS, "");
            boolean accountChanged = false;
            if (stored != null && !stored.isEmpty() && !stored.equals(accessToken)) {
                String storedSub = jwtSub(stored);
                String incomingSub = jwtSub(accessToken);
                if (!storedSub.isEmpty() && !incomingSub.isEmpty()
                        && !storedSub.equals(incomingSub)) {
                    accountChanged = true;
                } else {
                    long storedExp = jwtExpSeconds(stored);
                    long incomingExp = jwtExpSeconds(accessToken);
                    if (storedExp > 0 && incomingExp > 0 && incomingExp < storedExp) {
                        Log.w(TAG, "Ignoring older token pair (incoming exp "
                                + incomingExp + " < stored " + storedExp + ")");
                        return;
                    }
                }
            }
            SharedPreferences.Editor editor = p.edit().putString(KEY_ACCESS, accessToken);
            if (refreshToken != null && !refreshToken.isEmpty()) {
                editor.putString(KEY_REFRESH, refreshToken);
            } else if (accountChanged) {
                editor.remove(KEY_REFRESH);
            }
            // commit, not apply: a rotated refresh token exists nowhere else,
            // so an OEM kill right after rotation must not lose the async
            // write. All callers are off the main thread.
            editor.commit();
        }
    }

    /** Stored access token, or empty. Exposed for the plugins' getTokens. */
    public static String readAccess(Context ctx) {
        String v = prefs(ctx).getString(KEY_ACCESS, "");
        return v != null ? v : "";
    }

    /** Stored refresh token, or empty. Exposed for the plugins' getTokens. */
    public static String readRefresh(Context ctx) {
        String v = prefs(ctx).getString(KEY_REFRESH, "");
        return v != null ? v : "";
    }

    /**
     * Wipe the stored pair. Called on sign-out so a valid refresh token for
     * the old account never lingers on disk.
     */
    public static void clear(Context ctx) {
        synchronized (LOCK) {
            prefs(ctx).edit().remove(KEY_ACCESS).remove(KEY_REFRESH).commit();
        }
    }

    /**
     * Best current access token for a Supabase call. Returns the stored token
     * (or the caller's fallback when the store is empty, e.g. right after an
     * app update restored an old service), refreshing it first when it is
     * expired or about to expire. Never returns null; callers still handle a
     * 401 with forceRefresh for the cases where the exp claim lied on us.
     */
    public static String getValidAccessToken(Context ctx, OkHttpClient http,
                                             String supabaseUrl, String anonKey,
                                             String fallback) {
        String access = prefs(ctx).getString(KEY_ACCESS, "");
        String fb = fallback != null ? fallback : "";
        if (access == null || access.isEmpty()) {
            access = fb;
        } else if (!fb.isEmpty() && !fb.equals(access)) {
            // Prefer whichever token is fresher. The store can hold a stale
            // pair from a previous tracking session while the caller carries
            // a fresh token from the start intent (the async seed may not
            // have landed yet); using the stale one would trigger a refresh
            // with a long-consumed refresh token and risk revoking the
            // current session family.
            long storedExp = jwtExpSeconds(access);
            long fbExp = jwtExpSeconds(fb);
            if (fbExp > storedExp) access = fb;
        }
        if (access.isEmpty()) return "";

        long exp = jwtExpSeconds(access);
        long nowSec = System.currentTimeMillis() / 1000L;
        if (exp > 0 && nowSec >= exp - EXPIRY_MARGIN_SECONDS) {
            String fresh = refreshLocked(ctx, http, supabaseUrl, anonKey, access);
            if (fresh != null && !fresh.isEmpty()) return fresh;
        }
        return access;
    }

    /**
     * A call just failed with 401: refresh the session now. Returns the new
     * access token, or null when refresh is impossible right now (no refresh
     * token, network down, backoff window). If another thread refreshed while
     * we waited on the lock, its result is returned without a second network
     * round trip.
     */
    public static String forceRefresh(Context ctx, OkHttpClient http,
                                      String supabaseUrl, String anonKey,
                                      String failedToken) {
        return refreshLocked(ctx, http, supabaseUrl, anonKey, failedToken);
    }

    private static String refreshLocked(Context ctx, OkHttpClient http,
                                        String supabaseUrl, String anonKey,
                                        String staleToken) {
        if (supabaseUrl == null || supabaseUrl.isEmpty()
                || anonKey == null || anonKey.isEmpty()) {
            return null;
        }
        synchronized (LOCK) {
            // Someone else may have refreshed while we waited on the lock.
            String current = prefs(ctx).getString(KEY_ACCESS, "");
            if (current != null && !current.isEmpty() && !current.equals(staleToken)) {
                long exp = jwtExpSeconds(current);
                long nowSec = System.currentTimeMillis() / 1000L;
                if (exp <= 0 || nowSec < exp - 30) {
                    return current;
                }
            }

            long now = System.currentTimeMillis();
            if (now - lastRefreshFailureMs < FAILURE_BACKOFF_MS) {
                return null;
            }

            String refreshToken = prefs(ctx).getString(KEY_REFRESH, "");
            if (refreshToken == null || refreshToken.isEmpty()) {
                Log.w(TAG, "No refresh token stored; cannot refresh session natively");
                lastRefreshFailureMs = now;
                return null;
            }

            try {
                String body = new JSONObject().put("refresh_token", refreshToken).toString();
                Request request = new Request.Builder()
                        .url(supabaseUrl + "/auth/v1/token?grant_type=refresh_token")
                        .post(RequestBody.create(body, JSON_TYPE))
                        .addHeader("apikey", anonKey)
                        .addHeader("Content-Type", "application/json")
                        .build();

                Response response = http.newCall(request).execute();
                String responseBody = response.body() != null ? response.body().string() : "";
                int code = response.code();
                response.close();

                if (code >= 200 && code < 300) {
                    JSONObject json = new JSONObject(responseBody);
                    String newAccess = json.optString("access_token", "");
                    String newRefresh = json.optString("refresh_token", "");
                    if (!newAccess.isEmpty()) {
                        storeTokens(ctx, newAccess, newRefresh);
                        Log.d(TAG, "Session refreshed natively");
                        return newAccess;
                    }
                    Log.e(TAG, "Refresh response had no access_token");
                } else {
                    // 400 with "refresh_token_not_found" or similar usually
                    // means the WebView rotated the session after our copy was
                    // stored. AuthContext pushes every rotation down through
                    // updateToken, so the store heals on the next JS refresh
                    // or app resume.
                    Log.e(TAG, "Session refresh failed: " + code + " "
                            + responseBody.substring(0, Math.min(responseBody.length(), 200)));
                }
            } catch (Exception e) {
                Log.e(TAG, "Session refresh error", e);
            }
            lastRefreshFailureMs = System.currentTimeMillis();
            return null;
        }
    }

    /**
     * Epoch seconds from the JWT exp claim, or 0 when unparsable. A 0 means
     * "unknown": callers skip proactive refresh and rely on the 401 retry.
     */
    static long jwtExpSeconds(String jwt) {
        JSONObject payload = jwtPayload(jwt);
        return payload != null ? payload.optLong("exp", 0) : 0;
    }

    /** User id from the JWT sub claim, or empty when unparsable. */
    static String jwtSub(String jwt) {
        JSONObject payload = jwtPayload(jwt);
        return payload != null ? payload.optString("sub", "") : "";
    }

    private static JSONObject jwtPayload(String jwt) {
        try {
            String[] parts = jwt.split("\\.");
            if (parts.length < 2) return null;
            byte[] decoded = Base64.decode(parts[1],
                    Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            return new JSONObject(new String(decoded, "UTF-8"));
        } catch (Exception e) {
            return null;
        }
    }
}
