import type { MetadataRoute } from "next";

// Web app manifest: makes peja.life installable (Android Chrome install
// prompt + iOS Add to Home Screen standalone mode). Without this the
// install banner's beforeinstallprompt never fires and iOS opens the
// "app" as a browser tab.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "peja",
    short_name: "peja",
    description: "Your people, on one safe map",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0612",
    theme_color: "#7c3aed",
    orientation: "portrait",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
