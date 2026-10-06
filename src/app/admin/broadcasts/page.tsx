"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Megaphone, Send, AlertTriangle, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { NIGERIA_STATES_LIST } from "@/lib/nigeriaLgas";
import {
  AUDIENCE_KINDS,
  DELIVERY_OPTIONS,
  describeAudience,
  deliveryIsSafeForSensitive,
  type BroadcastAudience,
  type BroadcastDelivery,
} from "@/lib/broadcastAudience";

/**
 * Compose and send a broadcast.
 *
 * Built general on purpose. The message that prompted it was "set up your
 * recovery codes", but the same screen sends the Christmas safety note,
 * the New Year's Eve warning and the Children's Day greeting, and the
 * milestone cron reuses the very same send path.
 *
 * The one piece of real friction is the push warning: a push body is
 * readable on a lock screen by whoever is standing next to the person. For
 * most messages that is fine. For anything about violence or self-harm it
 * can expose the user to exactly the person they are hiding from, so the
 * screen says so before you send rather than after.
 */
type Row = {
  id: string;
  title: string;
  body: string;
  audience: BroadcastAudience;
  delivery: BroadcastDelivery;
  status: string;
  sent_at: string | null;
  sent_count: number;
  milestone_key: string | null;
  created_at: string;
};

export default function AdminBroadcastsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [resourceText, setResourceText] = useState("");
  const [actionUrl, setActionUrl] = useState("");
  const [kind, setKind] = useState<BroadcastAudience["kind"]>("no_recovery_codes");
  const [states, setStates] = useState<string[]>([]);
  const [role, setRole] = useState<"guardian" | "vip" | "mvp" | "beacon_owner">("guardian");
  const [days, setDays] = useState(30);
  const [delivery, setDelivery] = useState<BroadcastDelivery>("popup");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);

  const token = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/admin/broadcasts"), {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const json = await res.json();
      if (res.ok) setRows(json.broadcasts || []);
    } catch {
      /* leave the list as it was */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const audience = (): BroadcastAudience => {
    switch (kind) {
      case "states":
        return { kind: "states", states };
      case "role":
        return { kind: "role", role };
      case "inactive":
        return { kind: "inactive", days };
      default:
        return { kind } as BroadcastAudience;
    }
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/admin/broadcasts"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await token()}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          resourceText: resourceText.trim() || null,
          actionUrl: actionUrl.trim() || null,
          audience: audience(),
          delivery,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Could not send");
        return;
      }
      setSentNote(
        delivery === "popup"
          ? "Popup is live. It shows to anyone who matches, on their next open."
          : `Sent to ${json.sentCount} ${json.sentCount === 1 ? "person" : "people"}.`,
      );
      setTitle("");
      setBody("");
      setResourceText("");
      setActionUrl("");
      setConfirmOpen(false);
      load();
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setSending(false);
    }
  };

  const field =
    "w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-primary-500/50 placeholder:text-dark-500";
  const canSend =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (kind !== "states" || states.length > 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-dark-50 mb-1 flex items-center gap-2">
        <Megaphone className="w-6 h-6 text-primary-400" /> Broadcasts
      </h1>
      <p className="text-sm text-dark-400 mb-6">
        Send a message to a chosen group. Nothing is sent until you confirm.
      </p>

      {sentNote && (
        <div className="glass-card mb-4 flex items-start gap-2.5">
          <Check className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
          <p className="text-sm text-dark-200">{sentNote}</p>
        </div>
      )}

      <div className="glass-card mb-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-dark-200 mb-1.5">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 80))}
            placeholder="Short and plain"
            className={field}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-dark-200 mb-1.5">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 600))}
            rows={4}
            placeholder="What you want them to know, and what to do about it"
            className={`${field} resize-none`}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-dark-200 mb-1.5">
            Resource <span className="text-dark-500 font-normal">(optional)</span>
          </label>
          <input
            value={resourceText}
            onChange={(e) => setResourceText(e.target.value.slice(0, 200))}
            placeholder="A helpline, a number, something they can actually use"
            className={field}
          />
          <p className="text-xs text-dark-500 mt-1.5">
            Worth filling in on heavy messages. An awareness day with nothing
            attached is just an interruption.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-dark-200 mb-1.5">
            Link <span className="text-dark-500 font-normal">(optional)</span>
          </label>
          <input
            value={actionUrl}
            onChange={(e) => setActionUrl(e.target.value)}
            placeholder="/settings or https://..."
            className={field}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-dark-200 mb-1.5">Who gets it</label>
          <div className="space-y-1.5">
            {AUDIENCE_KINDS.map((a) => (
              <button
                key={a.kind}
                onClick={() => setKind(a.kind)}
                className={`w-full px-3 py-2.5 rounded-xl border text-left transition-ui ${
                  kind === a.kind
                    ? "border-primary-500/50 bg-primary-500/10"
                    : "border-white/10 bg-white/5"
                }`}
              >
                <span className="block text-sm text-dark-100">{a.label}</span>
                <span className="block text-xs text-dark-400 mt-0.5">{a.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {kind === "states" && (
          <div className="flex flex-wrap gap-1.5">
            {NIGERIA_STATES_LIST.map((st) => (
              <button
                key={st}
                onClick={() =>
                  setStates((p) => (p.includes(st) ? p.filter((x) => x !== st) : [...p, st]))
                }
                className={`px-2.5 py-1 rounded-full text-xs border transition-ui ${
                  states.includes(st)
                    ? "border-primary-500/50 bg-primary-500/15 text-primary-200"
                    : "border-white/10 bg-white/5 text-dark-300"
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        )}

        {kind === "role" && (
          <div className="flex flex-wrap gap-1.5">
            {(["guardian", "vip", "mvp", "beacon_owner"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`px-3 py-1.5 rounded-full text-xs border capitalize transition-ui ${
                  role === r
                    ? "border-primary-500/50 bg-primary-500/15 text-primary-200"
                    : "border-white/10 bg-white/5 text-dark-300"
                }`}
              >
                {r.replace("_", " ")}
              </button>
            ))}
          </div>
        )}

        {kind === "inactive" && (
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 30))}
            className={field}
          />
        )}

        <div>
          <label className="block text-sm font-medium text-dark-200 mb-1.5">How it arrives</label>
          <div className="space-y-1.5">
            {DELIVERY_OPTIONS.map((d) => (
              <button
                key={d.value}
                onClick={() => setDelivery(d.value)}
                className={`w-full px-3 py-2.5 rounded-xl border text-left transition-ui ${
                  delivery === d.value
                    ? "border-primary-500/50 bg-primary-500/10"
                    : "border-white/10 bg-white/5"
                }`}
              >
                <span className="block text-sm text-dark-100">{d.label}</span>
                <span className="block text-xs text-dark-400 mt-0.5">{d.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {!deliveryIsSafeForSensitive(delivery) && (
          <div className="flex gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25">
            <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
            <p className="text-xs text-dark-300 leading-relaxed">
              This appears on the lock screen, where anyone near the phone can
              read it. If the subject could put someone at risk of being seen
              reading it, use in-app or popup instead.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={!canSend}
          leftIcon={<Send className="w-4 h-4" />}
        >
          Review and send
        </Button>
      </div>

      <h2 className="text-sm font-semibold text-dark-400 uppercase mb-3">Sent</h2>
      {loading ? (
        <p className="text-sm text-dark-500">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-dark-500">Nothing sent yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="glass-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-dark-100 font-medium truncate">{r.title}</p>
                  <p className="text-xs text-dark-400 mt-0.5">
                    {describeAudience(r.audience)} · {r.delivery.replace("_", " ")}
                    {r.milestone_key ? " · milestone" : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm text-dark-200">{r.sent_count || 0}</p>
                  <p className="text-xs text-dark-500">
                    {formatDistanceToNow(new Date(r.sent_at || r.created_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} title="Send this?">
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <p className="text-sm text-dark-100 font-medium">{title}</p>
            <p className="text-sm text-dark-300 mt-1 whitespace-pre-wrap">{body}</p>
            {resourceText && (
              <p className="text-sm text-primary-300 mt-2 whitespace-pre-wrap">{resourceText}</p>
            )}
          </div>
          <p className="text-sm text-dark-400">
            Going to <span className="text-dark-100">{describeAudience(audience())}</span>, as{" "}
            <span className="text-dark-100">
              {DELIVERY_OPTIONS.find((d) => d.value === delivery)?.label.toLowerCase()}
            </span>
            .
          </p>
          <p className="text-xs text-dark-500">This cannot be unsent.</p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={send} disabled={sending}>
              {sending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
