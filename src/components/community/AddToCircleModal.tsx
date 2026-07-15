"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { supabase } from "@/lib/supabase";
import { authFetchJson } from "@/lib/authFetch";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { Modal } from "@/components/ui/Modal";
import { Check, User } from "lucide-react";

interface Found {
  userId: string;
  name: string;
  avatar: string | null;
}

/**
 * Add people to a specific circle from anywhere (the map sheet, the
 * community page). Search any peja user; adding sends the combined
 * circle+contact invite (see the groups API). Reusable + self-contained.
 */
export function AddToCircleModal({
  groupId,
  groupName,
  existingMemberIds,
  onClose,
  onAdded,
}: {
  groupId: string | null;
  groupName: string;
  existingMemberIds: string[];
  onClose: () => void;
  onAdded?: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId) {
      setQuery("");
      setResults([]);
      setAdded(new Set());
    }
  }, [groupId]);

  useEffect(() => {
    if (!query.trim() || !user) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("users")
        .select("id, full_name, avatar_url")
        .ilike("full_name", `%${query.trim()}%`)
        .neq("id", user.id)
        .limit(6);
      setResults(
        (data || []).map((u) => ({
          userId: u.id,
          name: u.full_name || "Unknown",
          avatar: u.avatar_url || null,
        }))
      );
    }, 300);
    return () => clearTimeout(t);
  }, [query, user]);

  const add = async (f: Found) => {
    if (!groupId) return;
    setBusyId(f.userId);
    setAdded((prev) => new Set(prev).add(f.userId)); // optimistic
    const { res, data } = await authFetchJson("/api/community/groups", {
      method: "POST",
      body: JSON.stringify({ action: "add", groupId, memberIds: [f.userId] }),
    });
    setBusyId(null);
    if (!res.ok) {
      setAdded((prev) => {
        const next = new Set(prev);
        next.delete(f.userId);
        return next;
      });
      toast.warning(data?.error || "Couldn't add");
      return;
    }
    if (navigator.vibrate) navigator.vibrate(12);
    onAdded?.();
  };

  return (
    <Modal isOpen={Boolean(groupId)} onClose={onClose} title={`Add to ${groupName}`}>
      <div className="space-y-3">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search anyone on peja..."
          className="glass-input px-4"
        />
        {query.trim() && results.length === 0 && (
          <p className="text-sm text-dark-500 text-center py-2">Nobody by that name</p>
        )}
        <div className="space-y-1.5">
          {results.map((f) => {
            const isMember = existingMemberIds.includes(f.userId) || added.has(f.userId);
            return (
              <div
                key={f.userId}
                className="flex items-center gap-3 p-2.5 rounded-2xl bg-dark-800/50 border border-dark-700/60"
              >
                <div className="w-9 h-9 rounded-full overflow-hidden bg-dark-700 flex items-center justify-center shrink-0">
                  {f.avatar ? (
                    <AvatarImage src={f.avatar} wrapperClassName="w-full h-full" />
                  ) : (
                    <User className="w-4 h-4 text-dark-300" />
                  )}
                </div>
                <p className="flex-1 text-sm font-medium text-dark-100 truncate">{f.name}</p>
                <button
                  onClick={() => add(f)}
                  disabled={isMember || busyId === f.userId}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 active:scale-95 transition-all ${
                    isMember ? "bg-green-500/15 beacon-ok-text" : "bg-primary-600 text-white"
                  }`}
                >
                  {isMember ? (
                    <span className="flex items-center gap-1">
                      <Check className="w-3 h-3" /> Added
                    </span>
                  ) : busyId === f.userId ? (
                    "..."
                  ) : (
                    "Add"
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
