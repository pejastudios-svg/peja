"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type AudioCtx = {
  soundEnabled: boolean;
  setSoundEnabled: (v: boolean) => void;
  toggleSound: () => void;
};

const Ctx = createContext<AudioCtx | null>(null);
const KEY = "peja-sound-enabled-v1";

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [soundEnabled, setSoundEnabledState] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw === "1") setSoundEnabledState(true);
    } catch {}
  }, []);

  const setSoundEnabled = (v: boolean) => {
    setSoundEnabledState(v);
    try {
      sessionStorage.setItem(KEY, v ? "1" : "0");
    } catch {}
  };

  const toggleSound = () => setSoundEnabled(!soundEnabled);

  const value = useMemo(() => ({ soundEnabled, setSoundEnabled, toggleSound }), [soundEnabled]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAudio() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAudio must be used within AudioProvider");
  return ctx;
}