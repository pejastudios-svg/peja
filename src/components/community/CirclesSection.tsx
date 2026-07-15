"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { supabase } from "@/lib/supabase";
import { authFetchJson } from "@/lib/authFetch";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { Modal } from "@/components/ui/Modal";
import { Check, Clock, Pencil, Plus, Trash2, User, Users, X } from "lucide-react";

interface Circle {
  id: string;
  name: string;
  membersVisible: boolean;
  members: { userId: string; name: string; avatar: string | null; status: string }[];
}

interface PendingGroupInvite {
  rowId: string;
  groupName: string;
  ownerName: string;
}

interface EligibleContact {
  userId: string;
  name: string;
  avatar: string | null;
}

/**
 * "Your circles" - named sharing audiences (Family, Work...) built from
 * accepted contacts. Members consent per circle; a circle then becomes a
 * one-tap audience in Share My Location.
 */
export function CirclesSection({ query = "" }: { query?: string } = {}) {
  const q = query.trim().toLowerCase();
  const { user } = useAuth();
  const toast = useToast();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [pending, setPending] = useState<PendingGroupInvite[]>([]);
  const [memberOf, setMemberOf] = useState<{ groupId: string; name: string; ownerName: string }[]>([]);
  const [eligible, setEligible] = useState<EligibleContact[]>([]);
  const [manage, setManage] = useState<Circle | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [memberResults, setMemberResults] = useState<EligibleContact[]>([]);

  // Polls race optimistic writes: a fetch that STARTED before a mutation
  // resolves after it and stomps the UI with stale data (rename flickers
  // old -> new). Fetches capture their start time; results from before
  // the last mutation are discarded.
  const lastMutationAt = useRef(0);
  const markMutation = () => { lastMutationAt.current = Date.now(); };

  const load = useCallback(async () => {
    if (!user) return;
    const startedAt = Date.now();
    const [gs, pend, rels] = await Promise.all([
      supabase
        .from("contact_groups")
        .select("id, name, members_visible, contact_group_members(id, member_user_id, status)")
        .eq("owner_id", user.id)
        .order("created_at"),
      supabase
        .from("contact_group_members")
        .select("id, status, contact_groups(id, name, owner_id)")
        .eq("member_user_id", user.id)
        .in("status", ["pending", "accepted"]),
      supabase
        .from("emergency_contacts")
        .select("user_id, contact_user_id")
        .eq("status", "accepted")
        .or(`user_id.eq.${user.id},contact_user_id.eq.${user.id}`),
    ]);

    // Resolve names for group members + pending owners + eligible contacts.
    const memberIds = new Set<string>();
    for (const g of gs.data || []) {
      for (const m of (g.contact_group_members as { member_user_id: string }[]) || []) {
        memberIds.add(m.member_user_id);
      }
    }
    const peerIds = new Set(
      (rels.data || []).flatMap((r) => [r.user_id, r.contact_user_id]).filter((id) => id !== user.id)
    );
    const ownerIds = (pend.data || [])
      .map((p) => (p.contact_groups as unknown as { owner_id: string } | null)?.owner_id)
      .filter(Boolean) as string[];
    const allIds = [...new Set([...memberIds, ...peerIds, ...ownerIds])];
    const nameById = new Map<string, { name: string; avatar: string | null }>();
    if (allIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, full_name, avatar_url")
        .in("id", allIds);
      for (const u of users || []) {
        nameById.set(u.id, { name: u.full_name || "Unknown", avatar: u.avatar_url || null });
      }
    }

    // Started before the newest local change: stale, discard.

    if (startedAt < lastMutationAt.current) return;

    setCircles(
      (gs.data || []).map((g) => ({
        id: g.id,
        name: g.name,
        membersVisible: Boolean((g as { members_visible?: boolean }).members_visible),
        members: ((g.contact_group_members as { id: string; member_user_id: string; status: string }[]) || []).map(
          (m) => ({
            userId: m.member_user_id,
            name: nameById.get(m.member_user_id)?.name || "Unknown",
            avatar: nameById.get(m.member_user_id)?.avatar || null,
            status: m.status,
          })
        ),
      }))
    );
    setPending(
      (pend.data || [])
        .filter((p) => p.status === "pending")
        .map((p) => {
          const g = p.contact_groups as unknown as { name: string; owner_id: string } | null;
          return {
            rowId: p.id,
            groupName: g?.name || "a circle",
            ownerName: g ? nameById.get(g.owner_id)?.name || "Someone" : "Someone",
          };
        })
    );
    setMemberOf(
      (pend.data || [])
        .filter((p) => p.status === "accepted")
        .map((p) => {
          const g = p.contact_groups as unknown as { id: string; name: string; owner_id: string } | null;
          return {
            groupId: g?.id || "",
            name: g?.name || "a circle",
            ownerName: g ? nameById.get(g.owner_id)?.name || "Someone" : "Someone",
          };
        })
    );
    setEligible(
      [...peerIds].map((id) => ({
        userId: id,
        name: nameById.get(id)?.name || "Unknown",
        avatar: nameById.get(id)?.avatar || null,
      }))
    );
  }, [user]);

  useEffect(() => {
    load();
    // Recompute derivable badges (idempotent, cheap) - the community
    // page is the natural moment since most badges are community-shaped.
    authFetchJson("/api/achievements/sync", { method: "POST" }).catch(() => {});

    // Near-realtime pending -> accepted flips without manual refresh:
    // poll while this screen is open + refetch when it regains focus.
    const t = setInterval(load, 12_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  // Manage-modal search: ANY peja user can be invited to a circle - if
  // they aren't a contact yet, one accept covers both relationships.
  useEffect(() => {
    if (!manage || !memberQuery.trim() || !user) {
      setMemberResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("users")
        .select("id, full_name, avatar_url")
        .ilike("full_name", `%${memberQuery.trim()}%`)
        .neq("id", user.id)
        .limit(6);
      setMemberResults(
        (data || []).map((u) => ({
          userId: u.id,
          name: u.full_name || "Unknown",
          avatar: u.avatar_url || null,
        }))
      );
    }, 300);
    return () => clearTimeout(t);
  }, [memberQuery, manage, user]);

  const createCircle = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const { res, data } = await authFetchJson("/api/community/groups", {
        method: "POST",
        body: JSON.stringify({ action: "create", name }),
      });
      if (!res.ok) {
        toast.warning(data?.error || "Couldn't create circle");
        return;
      }
      setNewName("");
      setCreating(false);
      await load();
      toast.success(`${name} created - now add people to it`);
    } finally {
      setBusy(false);
    }
  };

  // Optimistic writes: state changes INSTANTLY, the network catches up,
  // and a failure rolls the exact change back with a toast.
  const patchCircle = (groupId: string, fn: (c: Circle) => Circle) => {
    setCircles((prev) => prev.map((c) => (c.id === groupId ? fn(c) : c)));
  };

  const addMember = async (groupId: string, userId: string) => {
    const person =
      eligible.find((c) => c.userId === userId) ??
      memberResults.find((c) => c.userId === userId);
    const optimistic = {
      userId,
      name: person?.name || "Unknown",
      avatar: person?.avatar || null,
      status: "pending",
    };
    patchCircle(groupId, (c) =>
      c.members.some((m) => m.userId === userId)
        ? c
        : { ...c, members: [...c.members, optimistic] }
    );

    const { res, data } = await authFetchJson("/api/community/groups", {
      method: "POST",
      body: JSON.stringify({ action: "add", groupId, memberIds: [userId] }),
    });
    if (!res.ok) {
      patchCircle(groupId, (c) => ({
        ...c,
        members: c.members.filter((m) => m.userId !== userId),
      }));
      toast.warning(data?.error || "Couldn't add");
      return;
    }
    load(); // silent true-up in the background
  };

  const removeMember = async (groupId: string, userId: string) => {
    const before = circles.find((c) => c.id === groupId);
    const removed = before?.members.find((m) => m.userId === userId);
    patchCircle(groupId, (c) => ({
      ...c,
      members: c.members.filter((m) => m.userId !== userId),
    }));

    const { res, data } = await authFetchJson("/api/community/groups", {
      method: "POST",
      body: JSON.stringify({ action: "remove", groupId, memberUserId: userId }),
    });
    if (!res.ok && removed) {
      patchCircle(groupId, (c) => ({ ...c, members: [...c.members, removed] }));
      toast.warning(data?.error || "Couldn't remove");
      return;
    }
    load();
  };

  const toggleVisibility = async (groupId: string, visible: boolean) => {
    markMutation();
    patchCircle(groupId, (c) => ({ ...c, membersVisible: visible })); // optimistic
    setManage((m) => (m && m.id === groupId ? { ...m, membersVisible: visible } : m));
    const { res, data } = await authFetchJson("/api/community/groups", {
      method: "POST",
      body: JSON.stringify({ action: "visibility", groupId, visible }),
    });
    markMutation();
    if (!res.ok) {
      patchCircle(groupId, (c) => ({ ...c, membersVisible: !visible }));
      setManage((m) => (m && m.id === groupId ? { ...m, membersVisible: !visible } : m));
      toast.warning(data?.error || "Couldn't update");
    }
  };

  const renameCircle = async (groupId: string, name: string) => {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    const prev = circles.find((c) => c.id === groupId)?.name || "";
    markMutation();
    patchCircle(groupId, (c) => ({ ...c, name: clean })); // optimistic
    setManage((m) => (m && m.id === groupId ? { ...m, name: clean } : m));
    setRenaming(false);
    const { res, data } = await authFetchJson("/api/community/groups", {
      method: "POST",
      body: JSON.stringify({ action: "rename", groupId, name: clean }),
    });
    markMutation(); // commit time: polls started before this are stale
    if (!res.ok) {
      patchCircle(groupId, (c) => ({ ...c, name: prev }));
      setManage((m) => (m && m.id === groupId ? { ...m, name: prev } : m));
      toast.warning(data?.error || "Couldn't rename the circle");
    }
  };

  const respond = async (rowId: string, accept: boolean) => {
    setRespondingId(rowId);
    try {
      const { res, data } = await authFetchJson("/api/community/groups", {
        method: "POST",
        body: JSON.stringify({ action: "respond", memberRowId: rowId, accept }),
      });
      if (!res.ok && res.status !== 409) {
        toast.warning(data?.error || "Couldn't respond");
        return;
      }
      setPending((prev) => prev.filter((p) => p.rowId !== rowId));
      if (accept) toast.success("You're in the circle");
    } finally {
      setRespondingId(null);
    }
  };

  useEffect(() => {
    setMemberQuery("");
  }, [manage?.id]);

  // Keep the manage modal in sync with reloaded circles.
  useEffect(() => {
    if (manage) {
      const fresh = circles.find((c) => c.id === manage.id);
      if (fresh) setManage(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circles]);

  if (!user) return null;

  return (
    <div className="mb-6">
      {/* pending circle invites */}
      {pending.length > 0 && (
        <div className="space-y-2 mb-4">
          {pending.map((p) => (
            <div key={p.rowId} className="glass-card !p-3.5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
                <Users className="beacon-accent-text w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-dark-100">
                  {p.ownerName} added you to their {p.groupName} circle
                </p>
                <p className="text-xs text-dark-500">They can share live location with the circle at once</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => respond(p.rowId, true)}
                  disabled={respondingId === p.rowId}
                  className="p-2 bg-green-600/20 text-green-400 rounded-lg active:scale-90 transition-transform"
                  aria-label="Accept"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => respond(p.rowId, false)}
                  disabled={respondingId === p.rowId}
                  className="p-2 bg-red-600/20 text-red-400 rounded-lg active:scale-90 transition-transform"
                  aria-label="Decline"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* circles list */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-wider text-dark-500">Your circles</p>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 text-xs font-semibold beacon-accent-text active:scale-95 transition-transform"
        >
          <Plus className="w-3.5 h-3.5" /> New circle
        </button>
      </div>

      {circles.length === 0 ? (
        <button
          onClick={() => setCreating(true)}
          className="w-full rounded-2xl border border-dashed border-primary-500/40 p-4 text-center active:scale-[0.98] transition-transform"
        >
          <p className="text-sm text-dark-300 font-medium">Group your people into circles</p>
          <p className="text-xs text-dark-500 mt-0.5">
            Family, roommates, coworkers - then share your location with a whole circle in one tap
          </p>
        </button>
      ) : (
        <div className="space-y-2">
          {circles
            .filter(
              (c) =>
                !q ||
                c.name.toLowerCase().includes(q) ||
                c.members.some((m) => (m.name || "").toLowerCase().includes(q))
            )
            .map((c) => (
            <button
              key={c.id}
              onClick={() => setManage(c)}
              className="w-full glass-card !p-3.5 flex items-center gap-3 active:scale-[0.985] transition-transform"
            >
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium text-dark-100">{c.name}</p>
                <p className="text-xs text-dark-500">
                  {c.members.filter((m) => m.status === "accepted").length} in
                  {c.members.some((m) => m.status === "pending")
                    ? ` · ${c.members.filter((m) => m.status === "pending").length} pending`
                    : ""}
                </p>
              </div>
              <div className="flex -space-x-2 shrink-0">
                {c.members.slice(0, 4).map((m) => (
                  <div
                    key={m.userId}
                    className={`w-7 h-7 rounded-full overflow-hidden border-2 border-dark-900 bg-dark-700 flex items-center justify-center ${
                      m.status !== "accepted" ? "opacity-50" : ""
                    }`}
                  >
                    {m.avatar ? (
                      <AvatarImage src={m.avatar} wrapperClassName="w-full h-full" />
                    ) : (
                      <User className="w-3.5 h-3.5 text-dark-300" />
                    )}
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* circles I belong to */}
      {memberOf.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-dark-500 mb-2">
            Circles you&apos;re in
          </p>
          <div className="space-y-2">
            {memberOf
              .filter((m) => !q || m.name.toLowerCase().includes(q) || m.ownerName.toLowerCase().includes(q))
              .map((m) => (
              <div key={m.groupId} className="glass-card !p-3.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                  <Users className="beacon-ok-text w-4.5 h-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-dark-100 truncate">{m.name}</p>
                  <p className="text-xs text-dark-500">{m.ownerName}&apos;s circle</p>
                </div>
                <button
                  onClick={async () => {
                    setMemberOf((prev) => prev.filter((x) => x.groupId !== m.groupId));
                    const { res } = await authFetchJson("/api/community/groups", {
                      method: "POST",
                      body: JSON.stringify({ action: "remove", groupId: m.groupId, memberUserId: user.id }),
                    });
                    if (!res.ok) {
                      setMemberOf((prev) => [...prev, m]);
                      toast.warning("Couldn't leave");
                    }
                  }}
                  className="text-xs font-semibold text-dark-500 px-2.5 py-1.5 rounded-lg active:scale-95 transition-transform shrink-0"
                >
                  Leave
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* create modal */}
      <Modal isOpen={creating} onClose={() => setCreating(false)} title="New circle">
        <div className="space-y-3">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createCircle()}
            placeholder="Family, Roommates, Work..."
            maxLength={40}
            className="glass-input px-4"
          />
          <button
            onClick={createCircle}
            disabled={!newName.trim() || busy}
            className="w-full py-3 rounded-2xl bg-primary-600 text-white font-semibold active:scale-[0.98] transition-transform disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </Modal>

      {/* manage modal */}
      <Modal isOpen={Boolean(manage)} onClose={() => { setManage(null); setRenaming(false); }} title={manage?.name || ""}>
        {manage && (
          <div className="space-y-1.5">
            {/* creator can rename the circle */}
            <div className="flex items-center gap-2 pb-1">
              {renaming ? (
                <>
                  <input
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    maxLength={40}
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") renameCircle(manage.id, renameVal); }}
                    className="glass-input flex-1 px-3 !py-2 text-sm"
                    placeholder="Circle name"
                  />
                  <button
                    onClick={() => renameCircle(manage.id, renameVal)}
                    disabled={!renameVal.trim()}
                    className="p-2 rounded-lg bg-primary-600/20 beacon-accent-text active:scale-90 transition-transform disabled:opacity-40"
                    aria-label="Save name"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setRenaming(false)}
                    className="p-2 rounded-lg bg-dark-700/60 text-dark-300 active:scale-90 transition-transform"
                    aria-label="Cancel rename"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setRenameVal(manage.name); setRenaming(true); }}
                  className="flex items-center gap-1.5 text-xs font-semibold beacon-accent-text active:scale-95 transition-transform"
                >
                  <Pencil className="w-3.5 h-3.5" /> Rename circle
                </button>
              )}
            </div>
            <input
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              placeholder="Search anyone on peja..."
              className="glass-input px-4 mb-2"
            />
            {memberQuery.trim() && memberResults.length === 0 && (
              <p className="text-sm text-dark-500 py-2 text-center">Nobody by that name</p>
            )}
            {!memberQuery.trim() && eligible.length === 0 && (
              <p className="text-sm text-dark-500 py-3 text-center">
                Search for anyone, or add contacts to your community first.
              </p>
            )}
            {(memberQuery.trim() ? memberResults : eligible).map((c) => {
              const member = manage.members.find((m) => m.userId === c.userId);
              return (
                <div
                  key={c.userId}
                  className="flex items-center gap-3 p-2.5 rounded-2xl bg-dark-800/50 border border-dark-700/60"
                >
                  <div className="w-9 h-9 rounded-full overflow-hidden bg-dark-700 flex items-center justify-center shrink-0">
                    {c.avatar ? (
                      <AvatarImage src={c.avatar} wrapperClassName="w-full h-full" />
                    ) : (
                      <User className="w-4 h-4 text-dark-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-dark-100 truncate">{c.name}</p>
                    {member?.status === "pending" && (
                      <p className="beacon-wait-text text-xs flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Waiting for them to accept
                      </p>
                    )}
                  </div>
                  {member ? (
                    <button
                      onClick={() => removeMember(manage.id, c.userId)}
                      className="p-2 rounded-lg bg-red-600/15 text-red-400 active:scale-90 transition-transform shrink-0"
                      aria-label="Remove"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => addMember(manage.id, c.userId)}
                      className="p-2 rounded-lg bg-primary-600/20 beacon-accent-text active:scale-90 transition-transform shrink-0"
                      aria-label="Add"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-dark-800/50 border border-dark-700/60 mt-1">
              <div className="flex-1">
                <p className="text-sm font-medium text-dark-100">Members can see each other</p>
                <p className="text-xs text-dark-500">
                  {manage.membersVisible
                    ? "Everyone in this circle can see and message each other"
                    : "Only you see the full member list"}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={manage.membersVisible}
                onClick={() => toggleVisibility(manage.id, !manage.membersVisible)}
                className={`relative w-[46px] h-[28px] rounded-full transition-colors duration-300 shrink-0 ${
                  manage.membersVisible ? "bg-green-500" : "bg-dark-600"
                }`}
              >
                <span
                  className="absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white shadow-md"
                  style={{
                    left: manage.membersVisible ? 21 : 3,
                    transition: "left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }}
                />
              </button>
            </div>

            <button
              onClick={async () => {
                const snapshot = circles;
                const doomed = manage;
                setManage(null);
                setCircles((prev) => prev.filter((c) => c.id !== doomed.id));
                const { res, data } = await authFetchJson("/api/community/groups", {
                  method: "POST",
                  body: JSON.stringify({ action: "delete", groupId: doomed.id }),
                });
                if (!res.ok) {
                  setCircles(snapshot);
                  toast.warning(data?.error || "Couldn't delete circle");
                } else {
                  load();
                }
              }}
              className="w-full mt-2 py-2.5 rounded-2xl border border-red-500/30 beacon-bad-text text-sm font-semibold active:scale-[0.98] transition-transform"
            >
              Delete circle
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
