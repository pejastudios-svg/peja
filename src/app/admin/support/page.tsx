"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import HudShell from "@/components/dashboard/HudShell";
import HudPanel from "@/components/dashboard/HudPanel";
import GlowButton from "@/components/dashboard/GlowButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatDistanceToNow } from "date-fns";
import {
  MessageSquare,
  RefreshCw,
  Inbox,
  CheckCircle2,
  Clock,
  CircleDot,
  User,
  Mail,
  Send,
  Archive,
  Trash2,
  ArchiveRestore,
  StickyNote,
} from "lucide-react";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

type TicketStatus = "open" | "in_progress" | "resolved" | "archived";

interface AdminNote {
  id: string;
  kind: "note" | "reply";
  body: string;
  author_id: string | null;
  created_at: string;
}

interface Ticket {
  id: string;
  ticket_number: string;
  user_id: string;
  title: string;
  message: string;
  status: TicketStatus;
  admin_notes: AdminNote[];
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
  user?: {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  };
}

const FILTERS: { key: "all" | TicketStatus; label: string; icon: any }[] = [
  { key: "all", label: "All", icon: Inbox },
  { key: "open", label: "Open", icon: CircleDot },
  { key: "in_progress", label: "In Progress", icon: Clock },
  { key: "resolved", label: "Resolved", icon: CheckCircle2 },
  { key: "archived", label: "Archived", icon: Archive },
];

function statusBadge(status: TicketStatus) {
  switch (status) {
    case "open":
      return { label: "Open", bg: "rgba(234, 179, 8, 0.15)", color: "#eab308", border: "rgba(234, 179, 8, 0.35)" };
    case "in_progress":
      return { label: "In Progress", bg: "rgba(59, 130, 246, 0.15)", color: "#3b82f6", border: "rgba(59, 130, 246, 0.35)" };
    case "resolved":
      return { label: "Resolved", bg: "rgba(34, 197, 94, 0.15)", color: "#22c55e", border: "rgba(34, 197, 94, 0.35)" };
    case "archived":
      return { label: "Archived", bg: "rgba(148, 163, 184, 0.15)", color: "#94a3b8", border: "rgba(148, 163, 184, 0.35)" };
  }
}

export default function AdminSupportPage() {
  const { session } = useAuth();
  const toast = useToast();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | TicketStatus>("open");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [draft, setDraft] = useState("");
  const [acting, setActing] = useState(false);
  // In-app delete confirmation. Holds the ticket pending deletion; null = closed.
  const [pendingDelete, setPendingDelete] = useState<Ticket | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTickets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("support_tickets")
        .select(`
          id, ticket_number, user_id, title, message, status, admin_notes,
          resolved_at, resolved_by, created_at, updated_at,
          user:user_id ( id, full_name, email, avatar_url )
        `)
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      const rows = (data || []).map((t: any) => ({
        ...t,
        admin_notes: Array.isArray(t.admin_notes) ? t.admin_notes : [],
        user: Array.isArray(t.user) ? t.user[0] : t.user,
      })) as Ticket[];
      setTickets(rows);
    } catch (err: any) {
      toast.danger(err?.message || "Failed to load tickets");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchTickets(false);
  }, [fetchTickets]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-support-tickets")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets" },
        () => fetchTickets(true)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchTickets]);

  const counts = useMemo(() => {
    const c = { all: tickets.length, open: 0, in_progress: 0, resolved: 0, archived: 0 };
    for (const t of tickets) c[t.status] += 1;
    return c;
  }, [tickets]);

  const filtered = useMemo(() => {
    if (filter === "all") return tickets;
    return tickets.filter((t) => t.status === filter);
  }, [tickets, filter]);

  const openTicket = (t: Ticket) => {
    setSelected(t);
    // Textarea is always empty when opening a ticket so the admin can't
    // accidentally send a saved internal note to the user as a reply.
    setDraft("");
  };

  const closeTicket = () => {
    setSelected(null);
    setDraft("");
  };

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token || ""}`,
  });

  // Patch local state for a single ticket (also updates `selected` if it's the
  // one being patched, so the modal stays in sync without a refetch).
  const patchTicket = (id: string, patch: Partial<Ticket>) => {
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setSelected((curr) => (curr && curr.id === id ? { ...curr, ...patch } : curr));
  };

  const setStatus = async (status: TicketStatus) => {
    if (!selected || !session?.access_token) return;
    setActing(true);
    try {
      const res = await fetch(apiUrl("/api/admin/support/set-status"), {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ ticketId: selected.id, status }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Failed");
      patchTicket(selected.id, {
        status,
        resolved_at:
          status === "resolved" ? new Date().toISOString() : selected.status === "resolved" ? null : selected.resolved_at,
      });
      const label =
        status === "resolved" ? "Ticket resolved"
        : status === "in_progress" ? "Marked in progress"
        : status === "archived" ? "Ticket archived"
        : "Ticket reopened";
      toast.success(label + (data.emailSent ? " · user notified" : ""));
      if (status === "archived") closeTicket();
    } catch (err: any) {
      toast.danger(err?.message || "Failed to update");
    } finally {
      setActing(false);
    }
  };

  // Append a note. sendEmail = true emails the user and stores it as a "reply"
  // entry; false stores it as an internal "note" entry. In both cases the
  // textarea is cleared so the field is ready for the next message.
  const submitDraft = async (sendEmail: boolean) => {
    if (!selected || !session?.access_token) return;
    const text = draft.trim();
    if (!text) {
      toast.warning(sendEmail ? "Type a reply first." : "Type a note first.");
      return;
    }
    if (sendEmail && !selected.user?.email) {
      toast.warning("This user has no email on file.");
      return;
    }
    setActing(true);
    try {
      const res = await fetch(apiUrl("/api/admin/support/add-note"), {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ ticketId: selected.id, body: text, sendEmail }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Failed");
      patchTicket(selected.id, { admin_notes: data.admin_notes as AdminNote[] });
      setDraft("");
      toast.success(sendEmail ? "Reply sent · user notified" : "Note saved");
    } catch (err: any) {
      toast.danger(err?.message || "Failed");
    } finally {
      setActing(false);
    }
  };

  // Both entry points (row icon + modal footer) open the in-app confirm dialog
  // rather than calling `window.confirm`, which renders as the browser's native
  // alert chrome and breaks the in-app feel.
  const requestDelete = (ticket: Ticket) => setPendingDelete(ticket);

  const confirmDelete = async () => {
    if (!pendingDelete || !session?.access_token) return;
    setDeleting(true);
    try {
      const res = await fetch(apiUrl("/api/admin/support/delete"), {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ ticketId: pendingDelete.id }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Failed");
      const deletedId = pendingDelete.id;
      setTickets((prev) => prev.filter((t) => t.id !== deletedId));
      if (selected?.id === deletedId) closeTicket();
      toast.success("Ticket deleted");
      setPendingDelete(null);
    } catch (err: any) {
      toast.danger(err?.message || "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const archiveTicket = async (ticket: Ticket) => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(apiUrl("/api/admin/support/set-status"), {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ ticketId: ticket.id, status: "archived" }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Failed");
      patchTicket(ticket.id, { status: "archived" });
      toast.success("Ticket archived");
    } catch (err: any) {
      toast.danger(err?.message || "Failed to archive");
    }
  };

  const unarchiveTicket = async (ticket: Ticket) => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(apiUrl("/api/admin/support/set-status"), {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ ticketId: ticket.id, status: "open" }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Failed");
      patchTicket(ticket.id, { status: "open" });
      toast.success("Ticket reopened");
    } catch (err: any) {
      toast.danger(err?.message || "Failed");
    }
  };

  return (
    <HudShell
      title="Support Tickets"
      subtitle="User-submitted help requests from the in-app form"
      right={
        <GlowButton
          onClick={() => fetchTickets(true)}
          disabled={refreshing || loading}
          className="h-9 text-xs flex items-center justify-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </GlowButton>
      }
    >
      {/* Filter chips */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map((f) => {
          const Icon = f.icon;
          const isActive = filter === f.key;
          const count = counts[f.key];
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-600 text-white shadow-lg shadow-primary-900/30"
                  : "glass-sm text-dark-300 hover:bg-white/10"
              }`}
            >
              <Icon className="w-4 h-4" />
              {f.label}
              <span
                className={`min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center ${
                  isActive ? "bg-white/20 text-white" : "bg-dark-700 text-dark-200"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <HudPanel>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <MessageSquare className="w-10 h-10 text-dark-500 mx-auto mb-3" />
            <p className="text-dark-300 font-medium mb-1">No tickets here</p>
            <p className="text-sm text-dark-500">
              {filter === "all"
                ? "Nothing has been submitted yet."
                : `No ${filter.replace("_", " ")} tickets right now.`}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {filtered.map((t) => {
              const badge = statusBadge(t.status);
              const noteCount = t.admin_notes?.length || 0;
              return (
                <li
                  key={t.id}
                  className="flex items-start gap-2 rounded-xl"
                  style={{
                    background: "var(--glass-input-bg)",
                    border: "1px solid var(--glass-border)",
                  }}
                >
                  <button
                    onClick={() => openTicket(t)}
                    className="flex-1 min-w-0 flex items-start gap-3 p-3.5 text-left"
                  >
                    <div className="w-9 h-9 rounded-full bg-primary-600/15 flex items-center justify-center shrink-0 overflow-hidden">
                      {t.user?.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.user.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-4 h-4 text-primary-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-medium text-dark-100 truncate">{t.title}</p>
                        <span
                          className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}
                        >
                          {badge.label}
                        </span>
                        {noteCount > 0 && (
                          <span className="text-[10px] text-dark-400 inline-flex items-center gap-1 shrink-0">
                            <StickyNote className="w-3 h-3" />
                            {noteCount}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-dark-400 line-clamp-2">{t.message}</p>
                      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-dark-500 flex-wrap">
                        <span className="font-mono">{t.ticket_number}</span>
                        <span>·</span>
                        <span>{t.user?.full_name || t.user?.email || "Unknown user"}</span>
                        <span>·</span>
                        <span>{formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}</span>
                      </div>
                    </div>
                  </button>

                  {/* Row-level actions: archive + delete */}
                  <div className="flex items-center gap-1 pr-2 py-3 shrink-0">
                    {t.status === "archived" ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          unarchiveTicket(t);
                        }}
                        title="Restore from archive"
                        className="p-2 rounded-lg text-dark-400 hover:bg-white/5 hover:text-dark-200 transition-colors"
                      >
                        <ArchiveRestore className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          archiveTicket(t);
                        }}
                        title="Archive"
                        className="p-2 rounded-lg text-dark-400 hover:bg-white/5 hover:text-dark-200 transition-colors"
                      >
                        <Archive className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDelete(t);
                      }}
                      title="Delete"
                      className="p-2 rounded-lg text-dark-400 hover:bg-red-500/15 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </HudPanel>

      {selected && (
        <Modal isOpen={!!selected} onClose={closeTicket} title="Support ticket" size="lg">
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-dark-500 mb-1">Ticket</p>
              <p className="font-mono text-sm text-dark-100">{selected.ticket_number}</p>
            </div>

            <div
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ background: "var(--glass-input-bg)", border: "1px solid var(--glass-border)" }}
            >
              <div className="w-10 h-10 rounded-full bg-primary-600/15 flex items-center justify-center shrink-0 overflow-hidden">
                {selected.user?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.user.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-5 h-5 text-primary-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-dark-100 truncate">
                  {selected.user?.full_name || "Unknown user"}
                </p>
                <div className="flex items-center gap-1 text-xs text-dark-400 mt-0.5">
                  <Mail className="w-3 h-3 shrink-0" />
                  <a
                    href={`mailto:${selected.user?.email || ""}?subject=${encodeURIComponent(
                      `Re: ${selected.title} [${selected.ticket_number}]`
                    )}`}
                    className="truncate hover:text-primary-400"
                  >
                    {selected.user?.email || "no email on file"}
                  </a>
                </div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-dark-500 mb-1">Title</p>
              <p className="text-dark-100">{selected.title}</p>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-dark-500 mb-1">Message</p>
              <p className="text-sm text-dark-200 whitespace-pre-wrap break-words">{selected.message}</p>
            </div>

            {/* Notes & replies history */}
            {selected.admin_notes.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-dark-500 mb-2">
                  History · {selected.admin_notes.length}
                </p>
                <ul className="space-y-2">
                  {selected.admin_notes
                    .slice()
                    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
                    .map((n) => {
                      const isReply = n.kind === "reply";
                      return (
                        <li
                          key={n.id}
                          className="p-3 rounded-xl"
                          style={{
                            background: isReply ? "rgba(124,58,237,0.08)" : "var(--glass-input-bg)",
                            border: `1px solid ${isReply ? "rgba(124,58,237,0.25)" : "var(--glass-border)"}`,
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            {isReply ? (
                              <Send className="w-3.5 h-3.5 text-primary-400 shrink-0" />
                            ) : (
                              <StickyNote className="w-3.5 h-3.5 text-dark-400 shrink-0" />
                            )}
                            <span className="text-[11px] font-bold uppercase tracking-wider text-dark-300">
                              {isReply ? "Reply sent to user" : "Internal note"}
                            </span>
                            <span className="text-[11px] text-dark-500 ml-auto shrink-0">
                              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                            </span>
                          </div>
                          <p className="text-sm text-dark-100 whitespace-pre-wrap break-words">
                            {n.body}
                          </p>
                        </li>
                      );
                    })}
                </ul>
              </div>
            )}

            {/* Compose: empty by default so internal notes never leak into a reply. */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-dark-500 mb-1 block">
                New note or reply
              </label>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={5}
                placeholder="Type a reply for the user, or leave a note for the team."
                className="w-full px-3 py-2.5 glass-input text-sm resize-none"
                disabled={acting}
              />
              <p className="mt-1.5 text-[11px] text-dark-500 leading-relaxed">
                <b className="text-dark-300">Save note</b> stores this internally. <b className="text-dark-300">Send reply</b> emails the user. Either way the field clears for the next message.
              </p>

              <div className="flex flex-wrap gap-2 mt-3">
                <Button variant="secondary" size="sm" onClick={() => submitDraft(false)} disabled={acting || !draft.trim()}>
                  {acting ? <PejaSpinner className="w-4 h-4 mr-1" /> : <StickyNote className="w-4 h-4 mr-1" />}
                  Save note
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => submitDraft(true)}
                  disabled={acting || !draft.trim() || !selected.user?.email}
                  title={!selected.user?.email ? "User has no email on file" : undefined}
                >
                  {acting ? <PejaSpinner className="w-4 h-4 mr-1" /> : <Send className="w-4 h-4 mr-1" />}
                  Send reply
                </Button>
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--glass-border)]">
              <p className="text-[11px] font-bold uppercase tracking-wider text-dark-500 mb-2">Status</p>
              <div className="flex flex-wrap gap-2">
                {selected.status !== "in_progress" && (
                  <Button variant="secondary" size="sm" onClick={() => setStatus("in_progress")} disabled={acting}>
                    <Clock className="w-4 h-4 mr-1" />
                    Mark in progress
                  </Button>
                )}
                {selected.status !== "resolved" && (
                  <Button variant="primary" size="sm" onClick={() => setStatus("resolved")} disabled={acting}>
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    Resolve
                  </Button>
                )}
                {(selected.status === "resolved" || selected.status === "archived") && (
                  <Button variant="secondary" size="sm" onClick={() => setStatus("open")} disabled={acting}>
                    <CircleDot className="w-4 h-4 mr-1" />
                    Reopen
                  </Button>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--glass-border)] flex flex-wrap gap-2">
              {selected.status !== "archived" ? (
                <Button variant="secondary" size="sm" onClick={() => setStatus("archived")} disabled={acting}>
                  <Archive className="w-4 h-4 mr-1" />
                  Archive
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setStatus("open")} disabled={acting}>
                  <ArchiveRestore className="w-4 h-4 mr-1" />
                  Restore from archive
                </Button>
              )}
              <Button variant="danger" size="sm" onClick={() => requestDelete(selected)} disabled={acting}>
                <Trash2 className="w-4 h-4 mr-1" />
                Delete ticket
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* In-app delete confirmation. Replaces window.confirm so the dialog
          matches the app chrome instead of the browser's native alert. */}
      {pendingDelete && (
        <Modal
          isOpen={!!pendingDelete}
          onClose={() => {
            if (!deleting) setPendingDelete(null);
          }}
          title="Delete ticket"
          size="sm"
        >
          <div className="space-y-4">
            <div
              className="flex items-start gap-3 p-3 rounded-xl"
              style={{
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
              }}
            >
              <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4 text-red-400" />
              </div>
              <div className="min-w-0">
                <p className="text-dark-100 text-sm">
                  Permanently delete{" "}
                  <b className="text-dark-50">&ldquo;{pendingDelete.title}&rdquo;</b>?
                </p>
                <p className="text-xs text-dark-400 mt-1 font-mono">
                  {pendingDelete.ticket_number}
                </p>
                <p className="text-xs text-dark-400 mt-2 leading-relaxed">
                  This removes the ticket and every note attached to it. The
                  user is not notified. This cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? <PejaSpinner className="w-4 h-4 mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
                {deleting ? "Deleting…" : "Delete forever"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </HudShell>
  );
}
