# v2 Messaging — Handoff

Purpose: pick this up cold and know exactly where things stand. Everything is current as of the last commit in this session.

The v2 chat lives entirely under [`apps/web/src/features/chat/`](.) plus the routes at [`apps/web/src/app/messages-v2/`](../../app/messages-v2/) and components at [`apps/web/src/components/messages-v2/`](../../components/messages-v2/). v1 (the old `/messages/[id]/page.tsx`) is untouched and still works — v2 is built alongside.

---

## 🔴 Current bugs (in priority order)

### 1. Voice note scrubber dot doesn't move during playback
**File**: [`apps/web/src/components/messages-v2/AudioBubble.tsx`](../../components/messages-v2/AudioBubble.tsx)

**State**: still broken after multiple attempts. Last attempt: always-on RAF poll reads `audioRef.current` *inside* the tick (was previously captured in closure on first run, which left a stale/null reference). Added `[audio-tick]` console logs at ~1 Hz when playing to make diagnosis possible.

**What to check next**:
- Open browser console while playing a voice note. Look for `[audio-tick]` logs.
- If logs **don't appear**: RAF effect isn't running. Verify `audioRef.current` is non-null at mount time. Inspect with React DevTools.
- If logs appear but **`paused: true`**: `togglePlay`'s `el.play()` is failing silently. Check for a rejected promise — wrap in `.then().catch(console.error)` rather than swallowing.
- If logs appear and **`paused: false` with advancing `currentTime`**: React isn't re-rendering. Check for memoization / `key` issues on AudioBubble.
- If `currentTime` advances but **`duration` is `Infinity` or `NaN`**: progressFraction becomes NaN → dot left=NaN%. Common with `webm` recordings that don't have a Cues block. Workaround: seek to a far position briefly on play to force the browser to compute duration.

**Code touchpoint**: [`AudioBubble.tsx`](../../components/messages-v2/AudioBubble.tsx) lines ~155–186 (RAF effect), and the `progressFraction` calc near the render.

### 2. Video bubble has no play indicator + tap doesn't play
**File**: [`apps/web/src/app/messages-v2/[id]/page.tsx`](../../app/messages-v2/[id]/page.tsx) — the bubble render block, around the `isVideo ? <video>` ternary.

**State**: I removed the big `▶` overlay in the earlier "fix video controls" pass and switched to `controls={!isPending && !isFailed}`. User reports tapping does nothing. Probable causes:
- Native HTML5 `<video controls>` requires the user to tap the actual control bar, not the poster image. On mobile that surface is small and the parent message bubble's click handler may be intercepting taps.
- Capacitor WebView on Android sometimes hides default video controls unless `playsinline` is set and the video is `muted` initially.
- Cloudinary URL might be returning the original instead of the transformed version if the delivery transform helper is failing silently.

**What to check next**:
- Add `onClick={(e) => e.stopPropagation()}` on the `<video>` element so the bubble's click handler doesn't eat the tap.
- Restore a small play overlay (similar to images) and make tap-to-play call `videoRef.current.play()` explicitly. Re-add a `useRef<HTMLVideoElement>` per bubble.
- Or: open a fullscreen video lightbox on tap (the way images do now) — that's the simpler UX and avoids inline-controls UX problems.
- Verify the Cloudinary delivery URL actually loads by pasting it from the console into a new tab. Should be the transformed URL with `q_auto:eco,f_auto,c_limit,h_720`.

**Code touchpoint**: [thread page bubble render](../../app/messages-v2/%5Bid%5D/page.tsx), the video branch inside `hasMedia &&` block.

### 3. (Possibly resolved, needs verification) Audio bubble layout "not centered"
**File**: [`AudioBubble.tsx`](../../components/messages-v2/AudioBubble.tsx)

**Last fix**: switched to CSS Grid where the play button spans both rows (`gridRow: 1 / 3`, `alignSelf: 'start'`) so its centre lands at the same Y as the waveform's centre. The cell below the play button is intentionally empty.

User hasn't re-confirmed since this commit. **Verify after fixing #1 and #2.**

---

## ✅ What's been built (by phase)

### Phase 1 — Core text messaging (shipped earlier in this session series)
- UUID-based optimistic sends (no temp-id → real-id swap)
- Postgres trigger for atomic conversation summary updates
- Realtime: messages INSERT/UPDATE, conversations UPDATE, conversation_participants UPDATE
- Cross-device + cross-user sync
- Read receipts (✓✓)
- Recently-cleared unread grace window (15s) so refetches don't bump stale counts back up
- Thread merge logic that preserves messages newer than fetch horizon
- Cross-device clock-skew handling: optimistic timestamp = `max(Date.now(), lastMessage + 1ms)`
- Files: [`store.ts`](store.ts), [`realtime.ts`](realtime.ts), [`useSendMessage.ts`](useSendMessage.ts), [`api.ts`](api.ts), [`useChatInit.ts`](useChatInit.ts)

### Phase 2 — Reliability + presence + indicators (shipped)
- **Drafts**: per-conversation, persisted to localStorage. "Draft:" preview on list page.
- **Offline send queue** ([`outbox.ts`](outbox.ts)): localStorage-backed, FIFO drain on online/visibility/SUBSCRIBED events. Max 5 auto-retries then waits for tap.
- **Tap-to-retry failed bubble**: pulls from outbox and replays via `retryOutboxItem`.
- **Reload-safe**: queued items rehydrate as failed bubbles on boot.
- **Online presence** ([`presence.ts`](presence.ts)): purple dot via Supabase Realtime Presence channel `peja-presence`. Single global channel (matches WhatsApp/Telegram defaults).
- **Header subtitle**: typing → online → last seen X ago.
- **Typing indicator** ([`useTypingChannel.ts`](useTypingChannel.ts)): per-conversation broadcast, throttled to 1/1.5s, 3s TTL on receiver.
- **In-thread pulsing icon**: chat-bubble icon when other typing, mic icon when other recording.
- **Cross-session last seen**: `users.last_seen_at` column + heartbeat ([`heartbeat.ts`](heartbeat.ts)) updating every 30s while foregrounded.

### Phase 3a — Images (shipped)
- Image picker (multi-select) on the input bar
- Pending thumbnails row with × to remove
- Optimistic bubble using blob: URLs (image renders instantly)
- Pre-measured natural width/height via `Image()` → `aspect-ratio` on container = no flicker
- Tap-to-expand lightbox
- Realtime media hydration: `handleMessageInsert` fetches `message_media` for incoming media messages
- Files: [`useSendMessage.ts`](useSendMessage.ts), [`mediaBlobs.ts`](mediaBlobs.ts) (IndexedDB blob store)

### Phase 3b — Videos (shipped)
- Picker accepts video files too
- Pending preview shows first-frame thumbnail via `<video preload="metadata">`
- Bubble renders inline `<video controls preload="metadata">`
- **BUG: tap doesn't play, see issue #2 above**
- Lightbox renders `<video controls autoPlay>` for video — broken since `controls` doesn't surface

### Phase 3 polish push (shipped)
**Compression / pipeline** ([`chatMedia.ts`](chatMedia.ts)):
- Image compression via `browser-image-compression` (longest edge → 1920px, target 500KB)
- HEIC → JPEG auto-conversion via lazy-imported `heic2any` so iPhone photos render on Android
- Video compression via Cloudinary's transcoding upload preset (existing lib at `apps/web/src/lib/mediaCompression.ts`)
- Audio just goes to Supabase Storage (small files)
- 50MB image / 100MB video / 25MB document caps with friendly toast on reject
- 90-second video duration cap (checked at pick time)

**Cloudinary delivery URL transforms**:
- Outgoing video URLs are rewritten to include `q_auto:eco,f_auto,c_limit,h_720` before being saved. First viewer triggers Cloudinary transcode; CDN-cached after.
- Video thumbnails: derived from Cloudinary URL via `so_0` start-offset transform, used as `<video poster>`.

**Circular upload progress ring** + **cancel button**:
- Per-message progress stored in `store.uploadProgressById[messageId]`
- SVG ring with `stroke-dashoffset` driven by 0..1 fraction
- X button inside the ring aborts the in-flight upload via AbortController
- For Cloudinary video uploads: AbortSignal threaded through `compressVideo` → cancels the XHR
- For Supabase storage uploads: SDK doesn't expose signal; bytes finish in background but UI removes the bubble immediately (orphan cleanup handles the leak)

**External link warning** ([`MessageText.tsx`](../../components/messages-v2/MessageText.tsx) + [`ExternalLinkWarningModal.tsx`](../../components/messages-v2/ExternalLinkWarningModal.tsx)):
- URL regex tokenises text content
- Tap a link → modal: "This link will take you to an outside site. Make sure you trust the sender..."
- Per-domain "remembered" set (`window.__pejaTrustedDomains`) so the same domain doesn't nag in the session
- Internal hosts (`peja.life`) skip the warning

**Conversation list rich previews**:
- Migration rewrites `peja_message_preview()` to return `📷 Photo` / `🎥 Video` / `🎙 Voice note` / `📎 File` based on the first attached media row

**Orphan storage cleanup**:
- `/api/cron/cleanup-orphan-chat-media/` route lists orphans via `peja_list_orphan_chat_media()` (SECURITY DEFINER), deletes via Storage API
- Auth: `?secret=<CRON_SECRET>` query or `Authorization: Bearer` header
- Scheduled via cron-job.org externally (NOT Vercel cron)

### Phase 3c — Voice notes (mostly shipped, has bug #1)
- **Recorder hook** ([`useVoiceRecorder.ts`](useVoiceRecorder.ts)): platform split — `capacitor-voice-recorder` on Android, `MediaRecorder` web fallback. Returns `start/stop/cancel`, `duration`, live `amplitude`.
- **Recorder bar** ([`VoiceRecorderBar.tsx`](../../components/messages-v2/VoiceRecorderBar.tsx)):
  - Hold mic → record, slide left to cancel, release to send
  - Short tap → enter locked hands-free mode with explicit Cancel + Send buttons
  - Replaces input bar when active
- **Audio bubble** ([`AudioBubble.tsx`](../../components/messages-v2/AudioBubble.tsx)):
  - CSS Grid layout: play button spans both rows on left, waveform + speed on top right, timer + meta on bottom right
  - Real waveform: decoded client-side via `AudioContext.decodeAudioData`, downsampled to 32 bars, cached per URL
  - Speed cycling (1× / 1.5× / 2×)
  - Drag-to-seek scrubber dot (pointer events with `setPointerCapture`)
  - **BUG: dot doesn't move during playback, see issue #1**
- **Realtime "recording" indicator**: typing channel now broadcasts both `typing` and `recording` events with shared 3s TTL
- **In-thread pulsing icon**: chat-bubble (typing) vs mic (recording)
- **2-minute hard cap** with auto-stop + toast

---

## 🟡 Remaining work

### Phase 3d — Documents / files
Just files. No compression (files are typically already compressed). Generic icon + filename + filesize + tap-to-open. 25MB cap already enforced.

### Phase 4 — Interactions
- Reply to message (quoted reference bubble)
- React with emoji
- Edit message (NO time limit per user instruction — open-ended)
- Delete for me / Delete for everyone
- Copy / Forward
- Long-press action menu
- Swipe-to-reply gesture

### Phase 5 — Chat info / moderation
- Other-user profile pic in the thread header (user requested)
- Chat menu (kebab) in the header (user requested)
- View shared media / files (gallery)
- Mute notifications (1h / 8h / 1d / forever)
- Block user
- Report user

### Phase 6 — UX polish
- **Light mode bubble color fix** (user requested — sender bubble is white-on-white in light mode currently)
- Date separators ("Today", "Yesterday", explicit dates)
- Unread divider line
- Scroll to a specific message from reply preview
- Bubble alignment refinements for stacked attachments

### Phase 7 — Search & performance
- Search within a chat
- Search across all chats
- Message pagination (load older on scroll-up)
- IndexedDB warm-start cache (so opening a chat shows last-known-good state instantly while realtime catches up)

### Cross-phase / new requests from this session
- **Group chats** (user explicitly added to scope)
- **Incident link previews in chat** (pasting an incident URL renders a preview card)
- **VIP-only "send to chat" button on PostCards / post detail** (so a VIP can forward an incident into a chat)
- **SOS native SMS** (regardless of online state, ideally auto-fill recipients from emergency contacts)
- **SML and incident-report SMS** (only when offline)
- **Offline mode for SOS / SML / incident reports** — same outbox pattern as messages, drains on reconnect. User said: "for the sos, sml and incident reporting part, we can do that when we're done fully with the messaging part."

### Deferred (NOT doing yet, per user)
- Voice / video calls (huge undertaking, separate phase)
- End-to-end encryption

---

## 📦 Database migrations status

Located at [`apps/web/supabase/migrations/`](../../../supabase/migrations/). Apply in order, idempotent.

| Migration | Status | Notes |
|---|---|---|
| `20260524_messages_update_conversation_trigger.sql` | applied | `peja_sync_conversation_from_message` trigger — atomic conversation summary updates |
| `20260525_users_last_seen_at.sql` | **needs verification** | Adds `users.last_seen_at`. Heartbeat writes here every 30s |
| `20260526_messages_preview_by_media_type.sql` | **needs verification** | Rewrites `peja_message_preview()` for rich previews |
| `20260527_cleanup_orphan_chat_media.sql` | applied (current version) | Just drops the previously-broken cleanup function. Safe to re-apply. |
| `20260528_list_orphan_chat_media.sql` | **needs to be applied** | `peja_list_orphan_chat_media()` SECURITY DEFINER function for the cron route |

To verify a migration is applied, query: `select proname from pg_proc where proname like 'peja_%';`

---

## 🔑 Environment variables

| Variable | Purpose | Where set |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Vercel + `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Vercel + `.env.local`. **Watch for trailing newlines** — that's what broke prod realtime earlier in this session series. |
| `SUPABASE_SERVICE_ROLE_KEY` | For admin routes | Vercel only |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Cloudinary account | Vercel + `.env.local` |
| `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | Cloudinary unsigned preset | Vercel + `.env.local` |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | For destroy route | Vercel only |
| `CRON_SECRET` | Auth for cron endpoints | Vercel (Production + Preview). Not in `.env.local` unless testing locally. |

---

## 🪣 Storage / Cloudinary setup

**Supabase Storage bucket `message-media`** — must be PUBLIC for `getPublicUrl()` to return readable URLs. This was a bug that took an hour to find earlier (RLS on the bucket → blank image bubbles). If chat media stops loading after a deploy, check the bucket's public toggle first.

**Cloudinary**:
- Account configured
- Unsigned upload preset configured (used by `compressVideo` in `apps/web/src/lib/mediaCompression.ts`)
- Existing preset config is fine; no transformations needed in the preset since we apply them via delivery URL

---

## ⏰ Cron job setup

Using **cron-job.org** (not Vercel cron). Existing job:
- `https://peja.life/api/cron/checkin-monitor/?secret=...` — SOS / SML check-in monitor
  - Schedule: every minute (`* * * * *`). Unchanged — internals were batched/bounded
    but the URL, GET method, and `?secret=` auth are the same.

Add these (currently missing):
- `https://peja.life/api/cron/cleanup-orphan-chat-media/?secret=YOUR_CRON_SECRET`
  - Schedule: `0 3 * * *` (daily 03:00 UTC)
- `https://peja.life/api/jobs/expire/?secret=YOUR_CRON_SECRET`
  - Schedule: `0 * * * *` (hourly). REQUIRED: expiry used to be triggered from the
    client on every feed visit; that was removed, so posts/SOS/check-ins now only
    auto-resolve when this cron runs.
- `https://peja.life/api/cron/analytics-retention/?secret=YOUR_CRON_SECRET`
  - Schedule: `0 3 * * *` (daily). Prunes app_events / user_sessions / old SOS
    notifications so those tables don't grow forever.

All: Method GET, no headers needed (secret is in the query string).

**Trailing slash before `?` is load-bearing** — `next.config.ts` has `trailingSlash: true` which 308-redirects URLs without the slash.

NOTE: do NOT also schedule these via Supabase pg_cron or Vercel cron — cron-job.org
is the single scheduler. Double-scheduling would run the check-in monitor twice a minute.

---

## 📂 Key files

### Feature root (`apps/web/src/features/chat/`)
- [`store.ts`](store.ts) — Zustand store, all chat state
- [`types.ts`](types.ts) — `ChatMessage`, `ChatMessageMedia`, `OutboxItem`, etc.
- [`api.ts`](api.ts) — Supabase data layer (fetch conversation list, fetch thread, send text, send media, mark read)
- [`realtime.ts`](realtime.ts) — Supabase Realtime channel setup
- [`presence.ts`](presence.ts) — global online-presence channel
- [`heartbeat.ts`](heartbeat.ts) — periodic `users.last_seen_at` writes
- [`outbox.ts`](outbox.ts) — localStorage-backed send queue
- [`mediaBlobs.ts`](mediaBlobs.ts) — IndexedDB blob store for queued media
- [`chatMedia.ts`](chatMedia.ts) — pipeline: validate → HEIC → compress → Cloudinary or storage
- [`useChatInit.ts`](useChatInit.ts) — boot hook (realtime + presence + heartbeat + outbox drain)
- [`useSendMessage.ts`](useSendMessage.ts) — primary send entrypoint, `cancelInflightSend`
- [`useOutboxDrain.ts`](useOutboxDrain.ts) — drain on online / visibility / SUBSCRIBED
- [`useTypingChannel.ts`](useTypingChannel.ts) — per-conversation typing + recording broadcast
- [`useVoiceRecorder.ts`](useVoiceRecorder.ts) — platform-aware recorder hook

### Components (`apps/web/src/components/messages-v2/`)
- [`MessageText.tsx`](../../components/messages-v2/MessageText.tsx) — text with linkified URLs + external-link warning
- [`ExternalLinkWarningModal.tsx`](../../components/messages-v2/ExternalLinkWarningModal.tsx) — the warning modal
- [`VoiceRecorderBar.tsx`](../../components/messages-v2/VoiceRecorderBar.tsx) — recording input bar
- [`AudioBubble.tsx`](../../components/messages-v2/AudioBubble.tsx) — voice note player ← **has bug #1**

### Routes
- [`apps/web/src/app/messages-v2/page.tsx`](../../app/messages-v2/page.tsx) — conversation list
- [`apps/web/src/app/messages-v2/[id]/page.tsx`](../../app/messages-v2/%5Bid%5D/page.tsx) — thread view ← **has bug #2 in the video branch**
- [`apps/web/src/app/api/cron/cleanup-orphan-chat-media/route.ts`](../../app/api/cron/cleanup-orphan-chat-media/route.ts) — orphan cleanup cron

### Migrations (`apps/web/supabase/migrations/`)
See table above.

### Shared media lib (used by both v2 chat AND v1 post creation)
- `apps/web/src/lib/mediaCompression.ts` — `compressImage`, `compressVideo`, `validateMediaFile`, `getVideoDuration`. Has `AbortSignal` support for `compressVideo` (added this session).

---

## 🧪 How to verify everything works after picking back up

1. **Type check**: `cd apps/web && npx tsc --noEmit`
2. **Voice note** (the broken case): record, send to yourself via `/messages-v2`, tap play. Open console — look for `[audio-tick]` logs. Paste back the log values.
3. **Video send**: pick a video, send, wait for the upload ring to finish. Tap the bubble. Should play. (Currently broken.)
4. **Image send**: pick a photo, send. Should appear instantly via blob URL, then swap to public URL after upload.
5. **Cancel button**: pick a large video (>50MB will trigger the size cap; ~30MB to actually try cancelling), tap the X inside the upload ring. Should disappear.
6. **External link**: paste `https://google.com` into a message, send, tap the link in the rendered bubble. Should show the warning.
7. **Drafts**: type "hello", navigate away, come back. Draft restored.
8. **Cleanup cron**: `curl "https://peja.life/api/cron/cleanup-orphan-chat-media/?secret=YOUR_SECRET"`. Should return `{"ok":true,"orphans_found":N,"deleted":N}`.

---

## 📝 Operational notes / lessons from this session

- **The "messages send on localhost but not on prod" bug** was caused by a trailing newline (`%0A`) in `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel's env settings. Found by inspecting the WSS URL in Network tab. If realtime breaks in prod, check this first.
- **Empty image bubbles** after upload: caused by RLS allowing INSERT but blocking the implicit `RETURNING` from `.select()`. Fix: don't trust the SELECT after INSERT — build the response client-side from input. Pattern is in `sendMediaMessage` in [`api.ts`](api.ts).
- **`trailingSlash: true`** in `next.config.ts` means every API URL needs the slash before `?`. Already bit us once.
- **Don't delete `storage.objects` from SQL** — Supabase's `protect_delete()` trigger blocks it. Always go through the Storage API (`supabase.storage.from(...).remove(...)`).
- **`[]` is truthy in JS** — `{ media: [] }` overwrites a populated media array via spread. Always check `arr && arr.length > 0` before spreading conditionally.
- **Capacitor WebView quirks**: some builds drop `play` and `timeupdate` events silently. Polling on RAF is more reliable than events.

---

## 🎯 Next session — recommended pickup order

1. Fix bug #1 (voice note dot) — use the `[audio-tick]` logs to diagnose
2. Fix bug #2 (video play) — switch to lightbox-on-tap, simpler than fighting native controls
3. Apply remaining migrations (verify each is applied, run any that aren't)
4. Add the cron-job.org schedule for cleanup
5. Phase 3d (files) — small, finishes Phase 3
6. Phase 4 (interactions) — big, multiple sessions

Don't skip steps 1–2. They're small enough to ship before Phase 4.
