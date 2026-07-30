import { sendPushToUser } from "./_firebaseAdmin";
import { getSupabaseAdmin } from "./_supabaseAdmin";

// "They are okay" fan-out after an SOS or fall alert is cancelled.
//
// Anyone who was alarmed must be told it ended. An app that shouts
// "EMERGENCY" and then goes silent teaches people to distrust the next
// alert, which is the one that might be real.

export async function notifyAllClear(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  source: "app" | "beacon",
): Promise<number> {
  try {
    const { data: me } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    const name = (me?.full_name || "Someone").split(" ")[0];

    // Exactly the audience that was alerted: accepted emergency contacts.
    const { data: contacts } = await supabaseAdmin
      .from("emergency_contacts")
      .select("contact_user_id")
      .eq("user_id", userId)
      .eq("status", "accepted")
      .not("contact_user_id", "is", null);

    const ids = [
      ...new Set((contacts || []).map((c) => c.contact_user_id as string)),
    ].filter(Boolean);
    if (ids.length === 0) return 0;

    const title = `${name} is okay`;
    const body =
      source === "beacon"
        ? `${name} cancelled the Beacon alert. No help is needed.`
        : `${name} cancelled their SOS. No help is needed.`;

    await supabaseAdmin.from("notifications").insert(
      ids.map((id) => ({
        user_id: id,
        type: "system",
        title,
        body,
        data: { type: "sos_all_clear", from_user_id: userId },
        is_read: false,
      })),
    );

    for (const id of ids) {
      sendPushToUser({
        userId: id,
        title,
        body,
        data: { type: "sos_all_clear", from_user_id: userId },
      }).catch(() => {});
    }
    return ids.length;
  } catch {
    // An all-clear failing must never break the cancel itself.
    return 0;
  }
}
