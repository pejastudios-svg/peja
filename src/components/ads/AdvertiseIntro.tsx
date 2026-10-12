"use client";

import { useState } from "react";
import { Megaphone, ShieldCheck, EyeOff } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { PROHIBITED_CATEGORIES } from "@/lib/ads";

/**
 * Shown before the form.
 *
 * Sets what Peja will and will not do with an advert, up front, so
 * nobody is surprised later by a rejection or by their placement going
 * quiet during an emergency.
 *
 * Deliberately short. An earlier version also spelled out that a
 * placement is not a promise of views; that is now said once, next to
 * the catchment figure where it is actually relevant, and in the terms.
 * Repeating it a third time here read as a warning and gave people a
 * reason to close the page.
 */
const SKIP_KEY = "peja-advertise-intro-skip";

export function advertiseIntroSkipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

export function AdvertiseIntro({
  open,
  onAccept,
  onCancel,
}: {
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const [skip, setSkip] = useState(false);

  const accept = () => {
    if (skip) {
      try { localStorage.setItem(SKIP_KEY, "1"); } catch {}
    }
    onAccept();
  };

  return (
    <Modal isOpen={open} onClose={onCancel} title="Before you start">
      <div className="space-y-4">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-primary-500/15 flex items-center justify-center">
          <Megaphone className="w-6 h-6 text-primary-400" />
        </div>

        <p className="text-sm text-dark-300 leading-relaxed">
          Peja is a safety app first. That shapes how advertising works
          here, and it is worth knowing before you spend anything.
        </p>

        <div className="space-y-3">
          <div className="flex gap-2.5">
            <ShieldCheck className="w-5 h-5 text-primary-400 shrink-0 mt-0.5" />
            <p className="text-sm text-dark-300 leading-relaxed">
              <span className="text-dark-100 font-medium">A person reviews every advert.</span>{" "}
              Nothing goes live automatically. We may reject anything that does
              not belong on a safety map, and we will tell you why.
            </p>
          </div>

          <div className="flex gap-2.5">
            <EyeOff className="w-5 h-5 text-primary-400 shrink-0 mt-0.5" />
            <p className="text-sm text-dark-300 leading-relaxed">
              <span className="text-dark-100 font-medium">Adverts pause during emergencies.</span>{" "}
              Your placement is hidden for anyone caught up in one: the person
              who raised the alarm, the contacts watching over them, and anyone
              near a fresh incident. Everyone else still sees you, and nothing
              about your bill changes.
            </p>
          </div>
        </div>

        <details className="rounded-xl bg-[var(--glass-input-bg)] border border-[var(--glass-border)] overflow-hidden">
          <summary className="px-3 py-2.5 text-sm text-dark-200 cursor-pointer select-none">
            What we cannot advertise
          </summary>
          <ul className="px-3 pb-3 space-y-1">
            {PROHIBITED_CATEGORIES.map((c) => (
              <li key={c} className="text-xs text-dark-400">· {c}</li>
            ))}
          </ul>
        </details>

        <p className="text-xs text-dark-500">
          Full details in the{" "}
          {/* A new tab, not a navigation.
              Routing away from here was wrong twice over: onCancel on this
              dialog means "leave the page", not "close", so it fired two
              navigations at once and the dialog never closed, and it threw
              away whatever had already been typed into the form behind it.
              Terms are reference material; they belong beside the form. */}
          <button
            onClick={() => window.open("/terms", "_blank", "noopener")}
            className="text-primary-400 hover:text-primary-300 underline"
          >
            advertiser terms
          </button>
          .
        </p>

        <label className="flex items-center gap-2.5 text-sm text-dark-300">
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => setSkip(e.target.checked)}
            className="shrink-0"
          />
          Do not show this again
        </label>

        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Not now
          </Button>
          <Button size="sm" onClick={accept}>
            I understand, continue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
