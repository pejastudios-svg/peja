import { supabase } from "./supabase";

export type NotificationType = 
  | "sos_alert"
  | "nearby_incident"
  | "post_confirmed"
  | "post_comment"
  | "comment_liked"
  | "guardian_approved"
  | "guardian_rejected"
  | "system"
  | "post_comment"
  | "comment_reply"
  | "comment_liked"
  | "dm_message";       


interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, any>;
}

// ============================================
// CORE NOTIFICATION FUNCTION
// ============================================
export async function createNotification({
  userId,
  type,
  title,
  body,
  data,
}: CreateNotificationParams): Promise<boolean> {
  try {
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      type,
      title,
      body,
      data: data || {},
      is_read: false,
    });

    if (error) {
      console.error("Error creating notification:", error);
      return false;
    }

    // Also send FCM push notification (fire and forget)
    sendFCMPush(userId, title, body || "", data || {}).catch((err) => {
      console.warn("[FCM] Push failed (non-blocking):", err);
    });

    return true;
  } catch (error) {
    console.error("Notification error:", error);
    return false;
  }
}

async function sendFCMPush(
  userId: string,
  title: string,
  body: string,
  data: Record<string, any>
): Promise<void> {
  try {
    const { data: authData } = await supabase.auth.getSession();
    const token = authData.session?.access_token;

    if (!token) return;

    // Convert all data values to strings (FCM requirement)
    const stringData: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      stringData[key] = String(value ?? "");
    }

    const { apiUrl } = await import("./api");

    await fetch(apiUrl("/api/send-push"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId,
        title,
        body,
        data: stringData,
      }),
    });
  } catch (err) {
    // Non-blocking, don't throw
    console.warn("[FCM] Push send error:", err);
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Calculate distance between two points in km (Haversine formula)
function calculateDistanceKm(
  lat1: number, 
  lon1: number, 
  lat2: number, 
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Check if current time is within quiet hours
function isInQuietHours(start: string, end: string): boolean {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTimeMinutes = currentHour * 60 + currentMinute;

  const [startHour, startMin] = start.split(':').map(Number);
  const [endHour, endMin] = end.split(':').map(Number);
  const startTimeMinutes = startHour * 60 + startMin;
  const endTimeMinutes = endHour * 60 + endMin;

  if (startTimeMinutes > endTimeMinutes) {
    // Overnight quiet hours (e.g., 23:00 - 07:00)
    return currentTimeMinutes >= startTimeMinutes || currentTimeMinutes <= endTimeMinutes;
  } else {
    // Same-day quiet hours
    return currentTimeMinutes >= startTimeMinutes && currentTimeMinutes <= endTimeMinutes;
  }
}

// Nigerian states list
const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun",
  "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"
];

// Extract state from address string
function extractStateFromAddress(address: string | null): string | null {
  if (!address) return null;
  
  const addressLower = address.toLowerCase();
  for (const state of NIGERIAN_STATES) {
    if (addressLower.includes(state.toLowerCase())) {
      return state;
    }
  }
  
  return null;
}

// Category classification
const DANGER_CATEGORIES = ["crime", "fire", "accident", "police", "flooding"]; // ← Added flooding
const CAUTION_CATEGORIES = ["roadwork", "traffic", "outage"];
const AWARENESS_CATEGORIES = ["protest", "event", "animal", "noise"];
const INFO_CATEGORIES = ["general", "closure", "transport"];

function getCategoryType(category: string): "danger" | "caution" | "awareness" | "info" {
  if (DANGER_CATEGORIES.includes(category)) return "danger";
  if (CAUTION_CATEGORIES.includes(category)) return "caution";
  if (AWARENESS_CATEGORIES.includes(category)) return "awareness";
  return "info";
}

function getCategoryName(category: string): string {
  const names: Record<string, string> = {
    crime: "Crime",
    fire: "Fire",
    accident: "Accident",
    police: "Police Activity",
    roadwork: "Road Work",
    traffic: "Traffic",
    outage: "Power Outage",
    flooding: "Flooding",
    protest: "Protest",
    event: "Event",
    animal: "Animal Hazard",
    noise: "Disturbance",
    general: "General",
    closure: "Closure",
    transport: "Transport",
  };
  return names[category] || "Incident";
}

// ============================================
// MAIN NOTIFICATION LOGIC
// ============================================

interface UserWithSettings {
  id: string;
  last_latitude: number | null;
  last_longitude: number | null;
  settings: {
    push_enabled: boolean;
    danger_alerts: boolean;
    caution_alerts: boolean;
    awareness_alerts: boolean;
    info_alerts: boolean;
    alert_zone_type: string;
    selected_states: string[];
    alert_radius_km: number;
    quiet_hours_enabled: boolean;
    quiet_hours_start: string;
    quiet_hours_end: string;
  } | null;
}

// =====================================================
// UPDATED shouldNotifyUser FUNCTION
// =====================================================
async function shouldNotifyUser(
  user: UserWithSettings,
  category: string,
  postLatitude: number | null,
  postLongitude: number | null,
  postAddress: string | null
): Promise<boolean> {
  const settings = user.settings;
  const catType = getCategoryType(category);

  console.log(`\n🔍 Checking user ${user.id.slice(0, 8)}...`);

  // ============================================
  // CASE 1: No settings - BLOCK
  // ============================================
  if (!settings) {
    console.log(`  ✗ No settings found - BLOCKING`);
    return false;
  }

  // ============================================
  // CASE 2: Push notifications disabled
  // ============================================
  if (settings.push_enabled === false) {
    console.log(`  ✗ Push notifications DISABLED`);
    return false;
  }

  // ============================================
  // CASE 3: Check category preferences
  // ============================================
  console.log(`  📂 Category: ${category} (type: ${catType})`);
  
  switch (catType) {
    case "danger":
      if (settings.danger_alerts === false) {
        console.log(`  ✗ 🔴 Danger alerts DISABLED`);
        return false;
      }
      console.log(`  ✓ 🔴 Danger alerts enabled`);
      break;
      
    case "caution":
      if (settings.caution_alerts === false) {
        console.log(`  ✗ 🟠 Caution alerts DISABLED`);
        return false;
      }
      console.log(`  ✓ 🟠 Caution alerts enabled`);
      break;
      
    case "awareness":
      if (settings.awareness_alerts === false) {
        console.log(`  ✗ 🟡 Awareness alerts DISABLED`);
        return false;
      }
      console.log(`  ✓ 🟡 Awareness alerts enabled`);
      break;
      
    case "info":
      if (settings.info_alerts === false) {
        console.log(`  ✗ 🔵 Info alerts DISABLED`);
        return false;
      }
      console.log(`  ✓ 🔵 Info alerts enabled`);
      break;
  }

  // ============================================
  // CASE 4: Check quiet hours
  // ============================================
  if (settings.quiet_hours_enabled) {
    const start = settings.quiet_hours_start || "23:00";
    const end = settings.quiet_hours_end || "07:00";
    
    if (isInQuietHours(start, end)) {
      if (catType !== "danger") {
        console.log(`  ✗ Quiet hours active - only danger allowed`);
        return false;
      }
      console.log(`  ✓ Quiet hours active but danger category`);
    }
  }

  // ============================================
  // CASE 5: Check location/zone preferences
  // ============================================
  const alertZoneType = settings.alert_zone_type || "all_nigeria";
  console.log(`  📍 Zone type: "${alertZoneType}"`);

  // FIX: Use strict comparison and handle all cases
  if (alertZoneType === "all_nigeria") {
    // ✅ All Nigeria - always allow
    console.log(`  ✓ All Nigeria - ALLOWED`);
    return true;
  } else if (alertZoneType === "states") {
    // ✅ Selected States
    const selectedStates = settings.selected_states || [];
    console.log(`  📍 Selected states: [${selectedStates.join(', ')}]`);
    console.log(`  📍 Post address: "${postAddress}"`);
    
    if (selectedStates.length === 0) {
      console.log(`  ✓ No states selected - allowing all`);
      return true;
    }
    
    const postState = extractStateFromAddress(postAddress);
    console.log(`  📍 Extracted state: "${postState}"`);
    
    if (!postState) {
      console.log(`  ✗ Cannot determine post state - BLOCKING`);
      return false;
    }
    
    const isInSelectedState = selectedStates.some(
      s => s.trim().toLowerCase() === postState.trim().toLowerCase()
    );
    
    console.log(`  ${isInSelectedState ? '✓' : '✗'} State match: ${isInSelectedState}`);
    return isInSelectedState;
  } else if (alertZoneType === "radius") {
    // ✅ Custom Radius
    console.log(`  📍 Checking radius...`);
    console.log(`  📍 User location: lat=${user.last_latitude}, lng=${user.last_longitude}`);
    console.log(`  📍 Post location: lat=${postLatitude}, lng=${postLongitude}`);
    
    if (!user.last_latitude || !user.last_longitude) {
      console.log(`  ✗ User has no saved location`);
      return false;
    }
    
    if (!postLatitude || !postLongitude) {
      console.log(`  ✗ Post has no coordinates`);
      return false;
    }
    
    const radiusKm = settings.alert_radius_km || 5;
    const distance = calculateDistanceKm(
      user.last_latitude,
      user.last_longitude,
      postLatitude,
      postLongitude
    );
    
    const withinRadius = distance <= radiusKm;
    console.log(`  📍 Distance: ${distance.toFixed(2)}km, Radius: ${radiusKm}km - ${withinRadius ? 'WITHIN ✓' : 'OUTSIDE ✗'}`);
    return withinRadius;
  } else {
    // Unknown zone type - allow to be safe
    console.log(`  ⚠️ Unknown zone type "${alertZoneType}" - allowing`);
    return true;
  }
}

// ============================================
// NOTIFY USERS ABOUT NEW INCIDENT (FIXED)
// ============================================
export async function notifyUsersAboutIncident(
  postId: string,
  posterId: string,
  category: string,
  address: string | null,
  latitude?: number,
  longitude?: number
): Promise<number> {
  console.log("========================================");
  console.log("NOTIFY USERS ABOUT INCIDENT");
  console.log("Post ID:", postId);
  console.log("Category:", category);
  console.log("Address:", address);
  console.log("Latitude:", latitude);
  console.log("Longitude:", longitude);
  console.log("========================================");

  try {
    // =====================================================
    // STEP 1: GET ALL ACTIVE USERS
    // =====================================================
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, last_latitude, last_longitude")
      .neq("id", posterId)
      .eq("status", "active");

    if (usersError) {
      console.error("Error fetching users:", usersError);
      return 0;
    }

    if (!users || users.length === 0) {
      console.log("No users to notify");
      return 0;
    }

    console.log(`Found ${users.length} potential users`);

    // =====================================================
    // STEP 2: GET SETTINGS FOR ALL USERS IN ONE QUERY
    // =====================================================
    const userIds = users.map(u => u.id);
    
    const { data: allSettings, error: settingsError } = await supabase
      .from("user_settings")
      .select("*")
      .in("user_id", userIds);

    if (settingsError) {
      console.error("Error fetching settings:", settingsError);
      return 0;
    }

    console.log(`Fetched settings for ${allSettings?.length || 0} users`);

    // Create a map of user_id -> settings
    const settingsMap: Record<string, any> = {};
    if (allSettings) {
      allSettings.forEach(s => {
        settingsMap[s.user_id] = s;
      });
    }

    // =====================================================
    // STEP 3: CHECK EACH USER AND NOTIFY
    // =====================================================
    const categoryName = getCategoryName(category);
    const shortAddress = address 
      ? address.split(",").slice(0, 2).join(",").trim() 
      : null;

    let notifiedCount = 0;

    for (const user of users) {
      const userWithSettings: UserWithSettings = {
        id: user.id,
        last_latitude: user.last_latitude,
        last_longitude: user.last_longitude,
        settings: settingsMap[user.id] || null,
      };

      const shouldNotify = await shouldNotifyUser(
        userWithSettings,
        category,
        latitude || null,
        longitude || null,
        address
      );

      if (shouldNotify) {
        const success = await createNotification({
          userId: user.id,
          type: "nearby_incident",
          title: `📍 ${categoryName} Alert`,
          body: shortAddress 
            ? `Reported near ${shortAddress}` 
            : "An incident was reported nearby",
          data: { post_id: postId, category },
        });

        if (success) {
          notifiedCount++;
          console.log(`✓ Notified user ${user.id.slice(0, 8)}`);
        }
      } else {
        console.log(`✗ Skipped user ${user.id.slice(0, 8)} (settings filter)`);
      }
    }

    console.log(`========================================`);
    console.log(`TOTAL NOTIFIED: ${notifiedCount} / ${users.length}`);
    console.log(`========================================`);

    return notifiedCount;
  } catch (error) {
    console.error("Error in notifyUsersAboutIncident:", error);
    return 0;
  }
}

// ============================================
// SIMPLE NOTIFICATION FUNCTIONS
// ============================================

export async function notifyPostConfirmed(
  postId: string,
  postOwnerId: string,
  confirmerName: string
): Promise<boolean> {
  return createNotification({
    userId: postOwnerId,
    type: "post_confirmed",
    title: "✓ Your post was confirmed",
    body: `${confirmerName} confirmed your incident report`,
    data: { post_id: postId },
  });
}

export async function notifyPostComment(
  postId: string,
  postOwnerId: string,
  commenterName: string,
  commentPreview: string
): Promise<boolean> {
  const preview = commentPreview.length > 50 
    ? commentPreview.slice(0, 50) + "..." 
    : commentPreview;
    
  return createNotification({
    userId: postOwnerId,
    type: "post_comment",
    title: "💬 New comment on your post",
    body: `${commenterName}: ${preview}`,
    data: { post_id: postId },
  });
}

export async function notifyCommentReply(
  postId: string,
  commentOwnerId: string,
  replierName: string,
  replyPreview: string
): Promise<boolean> {
  const preview =
    replyPreview.length > 60 ? replyPreview.slice(0, 60) + "..." : replyPreview;

  return createNotification({
    userId: commentOwnerId,
    type: "comment_reply",
    title: "↩️ New reply to your comment",
    body: `${replierName}: ${preview}`,
    data: { post_id: postId },
  });
}

export async function notifyCommentLiked(
  postId: string,
  commentOwnerId: string,
  likerName: string
): Promise<boolean> {
  return createNotification({
    userId: commentOwnerId,
    type: "comment_liked",
    title: "❤️ Someone liked your comment",
    body: `${likerName} liked your comment`,
    data: { post_id: postId },
  });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export async function getUnreadCount(userId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

export async function markAllAsRead(userId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    return !error;
  } catch {
    return false;
  }
}

export async function cleanupOldSOSNotifications(): Promise<void> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    await supabase
      .from("notifications")
      .delete()
      .eq("type", "sos_alert")
      .lt("created_at", twentyFourHoursAgo);
  } catch (error) {
    console.error("Error cleaning up SOS notifications:", error);
  }
}

// ============================================
// DM MESSAGE NOTIFICATION
// ============================================
export async function notifyDMMessage(
  recipientId: string,
  senderName: string,
  messagePreview: string,
  conversationId: string
): Promise<boolean> {
  // Check if recipient has muted this conversation
  try {
    const { data: participant } = await supabase
      .from("conversation_participants")
      .select("is_muted")
      .eq("conversation_id", conversationId)
      .eq("user_id", recipientId)
      .maybeSingle();

    if (participant?.is_muted) {
      return false; // Don't notify — conversation is muted
    }
  } catch {
    // If check fails, proceed with notification
  }

  const preview =
    messagePreview.length > 60 ? messagePreview.slice(0, 60) + "..." : messagePreview;

  return createNotification({
    userId: recipientId,
    type: "dm_message",
    title: `📩 ${senderName}`,
    body: preview || "Sent you a message",
    data: { conversation_id: conversationId, sender_name: senderName },
  });
}