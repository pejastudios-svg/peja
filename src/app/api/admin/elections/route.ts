import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, requireAdminSession } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { verifyPin } from "@/lib/adminSession";

// Admin management for Election Watch.
//
// Moderation (hide/unhide, freeze, unlock, close/reopen) runs on the
// admin session alone. DESTRUCTIVE actions (deletes, purge) additionally
// demand the admin dashboard PIN in the request body, verified fresh
// against ADMIN_PIN_HASH on every call: a hijacked admin tab without the
// PIN in someone's head cannot destroy the record. Every action lands in
// election_audit; clearing the ledger leaves a stamp saying it was
// cleared, so even the wipe is on the record.

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const supabaseAdmin = getSupabaseAdmin();

    const [
      { data: elections },
      { data: uploads },
      { data: access },
      { data: audit },
      { data: tallies },
      { data: candidates },
    ] = await Promise.all([
      supabaseAdmin
        .from("elections")
        .select("id, title, status, created_at, created_by, users:created_by (full_name)")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("election_uploads")
        .select(
          "id, election_id, state, lga, polling_unit, photo_url, photo_sha256, device_lat, device_lng, hidden, hidden_reason, tallies_hidden, created_at, uploader_id, users:uploader_id (full_name)",
        )
        .order("created_at", { ascending: false })
        .limit(300),
      supabaseAdmin
        .from("election_access")
        .select(
          "user_id, failed_attempts, locked_at, frozen, updated_at, users:user_id (full_name, is_vip, is_mvp)",
        ),
      supabaseAdmin
        .from("election_audit")
        .select("id, actor_id, action, subject, created_at, users:actor_id (full_name)")
        .order("created_at", { ascending: false })
        .limit(100),
      // Full tallies, history included: the evidence detail modal shows
      // figures, who entered them, from where, and every correction.
      supabaseAdmin
        .from("election_tallies")
        .select(
          "id, upload_id, figures, note, superseded_by, device_lat, device_lng, created_at, users:tallied_by (full_name)",
        )
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("election_candidates")
        .select("id, election_id, name, description, photo_url, sort")
        .order("sort", { ascending: true }),
    ]);

    return NextResponse.json({
      ok: true,
      elections: elections || [],
      uploads: uploads || [],
      access: access || [],
      audit: audit || [],
      tallies: tallies || [],
      candidates: candidates || [],
    });
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}

const DESTRUCTIVE = new Set([
  "delete_upload",
  "delete_election",
  "delete_access",
  "clear_audit",
  "purge_all",
]);

/** Remove every storage object under elections/<electionId>/. */
async function removeElectionStorage(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  electionId: string,
) {
  for (const folder of ["sheets", "candidates"]) {
    const prefix = `elections/${electionId}/${folder}`;
    const { data: objects } = await supabaseAdmin.storage
      .from("media")
      .list(prefix, { limit: 1000 });
    if (objects && objects.length > 0) {
      await supabaseAdmin.storage
        .from("media")
        .remove(objects.map((o) => `${prefix}/${o.name}`));
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAdminSession(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { action, uploadId, userId, electionId, candidateId, reason, hideTally, pin, name, description, photoDataUrl } =
      await req.json();
    const now = new Date().toISOString();

    // The second key for destructive work: the dashboard PIN, verified
    // fresh. The session cookie alone is not enough to delete history.
    if (DESTRUCTIVE.has(action)) {
      const storedHash = process.env.ADMIN_PIN_HASH;
      if (!storedHash) {
        return NextResponse.json({ error: "Server mis-configured" }, { status: 500 });
      }
      if (!pin || typeof pin !== "string" || !verifyPin(pin, storedHash)) {
        return NextResponse.json(
          { error: "Admin PIN required for deletion" },
          { status: 401 },
        );
      }
    }

    const audit = async (subject: Record<string, unknown>) => {
      await supabaseAdmin.from("election_audit").insert({
        actor_id: user.id,
        action: String(action),
        subject,
      });
    };

    switch (action) {
      // ── moderation ──
      case "hide_upload": {
        const cleanReason = String(reason ?? "").trim();
        if (!cleanReason) {
          return NextResponse.json(
            { error: "A public reason is required to hide evidence" },
            { status: 400 },
          );
        }
        const { data } = await supabaseAdmin
          .from("election_uploads")
          .update({
            hidden: true,
            hidden_reason: cleanReason,
            hidden_by: user.id,
            hidden_at: now,
            // Toggleable: pull the tally from totals too (default), or
            // keep the count while the evidence stays withheld.
            tallies_hidden: hideTally !== false,
          })
          .eq("id", uploadId)
          .select("id")
          .maybeSingle();
        if (!data) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
        await audit({ uploadId, reason: cleanReason, hideTally: hideTally !== false });
        return NextResponse.json({ ok: true });
      }
      case "unhide_upload": {
        const { data } = await supabaseAdmin
          .from("election_uploads")
          .update({
            hidden: false,
            hidden_reason: null,
            hidden_by: null,
            hidden_at: null,
            tallies_hidden: true,
          })
          .eq("id", uploadId)
          .select("id")
          .maybeSingle();
        if (!data) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
        await audit({ uploadId });
        return NextResponse.json({ ok: true });
      }
      case "freeze_user":
      case "unfreeze_user": {
        const frozen = action === "freeze_user";
        const { data: updated } = await supabaseAdmin
          .from("election_access")
          .update({ frozen, updated_at: now })
          .eq("user_id", userId)
          .select("user_id")
          .maybeSingle();
        if (!updated) {
          await supabaseAdmin.from("election_access").insert({
            user_id: userId,
            pin_hash: "",
            pin_salt: "",
            frozen,
            updated_at: now,
          });
        }
        await audit({ userId, frozen });
        return NextResponse.json({ ok: true });
      }
      case "unlock_pin": {
        await supabaseAdmin
          .from("election_access")
          .update({ failed_attempts: 0, locked_at: null, updated_at: now })
          .eq("user_id", userId);
        await audit({ userId });
        return NextResponse.json({ ok: true });
      }
      case "reset_pin": {
        await supabaseAdmin.from("election_access").delete().eq("user_id", userId);
        await audit({ userId });
        return NextResponse.json({ ok: true });
      }
      case "close_election":
      case "reopen_election": {
        const status = action === "close_election" ? "closed" : "active";
        const { data } = await supabaseAdmin
          .from("elections")
          .update({ status })
          .eq("id", electionId)
          .select("id")
          .maybeSingle();
        if (!data) return NextResponse.json({ error: "Election not found" }, { status: 404 });
        await audit({ electionId, status });
        return NextResponse.json({ ok: true });
      }

      case "edit_candidate": {
        const { data: candidate } = await supabaseAdmin
          .from("election_candidates")
          .select("id, election_id, photo_url")
          .eq("id", candidateId)
          .maybeSingle();
        if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

        const updates: Record<string, unknown> = {};
        if (name !== undefined) {
          const clean = String(name).trim();
          if (clean.length < 2 || clean.length > 120) {
            return NextResponse.json({ error: "Give the candidate a name" }, { status: 400 });
          }
          updates.name = clean;
        }
        if (description !== undefined) {
          updates.description = description ? String(description).slice(0, 1000) : null;
        }

        // New photo: store alongside the old under the immutable prefix,
        // repoint, then best-effort remove the old object. A failed
        // removal only wastes bytes, never correctness.
        if (photoDataUrl) {
          const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(String(photoDataUrl));
          if (!m) return NextResponse.json({ error: "Bad image" }, { status: 400 });
          const bytes = Buffer.from(m[2], "base64");
          if (bytes.length > 5 * 1024 * 1024) {
            return NextResponse.json({ error: "Image too large (5MB max)" }, { status: 400 });
          }
          const ext = m[1] === "png" ? "png" : m[1] === "webp" ? "webp" : "jpg";
          const path = `elections/${candidate.election_id}/candidates/${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await supabaseAdmin.storage
            .from("media")
            .upload(path, bytes, { contentType: `image/${m[1] === "jpg" ? "jpeg" : m[1]}` });
          if (upErr) return NextResponse.json({ error: "Could not store the image" }, { status: 500 });
          updates.photo_url = supabaseAdmin.storage.from("media").getPublicUrl(path).data.publicUrl;
          if (candidate.photo_url) {
            const old = /\/media\/(elections\/.+)$/.exec(candidate.photo_url)?.[1];
            if (old) await supabaseAdmin.storage.from("media").remove([old]).catch(() => {});
          }
        }

        if (Object.keys(updates).length === 0) {
          return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
        }

        const { data: updated, error: updErr } = await supabaseAdmin
          .from("election_candidates")
          .update(updates)
          .eq("id", candidateId)
          .select("id, election_id, name, description, photo_url, sort")
          .single();
        if (updErr || !updated) {
          return NextResponse.json({ error: "Could not update the candidate" }, { status: 500 });
        }
        await audit({ candidateId, changed: Object.keys(updates) });
        return NextResponse.json({ ok: true, candidate: updated });
      }

      // ── destruction, PIN-verified above ──
      case "delete_upload": {
        const { data: up } = await supabaseAdmin
          .from("election_uploads")
          .select("id, photo_url, election_id, state, lga")
          .eq("id", uploadId)
          .maybeSingle();
        if (!up) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
        const path = String(up.photo_url).split("/public/media/")[1];
        if (path) await supabaseAdmin.storage.from("media").remove([path]);
        await supabaseAdmin.from("election_uploads").delete().eq("id", uploadId);
        await audit({ uploadId, electionId: up.election_id, state: up.state, lga: up.lga });
        return NextResponse.json({ ok: true });
      }
      case "delete_election": {
        const { data: e } = await supabaseAdmin
          .from("elections")
          .select("id, title")
          .eq("id", electionId)
          .maybeSingle();
        if (!e) return NextResponse.json({ error: "Election not found" }, { status: 404 });
        await removeElectionStorage(supabaseAdmin, electionId);
        await supabaseAdmin.from("elections").delete().eq("id", electionId);
        await audit({ electionId, title: e.title });
        return NextResponse.json({ ok: true });
      }
      case "delete_access": {
        await supabaseAdmin.from("election_access").delete().eq("user_id", userId);
        await audit({ userId });
        return NextResponse.json({ ok: true });
      }
      case "clear_audit": {
        await supabaseAdmin
          .from("election_audit")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        // The wipe itself goes on the fresh ledger: an empty ledger with
        // no explanation would be indistinguishable from tampering.
        await audit({ cleared: true });
        return NextResponse.json({ ok: true });
      }
      case "purge_all": {
        const { data: all } = await supabaseAdmin.from("elections").select("id");
        for (const e of all || []) {
          await removeElectionStorage(supabaseAdmin, e.id);
        }
        await supabaseAdmin
          .from("elections")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        await supabaseAdmin
          .from("election_access")
          .delete()
          .neq("user_id", "00000000-0000-0000-0000-000000000000");
        await supabaseAdmin
          .from("election_audit")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        await audit({ purged: true });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}
