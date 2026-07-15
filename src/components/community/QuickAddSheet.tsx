"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { supabase } from "@/lib/supabase";
import { signalCircleRefresh } from "@/lib/authFetch";
import { createNotification } from "@/lib/notifications";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { Modal } from "@/components/ui/Modal";
import { InvitePanel } from "./InvitePanel";
import { Check, ChevronRight, Search, User } from "lucide-react";

interface FoundUser {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

/**
 * The + button's fast path: search someone already on peja and send the
 * contact request in two taps, or invite off-platform below. Full
 * management stays on the community page (link at the bottom).
 */
export function QuickAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSentTo(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim() || !user) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("users")
        .select("id, full_name, avatar_url")
        .ilike("full_name", `%${query.trim()}%`)
        .neq("id", user.id)
        .limit(6);
      setResults((data as FoundUser[]) || []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query, user]);

  const sendRequest = async (target: FoundUser) => {
    if (!user || sendingTo) return;
    setSendingTo(target.id);
    try {
      // Existing relationship in any state? Route them to the full page.
      const { data: existing } = await supabase
        .from("emergency_contacts")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("contact_user_id", target.id)
        .maybeSingle();
      if (existing && existing.status !== "declined") {
        toast.info(
          existing.status === "accepted"
            ? "Already in your community"
            : "Request already pending"
        );
        return;
      }

      // Optimistic: show Sent immediately; roll back if the write fails.
      setSentTo((prev) => new Set(prev).add(target.id));
      if (navigator.vibrate) navigator.vibrate(12);

      const { error } = await supabase.from("emergency_contacts").insert({
        user_id: user.id,
        contact_user_id: target.id,
        relationship: "friend",
        status: "pending",
      });
      if (error) {
        setSentTo((prev) => {
          const next = new Set(prev);
          next.delete(target.id);
          return next;
        });
        toast.warning("Couldn't send the request");
        return;
      }
      signalCircleRefresh();
      await createNotification({
        userId: target.id,
        type: "system",
        title: "Emergency Contact Request",
        body: `${user.full_name || "Someone"} wants to add you as their emergency contact (friend).`,
        data: { type: "emergency_contact_request", from_user_id: user.id },
      });
    } finally {
      setSendingTo(null);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Add to your community" animation="slide-up">
      <div className="space-y-4">
        {/* search on peja */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people on peja..."
            className="glass-input !pl-10 pr-4"
          />
        </div>

        {query.trim() && (
          <div className="space-y-1.5">
            {searching && results.length === 0 ? (
              <p className="text-sm text-dark-500 text-center py-2">Searching...</p>
            ) : results.length === 0 ? (
              <p className="text-sm text-dark-500 text-center py-2">
                Nobody by that name yet - invite them below
              </p>
            ) : (
              results.map((r) => {
                const sent = sentTo.has(r.id);
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 p-2.5 rounded-2xl bg-dark-800/50 border border-dark-700/60"
                  >
                    <div className="w-9 h-9 rounded-full overflow-hidden bg-dark-700 flex items-center justify-center shrink-0">
                      {r.avatar_url ? (
                        <AvatarImage src={r.avatar_url} wrapperClassName="w-full h-full" />
                      ) : (
                        <User className="w-4 h-4 text-dark-300" />
                      )}
                    </div>
                    <p className="flex-1 text-sm font-medium text-dark-100 truncate">{r.full_name}</p>
                    <button
                      onClick={() => sendRequest(r)}
                      disabled={sent || sendingTo === r.id}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 active:scale-95 transition-all ${
                        sent
                          ? "bg-green-500/15 beacon-ok-text"
                          : "bg-primary-600 text-white"
                      }`}
                    >
                      {sent ? (
                        <span className="flex items-center gap-1">
                          <Check className="w-3 h-3" /> Sent
                        </span>
                      ) : sendingTo === r.id ? (
                        "..."
                      ) : (
                        "Request"
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* invite off-platform */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-dark-500 mb-2">
            Not on peja yet?
          </p>
          <InvitePanel compact />
        </div>

        <button
          onClick={() => {
            onClose();
            router.push("/emergency-contacts");
          }}
          className="w-full flex items-center justify-center gap-1 py-2.5 text-sm font-semibold beacon-accent-text active:scale-[0.98] transition-transform"
        >
          View all contacts and circles
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </Modal>
  );
}
