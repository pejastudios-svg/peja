let ctx: AudioContext | null = null;

export function ensureNotificationAudioUnlocked() {
  if (typeof window === "undefined") return false;

  try {
    if (!ctx) {
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!AC) return false;
      ctx = new AC();
    }
    if (ctx.state === "suspended") {
      // must be called from a user gesture at least once
      ctx.resume().catch(() => {});
    }

    // flag so we can safely play later
    (window as any).__pejaNotifAudioUnlocked = true;
    return true;
  } catch {
    return false;
  }
}

export function playNotificationSound() {
  if (typeof window === "undefined") return;

  // Only play if the browser has been "unlocked" by user gesture
  if (!(window as any).__pejaNotifAudioUnlocked) return;

  try {
    if (!ctx) {
      // If somehow not created yet, try creating now
      ensureNotificationAudioUnlocked();
    }
    if (!ctx) return;
    if (ctx.state === "suspended") return;

    // Short, clean “security beep” (no external asset)
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = "sine";
    o.frequency.value = 880;

    g.gain.value = 0;
    o.connect(g);
    g.connect(ctx.destination);

    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    o.start(t);
    o.stop(t + 0.14);
  } catch {
    // ignore
  }
}