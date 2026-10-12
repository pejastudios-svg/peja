"use client";

import { useEffect, useId } from "react";

/**
 * Freeze page scroll while something is open over it.
 *
 * Tracked as a SET of holders rather than a counter.
 *
 * A counter only works if every increment is matched exactly once. It
 * is not self-correcting: one unbalanced decrement, a double cleanup, a
 * component torn down mid-navigation, and the number never returns to
 * zero. The symptom is a page that stays unscrollable with nothing on
 * screen to close, and the only way out is a refresh. A set cannot drift
 * that way, because releasing the same holder twice is a no-op and the
 * styles come off the moment it is empty.
 */
const holders = new Set<string>();

function apply() {
  if (holders.size > 0) {
    // overflow hidden rather than position fixed, which shifts the page
    // under the iOS safe area.
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
  } else {
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
  }
}

let savedScrollY = 0;

export function useScrollFreeze(active: boolean) {
  const id = useId();

  useEffect(() => {
    if (!active) return;

    if (holders.size === 0) savedScrollY = window.scrollY;
    holders.add(id);
    apply();

    return () => {
      holders.delete(id);
      apply();
      if (holders.size === 0) window.scrollTo(0, savedScrollY);
    };
  }, [active, id]);
}

/**
 * Release every lock and unfreeze.
 *
 * A backstop for the case nothing else can catch: a route change that
 * unmounts the thing holding the lock in a way React does not run
 * cleanup for. Called on navigation, so a stuck page cannot outlive the
 * screen that caused it.
 */
export function releaseAllScrollFreezes() {
  if (holders.size === 0) return;
  holders.clear();
  apply();
}
