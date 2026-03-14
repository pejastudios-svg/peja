import { Share } from "@capacitor/share";

export async function shareUrl(opts: {
  title: string;
  text?: string;
  url: string;
}): Promise<"shared" | "copied" | "cancelled"> {
  const { title, text, url } = opts;

  const isCapacitor =
    typeof window !== "undefined" &&
    typeof (window as any).Capacitor !== "undefined" &&
    (window as any).Capacitor.isNativePlatform?.();

  // Native: use Capacitor Share (iOS + Android)
  if (isCapacitor) {
    try {
      await Share.share({
        title,
        text: text || title,
        url,
        dialogTitle: title,
      });
      return "shared";
    } catch {
      return "cancelled";
    }
  }

  // Web: try navigator.share
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err: any) {
      if (err?.name === "AbortError") return "cancelled";
    }
  }

  // Fallback: clipboard
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
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