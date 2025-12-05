import { supabase } from "./supabase";

export type NotificationType = 
  | "sos_alert"
  | "nearby_incident"
  | "post_confirmed"
  | "post_comment"
  | "comment_liked"
  | "guardian_approved"
  | "guardian_rejected"
  | "system";

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, any>;
}

// Create a notification for a user
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

    return true;
  } catch (error) {
    console.error("Notification error:", error);
    return false;
  }
}

// Notify post owner when someone confirms their post
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

// Notify post owner when someone comments
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

// Notify comment owner when someone likes their comment
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

// Get unread notification count for header badge
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