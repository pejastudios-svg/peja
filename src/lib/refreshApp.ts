// User-facing "Refresh App" action. The auto-update flow in
// ServiceWorkerRegistration.tsx already covers the normal case (open app,
// new SW installs, page reloads on controllerchange). This is the manual
// escape hatch for the deploy window where the old SW is still in control
// and the user wants the fix RIGHT NOW.
//
// Order matters:
//   1. Clear localStorage caches that survive a reload (feed, pending).
//   2. Tell the SW to nuke its caches (peja-*-v*).
//   3. Ask the SW for the latest sw.js bytes (registration.update).
//   4. Reload the page.

export async function refreshApp(): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    // 1. Drop the localStorage feed + pending-deletes overlay so the next
    //    load fetches from network with a clean slate.
    localStorage.removeItem("peja-feed-v2");
    localStorage.removeItem("peja-feed-pending-v1");
  } catch {
    // localStorage can throw in private-browsing modes; carry on.
  }

  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      // 2. Purge all SW caches. The SW handler at sw.js exists already.
      if (reg?.active) reg.active.postMessage("clearCache");
      // 3. Pull the latest sw.js. If a newer one exists, the install +
      //    skipWaiting flow takes over and controllerchange fires a reload.
      await reg?.update();
    } catch {
      // SW could be unregistered (dev mode, etc) — just reload.
    }
  }

  // 4. Belt-and-braces reload in case controllerchange didn't fire
  //    (e.g. SW already at the latest version, nothing to upgrade to).
  window.location.reload();
}
