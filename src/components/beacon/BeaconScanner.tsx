"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard, ScanLine } from "lucide-react";
import { parseDeviceId } from "@/lib/beacon";

// Minimal typing for the Shape Detection API (Android WebView / Chrome).
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

// Zoom/focus camera capabilities aren't in the standard TS lib yet.
interface ZoomCapabilities {
  zoom?: { min: number; max: number; step: number };
}
interface ZoomConstraints {
  advanced?: Array<{ zoom?: number; focusMode?: string }>;
}

/**
 * The QR on the device back is ~1cm; at normal focus distance it's only a
 * few dozen pixels. Optical/digital zoom lets the user hold the phone at
 * focusable distance while the code fills the frame.
 */
async function tuneTrack(track: MediaStreamTrack, zoom: number): Promise<void> {
  try {
    await track.applyConstraints({
      advanced: [{ zoom, focusMode: "continuous" }],
    } as ZoomConstraints as MediaTrackConstraints);
  } catch {
    // Not supported on this camera - fine, plain scanning still works.
  }
}

/**
 * Camera viewfinder that reads the QR on the back of a Beacon 1
 * (encodes `tel:<device id>`). Falls back to manual entry when the
 * platform has no BarcodeDetector or the camera is refused.
 */
export function BeaconScanner({ onFound }: { onFound: (deviceId: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const foundRef = useRef(false);
  const [mode, setMode] = useState<"starting" | "scanning" | "manual">("starting");
  const [manualValue, setManualValue] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;

    async function start() {
      if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
        setMode("manual");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            // High resolution so a ~1cm QR still has enough pixels.
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setMode("scanning");

        // Zoom in by default when the camera supports it - the Beacon's QR
        // is tiny and unreadable at arm's length otherwise.
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const caps = (track.getCapabilities?.() ?? {}) as ZoomCapabilities;
        if (caps.zoom && caps.zoom.max > 1) {
          const start = Math.min(2, caps.zoom.max);
          setMaxZoom(caps.zoom.max);
          setZoom(start);
          await tuneTrack(track, start);
        } else {
          await tuneTrack(track, 1);
        }

        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        const tick = async () => {
          if (cancelled || foundRef.current) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2) {
            try {
              const codes = await detector.detect(v);
              for (const code of codes) {
                const id = parseDeviceId(code.rawValue);
                if (id) {
                  foundRef.current = true;
                  if (navigator.vibrate) navigator.vibrate(30);
                  onFound(id);
                  return;
                }
              }
            } catch {
              // detector hiccup on a frame - keep scanning
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) setMode("manual");
      }
    }

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitManual = () => {
    const id = parseDeviceId(manualValue);
    if (!id) {
      setManualError("That doesn't look like a Beacon ID. It's the number under the QR code.");
      return;
    }
    onFound(id);
  };

  if (mode === "manual") {
    return (
      <div className="beacon-step-in space-y-4">
        <div className="text-center space-y-1">
          <p className="text-dark-100 font-semibold">Enter the Beacon ID</p>
          <p className="text-sm text-dark-400">
            It&apos;s the number printed under the QR code on the back of the device.
          </p>
        </div>
        <input
          inputMode="numeric"
          autoFocus
          value={manualValue}
          onChange={(e) => { setManualValue(e.target.value); setManualError(null); }}
          onKeyDown={(e) => e.key === "Enter" && submitManual()}
          placeholder="e.g. 67084982860"
          className="w-full bg-dark-800 border border-dark-600 rounded-2xl px-4 py-3.5 text-center text-lg tracking-widest text-dark-100 placeholder:text-dark-500 placeholder:tracking-normal focus:outline-none focus:border-primary-500 transition-colors"
        />
        {manualError && <p className="text-sm text-red-400 text-center">{manualError}</p>}
        <button
          onClick={submitManual}
          disabled={!manualValue.trim()}
          className="w-full py-3.5 rounded-2xl bg-primary-600 text-white font-semibold active:scale-[0.98] transition-transform disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="beacon-step-in space-y-4">
      <div className="relative mx-auto w-64 h-64 rounded-3xl overflow-hidden bg-dark-900">
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* viewfinder frame */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-6 rounded-2xl border-2 border-white/25" />
          {["top-5 left-5 border-t-[3px] border-l-[3px] rounded-tl-2xl",
            "top-5 right-5 border-t-[3px] border-r-[3px] rounded-tr-2xl",
            "bottom-5 left-5 border-b-[3px] border-l-[3px] rounded-bl-2xl",
            "bottom-5 right-5 border-b-[3px] border-r-[3px] rounded-br-2xl"].map((pos) => (
            <div key={pos} className={`absolute w-7 h-7 border-primary-400 ${pos}`} />
          ))}
          <div className="absolute inset-x-10 top-1/2 flex justify-center">
            <div className="beacon-scanline h-0.5 w-full rounded-full bg-primary-400/80 shadow-[0_0_12px_rgba(167,139,250,0.8)]" />
          </div>
        </div>
        {mode === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-dark-900">
            <ScanLine className="w-8 h-8 text-dark-500 animate-pulse" />
          </div>
        )}
        {/* zoom control - only when the camera can zoom */}
        {mode === "scanning" && maxZoom > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1 bg-black/50 backdrop-blur rounded-full p-1">
            {[1, 2, 3].filter((z) => z <= maxZoom).map((z) => (
              <button
                key={z}
                onClick={() => {
                  setZoom(z);
                  if (trackRef.current) tuneTrack(trackRef.current, z);
                }}
                className={`w-9 h-7 rounded-full text-xs font-bold transition-all ${
                  zoom === z ? "bg-white text-black scale-105" : "text-white/80"
                }`}
              >
                {z}x
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-center text-sm text-dark-400">
        Point the camera at the QR code on the back of your Beacon. Hold it
        about a hand&apos;s length away and let it focus.
      </p>
      <button
        onClick={() => setMode("manual")}
        className="mx-auto flex items-center gap-2 text-sm text-primary-300 font-medium py-2 px-4 rounded-full active:scale-95 transition-transform"
      >
        <Keyboard className="w-4 h-4" />
        Type the ID instead
      </button>
    </div>
  );
}
