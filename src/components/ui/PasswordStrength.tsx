// src/components/ui/PasswordStrength.tsx
"use client";

import { Check, X } from "lucide-react";

const rules = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "Uppercase letter (A-Z)", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter (a-z)", test: (p: string) => /[a-z]/.test(p) },
  { label: "Number (0-9)", test: (p: string) => /\d/.test(p) },
];

export function isPasswordStrong(password: string): boolean {
  return rules.every((r) => r.test(password));
}

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;

  const passed = rules.filter((r) => r.test(password)).length;
  const percent = (passed / rules.length) * 100;

  const barColor =
    percent <= 25
      ? "bg-red-500"
      : percent <= 50
      ? "bg-orange-500"
      : percent <= 75
      ? "bg-yellow-500"
      : "bg-green-500";

  return (
    <div className="space-y-2 mt-2">
      <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300 rounded-full`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-1">
        {rules.map((rule) => {
          const met = rule.test(password);
          return (
            <div key={rule.label} className="flex items-center gap-1.5">
              {met ? (
                <Check className="w-3 h-3 text-green-400 flex-shrink-0" />
              ) : (
                <X className="w-3 h-3 text-dark-500 flex-shrink-0" />
              )}
              <span
                className={`text-xs ${met ? "text-green-400" : "text-dark-500"}`}
              >
                {rule.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}