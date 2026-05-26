// Native push-notification cleanup. When the user opens a chat
// thread or an incident, the matching delivered push(es) in the
// device's notification tray should disappear — same way iMessage
// or WhatsApp do it.
//
// Wired by the chat thread (apps/web/src/app/messages/[id]/page.tsx)
// and the post detail page (apps/web/src/app/post/[id]/page.tsx) on
// mount, right after the in-app `notifications` row is marked read.
//
// Web / non-Capacitor environments are no-ops: regular browsers don't
// hand the page a tray API, and our PWA push doesn't surface in a
// persistent tray that survives a tap. iOS PWA push is similarly
// scoped; this helper is most useful on native iOS / Android.

const CAPACITOR_PUSH_MODULE = "@capacitor/push-notifications";

function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  return (window as Window & { Capacitor?: unknown }).Capacitor !== undefined;
}

interface DeliveredNotification {
  id: string;
  // data carries the FCM payload — see /api/_firebaseAdmin.ts. We
  // match on the relevant id field for each call site.
  data?: Record<string, unknown>;
  notification?: {
    data?: Record<string, unknown>;
  };
}

function dataFor(n: DeliveredNotification): Record<string, unknown> {
  // Capacitor wraps the FCM data under `notification.data` on iOS
  // and exposes a top-level `data` on Android in some plugin
  // versions. Read both, prefer the nested form.
  return (n.notification?.data ?? n.data ?? {}) as Record<string, unknown>;
}

/**
 * Drop every delivered push whose data.{field} matches the given
 * value. Safe to call on web (no-op). Best-effort — a failure here
 * just leaves the notification in the tray.
 */
async function clearByDataField(field: string, value: string): Promise<void> {
  if (!isCapacitorNative()) return;
  if (!value) return;

  try {
    // Dynamic import keeps the plugin out of the web bundle when
    // we're not on Capacitor. The plugin lazy-loads its native
    // bridge anyway, but the dynamic import lets the bundler
    // tree-shake the module on the web target.
    const mod = (await import(/* webpackIgnore: true */ CAPACITOR_PUSH_MODULE)) as {
      PushNotifications?: {
        getDeliveredNotifications: () => Promise<{ notifications: DeliveredNotification[] }>;
        removeDeliveredNotifications: (opts: {
          notifications: DeliveredNotification[];
        }) => Promise<void>;
      };
    };
    const pn = mod.PushNotifications;
    if (!pn) return;

    const { notifications } = await pn.getDeliveredNotifications();
    const matching = notifications.filter((n) => {
      const d = dataFor(n);
      return typeof d[field] === "string" && d[field] === value;
    });
    if (matching.length === 0) return;
    await pn.removeDeliveredNotifications({ notifications: matching });
  } catch {
    // Plugin may not be available, or the device may have revoked
    // notification permission. Silent — caller treats this as best-
    // effort cleanup.
  }
}

export function clearPushNotificationsForConversation(
  conversationId: string,
): Promise<void> {
  return clearByDataField("conversation_id", conversationId);
}

export function clearPushNotificationsForPost(postId: string): Promise<void> {
  return clearByDataField("post_id", postId);
}
