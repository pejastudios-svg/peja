"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  setTheme: () => {},
  toggle: () => {},
});

const STORAGE_KEY = "peja-theme";

function readStored(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "light";
}

// Push the theme to the native layer:
//  - status bar chrome (clock, signal, battery) stays readable on toggle
//  - persist to native Preferences so the NEXT cold launch can paint the
//    splash + WebView background in the user's theme before the web layer
//    boots. Without this, light-mode users see the hard-coded dark splash
//    flash on every open. MainActivity reads STORAGE_KEY from native storage.
function syncNativeTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  if ((window as any).Capacitor === undefined) return;
  import("@capacitor/status-bar")
    .then(({ StatusBar, Style }) => {
      const bg = theme === "light" ? "#ffffff" : "#0c0818";
      StatusBar.setBackgroundColor({ color: bg }).catch(() => {});
      StatusBar.setStyle({ style: theme === "light" ? Style.Light : Style.Dark }).catch(() => {});
    })
    .catch(() => {});
  import("@capacitor/preferences")
    .then(({ Preferences }) => {
      Preferences.set({ key: STORAGE_KEY, value: theme }).catch(() => {});
    })
    .catch(() => {});
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const initial = readStored();
    setThemeState(initial);
    document.documentElement.setAttribute("data-theme", initial);
    syncNativeTheme(initial);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    document.documentElement.setAttribute("data-theme", next);
    syncNativeTheme(next);
  };

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
