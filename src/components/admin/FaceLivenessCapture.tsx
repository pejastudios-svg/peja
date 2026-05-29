"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import type * as FaceApiNS from "@vladmandic/face-api";

type FaceApi = typeof FaceApiNS;

const MODEL_URL = "/face-models";

type Challenge = "straight" | "left" | "right" | "blink";

const CHALLENGE_LABELS: Record<Challenge, string> = {
  straight: "Look straight at the camera",
  left: "Turn your head to the LEFT",
  right: "Turn your head to the RIGHT",
  blink: "Blink your eyes",
};

const STEP_TIMEOUT_MS = 12000;
const SAMPLES_FOR_ENROLLMENT = 3;
const FRAMES_FOR_CONFIRMATION = 5;

const STRAIGHT_NOSE_TOL = 0.10;
const STRAIGHT_EAR_MIN = 0.25;
const TURN_LEFT_THRESHOLD = 0.62;
const TURN_RIGHT_THRESHOLD = 0.38;
// Blink detection: rolling window of the last N EAR values gives us the user's
// current open-eye baseline (immune to head movement). A blink is a dip-then-recover
// pattern — small absolute drops count, since many people blink shallowly.
const BLINK_WINDOW = 12;            // rolling buffer of recent EAR values (~1.5s at ~8fps)
const BLINK_DROP_RATIO = 0.90;       // EAR must drop to under 90% of recent max
const BLINK_DROP_MIN_ABS = 0.020;    // and the drop must be at least 0.02 in absolute terms
const BLINK_RECOVER_RATIO = 0.95;    // recovery: EAR climbs back to 95% of pre-dip max

export type FaceCaptureResult = {
  descriptor: number[];
  thumbnail: string;
};

type Props = {
  mode: "enroll" | "verify";
  onComplete: (result: FaceCaptureResult) => void;
  onCancel?: () => void;
};

let faceApiPromise: Promise<FaceApi> | null = null;

async function loadFaceApi(): Promise<FaceApi> {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })().catch((err) => {
      faceApiPromise = null;
      throw err;
    });
  }
  return faceApiPromise;
}

function shuffleChallenges(): Challenge[] {
  const rest: Challenge[] = ["left", "right", "blink"];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return ["straight", ...rest];
}

type Pt = { x: number; y: number };

function eyeAspectRatio(eye: Pt[]): number {
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * d(eye[0], eye[3]));
}

function centroid(pts: Pt[]): Pt {
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

export default function FaceLivenessCapture({ mode, onComplete, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceApiRef = useRef<FaceApi | null>(null);
  const rafRef = useRef<number | null>(null);

  // Loop-owned state (refs so the loop never sees stale values and the effect never restarts mid-run)
  const statusRef = useRef<"loading" | "ready" | "running" | "success" | "error">("loading");
  const stepIndexRef = useRef<number>(0);
  const stepStartRef = useRef<number>(0);
  const detectionInFlightRef = useRef<boolean>(false);
  const samplesRef = useRef<number[][]>([]);
  const thumbnailRef = useRef<string>("");
  const consecutiveOkRef = useRef<number>(0);
  const blinkStateRef = useRef<{
    ears: number[];
    sawDip: boolean;
    preDipMax: number;
    minDuringDip: number;
    complete: boolean;
  }>({
    ears: [],
    sawDip: false,
    preDipMax: 0,
    minDuringDip: 1,
    complete: false,
  });
  const lastCaptureAtRef = useRef<number>(0);
  const lastLogAtRef = useRef<number>(0);

  // Render state
  const [status, setStatusState] = useState<"loading" | "ready" | "running" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [challenges, setChallenges] = useState<Challenge[]>(() => shuffleChallenges());
  const [stepIndex, setStepIndexState] = useState(0);
  const [hint, setHint] = useState("");
  const [progress, setProgress] = useState(0);

  // Live overlay values
  const [liveNosePos, setLiveNosePos] = useState<number | null>(null);
  const [liveEar, setLiveEar] = useState<number | null>(null);
  const [liveRecentMax, setLiveRecentMax] = useState<number | null>(null);
  const [blinkPhase, setBlinkPhase] = useState<"idle" | "dip" | "complete">("idle");
  const [faceDetected, setFaceDetected] = useState<boolean>(false);
  const [frameOk, setFrameOk] = useState<number>(0);

  const setStatus = useCallback((s: typeof statusRef.current) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);

  const setStepIndex = useCallback((i: number) => {
    stepIndexRef.current = i;
    setStepIndexState(i);
  }, []);

  // Mount: load models + open camera
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const faceapi = await loadFaceApi();
        if (cancelled) return;
        faceApiRef.current = faceapi;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute("playsinline", "true");
          video.muted = true;
          await video.play();
          if (canvasRef.current) {
            canvasRef.current.width = video.videoWidth || 640;
            canvasRef.current.height = video.videoHeight || 480;
          }
        }
        setStatus("ready");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Failed to initialize");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [setStatus]);

  const drawOverlay = useCallback(
    (
      box: { x: number; y: number; width: number; height: number } | null,
      viewerLeftEye: Pt | null,
      viewerRightEye: Pt | null,
      noseTip: Pt | null,
      ok: boolean
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!box) return;

      ctx.strokeStyle = ok ? "#10b981" : "#3b82f6";
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      if (viewerLeftEye && viewerRightEye) {
        ctx.fillStyle = "#3b82f6";
        for (const p of [viewerLeftEye, viewerRightEye]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = "rgba(59, 130, 246, 0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(viewerLeftEye.x, viewerLeftEye.y);
        ctx.lineTo(viewerRightEye.x, viewerRightEye.y);
        ctx.stroke();

        const midX = (viewerLeftEye.x + viewerRightEye.x) / 2;
        const midY = (viewerLeftEye.y + viewerRightEye.y) / 2;
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(midX, midY - 30);
        ctx.lineTo(midX, midY + 80);
        ctx.stroke();
      }

      if (noseTip) {
        ctx.fillStyle = ok ? "#10b981" : "#f59e0b";
        ctx.beginPath();
        ctx.arc(noseTip.x, noseTip.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },
    []
  );

  const resetStepState = useCallback(() => {
    stepStartRef.current = performance.now();
    consecutiveOkRef.current = 0;
    blinkStateRef.current = {
      ears: [],
      sawDip: false,
      preDipMax: 0,
      minDuringDip: 1,
      complete: false,
    };
    setFrameOk(0);
    setProgress(0);
    setLiveRecentMax(null);
    setBlinkPhase("idle");
  }, []);

  const captureThumbnail = useCallback((): string => {
    const video = videoRef.current;
    if (!video) return "";
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.7);
  }, []);

  const finish = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const samples = samplesRef.current;
    if (samples.length === 0) {
      // eslint-disable-next-line no-console
      console.log("[face] FINISH error: no descriptor samples captured");
      setErrorMsg("No face descriptor captured");
      setStatus("error");
      return;
    }
    const avg = new Array<number>(samples[0].length).fill(0);
    for (const s of samples) for (let i = 0; i < s.length; i++) avg[i] += s[i];
    for (let i = 0; i < avg.length; i++) avg[i] /= samples.length;
    // eslint-disable-next-line no-console
    console.log(`[face] FINISH success: ${samples.length} samples averaged, descriptor length=${avg.length}`);
    setStatus("success");
    onComplete({ descriptor: avg, thumbnail: thumbnailRef.current });
  }, [onComplete, setStatus]);

  const advanceStep = useCallback(() => {
    const next = stepIndexRef.current + 1;
    // eslint-disable-next-line no-console
    console.log(
      `[face] step ${stepIndexRef.current} (${challenges[stepIndexRef.current]}) → ${next < challenges.length ? `${next} (${challenges[next]})` : "finish"}`
    );
    if (next >= challenges.length) {
      finish();
      return;
    }
    setStepIndex(next);
    resetStepState();
  }, [challenges, finish, resetStepState, setStepIndex]);

  // Main detection loop — depends only on `status` so it never tears down mid-run
  useEffect(() => {
    if (status !== "running") return;
    const faceapi = faceApiRef.current;
    const video = videoRef.current;
    if (!faceapi || !video) return;

    resetStepState();

    const tick = async () => {
      if (statusRef.current !== "running" || !videoRef.current) return;

      if (detectionInFlightRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      detectionInFlightRef.current = true;

      try {
        const v = videoRef.current;
        const detection = await faceapi
          .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
          .withFaceLandmarks();

        if (statusRef.current !== "running") return;

        const now = performance.now();
        const elapsed = now - stepStartRef.current;
        const currentChallenge = challenges[stepIndexRef.current];

        if (!detection) {
          setFaceDetected(false);
          setLiveNosePos(null);
          setLiveEar(null);
          setHint("No face detected — center yourself in the frame");
          consecutiveOkRef.current = 0;
          setFrameOk(0);
          drawOverlay(null, null, null, null, false);
          if (now - lastLogAtRef.current > 100) {
            lastLogAtRef.current = now;
            // eslint-disable-next-line no-console
            console.log(
              `[face] challenge=${currentChallenge} face=NO elapsed=${(elapsed / 1000).toFixed(1)}s`
            );
          }
        } else {
          setFaceDetected(true);
          const landmarks = detection.landmarks;
          const box = detection.detection.box;
          const lEyeRaw = landmarks.getLeftEye();
          const rEyeRaw = landmarks.getRightEye();
          const noseRaw = landmarks.getNose();

          const cA = centroid(lEyeRaw);
          const cB = centroid(rEyeRaw);
          const noseTip = noseRaw[3];

          // Map face-api's left/right (subject-relative) to viewer-relative by x coordinate
          const viewerLeftEye = cA.x < cB.x ? cA : cB;
          const viewerLeftEyePts = cA.x < cB.x ? lEyeRaw : rEyeRaw;
          const viewerRightEye = cA.x < cB.x ? cB : cA;
          const viewerRightEyePts = cA.x < cB.x ? rEyeRaw : lEyeRaw;

          const span = viewerRightEye.x - viewerLeftEye.x;
          const nosePos = span > 1 ? (noseTip.x - viewerLeftEye.x) / span : 0.5;

          const earL = eyeAspectRatio(viewerLeftEyePts);
          const earR = eyeAspectRatio(viewerRightEyePts);
          const avgEar = (earL + earR) / 2;

          setLiveNosePos(nosePos);
          setLiveEar(avgEar);

          let conditionMet = false;
          let stepHint = "";

          if (currentChallenge === "straight") {
            const centered = Math.abs(nosePos - 0.5) < STRAIGHT_NOSE_TOL;
            const eyesOpen = avgEar > STRAIGHT_EAR_MIN;
            conditionMet = centered && eyesOpen;
            stepHint = !centered
              ? "Face the camera directly"
              : !eyesOpen
              ? "Open your eyes"
              : "Hold still…";
          } else if (currentChallenge === "left") {
            conditionMet = nosePos > TURN_LEFT_THRESHOLD;
            stepHint = "Turn your head to the LEFT";
          } else if (currentChallenge === "right") {
            conditionMet = nosePos < TURN_RIGHT_THRESHOLD;
            stepHint = "Turn your head to the RIGHT";
          } else if (currentChallenge === "blink") {
            const bState = blinkStateRef.current;

            // Rolling window of recent EAR values gives us a baseline that adapts
            // to head movement instead of drifting upward forever
            bState.ears.push(avgEar);
            if (bState.ears.length > BLINK_WINDOW) bState.ears.shift();
            let recentMax = -Infinity;
            for (const e of bState.ears) if (e > recentMax) recentMax = e;
            setLiveRecentMax(recentMax);

            const inDip =
              avgEar < BLINK_DROP_RATIO * recentMax &&
              recentMax - avgEar > BLINK_DROP_MIN_ABS;

            if (inDip) {
              if (!bState.sawDip) {
                bState.sawDip = true;
                bState.preDipMax = recentMax;
                bState.minDuringDip = avgEar;
              } else if (avgEar < bState.minDuringDip) {
                bState.minDuringDip = avgEar;
              }
            }

            if (
              bState.sawDip &&
              !bState.complete &&
              avgEar > BLINK_RECOVER_RATIO * bState.preDipMax
            ) {
              bState.complete = true;
            }

            conditionMet = bState.complete;

            const phase: "idle" | "dip" | "complete" = bState.complete
              ? "complete"
              : bState.sawDip
              ? "dip"
              : "idle";
            setBlinkPhase(phase);

            stepHint = !bState.sawDip
              ? "Blink your eyes (close them briefly)"
              : !bState.complete
              ? "Now open them again"
              : "Blink detected";
          }

          drawOverlay(box, viewerLeftEye, viewerRightEye, noseTip, conditionMet);

          if (now - lastLogAtRef.current > 100) {
            lastLogAtRef.current = now;
            const bState = blinkStateRef.current;
            const parts = [
              `challenge=${currentChallenge}`,
              `face=YES`,
              `nosePos=${nosePos.toFixed(3)}`,
              `EAR=${avgEar.toFixed(3)}`,
              `met=${conditionMet}`,
              `ok=${consecutiveOkRef.current}`,
              `elapsed=${(elapsed / 1000).toFixed(1)}s`,
            ];
            if (currentChallenge === "blink") {
              let rMax = -Infinity;
              for (const e of bState.ears) if (e > rMax) rMax = e;
              if (rMax === -Infinity) rMax = 0;
              parts.push(
                `recentMax=${rMax.toFixed(3)}`,
                `sawDip=${bState.sawDip}`,
                `minDip=${bState.sawDip ? bState.minDuringDip.toFixed(3) : "—"}`,
                `complete=${bState.complete}`
              );
            }
            // eslint-disable-next-line no-console
            console.log(`[face] ${parts.join(" ")}`);
          }

          if (conditionMet) {
            consecutiveOkRef.current += 1;
            setFrameOk(consecutiveOkRef.current);

            if (currentChallenge === "straight") {
              const needed = mode === "enroll" ? SAMPLES_FOR_ENROLLMENT : 1;
              const canCapture =
                consecutiveOkRef.current >= FRAMES_FOR_CONFIRMATION &&
                now - lastCaptureAtRef.current > 250;

              if (canCapture) {
                const detWithDesc = await faceapi
                  .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
                  .withFaceLandmarks()
                  .withFaceDescriptor();
                if (detWithDesc?.descriptor) {
                  samplesRef.current.push(Array.from(detWithDesc.descriptor));
                  if (!thumbnailRef.current) thumbnailRef.current = captureThumbnail();
                  lastCaptureAtRef.current = now;
                  setProgress(samplesRef.current.length);
                  stepHint = `Captured ${samplesRef.current.length}/${needed}`;
                  setHint(stepHint);
                  if (samplesRef.current.length >= needed) {
                    advanceStep();
                  }
                }
              } else {
                setHint(`${stepHint} (${consecutiveOkRef.current}/${FRAMES_FOR_CONFIRMATION})`);
              }
            } else {
              // Blink's conditionMet is itself the confirmation (it can only become true after
              // a full open→closed→open sequence). Other challenges need sustained signal.
              const framesNeeded = currentChallenge === "blink" ? 2 : FRAMES_FOR_CONFIRMATION;
              if (consecutiveOkRef.current >= framesNeeded) {
                advanceStep();
              } else {
                setHint(`${stepHint} (${consecutiveOkRef.current}/${framesNeeded})`);
              }
            }
          } else {
            setHint(stepHint);
            if (currentChallenge !== "blink") {
              consecutiveOkRef.current = 0;
              setFrameOk(0);
            }
          }
        }

        if (elapsed > STEP_TIMEOUT_MS) {
          // eslint-disable-next-line no-console
          console.log(`[face] TIMEOUT on challenge=${currentChallenge} after ${(elapsed / 1000).toFixed(1)}s`);
          setErrorMsg(`Timed out on: ${CHALLENGE_LABELS[currentChallenge]}`);
          setStatus("error");
          return;
        }
      } catch {
        // transient detection error — keep looping
      } finally {
        detectionInFlightRef.current = false;
      }

      if (statusRef.current === "running") {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [status, challenges, advanceStep, captureThumbnail, drawOverlay, mode, resetStepState, setStatus]);

  const handleStart = () => {
    samplesRef.current = [];
    thumbnailRef.current = "";
    lastCaptureAtRef.current = 0;
    lastLogAtRef.current = 0;
    const newChallenges = shuffleChallenges();
    setChallenges(newChallenges);
    setStepIndex(0);
    setProgress(0);
    setErrorMsg("");
    setFrameOk(0);
    // eslint-disable-next-line no-console
    console.log(`[face] START mode=${mode} challenges=[${newChallenges.join(", ")}]`);
    setStatus("running");
  };

  const handleRetry = () => {
    samplesRef.current = [];
    thumbnailRef.current = "";
    lastCaptureAtRef.current = 0;
    setChallenges(shuffleChallenges());
    setStepIndex(0);
    setProgress(0);
    setErrorMsg("");
    setFaceDetected(false);
    setLiveNosePos(null);
    setLiveEar(null);
    setFrameOk(0);
    setStatus("ready");
  };

  const currentChallenge = challenges[stepIndex];
  const neededSamples = mode === "enroll" ? SAMPLES_FOR_ENROLLMENT : 1;

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="relative aspect-[4/3] bg-dark-900 rounded-2xl overflow-hidden border border-dark-700">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
          autoPlay
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ transform: "scaleX(-1)" }}
        />

        {status === "running" && (
          <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-md px-3 py-2 font-mono text-[10px] text-white space-y-0.5 leading-tight">
            <div>face: {faceDetected ? "yes" : "no"}</div>
            <div>nosePos: {liveNosePos != null ? liveNosePos.toFixed(2) : "—"}</div>
            <div>EAR: {liveEar != null ? liveEar.toFixed(2) : "—"}</div>
            {challenges[stepIndex] === "blink" && (
              <>
                <div>recentMax: {liveRecentMax != null ? liveRecentMax.toFixed(2) : "—"}</div>
                <div>phase: {blinkPhase}</div>
              </>
            )}
            <div>ok: {frameOk}/{FRAMES_FOR_CONFIRMATION}</div>
          </div>
        )}

        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-dark-950/80">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-dark-300">Loading face recognition…</p>
            </div>
          </div>
        )}

        {status === "running" && (
          <>
            <div className="absolute top-4 left-4 right-32">
              <div className="flex gap-1.5">
                {challenges.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${i < stepIndex ? "bg-green-500" : i === stepIndex ? "bg-primary-500" : "bg-dark-700"}`}
                  />
                ))}
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
              <p className="text-lg font-semibold text-white text-center">
                {CHALLENGE_LABELS[currentChallenge]}
              </p>
              {hint && <p className="text-sm text-dark-300 text-center mt-1">{hint}</p>}
              {currentChallenge === "straight" && progress > 0 && (
                <p className="text-xs text-dark-400 text-center mt-1">
                  Captured {progress}/{neededSamples}
                </p>
              )}
            </div>
          </>
        )}

        {status === "success" && (
          <div className="absolute inset-0 flex items-center justify-center bg-green-950/80">
            <div className="text-center">
              <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto mb-3" />
              <p className="text-lg font-semibold text-green-100">Verified</p>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-950/80 p-6">
            <div className="text-center">
              <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
              <p className="text-sm text-red-100">{errorMsg || "Verification failed"}</p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {status === "ready" && (
          <button
            onClick={handleStart}
            className="w-full py-4 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-500 transition-colors flex items-center justify-center gap-2"
          >
            <Camera className="w-5 h-5" />
            {mode === "enroll" ? "Start Enrollment" : "Verify Face"}
          </button>
        )}

        {status === "error" && (
          <button
            onClick={handleRetry}
            className="w-full py-4 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-500 transition-colors flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-5 h-5" />
            Try Again
          </button>
        )}

        {onCancel && status !== "success" && (
          <button
            onClick={onCancel}
            className="w-full py-3 text-sm text-dark-400 hover:text-dark-200 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
