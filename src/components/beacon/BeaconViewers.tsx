"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, Link2, Plus, X } from "lucide-react";
import { authFetchJson } from "@/lib/authFetch";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Modal } from "@/components/ui/Modal";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import type { BeaconDevice } from "@/lib/beacon";

// Who can see THIS Beacon. Two ways in: pick one of your own contacts, or
// share an invite link for someone who is not on peja yet (the school
// parent case). Each grant covers exactly one device.

interface Viewer {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  since: string;
}

interface PendingInvite {
  id: string;
  invitee_label: string | null;
  created_at: string;
}

interface PickableContact {
  userId: string;
  name: string;
  avatar: string | null;
}

export function BeaconViewers({ device }: { device: BeaconDevice }) {
  const { user } = useAuth();
  const toast = useToast();
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [contacts, setContacts] = useState<PickableContact[]>([]);
  const [busy, setBusy] = useState(false);
  const [inviteLabel, setInviteLabel] = useState("");

  const load = useCallback(async () => {
    const { data } = await authFetchJson(`/api/beacon/viewers?deviceId=${device.id}`);
    setViewers(data?.viewers || []);
    setPending(data?.pendingInvites || []);
    setLoaded(true);
  }, [device.id]);

  useEffect(() => {
    load().catch(() => setLoaded(true));
  }, [load]);

  // Contacts for the picker, minus people who already have a grant.
  useEffect(() => {
    if (!pickerOpen || !user) return;
    (async () => {
      const { data } = await supabase
        .from("emergency_contacts")
        .select("contact_user_id, status")
        .eq("user_id", user.id)
        .eq("status", "accepted");
      const ids = (data || []).map((r) => r.contact_user_id).filter(Boolean) as string[];
      if (ids.length === 0) {
        setContacts([]);
        return;
      }
      const { data: users } = await supabase
        .from("users")
        .select("id, full_name, avatar_url")
        .in("id", ids);
      setContacts(
        (users || [])
          .filter((u) => !viewers.some((v) => v.userId === u.id))
          .map((u) => ({ userId: u.id, name: u.full_name || "Unknown", avatar: u.avatar_url })),
      );
    })();
  }, [pickerOpen, user, viewers]);

  const grant = async (viewerUserId: string) => {
    setBusy(true);
    try {
      const { res, data } = await authFetchJson("/api/beacon/viewers", {
        method: "POST",
        body: JSON.stringify({ deviceId: device.id, viewerUserId }),
      });
      if (!res.ok) throw new Error(data?.error || "Could not add the viewer");
      await load();
      setPickerOpen(false);
    } catch (e) {
      toast.warning(e instanceof Error ? e.message : "Could not add the viewer");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (viewerUserId: string) => {
    setViewers((prev) => prev.filter((v) => v.userId !== viewerUserId));
    await authFetchJson("/api/beacon/viewers", {
      method: "DELETE",
      body: JSON.stringify({ deviceId: device.id, viewerUserId }),
    }).catch(() => load());
  };

  const shareInvite = async () => {
    setBusy(true);
    try {
      const { res, data } = await authFetchJson("/api/beacon/invite", {
        method: "POST",
        body: JSON.stringify({ deviceId: device.id, label: inviteLabel.trim() || null }),
      });
      if (!res.ok) throw new Error(data?.error || "Could not create the invite");
      const wearer = device.wearer_name || device.name || "a Beacon";
      const text = `Follow this link to see ${wearer}'s Beacon on peja: ${data.url}`;
      if (navigator.share) {
        await navigator.share({ text }).catch(() => {});
      } else {
        await navigator.clipboard.writeText(data.url);
        toast.success("Invite link copied");
      }
      setInviteLabel("");
      await load();
    } catch (e) {
      toast.warning(e instanceof Error ? e.message : "Could not create the invite");
    } finally {
      setBusy(false);
    }
  };

  const revokeInvite = async (inviteId: string) => {
    setPending((prev) => prev.filter((i) => i.id !== inviteId));
    await authFetchJson("/api/beacon/invite", {
      method: "DELETE",
      body: JSON.stringify({ inviteId }),
    }).catch(() => load());
  };

  const wearer = device.wearer_name || device.name || "this Beacon";

  return (
    <div className="rounded-2xl bg-dark-800/50 border border-dark-700 p-3.5">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
          <Eye className="beacon-accent-text w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-dark-100">Who can see {wearer}</p>
          <p className="text-xs text-dark-500">
            Each person here sees this Beacon only, nothing else of yours
          </p>
        </div>
      </div>

      {!loaded ? (
        <div className="flex justify-center py-4">
          <PejaSpinner className="w-5 h-5" />
        </div>
      ) : (
        <div className="mt-2.5 space-y-2">
          {viewers.map((v) => (
            <div key={v.userId} className="flex items-center gap-3 p-2 rounded-xl bg-[var(--soft-surface)]">
              <AvatarImage
                src={v.avatarUrl}
                wrapperClassName="w-8 h-8 rounded-full bg-primary-600/20 overflow-hidden shrink-0 flex items-center justify-center"
                fallback={<span className="text-xs font-bold text-primary-400">{v.fullName[0]}</span>}
              />
              <span className="flex-1 text-sm text-dark-100 truncate">{v.fullName}</span>
              <button
                onClick={() => revoke(v.userId)}
                aria-label={`Remove ${v.fullName}`}
                className="p-1.5 rounded-full text-dark-400 hover:bg-[var(--soft-surface-strong)] active:scale-[0.97] transition-ui"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          {pending.map((i) => (
            <div key={i.id} className="flex items-center gap-3 p-2 rounded-xl bg-[var(--soft-surface)]">
              <div className="w-8 h-8 rounded-full bg-[var(--soft-surface-strong)] flex items-center justify-center shrink-0">
                <Link2 className="w-4 h-4 text-dark-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-dark-200 truncate">
                  {i.invitee_label || "Invite link"}
                </p>
                <p className="text-[11px] text-dark-500">Waiting to be accepted</p>
              </div>
              <button
                onClick={() => revokeInvite(i.id)}
                aria-label="Withdraw invite"
                className="p-1.5 rounded-full text-dark-400 hover:bg-[var(--soft-surface-strong)] active:scale-[0.97] transition-ui"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          {viewers.length === 0 && pending.length === 0 && (
            <p className="text-xs text-dark-500 py-1">
              Nobody yet. Your emergency contacts may already see it through
              Beacon sharing above; this list is for everyone else.
            </p>
          )}

          <button
            onClick={() => setPickerOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-dark-600 text-xs font-medium text-primary-400 active:scale-[0.97] transition-transform"
          >
            <Plus className="w-3.5 h-3.5" /> Add a viewer
          </button>
        </div>
      )}

      <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="Add a viewer">
        <div className="space-y-4">
          {contacts.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-dark-500 mb-2">
                Your contacts
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {contacts.map((c) => (
                  <button
                    key={c.userId}
                    disabled={busy}
                    onClick={() => grant(c.userId)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-[var(--soft-surface)] text-left active:scale-[0.97] transition-transform disabled:opacity-50"
                  >
                    <AvatarImage
                      src={c.avatar}
                      wrapperClassName="w-8 h-8 rounded-full bg-primary-600/20 overflow-hidden shrink-0 flex items-center justify-center"
                      fallback={<span className="text-xs font-bold text-primary-400">{c.name[0]}</span>}
                    />
                    <span className="text-sm text-dark-100">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-dark-500 mb-2">
              Not on peja yet
            </p>
            <p className="text-xs text-dark-500 mb-2 leading-relaxed">
              Share a link instead. Whoever opens it and signs in becomes a
              viewer of this Beacon, and the link works once.
            </p>
            <input
              value={inviteLabel}
              onChange={(e) => setInviteLabel(e.target.value)}
              maxLength={60}
              placeholder="Who is it for? e.g. Ada's dad"
              className="w-full glass-input rounded-xl px-4 text-sm text-dark-100 placeholder:text-dark-500 mb-2"
            />
            <button
              onClick={shareInvite}
              disabled={busy}
              className="w-full py-3 rounded-xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? <PejaSpinner className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
              Share invite link
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
