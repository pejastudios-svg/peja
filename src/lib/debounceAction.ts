/**
 * Creates a debounced action — like TikTok likes.
 * UI updates instantly, but the actual API call only fires
 * after the user stops tapping for `delayMs`.
 *
 * Usage:
 *   const debouncedConfirm = createDebouncedAction(500);
 *   debouncedConfirm(postId, () => supabase.rpc("toggle_post_confirmation", ...));
 */

const timers = new Map<string, NodeJS.Timeout>();

export function createDebouncedAction(delayMs: number = 400) {
  return (key: string, action: () => Promise<any>) => {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);

    timers.set(
      key,
      setTimeout(async () => {
        timers.delete(key);
        try {
          await action();
        } catch {
          // handled by caller
        }
      }, delayMs)
    );
  };
}
