"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Loader2, CheckCircle, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";

type Row = {
  id: string;
  guardian_id: string | null;
  action: string;
  post_id: string | null;
  comment_id: string | null;
  reason: string | null;
  created_at: string | null;
};

export default function GuardianActionsPage() {
    useScrollRestore("guardian:actions");
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchRows = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("guardian_actions")
        .select("id,guardian_id,action,post_id,comment_id,reason,created_at")
        .eq("guardian_id", user.id)
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) throw error;
      setRows((data || []) as any);
    } catch (e) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, [user?.id]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const hay = `${r.action || ""} ${r.reason || ""} ${r.post_id || ""}`.toLowerCase();
      return hay.includes(s);
    });
  }, [rows, q]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark-100 flex items-center gap-2">
          <CheckCircle className="w-6 h-6 text-primary-400" />
          My Actions
        </h1>
        <p className="text-dark-400 mt-1">Your moderation activity history</p>
      </div>

      <div className="mb-4">
        <div className="relative">
          <button
            type="button"
            onClick={() => searchRef.current?.focus()}
            className="absolute left-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10"
          >
            <Search className="w-5 h-5 text-dark-400" />
          </button>
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search actions..."
            className="glass-input w-full h-11 pl-12 pr-4"
          />
        </div>
      </div>

      {loading ? (
  <div className="space-y-2">
    {Array.from({ length: 10 }).map((_, i) => (
      <div key={i} className="glass-card p-4">
        <Skeleton className="h-4 w-40 mb-2" />
        <Skeleton className="h-3 w-full mb-2" />
        <Skeleton className="h-3 w-24" />
      </div>
    ))}
  </div>
) : filtered.length === 0 ? (
  <div className="glass-card text-center py-10">
    <p className="text-dark-400">No actions yet</p>
  </div>
) : (
  <div className="space-y-2">
    {filtered.map((r) => (
            <div key={r.id} className="glass-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-dark-100 font-medium">{r.action}</p>
                  {r.reason && <p className="text-sm text-dark-400 mt-1">{r.reason}</p>}
                  {r.post_id && <p className="text-xs text-dark-500 mt-1">post: {r.post_id}</p>}
                </div>
                <span className="text-xs text-dark-500">
                  {r.created_at ? formatDistanceToNow(new Date(r.created_at), { addSuffix: true }) : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}