import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendPushToUser } from "../../_firebaseAdmin";
import { award, awardCommunityBadges } from "../../_achievements";

/**
 * Community groups.
 *  POST { action: "create", name }                      -> new group
 *  POST { action: "rename", groupId, name }             -> owner renames
 *  POST { action: "add", groupId, memberIds: [...] }    -> pending invites (any peja user; contact request rides along)
 *  POST { action: "respond", memberRowId, accept }      -> member accepts/declines
 *  POST { action: "remove", groupId, memberUserId }     -> owner removes / member leaves
 *  POST { action: "delete", groupId }                   -> owner deletes group
 *  POST { action: "visibility", groupId, visible }       -> owner toggles member-visibility
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const body = await req.json();
    const supabaseAdmin = getSupabaseAdmin();

    if (body.action === "create") {
      const name = String(body.name ?? "").trim().slice(0, 40);
      if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
      const { data, error } = await supabaseAdmin
        .from("contact_groups")
        .insert({ owner_id: user.id, name })
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ group: data });
    }

    if (body.action === "rename") {
      const groupId = String(body.groupId ?? "");
      const name = String(body.name ?? "").trim().slice(0, 40);
      if (!groupId || !name) {
        return NextResponse.json({ error: "groupId and name required" }, { status: 400 });
      }
      // Owner-only, scoped in the update itself so a non-owner is a no-op.
      const { data, error } = await supabaseAdmin
        .from("contact_groups")
        .update({ name })
        .eq("id", groupId)
        .eq("owner_id", user.id)
        .select("id, name");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) {
        return NextResponse.json({ error: "Only the circle creator can rename it" }, { status: 403 });
      }
      return NextResponse.json({ group: data[0] });
    }

    if (body.action === "add") {
      const groupId = String(body.groupId ?? "");
      const memberIds: string[] = Array.isArray(body.memberIds) ? body.memberIds : [];
      if (!groupId || memberIds.length === 0) {
        return NextResponse.json({ error: "groupId and memberIds required" }, { status: 400 });
      }

      const { data: group } = await supabaseAdmin
        .from("contact_groups")
        .select("id, name, owner_id")
        .eq("id", groupId)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

      // Anyone on peja can be invited straight into a circle. If they're
      // not yet an emergency contact, the SAME accept covers both: we
      // create the contact request here and the respond handler accepts
      // it together with the membership (one consent, clearly worded).
      const wanted = [...new Set(memberIds)].filter((id) => id !== user.id);
      const { data: targets } = await supabaseAdmin
        .from("users")
        .select("id")
        .in("id", wanted);
      const valid = (targets || []).map((t) => t.id);
      if (valid.length === 0) {
        return NextResponse.json({ error: "No valid users" }, { status: 400 });
      }

      const { data: rels } = await supabaseAdmin
        .from("emergency_contacts")
        .select("contact_user_id, status")
        .eq("user_id", user.id)
        .in("contact_user_id", valid);
      const relByUser = new Map((rels || []).map((r) => [r.contact_user_id, r.status]));

      // Missing relationship -> pending contact request rides along.
      const needsContact = valid.filter((id) => {
        const st = relByUser.get(id);
        return st !== "accepted" && st !== "pending";
      });
      if (needsContact.length > 0) {
        await supabaseAdmin.from("emergency_contacts").insert(
          needsContact.map((id) => ({
            user_id: user.id,
            contact_user_id: id,
            relationship: "friend",
            status: "pending",
          }))
        );
      }

      const { data: me } = await supabaseAdmin
        .from("users").select("full_name").eq("id", user.id).single();
      const myName = me?.full_name || "Someone";

      const { data: inserted, error } = await supabaseAdmin
        .from("contact_group_members")
        .upsert(
          valid.map((id) => ({ group_id: groupId, member_user_id: id, status: "pending" })),
          { onConflict: "group_id,member_user_id", ignoreDuplicates: true }
        )
        .select("id, member_user_id");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const title = `${myName} added you to their ${group.name} circle`;
      for (const row of inserted || []) {
        const isNewContact = relByUser.get(row.member_user_id) !== "accepted";
        const bodyText = isNewContact
          ? `Accepting also makes you ${myName}'s emergency contact - you'd be alerted if they're ever in danger.`
          : "Accept to be part of it - they can then share their live location with the whole circle at once.";
        await supabaseAdmin.from("notifications").insert({
          user_id: row.member_user_id,
          type: "system",
          title,
          body: bodyText,
          data: { type: "group_invite", group_id: groupId, member_row_id: row.id, group_name: group.name, from_name: myName },
          is_read: false,
        });
        sendPushToUser({
          userId: row.member_user_id,
          title,
          body: bodyText,
          data: { type: "group_invite", group_id: groupId },
        }).catch(() => {});
      }
      return NextResponse.json({ added: (inserted || []).length });
    }

    if (body.action === "respond") {
      const rowId = String(body.memberRowId ?? "");
      const accept = Boolean(body.accept);
      const { data: row } = await supabaseAdmin
        .from("contact_group_members")
        .select("id, group_id, member_user_id, status, contact_groups(name, owner_id)")
        .eq("id", rowId)
        .maybeSingle();
      if (!row || row.member_user_id !== user.id) {
        return NextResponse.json({ error: "Invite not found" }, { status: 404 });
      }
      if (row.status !== "pending") {
        return NextResponse.json({ error: `Already ${row.status}` }, { status: 409 });
      }
      const { error } = await supabaseAdmin
        .from("contact_group_members")
        .update({ status: accept ? "accepted" : "declined" })
        .eq("id", rowId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // One consent covers both: accepting the circle also accepts the
      // pending emergency-contact request from the circle owner (if any).
      const owner = (row.contact_groups as unknown as { owner_id: string } | null)?.owner_id;
      if (accept && owner) {
        await supabaseAdmin
          .from("emergency_contacts")
          .update({ status: "accepted" })
          .eq("user_id", owner)
          .eq("contact_user_id", user.id)
          .eq("status", "pending");
      }

      if (accept && owner) {
        await award(supabaseAdmin, user.id, "guardian");
        await awardCommunityBadges(supabaseAdmin, owner);
      }

      // Tell the owner their circle grew (or didn't).
      const g = row.contact_groups as unknown as { name: string; owner_id: string } | null;
      if (g && accept) {
        const { data: me } = await supabaseAdmin
          .from("users").select("full_name").eq("id", user.id).single();
        await supabaseAdmin.from("notifications").insert({
          user_id: g.owner_id,
          type: "system",
          title: `${me?.full_name || "Someone"} joined your ${g.name} circle`,
          body: "You can now share your live location with the whole circle in one tap.",
          data: { type: "group_joined", group_id: row.group_id },
          is_read: false,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "remove") {
      const groupId = String(body.groupId ?? "");
      const memberUserId = String(body.memberUserId ?? "");
      const { data: group } = await supabaseAdmin
        .from("contact_groups")
        .select("owner_id")
        .eq("id", groupId)
        .maybeSingle();
      const isOwner = group?.owner_id === user.id;
      const isSelf = memberUserId === user.id;
      if (!isOwner && !isSelf) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      await supabaseAdmin
        .from("contact_group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("member_user_id", memberUserId);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete") {
      const groupId = String(body.groupId ?? "");
      const { error } = await supabaseAdmin
        .from("contact_groups")
        .delete()
        .eq("id", groupId)
        .eq("owner_id", user.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "visibility") {
      const groupId = String(body.groupId ?? "");
      const visible = Boolean(body.visible);
      // Owner-only: the update is scoped to owner_id = caller.
      const { data, error } = await supabaseAdmin
        .from("contact_groups")
        .update({ members_visible: visible })
        .eq("id", groupId)
        .eq("owner_id", user.id)
        .select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) {
        return NextResponse.json({ error: "Only the circle owner can change this" }, { status: 403 });
      }
      return NextResponse.json({ ok: true, members_visible: visible });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: 500 })
    );
  }
}
