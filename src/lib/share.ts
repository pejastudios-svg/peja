import { Share } from "@capacitor/share";

/**
 * Share a URL using native share sheet on mobile (Capacitor)
 * or navigator.share on web, with clipboard fallback.
 *
 * Returns: "shared" | "copied" | "cancelled"
 */
export async function shareUrl(opts: {
  title: string;
  text?: string;
  url: string;
}): Promise<"shared" | "copied" | "cancelled"> {
  const { title, text, url } = opts;

  // Try Capacitor native share first (works on iOS + Android)
  const isCapacitor =
    typeof window !== "undefined" &&
    typeof (window as any).Capacitor !== "undefined" &&
    (window as any).Capacitor.isNativePlatform?.();

  if (isCapacitor) {
    try {
      await Share.share({
        title,
        text: text || title,
        url,
        dialogTitle: title,
      });
      return "shared";
    } catch (err: any) {
      // User cancelled
      if (err?.message?.includes("cancel") || err?.message?.includes("dismiss")) {
        return "cancelled";
      }
      // Fall through to web share
    }
  }

  // Web: try navigator.share
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err: any) {
      if (err?.name === "AbortError") return "cancelled";
      // Fall through to clipboard
    }
  }

  // Fallback: clipboard
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    // Final fallback
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.left = "-999999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return "copied";
  }
}