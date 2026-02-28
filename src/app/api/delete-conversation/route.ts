import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_auth";
import { getSupabaseAdmin } from "../_supabaseAdmin";
import { isRateLimited } from "../_rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const { conversationId } = await req.json();

    if (!conversationId) {
      return NextResponse.json({ ok: false, error: "Missing conversationId" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify the user is a participant
    const { data: participant, error: pErr } = await supabaseAdmin
      .from("conversation_participants")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .single();

    if (pErr || !participant) {
      return NextResponse.json({ ok: false, error: "Conversation not found" }, { status: 404 });
    }

    // 1. Delete all message_reads for this user in this conversation
    const { data: msgs } = await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("conversation_id", conversationId);

    if (msgs && msgs.length > 0) {
      const msgIds = msgs.map((m: any) => m.id);

      // Batch delete in chunks
      for (let i = 0; i < msgIds.length; i += 200) {
        const chunk = msgIds.slice(i, i + 200);

        await supabaseAdmin
          .from("message_reads")
          .delete()
          .in("message_id", chunk)
          .eq("user_id", user.id);

        await supabaseAdmin
          .from("message_deletions")
          .delete()
          .in("message_id", chunk)
          .eq("user_id", user.id);

        await supabaseAdmin
          .from("message_reactions")
          .delete()
          .in("message_id", chunk)
          .eq("user_id", user.id);
      }
    }

    // 2. Remove the participant record — this prevents fetchConversations 
    //    from returning this conversation for this user
    await supabaseAdmin
      .from("conversation_participants")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
