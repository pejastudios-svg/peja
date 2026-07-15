"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { formatDistanceToNow } from "date-fns";
import { FileDown, Link2, Search, Users, UserX } from "lucide-react";

// Circle completion: the metric that matters. A user with 2+ accepted
// contacts is real; a download with an empty circle is nothing. Campaigns
// are judged by connected pairs created, because the pair is the product.

interface Summary {
  totalUsers: number;
  real: number;
  one: number;
  empty: number;
  completionPct: number;
  uniquePairs: number;
  pairs7d: number;
  pairs30d: number;
  totalCircles: number;
}

interface Row {
  id: string;
  name: string;
  avatar: string | null;
  joined: string;
  contacts: number;
  circles: number;
  lastSeen: string | null;
}

function Tile({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl border border-dark-700 bg-dark-800/50 p-4">
      <p className="text-[11px] uppercase tracking-wide text-dark-500">{label}</p>
      <p className={`text-2xl font-black mt-1 ${tone === "good" ? "text-green-400" : tone === "bad" ? "text-red-400" : "text-dark-50"}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-dark-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function AdminCirclesPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  type Filter = "all" | "real" | "one" | "empty" | "in-circles" | "active7d" | "never-seen";
  const [filter, setFilter] = useState<Filter>("all");
  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "real", label: "Real (2+)" },
    { key: "one", label: "One contact" },
    { key: "empty", label: "Empty" },
    { key: "in-circles", label: "In circles" },
    { key: "active7d", label: "Active 7d" },
    { key: "never-seen", label: "Never seen" },
  ];

  useEffect(() => {
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        const res = await fetch("/api/admin/circle-metrics", {
          headers: { Authorization: `Bearer ${token || ""}` },
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error || "Could not load metrics");
          return;
        }
        setSummary(data.summary);
        setRows(data.users || []);
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      switch (filter) {
        case "real": return r.contacts >= 2;
        case "one": return r.contacts === 1;
        case "empty": return r.contacts === 0;
        case "in-circles": return r.circles > 0;
        case "active7d": return Boolean(r.lastSeen && now - new Date(r.lastSeen).getTime() < 7 * 86400_000);
        case "never-seen": return !r.lastSeen;
        default: return true;
      }
    });
  }, [rows, query, filter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center pt-40 pb-24">
        <PejaSpinner />
      </div>
    );
  }
  if (error || !summary) {
    return <p className="text-sm text-red-400 pt-40 pb-12 text-center">{error || "No data"}</p>;
  }

  return (
    <div className="circle-report px-6 pb-6 pt-32 max-w-6xl mx-auto space-y-6">
      {/* Print styles: the Export button uses the browser's print-to-PDF.
          Dark admin chrome prints terribly, so the report flips to plain
          black-on-white and hides everything interactive. */}
      <style>{`
        @media print {
          [data-admin-nav], .no-print { display: none !important; }
          body { background: #fff !important; }
          .circle-report { padding: 16px !important; max-width: none !important; }
          .circle-report, .circle-report * {
            color: #111 !important;
            background: transparent !important;
            border-color: #ccc !important;
            box-shadow: none !important;
          }
          .circle-report table { font-size: 11px; }
          .print-only { display: block !important; }
        }
      `}</style>
      <p className="print-only hidden text-xs">
        peja circle completion report - {new Date().toLocaleDateString()}
      </p>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-dark-50">Circle completion</h1>
          <p className="text-sm text-dark-400 mt-0.5">
            The pair is the product. Campaigns are judged by connected pairs created, not downloads.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          aria-label="Export as PDF"
          className="no-print shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-xl border border-dark-700 bg-dark-800/60 text-sm font-semibold text-dark-200 active:scale-95 transition-transform"
        >
          <FileDown className="w-4 h-4" />
          Export PDF
        </button>
      </div>

      {/* the north star, front and center */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="Real users (2+ contacts)"
          value={summary.real}
          sub={`${summary.completionPct}% of ${summary.totalUsers} users`}
          tone="good"
        />
        <Tile label="Connected pairs" value={summary.uniquePairs} sub={`+${summary.pairs7d} this week · +${summary.pairs30d} in 30 days`} />
        <Tile label="One contact" value={summary.one} sub="one invite from real" />
        <Tile label="Empty circles" value={summary.empty} sub="downloads, not users yet" tone="bad" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Total users" value={summary.totalUsers} />
        <Tile label="Circles (groups)" value={summary.totalCircles} />
        <Tile label="Pairs / user" value={summary.totalUsers ? (summary.uniquePairs / summary.totalUsers).toFixed(2) : "0"} sub="network density" />
        <Tile label="Completion rate" value={`${summary.completionPct}%`} tone={summary.completionPct >= 40 ? "good" : undefined} />
      </div>

      {/* user table */}
      <div className="rounded-2xl border border-dark-700 bg-dark-800/50 overflow-hidden">
        <div className="no-print p-3 border-b border-dark-700 flex items-center gap-2">
          <Search className="w-4 h-4 text-dark-500 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users..."
            className="flex-1 bg-transparent text-sm text-dark-100 placeholder:text-dark-500 focus:outline-none"
          />
          <span className="text-xs text-dark-500 shrink-0">{filtered.length} shown</span>
        </div>
        <div className="no-print px-3 py-2 border-b border-dark-700 flex items-center gap-1.5 overflow-x-auto hide-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors active:scale-95 ${
                filter === f.key
                  ? "bg-primary-600 text-white"
                  : "bg-dark-700/60 text-dark-300 hover:text-dark-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-dark-500 border-b border-dark-700">
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">Contacts</th>
                <th className="px-4 py-2.5">Circles</th>
                <th className="px-4 py-2.5">Joined</th>
                <th className="px-4 py-2.5">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((r) => (
                <tr key={r.id} className="border-b border-dark-700/50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full overflow-hidden bg-dark-700 shrink-0 flex items-center justify-center">
                        {r.avatar ? (
                          <AvatarImage src={r.avatar} wrapperClassName="w-full h-full" />
                        ) : (
                          <Users className="w-4 h-4 text-dark-400" />
                        )}
                      </div>
                      <span className="text-dark-100 truncate max-w-[180px]">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                        r.contacts >= 2
                          ? "bg-green-500/15 text-green-400"
                          : r.contacts === 1
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-red-500/10 text-red-400"
                      }`}
                    >
                      {r.contacts >= 2 ? <Link2 className="w-3 h-3" /> : r.contacts === 0 ? <UserX className="w-3 h-3" /> : null}
                      {r.contacts}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-dark-300">{r.circles}</td>
                  <td className="px-4 py-2.5 text-dark-400 text-xs">
                    {r.joined ? formatDistanceToNow(new Date(r.joined), { addSuffix: true }) : "?"}
                  </td>
                  <td className="px-4 py-2.5 text-dark-400 text-xs">
                    {r.lastSeen ? formatDistanceToNow(new Date(r.lastSeen), { addSuffix: true }) : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 200 && (
            <p className="text-xs text-dark-500 text-center py-2">Showing first 200. Use search to narrow.</p>
          )}
        </div>
      </div>
    </div>
  );
}
