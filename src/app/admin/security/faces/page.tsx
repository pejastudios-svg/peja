"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import {
  ArrowLeft,
  ScanFace,
  UserPlus,
  Copy,
  Check,
  Trash2,
  AlertTriangle,
} from "lucide-react";

type Enrollment = {
  id: string;
  label: string;
  thumbnail_url: string | null;
  enrolled_at: string;
};
type PendingToken = {
  token: string;
  label_hint: string | null;
  created_at: string;
  expires_at: string;
};

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return "expired";
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs >= 1) return `expires in ${hrs}h`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `expires in ${mins}m`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminFacesPage() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [pending, setPending] = useState<PendingToken[]>([]);

  const [labelHint, setLabelHint] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token || ""}`,
  };

  const reload = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/admin/face/list/", { headers });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setEnrollments(data.enrollments || []);
      setPending(data.pendingTokens || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  useEffect(() => {
    if (session?.access_token) reload();
  }, [session?.access_token, reload]);

  const handleIssue = async () => {
    setIssuing(true);
    setIssuedUrl(null);
    setCopied(false);
    try {
      const res = await fetch("/api/admin/face/enrollment-link/", {
        method: "POST",
        headers,
        body: JSON.stringify({ labelHint }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to issue link");
      setIssuedUrl(data.url);
      setLabelHint("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to issue link");
    } finally {
      setIssuing(false);
    }
  };

  const handleCopy = async () => {
    if (!issuedUrl) return;
    await navigator.clipboard.writeText(issuedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (kind: "enrollment" | "token", id: string) => {
    if (!confirm(`Revoke this ${kind}? This cannot be undone.`)) return;
    try {
      const res = await fetch("/api/admin/face/revoke/", {
        method: "POST",
        headers,
        body: JSON.stringify({ kind, id }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Revoke failed");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revoke failed");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen admin-bg px-4 pb-6 pt-32">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/admin/security"
          className="inline-flex items-center gap-2 text-sm text-dark-400 hover:text-dark-200 mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Security
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <ScanFace className="w-7 h-7 text-dark-200" />
          <h1 className="text-2xl font-bold text-dark-50">Face Recognition</h1>
        </div>
        <p className="text-sm text-dark-400 mb-6">
          Enrolled faces unlock admin login as a second factor between PIN and TOTP. Any
          enrolled face passes the check, so anyone who needs admin access enrolls their
          own face under this account using the link below.
        </p>

        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-3 mb-6 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-dark-200 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        {/* Issue link */}
        <section className="bg-dark-900 border border-dark-700 rounded-xl p-5 mb-6">
          <h2 className="text-lg font-semibold text-dark-50 mb-3 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-dark-200" />
            Issue Enrollment Link
          </h2>

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-dark-400">Who is this for? (optional)</span>
              <input
                type="text"
                value={labelHint}
                onChange={(e) => setLabelHint(e.target.value.slice(0, 60))}
                placeholder="e.g. Sarah's iPhone, Mike's MacBook"
                className="w-full mt-1 px-3 py-2 bg-dark-800 border border-dark-700 rounded-lg text-dark-100 text-sm"
                maxLength={60}
              />
              <span className="text-xs text-dark-500 mt-1 block">
                Pre-fills the label on the enrollment page. The enrollee can change it.
              </span>
            </label>

            <button
              onClick={handleIssue}
              disabled={issuing}
              className="w-full py-3 bg-primary-600 text-white rounded-lg font-medium disabled:opacity-50 hover:bg-primary-500 transition-colors flex items-center justify-center gap-2"
            >
              {issuing ? "Generating…" : "Generate Link"}
            </button>

            {issuedUrl && (
              <div className="bg-dark-800 border border-dark-700 rounded-lg p-3">
                <p className="text-xs text-dark-400 mb-2">
                  Link expires in 24h. Share via any channel.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs text-dark-200 font-mono break-all">
                    {issuedUrl}
                  </code>
                  <button
                    onClick={handleCopy}
                    className="px-3 py-1.5 bg-primary-600 text-white text-xs rounded font-medium hover:bg-primary-500 transition-colors flex items-center gap-1 flex-shrink-0"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Copy
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Pending tokens */}
        <section className="mb-6">
          <h2 className="text-lg font-semibold text-dark-50 mb-3">
            Pending Invitations ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <p className="text-sm text-dark-500">No pending enrollment links.</p>
          ) : (
            <div className="space-y-2">
              {pending.map((t) => (
                <div
                  key={t.token}
                  className="bg-dark-900 border border-dark-700 rounded-lg p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-dark-100 font-medium">
                      {t.label_hint || "Unlabeled invitation"}
                    </p>
                    <p className="text-xs text-dark-500 mt-0.5">
                      issued {formatDate(t.created_at)} • {formatExpiry(t.expires_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevoke("token", t.token)}
                    className="px-2.5 py-1.5 text-xs text-red-300 hover:text-red-100 hover:bg-red-950 rounded transition-colors flex items-center gap-1 flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Enrolled faces */}
        <section>
          <h2 className="text-lg font-semibold text-dark-50 mb-3">
            Enrolled Faces ({enrollments.length})
          </h2>
          {enrollments.length === 0 ? (
            <p className="text-sm text-dark-500">No faces enrolled yet.</p>
          ) : (
            <div className="space-y-2">
              {enrollments.map((e) => (
                <div
                  key={e.id}
                  className="bg-dark-900 border border-dark-700 rounded-lg p-3 flex items-center gap-3"
                >
                  {e.thumbnail_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={e.thumbnail_url}
                      alt={e.label}
                      className="w-12 h-12 rounded-lg object-cover border border-dark-700 flex-shrink-0"
                      style={{ transform: "scaleX(-1)" }}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-dark-800 border border-dark-700 flex items-center justify-center flex-shrink-0">
                      <ScanFace className="w-5 h-5 text-dark-500" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-dark-100 font-medium truncate">{e.label}</p>
                    <p className="text-xs text-dark-500 mt-0.5">
                      enrolled {formatDate(e.enrolled_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevoke("enrollment", e.id)}
                    className="px-2.5 py-1.5 text-xs text-red-300 hover:text-red-100 hover:bg-red-950 rounded transition-colors flex items-center gap-1 flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
