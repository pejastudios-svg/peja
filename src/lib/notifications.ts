import { supabase } from "./supabase";

export type NotificationType =
  | "sos_alert"
  | "nearby_incident"
  | "post_confirmed"
  | "post_confirmed_digest"
  | "post_comment"
  | "post_comment_digest"
  | "comment_liked"
  | "comment_liked_digest"
  | "comment_reply"
  | "comment_reply_digest"
  | "guardian_approved"
  | "guardian_rejected"
  | "system"
  | "dm_message"
  | "dm_message_digest"
  | "dm_blocked";

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, any>;
  silent?: boolean;
  skipPush?: boolean;
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
  silent = false,
  skipPush = false,
}: CreateNotificationParams): Promise<boolean> {
  try {
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      type,
      title: silent ? "" : title,
      body: silent ? "" : body,
      data: data || {},
      is_read: silent ? true : false,
    });

    if (error) return false;

    if (!silent && !skipPush && title) {
      sendFCMPush(userId, type, title, body || "", data || {}).catch(() => {});
    }

    return true;
  } catch {
    return false;
  }
}

async function sendFCMPush(
  userId: string,
  type: string,
  title: string,
  body: string,
  data: Record<string, any>
): Promise<void> {
  try {
    const { data: authData } = await supabase.auth.getSession();
    const token = authData.session?.access_token;
    if (!token) return;

    const stringData: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      stringData[key] = String(value ?? "");
    }

    const { apiUrl } = await import("./api");

    await fetch(apiUrl("/api/send-push"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId, type, title, body, data: stringData }),
    });
  } catch {
    // Non-blocking
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


  // ============================================
  // CASE 1: No settings - BLOCK
  // ============================================
  if (!settings) {
    return false;
  }

  // ============================================
  // CASE 2: Push notifications disabled
  // ============================================
  if (settings.push_enabled === false) {
    return false;
  }

  // ============================================
  // CASE 3: Check category preferences
  // ============================================
  
  switch (catType) {
    case "danger":
      if (settings.danger_alerts === false) {
        return false;
      }
      break;
      
    case "caution":
      if (settings.caution_alerts === false) {
        return false;
      }
      break;
      
    case "awareness":
      if (settings.awareness_alerts === false) {
        return false;
      }
      break;
      
    case "info":
      if (settings.info_alerts === false) {
        return false;
      }
      break;
  }



  // ============================================
  // CASE 4: Check location/zone preferences
  // ============================================
  const alertZoneType = settings.alert_zone_type || "all_nigeria";

  // FIX: Use strict comparison and handle all cases
  if (alertZoneType === "all_nigeria") {
    // ✅ All Nigeria - always allow
    return true;
  } else if (alertZoneType === "states") {
    // ✅ Selected States
    const selectedStates = settings.selected_states || [];
    
    if (selectedStates.length === 0) {
      return true;
    }
    
    const postState = extractStateFromAddress(postAddress);
    
    if (!postState) {
      return false;
    }
    
    const isInSelectedState = selectedStates.some(
      s => s.trim().toLowerCase() === postState.trim().toLowerCase()
    );
    
    return isInSelectedState;
  } else if (alertZoneType === "radius") {
    // ✅ Custom Radius
    
    if (!user.last_latitude || !user.last_longitude) {
      return false;
    }
    
    if (!postLatitude || !postLongitude) {
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
    return withinRadius;
  } else {
    // Unknown zone type - allow to be safe
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
      return 0;
    }

    if (!users || users.length === 0) {
      return 0;
    }


    // =====================================================
    // STEP 2: GET SETTINGS FOR ALL USERS IN ONE QUERY
    // =====================================================
    const userIds = users.map(u => u.id);
    
    const { data: allSettings, error: settingsError } = await supabase
      .from("user_settings")
      .select("*")
      .in("user_id", userIds);

    if (settingsError) {
      return 0;
    }


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
        }
      }
    }


    return notifiedCount;
  } catch (error) {
    return 0;
  }
}

// ============================================
// SOCIAL / DM NOTIFICATIONS (server-side)
// Throttling, digest collapsing, and silence checks run server-side because
// they require reading the recipient's rows (blocked by RLS client-side).
// ============================================

async function postSocial(payload: {
  kind: "post_confirmed" | "post_comment" | "comment_reply" | "comment_liked" | "dm_message";
  recipientId: string;
  actorName: string;
  postId?: string;
  conversationId?: string;
  preview?: string;
}): Promise<boolean> {
  try {
    const { data: authData } = await supabase.auth.getSession();
    const token = authData.session?.access_token;
    if (!token) return false;

    const { apiUrl } = await import("./api");
    const res = await fetch(apiUrl("/api/notify-social"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function notifyPostConfirmed(
  postId: string,
  postOwnerId: string,
  confirmerName: string
): Promise<boolean> {
  return postSocial({ kind: "post_confirmed", recipientId: postOwnerId, actorName: confirmerName, postId });
}

export async function notifyPostComment(
  postId: string,
  postOwnerId: string,
  commenterName: string,
  commentPreview: string
): Promise<boolean> {
  return postSocial({
    kind: "post_comment",
    recipientId: postOwnerId,
    actorName: commenterName,
    postId,
    preview: commentPreview,
  });
}

export async function notifyCommentReply(
  postId: string,
  commentOwnerId: string,
  replierName: string,
  replyPreview: string
): Promise<boolean> {
  return postSocial({
    kind: "comment_reply",
    recipientId: commentOwnerId,
    actorName: replierName,
    postId,
    preview: replyPreview,
  });
}

export async function notifyCommentLiked(
  postId: string,
  commentOwnerId: string,
  likerName: string
): Promise<boolean> {
  return postSocial({ kind: "comment_liked", recipientId: commentOwnerId, actorName: likerName, postId });
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
  return postSocial({
    kind: "dm_message",
    recipientId,
    actorName: senderName,
    conversationId,
    preview: messagePreview,
  });
}

// ============================================
// DM BLOCK NOTIFICATION
// ============================================
export async function notifyDMBlocked(
  blockedUserId: string,
  blockerName: string,
): Promise<boolean> {
  return createNotification({
    userId: blockedUserId,
    type: "dm_blocked",
    title: "🚫 You have been blocked",
    body: `${blockerName} has blocked you from messaging them`,
    data: {},
  });
}