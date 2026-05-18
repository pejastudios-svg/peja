"use client";

import Link from "next/link";
import { Lock, UserCog } from "lucide-react";
import { profileCompletion } from "@/lib/profileComplete";
import { useAuth } from "@/context/AuthContext";

/**
 * Renders a clear "complete your profile to unlock <feature>" card when the
 * signed-in user is missing one or more required fields. Returns `null` when
 * the profile is complete so callers can wrap their feature UI like:
 *
 *   const gate = useProfileGate("post");
 *   if (gate.blocked) return gate.element;
 *   ...render the feature
 *
 * Safety features (SOS, alerts, map, emergency contacts, Check-In, messaging)
 * MUST NOT use this gate.
 */
export function ProfileCompletionGate({
  featureLabel,
  className = "",
}: {
  featureLabel: string;
  className?: string;
}) {
  const { user } = useAuth();
  const { complete, missing } = profileCompletion(user as any);

  if (!user) return null;
  if (complete) return null;

  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{
        background: "var(--glass-input-bg)",
        border: "1px solid var(--glass-border)",
      }}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-primary-600/15 flex items-center justify-center shrink-0">
          <Lock className="w-5 h-5 text-primary-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-dark-100">
            Complete your profile to {featureLabel}
          </p>
          <p className="text-sm text-dark-400 mt-0.5">
            Safety features stay available to you. Profile fields are required
            for community features so reports can be trusted.
          </p>
        </div>
      </div>

      <ul className="space-y-1.5 mb-4">
        {missing.map((m) => (
          <li key={m.key} className="flex items-center gap-2 text-sm text-dark-200">
            <span className="w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0" />
            {m.label}
          </li>
        ))}
      </ul>

      <Link
        href="/profile/edit"
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 transition-colors"
      >
        <UserCog className="w-4 h-4" />
        Complete profile
      </Link>
    </div>
  );
}

/**
 * Hook variant for pages that want to short-circuit rendering when the
 * profile isn't complete. `blocked === true` means the user can't proceed.
 */
export function useProfileGate(featureLabel: string) {
  const { user } = useAuth();
  const { complete, missing } = profileCompletion(user as any);
  const blocked = !!user && !complete;
  return {
    blocked,
    missing,
    element: blocked ? <ProfileCompletionGate featureLabel={featureLabel} /> : null,
  };
}
