"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Mail,
  AlertTriangle,
  Shield,
  Camera,
  Bell,
  MapPin,
  BarChart3,
  Send,
  CheckCircle2,
  Copy,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { apiUrl } from "@/lib/api";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

interface FAQItem {
  question: string;
  answer: string;
  icon: any;
}

const faqs: FAQItem[] = [
  {
    question: "How do I report an incident?",
    answer: "Tap the + button at the top of the screen, take a photo or video of the incident, select a category, add a description if needed, and post. Your location is automatically captured.",
    icon: Camera,
  },
  {
    question: "What is the SOS feature?",
    answer: "The SOS feature is for personal emergencies. Press and hold the SOS button for 3 seconds to alert your emergency contacts and nearby users. Your live location will be shared for 5 hours. Misuse of this feature will result in a permanent ban.",
    icon: AlertTriangle,
  },
  {
    question: "How do I become a Guardian?",
    answer: "Guardians are trusted community moderators. To qualify, you need: 30+ day old account, 10+ confirmed posts, 50+ reputation score, and zero violations. Apply through your profile page.",
    icon: Shield,
  },
  {
    question: "Why should I confirm incidents?",
    answer: "Confirming incidents helps verify their accuracy. When multiple users confirm an incident, it increases trust and helps others know the report is real.",
    icon: Bell,
  },
  {
    question: "How do location alerts work?",
    answer: "You can set up alerts for: All of Nigeria, specific states, a custom radius around you, or saved locations like home and work. Customize this in Settings.",
    icon: MapPin,
  },
  {
    question: "What does the Analytics button do?",
    answer: "The Analytics button on the map shows you data insights about incidents in your area. View trends, hotspots, incident frequency by category, and time-based patterns. This helps you understand safety conditions and make informed decisions about where and when to travel.",
    icon: BarChart3,
  },
];

export default function HelpPage() {
  const router = useRouter();
  const { session } = useAuth();
  const toast = useToast();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Email Support collapsible form state
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportTitle, setSupportTitle] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportSending, setSupportSending] = useState(false);
  const [supportResult, setSupportResult] = useState<{ ticket_number: string } | null>(null);

  const TITLE_MAX = 120;
  const MESSAGE_MAX = 4000;

  const handleSendSupport = async () => {
    if (!session?.access_token) {
      toast.warning("Please sign in to contact support.");
      return;
    }
    const title = supportTitle.trim();
    const message = supportMessage.trim();
    if (!title) {
      toast.warning("Add a title for your message.");
      return;
    }
    if (!message) {
      toast.warning("Describe what you need help with.");
      return;
    }
    setSupportSending(true);
    try {
      const res = await fetch(apiUrl("/api/support/create"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ title, message }),
      });
      const data = await res.json();
      if (!data?.ok || !data?.ticket) throw new Error(data?.error || "Failed to send");
      setSupportResult({ ticket_number: data.ticket.ticket_number });
      setSupportTitle("");
      setSupportMessage("");
      toast.success("Support ticket sent");
    } catch (err: any) {
      toast.danger(err?.message || "Failed to send. Try again.");
    } finally {
      setSupportSending(false);
    }
  };

  const copyTicketNumber = async () => {
    if (!supportResult?.ticket_number) return;
    try {
      await navigator.clipboard.writeText(supportResult.ticket_number);
      toast.success("Ticket ID copied");
    } catch {}
  };

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/5">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="text-lg font-semibold text-dark-100">Help & Support</h1>
          <div className="w-9" />
        </div>
      </header>

      <main className="pt-app-header max-w-2xl mx-auto px-4 py-6">
        {/* Quick Contact — Email Support is a collapsible form. Sends a ticket
            into the support pipeline + emails the team. */}
        <section className="mb-8" id="support-contact">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">
            Contact Us
          </h2>
          <div className="glass-card overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setSupportOpen((v) => !v);
                if (supportResult) setSupportResult(null);
              }}
              className="w-full flex items-center gap-3 p-4 text-left"
              aria-expanded={supportOpen}
            >
              <div className="p-2 rounded-lg bg-primary-600/20">
                <Mail className="w-5 h-5 text-primary-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-dark-100">Email Support</p>
                <p className="text-sm text-dark-400">
                  Send us a ticket - we’ll reply by email
                </p>
              </div>
              {supportOpen ? (
                <ChevronUp className="w-5 h-5 text-dark-400 shrink-0" />
              ) : (
                <ChevronDown className="w-5 h-5 text-dark-400 shrink-0" />
              )}
            </button>

            {supportOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-[var(--glass-border)]">
                {supportResult ? (
                  <div className="py-4 text-center">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-500/15 flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-green-500" />
                    </div>
                    <p className="font-semibold text-dark-100 mb-1">Ticket sent</p>
                    <p className="text-sm text-dark-400 mb-3">
                      We’ll reply to your account email. Reference this ID if you write back.
                    </p>
                    <button
                      type="button"
                      onClick={copyTicketNumber}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-mono"
                      style={{
                        background: "var(--glass-input-bg)",
                        border: "1px solid var(--glass-border)",
                        color: "var(--color-dark-100)",
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {supportResult.ticket_number}
                    </button>
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => setSupportResult(null)}
                        className="text-sm font-medium text-primary-500 hover:underline"
                      >
                        Send another
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="block text-xs font-medium text-dark-300 uppercase tracking-wider mt-3 mb-1.5">
                      Title
                    </label>
                    <input
                      value={supportTitle}
                      onChange={(e) => setSupportTitle(e.target.value)}
                      maxLength={TITLE_MAX}
                      placeholder="Short summary of your issue"
                      className="w-full px-3 py-2.5 glass-input text-sm"
                      disabled={supportSending}
                    />
                    <p className="mt-1 text-[11px] text-dark-500 text-right">
                      {supportTitle.length}/{TITLE_MAX}
                    </p>

                    <label className="block text-xs font-medium text-dark-300 uppercase tracking-wider mt-3 mb-1.5">
                      Message
                    </label>
                    <textarea
                      value={supportMessage}
                      onChange={(e) => setSupportMessage(e.target.value)}
                      maxLength={MESSAGE_MAX}
                      rows={5}
                      placeholder="Give us as much detail as you can - what happened, when, and what you expected."
                      className="w-full px-3 py-2.5 glass-input text-sm resize-none"
                      disabled={supportSending}
                    />
                    <p className="mt-1 text-[11px] text-dark-500 text-right">
                      {supportMessage.length}/{MESSAGE_MAX}
                    </p>

                    <button
                      type="button"
                      onClick={handleSendSupport}
                      disabled={
                        supportSending || !supportTitle.trim() || !supportMessage.trim()
                      }
                      className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-white bg-primary-600 hover:bg-primary-700 transition-colors disabled:opacity-50"
                    >
                      {supportSending ? (
                        <PejaSpinner className="w-4 h-4" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      {supportSending ? "Sending…" : "Send to support"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* FAQs */}
        <section>
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">
            Frequently Asked Questions
          </h2>
          <div className="space-y-3">
            {faqs.map((faq, index) => {
              const Icon = faq.icon;
              const isExpanded = expandedIndex === index;

              return (
                <div key={index} className="glass-card overflow-hidden">
                  <button
                    onClick={() => setExpandedIndex(isExpanded ? null : index)}
                    className="w-full flex items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-dark-700">
                        <Icon className="w-4 h-4 text-primary-400" />
                      </div>
                      <span className="font-medium text-dark-100">{faq.question}</span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5 text-dark-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-dark-400" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0">
                      <p className="text-dark-300 leading-relaxed pl-11">
                        {faq.answer}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Still need help */}
        <section className="mt-8">
          <div className="glass-card text-center py-8">
            <h3 className="text-lg font-semibold text-dark-100 mb-2">
              Still need help?
            </h3>
            <p className="text-dark-400 mb-4">
              Our support team is available 24/7
            </p>
            <button
              type="button"
              onClick={() => {
                setSupportOpen(true);
                setSupportResult(null);
                const target = document.getElementById("support-contact");
                target?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 rounded-xl text-white font-medium transition-colors"
            >
              <Mail className="w-5 h-5" />
              Contact Support
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}