"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => {},
  toggle: () => {},
});

const STORAGE_KEY = "peja-theme";

function readStored(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "dark";
}

// Push the theme to the native Android/iOS status bar so the system chrome
// (clock, signal, battery icons) stays readable when the user toggles light/dark.
function syncNativeStatusBar(theme: Theme) {
  if (typeof window === "undefined") return;
  if ((window as any).Capacitor === undefined) return;
  import("@capacitor/status-bar")
    .then(({ StatusBar, Style }) => {
      const bg = theme === "light" ? "#ffffff" : "#0c0818";
      StatusBar.setBackgroundColor({ color: bg }).catch(() => {});
      StatusBar.setStyle({ style: theme === "light" ? Style.Light : Style.Dark }).catch(() => {});
    })
    .catch(() => {});
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const initial = readStored();
    setThemeState(initial);
    document.documentElement.setAttribute("data-theme", initial);
    syncNativeStatusBar(initial);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    document.documentElement.setAttribute("data-theme", next);
    syncNativeStatusBar(next);
  };

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
