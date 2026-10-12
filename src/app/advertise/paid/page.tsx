"use client";

import { Suspense, useEffect, useState } from "react";
import { adsEnabled } from "@/lib/ads";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, X, Clock } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { useAuth } from "@/context/AuthContext";
import { authFetchJson } from "@/lib/authFetch";

/** Where Paystack sends the advertiser back to. */
export default function PaidPage() {
  // Advertising is not live yet. Anyone who reaches this by typing the
  // URL or following an old link is sent home rather than shown a
  // half-finished product.
  if (!adsEnabled()) {
    if (typeof window !== "undefined") window.location.replace("/");
    return null;
  }

  return (
    <Suspense fallback={null}>
      <PaidInner />
    </Suspense>
  );
}

type State = "checking" | "paid" | "pending" | "failed" | "abandoned" | "error";

function PaidInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const reference = params.get("ref") || "";

  const [state, setState] = useState<State>("checking");
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user || !reference) return;
    let stop = false;
    let tries = 0;

    // Polled, because the webhook and this redirect race and the webhook
    // usually wins by a fraction of a second but not always. Six tries
    // over about fifteen seconds, then we stop and tell them it is still
    // settling, which is true and better than spinning forever.
    const check = async () => {
      try {
        const { res, data } = await authFetchJson(`/api/ads/verify?ref=${encodeURIComponent(reference)}`);
        if (stop) return;
        if (!res.ok) { setState("error"); return; }
        if (data.state === "paid") { setState("paid"); return; }
        if (data.state === "failed" || data.state === "abandoned") {
          setReason(data.reason || null);
          setState(data.state);
          return;
        }
        if (++tries >= 6) { setState("pending"); return; }
        setTimeout(check, 2500);
      } catch {
        if (stop) return;
        setState("error");
      }
    };
    check();
    return () => { stop = true; };
  }, [authLoading, user, reference]);

  if (authLoading) return null;

  const body = () => {
    switch (state) {
      case "checking":
        return (
          <>
            <PejaSpinner className="w-7 h-7 mx-auto" />
            <h1 className="text-xl font-bold text-dark-50 mt-4">Confirming your payment</h1>
            <p className="text-sm text-dark-400 mt-2">This takes a few seconds.</p>
          </>
        );
      case "paid":
        return (
          <>
            <Icon tone="green"><Check className="w-7 h-7 text-green-400" /></Icon>
            <h1 className="text-xl font-bold text-dark-50">Payment received</h1>
            <p className="text-sm text-dark-400 mt-2 leading-relaxed">
              Your advert is with us for review. A person looks at it within 24
              hours and you will get a notification either way. If we cannot
              approve it, you get a full refund automatically.
            </p>
          </>
        );
      case "pending":
        return (
          <>
            <Icon tone="amber"><Clock className="w-7 h-7 text-amber-400" /></Icon>
            <h1 className="text-xl font-bold text-dark-50">Still settling</h1>
            <p className="text-sm text-dark-400 mt-2 leading-relaxed">
              Your bank has not confirmed yet. Nothing is lost. Check your
              adverts in a few minutes and it will have updated on its own.
            </p>
          </>
        );
      case "failed":
      case "abandoned":
        return (
          <>
            <Icon tone="red"><X className="w-7 h-7 text-red-400" /></Icon>
            <h1 className="text-xl font-bold text-dark-50">
              {state === "abandoned" ? "Payment not completed" : "Payment did not go through"}
            </h1>
            <p className="text-sm text-dark-400 mt-2 leading-relaxed">
              {reason
                ? `${reason}. Nothing was charged.`
                : "Nothing was charged. Your advert is saved, so you can try paying again."}
            </p>
          </>
        );
      default:
        return (
          <>
            <Icon tone="amber"><Clock className="w-7 h-7 text-amber-400" /></Icon>
            <h1 className="text-xl font-bold text-dark-50">We could not check just now</h1>
            <p className="text-sm text-dark-400 mt-2 leading-relaxed">
              Your payment may still have gone through. Open your adverts to see
              where it stands.
            </p>
          </>
        );
    }
  };

  return (
    <div className="min-h-screen">
      <Header variant="back" title="Payment" onBack={() => router.push("/advertise/dashboard")} />
      <div className="max-w-md mx-auto px-4 pt-app-header-pill pb-10 text-center">
        {body()}
        {state !== "checking" && (
          <Button size="sm" className="mt-6" onClick={() => router.push("/advertise/dashboard")}>
            See my adverts
          </Button>
        )}
      </div>
    </div>
  );
}

function Icon({ tone, children }: { tone: "green" | "amber" | "red"; children: React.ReactNode }) {
  const bg = tone === "green" ? "bg-green-500/15" : tone === "amber" ? "bg-amber-500/15" : "bg-red-500/15";
  return <div className={`mx-auto w-14 h-14 rounded-2xl ${bg} flex items-center justify-center mb-4`}>{children}</div>;
}
