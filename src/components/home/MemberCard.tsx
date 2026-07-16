"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { openDirections } from "@/lib/directions";
import { supabase } from "@/lib/supabase";
import { authFetchJson } from "@/lib/authFetch";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { Modal } from "@/components/ui/Modal";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import {
  AlertTriangle, BatteryLow, Battery, HeartHandshake, MapPinned, MessageCircle, Navigation, Phone, User,
} from "lucide-react";
import type { CircleMember } from "./CircleSheet";

/**
 * Tap a circle member -> everything you can DO about them in one card:
 * Message, Call, Ask to check in, and the honest "share my location"
 * switch (Batch C of PEJA_HOME_V2_PLAN.md).
 */
export function MemberCard({
  member,
  onClose,
  origin,
}: {
  member: CircleMember | null;
  onClose: () => void;
  origin?: { lat: number; lng: number } | null;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [phone, setPhone] = useState<string | null>(null);
  const [sharing, setSharing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pinged, setPinged] = useState(false);

  // Load phone + my current sharing state toward this member.
  useEffect(() => {
    if (!member || !user) return;
    setPhone(null);
    setSharing(null);
    setPinged(false);
    (async () => {
      const [userRes, protectorRow, ownerRow] = await Promise.all([
        supabase.from("users").select("phone").eq("id", member.id).maybeSingle(),
        supabase
          .from("emergency_contacts")
          .select("share_back")
          .eq("user_id", member.id)
          .eq("contact_user_id", user.id)
          .eq("status", "accepted")
          .maybeSingle(),
        supabase
          .from("emergency_contacts")
          .select("hide_from_contact")
          .eq("user_id", user.id)
          .eq("contact_user_id", member.id)
          .eq("status", "accepted")
          .maybeSingle(),
      ]);
      setPhone(userRes.data?.phone || null);
      const viaShareBack = protectorRow.data?.share_back ?? false;
      const viaOwnRow = ownerRow.data ? !ownerRow.data.hide_from_contact : false;
      setSharing(viaShareBack || viaOwnRow);
    })();
  }, [member, user]);

  if (!member) return null;

  const isSelf = user?.id === member.id;
  if (isSelf) {
    return (
      <Modal isOpen={Boolean(member)} onClose={onClose} title="" animation="slide-up" size="sm" neutral>
        <div className="text-center py-2">
          <div className="mx-auto w-16 h-16 rounded-full overflow-hidden border-2 border-primary-500/40 bg-dark-700 flex items-center justify-center mb-3">
            {member.avatar ? (
              <AvatarImage src={member.avatar} wrapperClassName="w-full h-full" />
            ) : (
              <User className="w-7 h-7 text-dark-300" />
            )}
          </div>
          <p className="font-bold text-dark-100">This is you</p>
          <p className="text-sm text-dark-400 mt-0.5">
            Your circle sees you here when you share your location.
          </p>
        </div>
      </Modal>
    );
  }

  const askCheckIn = async () => {
    setBusy("ping");
    try {
      const { res, data } = await authFetchJson("/api/community/ping", {
        method: "POST",
        body: JSON.stringify({ peerId: member.id, mode: "ask" }),
      });
      if (!res.ok) {
        toast.warning(data?.error || "Couldn't send");
        return;
      }
      setPinged(true);
      if (navigator.vibrate) navigator.vibrate(15);
    } finally {
      setBusy(null);
    }
  };

  const toggleShare = async () => {
    if (sharing === null) return;
    const next = !sharing;
    setSharing(next); // optimistic
    const { res, data } = await authFetchJson("/api/community/sharing", {
      method: "POST",
      body: JSON.stringify({ peerId: member.id, share: next }),
    });
    if (!res.ok) {
      setSharing(!next);
      toast.warning(data?.error || "Couldn't update sharing");
    } else {
      toast.success(next ? `${member.name.split(" ")[0]} can see you again` : "Sharing paused");
    }
  };

  return (
    <Modal isOpen={Boolean(member)} onClose={onClose} title="" animation="slide-up" size="sm" neutral>
      <div className="-mt-2">
        {/* identity row */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`w-14 h-14 rounded-full overflow-hidden border-2 bg-dark-700 flex items-center justify-center shrink-0 ${
              member.sosActive || member.smlOverdue
                ? "border-red-500 animate-pulse"
                : member.tier === "fresh"
                  ? "border-green-500/70"
                  : "border-dark-600"
            }`}
          >
            {member.avatar ? (
              <AvatarImage src={member.avatar} wrapperClassName="w-full h-full" />
            ) : (
              <User className="w-7 h-7 text-dark-300" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-dark-100 truncate">{member.name}</p>
            <p className={`text-sm ${member.sosActive || member.smlOverdue ? "beacon-bad-text font-semibold" : "text-dark-400"}`}>
              {member.sosActive
                ? "SOS ACTIVE"
                : member.smlOverdue
                  ? "Check-in overdue"
                  : member.smlActive
                    ? "Sharing live with you"
                    : member.freshLabel
                    ? member.tier === "fresh"
                      ? `Updated ${member.freshLabel === "now" ? "just now" : `${member.freshLabel} ago`}`
                      : `Last seen ${member.freshLabel} ago`
                    : "No location yet"}
            </p>
          </div>
          {member.batteryPct != null && (
            <div className="flex items-center gap-1 shrink-0">
              {member.batteryPct <= 15 ? (
                <BatteryLow className="beacon-bad-text w-4.5 h-4.5" />
              ) : (
                <Battery className="beacon-ok-text w-4.5 h-4.5" />
              )}
              <span className={`text-sm font-medium ${member.batteryPct <= 15 ? "beacon-bad-text" : "text-dark-300"}`}>
                {member.batteryPct}%
              </span>
            </div>
          )}
        </div>

        {/* overdue check-in disclaimer (matches the SML page) */}
        {member.smlOverdue && !member.sosActive && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-red-500/10 border border-red-500/30 p-3 mb-4">
            <AlertTriangle className="beacon-bad-text w-4.5 h-4.5 shrink-0 mt-0.5" />
            <p className="beacon-bad-text text-xs leading-relaxed">
              {member.name.split(" ")[0]} missed their safety check-in and hasn&apos;t
              confirmed they&apos;re okay. Their emergency contacts have been
              alerted. Reach out to them now.
            </p>
          </div>
        )}

        {/* honesty: a coarse fix is an AREA, not a point */}
        {(member.accuracyM ?? 0) > 150 && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-primary-500/10 border border-primary-500/25 p-3 mb-4">
            <MapPinned className="beacon-accent-text w-4.5 h-4.5 shrink-0 mt-0.5" />
            <p className="text-xs text-dark-300 leading-relaxed">
              {member.name.split(" ")[0]} is somewhere within about{" "}
              {Math.round((member.accuracyM as number) / 50) * 50} meters of this spot. Their phone
              could only get a rough position, so treat the pin as an area, not an exact point.
            </p>
          </div>
        )}

        {/* actions */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {phone ? (
            <a
              href={`sms:${phone}`}
              className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-dark-800/60 border border-dark-700 active:scale-95 transition-transform"
            >
              <MessageCircle className="beacon-accent-text w-5 h-5" />
              <span className="text-[11px] font-semibold text-dark-200">Text</span>
            </a>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-dark-800/40 border border-dark-700/50 opacity-40">
              <MessageCircle className="w-5 h-5 text-dark-400" />
              <span className="text-[11px] font-semibold text-dark-400">No number</span>
            </div>
          )}
          {phone ? (
            <a
              href={`tel:${phone}`}
              className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-dark-800/60 border border-dark-700 active:scale-95 transition-transform"
            >
              <Phone className="beacon-ok-text w-5 h-5" />
              <span className="text-[11px] font-semibold text-dark-200">Call</span>
            </a>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-dark-800/40 border border-dark-700/50 opacity-40">
              <Phone className="w-5 h-5 text-dark-400" />
              <span className="text-[11px] font-semibold text-dark-400">No number</span>
            </div>
          )}
          <button
            onClick={askCheckIn}
            disabled={busy === "ping" || pinged}
            className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border active:scale-95 transition-all disabled:opacity-70 ${
              pinged
                ? "bg-green-500/10 border-green-500/30"
                : "bg-dark-800/60 border-dark-700"
            }`}
          >
            {busy === "ping" ? (
              <PejaSpinner className="w-5 h-5" />
            ) : (
              <HeartHandshake className={`w-5 h-5 ${pinged ? "beacon-ok-text" : "beacon-wait-text"}`} />
            )}
            <span className={`text-[11px] font-semibold ${pinged ? "beacon-ok-text" : "text-dark-200"}`}>
              {pinged ? "Asked" : "Are you OK?"}
            </span>
          </button>
        </div>

        {/* directions: only when their live spot is on the map */}
        {member.lat != null && member.lng != null && (
          <button
            onClick={() => openDirections({ lat: member.lat as number, lng: member.lng as number }, origin)}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold mb-4 active:scale-[0.985] transition-transform"
          >
            <Navigation className="w-4 h-4" />
            Directions to {member.name.split(" ")[0]}
          </button>
        )}

        {/* sharing switch */}
        <button
          onClick={toggleShare}
          disabled={sharing === null}
          className="w-full flex items-center gap-3 p-3 rounded-2xl bg-dark-800/60 border border-dark-700 active:scale-[0.985] transition-transform disabled:opacity-50"
        >
          <div className="flex-1 text-left">
            <p className="text-sm font-medium text-dark-100">Share my location</p>
            <p className="text-xs text-dark-500">
              {sharing === null
                ? "Checking..."
                : sharing
                  ? `${member.name.split(" ")[0]} can see where you are`
                  : "Paused - they can't see you"}
            </p>
          </div>
          <div
            className={`relative w-[46px] h-[28px] rounded-full transition-colors duration-300 shrink-0 ${
              sharing ? "bg-green-500" : "bg-dark-600"
            }`}
          >
            <span
              className="absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white shadow-md"
              style={{
                left: sharing ? 21 : 3,
                transition: "left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            />
          </div>
        </button>
      </div>
    </Modal>
  );
}
