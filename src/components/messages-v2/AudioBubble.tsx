"use client";

// In-bubble player for a voice note. Owns its own <audio> element,
// draws a play/pause control, a tappable waveform that doubles as a
// progress + seek track, the duration, and a speed pill (1×, 1.5×, 2×).
//
// Waveform strategy:
//   • On mount, fetch the audio bytes once and decode via
//     AudioContext.decodeAudioData → numeric samples.
//   • Downsample to a fixed bar count (we render ~32 bars).
//   • Cache the resulting peaks array under the URL on a module-level
//     Map so re-opening a thread doesn't re-decode the same files.
//
// Decode is slow-ish (50–300 ms per voice note), so we render a flat
// skeleton row of bars while it's running and swap to the real
// waveform as soon as it resolves. If decoding fails for any reason
// (CORS, codec the browser can't handle, etc.) we just keep showing
// the skeleton — playback still works fine via the <audio> element.

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Loader2 } from "lucide-react";
import { UploadRing } from "./UploadRing";

interface Props {
  url: string;
  // Duration in seconds. If we know it up-front (e.g. from the
  // optimistic message that's still uploading), pass it so the bubble
  // renders the right "0:08" label before the audio element has even
  // loaded metadata. The bubble overrides this with the audio's own
  // duration once that resolves, so passing a slightly stale value is
  // safe.
  initialDuration?: number;
  // Whose bubble — drives colour palette so the controls have enough
  // contrast against the bubble background.
  variant: "mine" | "theirs";
  // Optional message-meta line rendered at the bottom-right of the
  // bubble (timestamp + ✓ ticks). When provided, the AudioBubble
  // becomes the bubble's full body — the parent should NOT also
  // render its own status row, otherwise we end up with two rows of
  // metadata stacked vertically (which is what caused the player to
  // look "too high" before).
  metaTrailing?: React.ReactNode;
  // When the underlying message is still uploading, the play button
  // is replaced by an UploadRing showing live progress with a
  // tap-to-cancel X. Mirrors the image / video / document bubbles.
  isPending?: boolean;
  uploadFraction?: number;
  onCancelUpload?: () => void;
}

const SPEEDS: Array<{ label: string; value: number }> = [
  { label: "1×", value: 1 },
  { label: "1.5×", value: 1.5 },
  { label: "2×", value: 2 },
];

const BAR_COUNT = 32;

// Module-level cache so re-mounting an AudioBubble for the same URL
// (e.g. on scroll back into view) doesn't trigger another decode.
const peaksCache = new Map<string, number[]>();

// Module-level registry of every mounted AudioBubble's <audio>
// element. Whenever one starts playing, we walk the registry and
// pause any other that's currently playing — only one voice note can
// be audible at a time. Shared across the chat thread AND the
// chat-info Voice notes tab because they import the same module.
const audioRegistry = new Set<HTMLAudioElement>();

function pauseOtherAudios(except: HTMLAudioElement): void {
  for (const el of audioRegistry) {
    if (el !== except && !el.paused) {
      try {
        el.pause();
      } catch {}
    }
  }
}

export function AudioBubble({
  url,
  initialDuration,
  variant,
  metaTrailing,
  isPending,
  uploadFraction,
  onCancelUpload,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  // True while the browser is fetching / buffering audio data. Set
  // optimistically when the user taps play (covers the "I clicked but
  // nothing's happening yet" gap), and re-asserted by the audio
  // element's own `waiting` event when playback stalls mid-track to
  // refill the buffer. Cleared by `playing` (real audio actually
  // started) or `pause`.
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration ?? 0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [peaks, setPeaks] = useState<number[] | null>(
    peaksCache.get(url) ?? null
  );
  // While the user is dragging the scrubber dot, we feed the visual
  // position from a local ref so it tracks the pointer immediately,
  // even though we only commit the seek to the <audio> element on
  // pointer-up. (Committing every move = audible glitches.)
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  // -----------------------------------------------------
  // Decode the audio file into a peaks array. Async — runs once per
  // unique URL across the session via the module cache.
  // -----------------------------------------------------
  useEffect(() => {
    if (peaks) return; // already cached
    if (!url) return;
    if (url.startsWith("blob:")) {
      // Optimistic-state blob URL. Fetching a blob URL works (it's
      // a valid same-origin reference), but on some Capacitor
      // WebView versions decoding a blob: URL fails silently. Skip
      // decode while optimistic — we'll get a real peaks render
      // once the message is patched with the public URL.
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const buf = await loadPeaks(url, BAR_COUNT);
        if (cancelled) return;
        peaksCache.set(url, buf);
        setPeaks(buf);
      } catch (e) {
        // Decode failures aren't fatal — playback still works. We
        // just keep the skeleton bars.
        console.warn("[audio] waveform decode failed", e);
      }
    })();
    return () => { cancelled = true; };
  }, [url, peaks]);

  // Wire the audio element's events to React state. The audio
  // element itself doesn't re-render React; these listeners do.
  //
  // WebM-from-MediaRecorder duration trick: voice notes recorded on the
  // web with `MediaRecorder` are written without a Cues block, so the
  // browser reports `duration: Infinity` until it has scanned the whole
  // file. Seeking past the end (1e10s) forces the browser to read to
  // the end and compute the real duration; once we get a finite value
  // from the second `durationchange` event, we seek back to 0 and clear
  // the fix flag. Without this the scrubber dot can never advance
  // because `currentTime / duration` is NaN / 0.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    let durationFixApplied = false;
    const tryFixDuration = () => {
      if (durationFixApplied) return;
      if (!Number.isFinite(el.duration)) {
        durationFixApplied = true;
        try {
          el.currentTime = 1e10;
        } catch {}
      }
    };
    const onLoaded = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
      } else {
        tryFixDuration();
      }
    };
    const onDurationChange = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
        if (durationFixApplied) {
          // Reset playhead to the start after the seek-to-end trick.
          try {
            el.currentTime = 0;
          } catch {}
        }
      } else {
        tryFixDuration();
      }
    };
    const onTime = () => setCurrentTime(el.currentTime);
    const onPlay = () => {
      setIsPlaying(true);
      // Single-player rule: pausing every OTHER mounted bubble the
      // moment this one starts playing. Catches every play path —
      // togglePlay, autoplay, or programmatic .play() from somewhere
      // else — because the browser always fires the `play` event when
      // the element actually starts.
      pauseOtherAudios(el);
    };
    const onPause = () => {
      setIsPlaying(false);
      setIsLoading(false);
    };
    // Fires when actual audio playback starts or resumes after buffer
    // starvation. Distinct from `play` which fires the instant play()
    // is called, well before sound comes out. Using `playing` as the
    // signal lets the loading spinner stay up for the entire "I
    // clicked play but audio hasn't actually started yet" window.
    const onPlaying = () => setIsLoading(false);
    // Browser is stalled waiting for more buffered data. Mid-playback
    // buffer starvation shows the spinner again so the user knows the
    // pause isn't intentional.
    const onWaiting = () => setIsLoading(true);
    // canplay = the first chunk is ready; if we were optimistically
    // showing the spinner and the play() promise hasn't fired yet,
    // we can safely clear loading here too as a backstop.
    const onCanPlay = () => {
      if (!el.paused) setIsLoading(false);
    };
    const onEnd = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    // Surface decode / network failures. Without this listener,
    // `el.play()` rejects silently (caught by togglePlay's
    // console.warn) and the user sees zero feedback when a file
    // can't be loaded. Logs the underlying MediaError code so we
    // can tell decode-failed (4) apart from network-failed (2),
    // aborted (1) or src-not-supported (3).
    const onError = () => {
      const code = el.error?.code;
      const msg = el.error?.message;
      console.warn("[audio] element error", { code, msg, src: el.currentSrc });
    };
    audioRegistry.add(el);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onError);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("canplay", onCanPlay);
    return () => {
      audioRegistry.delete(el);
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onError);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("canplay", onCanPlay);
    };
  }, []);

  // Apply speed every time it changes.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = SPEEDS[speedIdx].value;
    }
  }, [speedIdx]);

  // Always-on RAF poll of the audio element's actual state. Reads the
  // ref INSIDE the tick — the previous version captured audioRef
  // .current in closure once, which meant the loop polled a stale
  // (or null) reference forever if the element wasn't mounted at
  // effect-run time.
  //
  // We poll because some Capacitor WebView builds drop `play` /
  // `timeupdate` events silently — relying on the events alone left
  // the scrubber dot frozen even when audio was clearly playing.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = audioRef.current;
      if (el) {
        const playing = !el.paused && !el.ended;
        setIsPlaying((prev) => (prev !== playing ? playing : prev));
        if (playing) {
          setCurrentTime(el.currentTime);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      if (el.paused) {
        // Optimistic loading flag — the `play()` promise resolves
        // when playback STARTS, which on a fresh src can take a
        // second or two while the browser fetches data. Showing the
        // spinner immediately covers that gap so the user sees the
        // click was registered.
        setIsLoading(true);
        await el.play();
      } else {
        el.pause();
      }
    } catch (e) {
      // If play() rejected, the audio is back in the paused state
      // and we never crossed `playing` — clear the optimistic flag
      // so the button doesn't stay stuck on the spinner.
      setIsLoading(false);
      // Surface the actual DOMException name so the cause is
      // diagnosable: "NotSupportedError" = browser can't decode the
      // format, "NotAllowedError" = autoplay policy (shouldn't happen
      // from a user click), "AbortError" = src changed mid-load. Plus
      // the element's own MediaError code if one is set.
      const err = e as Error & { name?: string };
      console.warn("[audio] play failed", {
        name: err?.name,
        message: err?.message,
        elementErrorCode: el.error?.code,
        elementErrorMessage: el.error?.message,
        src: el.currentSrc,
      });
    }
  }, []);

  // Common helper: turn a clientX (page coords) into a 0..1 fraction
  // along the seek track. Used by both tap-to-seek and drag-to-seek.
  const fractionFromX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const commitSeek = useCallback(
    (fraction: number) => {
      const el = audioRef.current;
      if (!el || !duration) return;
      el.currentTime = fraction * duration;
    },
    [duration]
  );

  // Pointer-down on the track / scrubber: start dragging. We capture
  // the pointer on the element so movement keeps tracking even if the
  // pointer leaves the track horizontally.
  const onSeekPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget as HTMLDivElement;
      target.setPointerCapture?.(e.pointerId);
      const f = fractionFromX(e.clientX);
      setDragFraction(f);
    },
    [fractionFromX]
  );

  const onSeekPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragFraction === null) return;
      setDragFraction(fractionFromX(e.clientX));
    },
    [dragFraction, fractionFromX]
  );

  const onSeekPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget as HTMLDivElement;
      target.releasePointerCapture?.(e.pointerId);
      if (dragFraction === null) return;
      commitSeek(dragFraction);
      setDragFraction(null);
    },
    [dragFraction, commitSeek]
  );

  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => (i + 1) % SPEEDS.length);
  }, []);

  const livePlaybackFraction = duration > 0 ? currentTime / duration : 0;
  // While dragging, the bars + the scrubber dot follow the pointer
  // (visual feedback). The audio's actual playback position only
  // moves when we commit on pointer-up.
  const progressFraction = dragFraction ?? livePlaybackFraction;
  // Countdown style: show remaining time. At rest (currentTime = 0)
  // this equals the full duration, so the bubble advertises how long
  // the clip is. As playback advances, the number ticks down toward 0.
  const remainingTime =
    dragFraction !== null
      ? (1 - dragFraction) * duration
      : Math.max(0, duration - currentTime);

  // Colour scheme: contrast against the bubble. On "mine" bubble the
  // bubble is primary-600, so we use white surfaces. On "theirs" the
  // bubble is white/10, so we use slightly brighter neutrals.
  const playBg =
    variant === "mine" ? "bg-white/25" : "bg-[var(--chat-control-other-bg)]";
  const playFg = variant === "mine" ? "text-white" : "text-dark-100";
  const barColor =
    variant === "mine" ? "bg-white/40" : "bg-[var(--chat-control-other-track)]";
  const barPlayedColor = variant === "mine" ? "bg-white" : "bg-primary-400";
  const timeFg = variant === "mine" ? "text-white/85" : "text-dark-300";
  const speedFg = variant === "mine" ? "text-white/85" : "text-dark-300";

  // Render bars. If peaks aren't loaded yet, render a flat skeleton.
  const bars = peaks ?? Array(BAR_COUNT).fill(0.25);

  const scrubberColor = variant === "mine" ? "bg-white" : "bg-primary-400";

  // Layout (matches the user-approved spec):
  //
  //   ┌──────────┬─────────────────────────────────────────┐
  //   │          │ Waveform with dot                 1×    │  ← top
  //   │  PLAY    │                                         │
  //   │          │ 0:08                         16:23 ✓✓   │  ← bottom
  //   └──────────┴─────────────────────────────────────────┘
  //
  // The play button is bigger than the waveform row alone, so by
  // sizing it to MATCH the height of (waveform + meta), the outer
  // flex container with `items-center` lands the play button's
  // vertical centre on the right column's vertical centre, and the
  // bubble reads as symmetric.
  //
  // Critical: the meta row ("0:08" + timestamp + ticks) is INSIDE
  // the right column — it does NOT span the full bubble width
  // underneath the play button. That was the asymmetry in the ✗
  // mock-up: when the meta row extended under the play button,
  // "0:15" sat in the bubble's bottom-left corner instead of being
  // anchored to the waveform's left edge.
  return (
    <div className="flex items-center gap-3 min-w-[230px]">
      {/* Hide the audio element completely — without `controls` it
          renders as a 0×0 inline element by default, but
          `display:none` is the explicit guarantee that it never
          contributes any layout. */}
      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />

      {isPending ? (
        // Upload in flight — swap the play button for the same
        // ring + cancel-X used by the other media bubbles.
        <span
          className="shrink-0 w-11 h-11 flex items-center justify-center"
          aria-hidden
        >
          <UploadRing
            fraction={uploadFraction ?? 0}
            size={44}
            onCancel={onCancelUpload}
          />
        </span>
      ) : (
        <button
          type="button"
          onClick={togglePlay}
          className={`shrink-0 w-11 h-11 rounded-full ${playBg} ${playFg} flex items-center justify-center active:scale-90 transition-transform`}
          aria-label={
            isLoading ? "Loading" : isPlaying ? "Pause" : "Play"
          }
          aria-busy={isLoading || undefined}
        >
          {/* Priority order: loading > playing > paused. Loading
              spinner takes precedence so the user always knows
              something is in progress, even if isPlaying briefly
              flips true while audio is still buffering. */}
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-4 h-4" />
          ) : (
            // Play triangle is right-heavy; 1 px nudge optically
            // centres it inside the round button.
            <Play className="w-4 h-4" style={{ marginLeft: "1px" }} />
          )}
        </button>
      )}

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        <div className="flex items-center gap-2">
          {/* Waveform track. */}
          <div
            ref={trackRef}
            onPointerDown={onSeekPointerDown}
            onPointerMove={onSeekPointerMove}
            onPointerUp={onSeekPointerUp}
            onPointerCancel={onSeekPointerUp}
            className="relative flex-1 h-7 flex items-center gap-[2px] cursor-pointer select-none touch-none"
          >
            {bars.map((amp, i) => {
              const isPlayed = i / bars.length < progressFraction;
              // Clamp so quiet sections still show some bar height
              // (otherwise silence looks like the waveform is missing).
              // Cap at 70% so bars don't poke past the dot vertically.
              const heightPct = Math.max(15, Math.min(70, amp * 70));
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-sm transition-colors ${
                    isPlayed ? barPlayedColor : barColor
                  }`}
                  style={{ height: `${heightPct}%` }}
                />
              );
            })}
            {/* Scrubber dot — pointer-events:none so the parent track
                handles the drag. */}
            <div
              aria-hidden
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full ${scrubberColor} pointer-events-none shadow`}
              style={{ left: `${(progressFraction * 100).toFixed(2)}%` }}
            />
          </div>

          <button
            type="button"
            onClick={cycleSpeed}
            className={`shrink-0 text-[11px] font-semibold ${speedFg} rounded px-1 min-w-[24px]`}
            aria-label="Playback speed"
          >
            {SPEEDS[speedIdx].label}
          </button>
        </div>

        <div
          className={`flex items-center justify-between text-[10px] tabular-nums leading-none ${timeFg}`}
        >
          <span>{formatTime(remainingTime)}</span>
          {metaTrailing && (
            <span className="flex items-center gap-1">{metaTrailing}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================
// Audio decode → peaks
// =====================================================
//
// Downsample the decoded waveform to `barCount` peaks. We take the
// absolute-max amplitude per slice (not RMS) because peaks read more
// like "loud syllables" than "average energy", which is what people
// expect a waveform to show.
async function loadPeaks(url: string, barCount: number): Promise<number[]> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${resp.status}`);
  const arrayBuf = await resp.arrayBuffer();
  // Use an AudioContext we can throw away after decoding so we don't
  // leak. Some browsers cap the global audio context count.
  const AC =
    (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext);
  const ctx = new AC();
  try {
    const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    const channel = audioBuf.getChannelData(0);
    const blockSize = Math.floor(channel.length / barCount) || 1;
    const peaks: number[] = [];
    let max = 0;
    for (let i = 0; i < barCount; i++) {
      const start = i * blockSize;
      let peak = 0;
      const end = Math.min(start + blockSize, channel.length);
      for (let j = start; j < end; j++) {
        const v = Math.abs(channel[j]);
        if (v > peak) peak = v;
      }
      if (peak > max) max = peak;
      peaks.push(peak);
    }
    // Normalise so the loudest bar is 1.0; otherwise quiet recordings
    // render as a flat line.
    return peaks.map((p) => (max > 0 ? p / max : 0));
  } finally {
    try { await ctx.close(); } catch {}
  }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
