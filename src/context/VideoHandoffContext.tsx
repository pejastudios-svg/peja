"use client";

import React, { createContext, useContext, useRef, useMemo, useCallback } from "react";

/**
 * VideoHandoffContext
 *
 * Allows InlineVideo and VideoLightbox to share playback state seamlessly.
 *
 * Flow:
 *   1. InlineVideo calls `beginExpand(src, currentTime, posterDataUrl)` when user taps expand
 *   2. VideoLightbox reads `getHandoff()` on mount to get the start time + poster
 *   3. VideoLightbox calls `returnTime(src, currentTime)` when it closes
 *   4. InlineVideo calls `getReturnTime(src)` to resume from where lightbox left off
 */

interface HandoffData {
  src: string;
  currentTime: number;
  posterDataUrl: string | null;
  timestamp: number;
}

interface ReturnData {
  src: string;
  currentTime: number;
  timestamp: number;
}

interface VideoHandoffContextType {
  beginExpand: (src: string, currentTime: number, posterDataUrl: string | null) => void;
  getHandoff: () => HandoffData | null;
  clearHandoff: () => void;
  returnTime: (src: string, currentTime: number) => void;
  getReturnTime: (src: string) => number | null;
  clearReturnTime: (src: string) => void;
}

const Ctx = createContext<VideoHandoffContextType | null>(null);

export function VideoHandoffProvider({ children }: { children: React.ReactNode }) {
  const handoffRef = useRef<HandoffData | null>(null);
  const returnRef = useRef<ReturnData | null>(null);

  const beginExpand = useCallback(
    (src: string, currentTime: number, posterDataUrl: string | null) => {
      handoffRef.current = {
        src,
        currentTime,
        posterDataUrl,
        timestamp: Date.now(),
      };
    },
    []
  );

  const getHandoff = useCallback(() => {
    const data = handoffRef.current;
    if (!data) return null;
    // Only valid for 5 seconds
    if (Date.now() - data.timestamp > 5000) {
      handoffRef.current = null;
      return null;
    }
    return data;
  }, []);

  const clearHandoff = useCallback(() => {
    handoffRef.current = null;
  }, []);

  const returnTime = useCallback((src: string, currentTime: number) => {
    returnRef.current = {
      src,
      currentTime,
      timestamp: Date.now(),
    };
  }, []);

  const getReturnTime = useCallback((src: string) => {
    const data = returnRef.current;
    if (!data) return null;
    // Only valid for 5 seconds and must match the same video
    if (Date.now() - data.timestamp > 5000) {
      returnRef.current = null;
      return null;
    }
    if (data.src !== src) return null;
    return data.currentTime;
  }, []);

  const clearReturnTime = useCallback((src: string) => {
    if (returnRef.current?.src === src) {
      returnRef.current = null;
    }
  }, []);

  const value = useMemo(
    () => ({
      beginExpand,
      getHandoff,
      clearHandoff,
      returnTime,
      getReturnTime,
      clearReturnTime,
    }),
    [beginExpand, getHandoff, clearHandoff, returnTime, getReturnTime, clearReturnTime]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVideoHandoff() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useVideoHandoff must be used within VideoHandoffProvider");
  return ctx;
}