"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import FaceLivenessCapture, { type FaceCaptureResult } from "@/components/admin/FaceLivenessCapture";

export default function FaceSandboxPage() {
  const [mode, setMode] = useState<"enroll" | "verify">("enroll");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FaceCaptureResult | null>(null);
  const [storedDescriptor, setStoredDescriptor] = useState<number[] | null>(null);
  const [matchDistance, setMatchDistance] = useState<number | null>(null);

  const handleComplete = (r: FaceCaptureResult) => {
    setResult(r);
    setRunning(false);
    if (mode === "enroll") {
      setStoredDescriptor(r.descriptor);
      setMatchDistance(null);
    } else if (storedDescriptor) {
      // Euclidean distance
      let sum = 0;
      for (let i = 0; i < r.descriptor.length; i++) {
        const d = r.descriptor[i] - storedDescriptor[i];
        sum += d * d;
      }
      setMatchDistance(Math.sqrt(sum));
    }
  };

  return (
    <div className="min-h-screen admin-bg px-4 pb-6 pt-32">
      <div className="max-w-2xl mx-auto">
        <Link
          href="/admin/security"
          className="inline-flex items-center gap-2 text-sm text-dark-400 hover:text-dark-200 mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Security
        </Link>

        <h1 className="text-2xl font-bold text-dark-50 mb-2">Face Recognition Sandbox</h1>
        <p className="text-sm text-dark-400 mb-6">
          Test the liveness capture flow before wiring it into the admin gate. Nothing is saved to the server.
        </p>

        <div className="bg-dark-900 border border-dark-700 rounded-xl p-4 mb-6">
          <div className="flex gap-1 mb-4 border-b border-white/10">
            <button
              onClick={() => {
                setMode("enroll");
                setResult(null);
                setMatchDistance(null);
              }}
              disabled={running}
              className={`relative px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${mode === "enroll" ? "text-primary-400 border-primary-500" : "text-dark-400 border-transparent hover:text-dark-200"}`}
            >
              Enroll Mode
            </button>
            <button
              onClick={() => {
                setMode("verify");
                setResult(null);
                setMatchDistance(null);
              }}
              disabled={running || !storedDescriptor}
              className={`relative px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors disabled:opacity-40 ${mode === "verify" ? "text-primary-400 border-primary-500" : "text-dark-400 border-transparent hover:text-dark-200"}`}
            >
              Verify Mode {!storedDescriptor && "(enroll first)"}
            </button>
          </div>

          {!running && (
            <button
              onClick={() => {
                setRunning(true);
                setResult(null);
              }}
              className="w-full py-3 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-500 transition-colors"
            >
              Start {mode === "enroll" ? "Enrollment" : "Verification"}
            </button>
          )}
        </div>

        {running && (
          <FaceLivenessCapture
            mode={mode}
            onComplete={handleComplete}
            onCancel={() => setRunning(false)}
          />
        )}

        {result && !running && (
          <div className="bg-dark-900 border border-dark-700 rounded-xl p-4 space-y-3">
            <h2 className="text-lg font-semibold text-dark-50">
              {mode === "enroll" ? "Enrollment Complete" : "Verification Complete"}
            </h2>

            {result.thumbnail && (
              <div>
                <p className="text-xs text-dark-500 mb-1">Captured baseline frame:</p>
                <img
                  src={result.thumbnail}
                  alt="Captured"
                  className="rounded-lg border border-dark-700 max-w-xs"
                  style={{ transform: "scaleX(-1)" }}
                />
              </div>
            )}

            <div>
              <p className="text-xs text-dark-500">Descriptor length: {result.descriptor.length}</p>
              <p className="text-xs text-dark-500">
                First 4 values: {result.descriptor.slice(0, 4).map((v) => v.toFixed(3)).join(", ")}…
              </p>
            </div>

            {mode === "verify" && matchDistance !== null && (
              <div
                className={`p-3 rounded-lg ${matchDistance < 0.5 ? "bg-green-950 border border-green-800" : "bg-red-950 border border-red-800"}`}
              >
                <p className={`text-sm font-semibold ${matchDistance < 0.5 ? "text-green-300" : "text-red-300"}`}>
                  {matchDistance < 0.5 ? "MATCH" : "NO MATCH"}
                </p>
                <p className="text-xs text-dark-400 mt-1">
                  Euclidean distance: {matchDistance.toFixed(4)} (threshold: 0.5)
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
