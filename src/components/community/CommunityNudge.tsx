"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { supabase } from "@/lib/supabase";
import { authFetchJson, CIRCLE_REFRESH_EVENT } from "@/lib/authFetch";
import { Modal } from "@/components/ui/Modal";
import { InvitePanel } from "./InvitePanel";
import { INVITE_REF_KEY } from "@/lib/invite";
import { Users, X } from "lucide-react";

const DISMISS_KEY = "peja-community-nudge-dismissed-at";
const RESHOW_AFTER_DAYS = 7;

/**
 * Two jobs, both on the home screen:
 * 1. Claim a pending invite referral (stored by /join) right after the
 *    invited person's first login, then point them at the request.
 * 2. When the user's circle is empty, show a dismissible nudge - the
 *    emptiness itself is the strongest argument for inviting people.
 */
export function CommunityNudge({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  // 1. Claim referral (runs once per stored ref; key cleared regardless
  // of outcome so a bad ref can't retry forever).
  useEffect(() => {
    if (!user) return;
    let ref: string | null = null;
    try { ref = localStorage.getItem(INVITE_REF_KEY); } catch {}
    if (!ref) return;
    try { localStorage.removeItem(INVITE_REF_KEY); } catch {}
    (async () => {
      try {
        const { res, data } = await authFetchJson("/api/community/claim-invite", {
          method: "POST",
          body: JSON.stringify({ ref }),
        });
        if (res.ok && data?.claimed && data.referrer_name) {
          toast.success(`${data.referrer_name} wants you in their circle`);
          router.push("/emergency-contacts");
        }
      } catch {
        /* invite claiming is best-effort - never block the home screen */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // 2. Empty-circle nudge (respects a 7-day dismissal). "Circle" means
  // an accepted contact in EITHER direction: people I added, and people
  // who added me. Counting only my own rows left the banner up for users
  // whose circle came entirely from invites they accepted. Re-checks on
  // circle mutations and focus so it also clears itself promptly.
  useEffect(() => {
    if (!user) return;
    let stop = false;
    const check = async () => {
      try {
        const dismissed = localStorage.getItem(DISMISS_KEY);
        if (dismissed && Date.now() - Number(dismissed) < RESHOW_AFTER_DAYS * 86400_000) {
          return;
        }
      } catch {}
      const { count, error } = await supabase
        .from("emergency_contacts")
        .select("id", { count: "exact", head: true })
        .eq("status", "accepted")
        .or(`user_id.eq.${user.id},contact_user_id.eq.${user.id}`);
      if (stop || error) return;
      setShow((count ?? 0) === 0);
    };
    check();
    window.addEventListener(CIRCLE_REFRESH_EVENT, check);
    window.addEventListener("focus", check);
    return () => {
      stop = true;
      window.removeEventListener(CIRCLE_REFRESH_EVENT, check);
      window.removeEventListener("focus", check);
    };
  }, [user]);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  };

  return (
    <>
      {/* One card, two shapes. Compact (sheet open): a single row sized
          to sit between the map controls. Full (sheet closed): the row
          plus an expanding detail section, so the switch reads as a
          morph. Opaque themed surface: the old translucent tint was
          unreadable over the always-dark map in light mode. */}
      <div className="rounded-2xl glass-card !p-3 beacon-step-in">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/emergency-contacts")}
            className="flex items-center gap-3 flex-1 min-w-0 text-left active:scale-[0.99] transition-transform"
          >
            <div className="w-9 h-9 rounded-full bg-primary-500/20 flex items-center justify-center shrink-0">
              <Users className="beacon-accent-text w-[18px] h-[18px]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-dark-100 truncate">Your circle is empty</p>
              {compact && (
                <p className="text-xs text-dark-400 truncate">Add the people who should know first.</p>
              )}
            </div>
          </button>
          {compact && (
            <button
              onClick={() => setInviteOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-primary-600 text-white text-xs font-semibold active:scale-95 transition-transform shrink-0"
            >
              Invite
            </button>
          )}
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="p-1.5 rounded-full text-dark-400 hover:bg-white/10 active:scale-90 transition-all shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div
          style={{
            maxHeight: compact ? 0 : 220,
            opacity: compact ? 0 : 1,
            overflow: "hidden",
            transition: "max-height 0.45s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease",
          }}
        >
          <p className="text-sm text-dark-400 leading-relaxed mt-2">
            Peja works when your people are on it. If something happens,
            who should know first?
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setInviteOpen(true)}
              className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold active:scale-95 transition-transform"
            >
              Invite your people
            </button>
            <button
              onClick={() => router.push("/emergency-contacts")}
              className="px-4 py-2 rounded-xl bg-dark-700/60 text-dark-200 text-sm font-semibold active:scale-95 transition-transform"
            >
              Find them on peja
            </button>
          </div>
        </div>
      </div>

      <Modal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite your people">
        <InvitePanel />
      </Modal>
    </>
  );
}
