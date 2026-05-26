# Chat. State & Handoff

Last updated: 2026-05-23

This doc replaces the old "Chat v2" state doc. The v1 chat has been deleted and the v2 implementation is now the only chat. Anywhere this file says "the chat", it means the single implementation at [`/messages`](../../app/messages/).

## TL;DR

- v1 is gone. There is one chat, mounted at `/messages` and `/messages/[id]`.
- Notification system is shipped end to end: realtime publication, server RPC for the DM/group fanout, digest rotation, in-chat suppression (including digest type), and FCM push for individual messages. Toast latency on a slow client/Supabase link is ~700-1000ms (was ~6.8s before the optimization arc).
- Chat list rows show mute/blocked status inline and update with the other party's "typing.." / "recording.." in realtime.
- Voice recorder is WhatsApp-style: hold-to-record with persistent mic DOM node (setPointerCapture survives state changes), tap-to-lock, slide-up-to-lock-hands-free, slide-left-to-trash with arc-into-can animation. Loading spinner on receiver playback while audio buffers.
- Slide-to-reply works on every bubble with a damped translation, armed icon hint, and proper Android touch-action handling.
- Pin is one-per-conversation with a swap-confirm dialog. Pins sync across devices via realtime UPDATE.
- Forward sheets sit at z-[10001] so they cover the post-modal overlay (FullScreenModalShell uses z-9999).
- Admin `/admin/vips` supports bulk MVP/VIP grant + revoke via a sticky bottom bar.
- Em dashes are banned in any user-facing string. See `~/.claude/projects/-Users-mac-Desktop-peja-app/memory/MEMORY.md` for the convention.

## Architecture overview

```
src/app/messages/                    Route surface. List page + thread page.
src/components/messages-v2/          UI components. Folder name still says "v2"
                                     for now (cleanup item below).
src/components/messages/             VoiceNotePlayer ONLY (used by admin/sos +
                                     map surfaces). Other v1 files deleted.
src/features/chat/                   Hooks, store (Zustand), realtime layer,
                                     API wrappers, outbox / drain, voice
                                     recorder. Most of the logic lives here.
src/components/chat/ChatBootstrap    Tiny component mounted at root that calls
                                     useChatInit() once globally. Replaces v1's
                                     MessageCacheProvider.
src/app/api/notify-social            Server route for DM + social notifications.
                                     Calls peja_notify_dm RPC for DMs.
supabase/migrations/                 Notification publication, indexes, and
                                     peja_notify_dm function live here (see
                                     20260608 / 20260609 / 20260610).
```

The chat store (`features/chat/store.ts`) is the single source of truth on the client. `ChatBootstrap` mounts `useChatInit` at the layout level so the conversation list, realtime channels, presence, and outbox drain are alive on every page (the unread-count badge in the header depends on this).

## Notification flow end-to-end

For a DM send:

1. Sender calls `useSendMessage`. After the message INSERT confirms, it fires `notifyDMMessage(recipientId, ...)` (fire-and-forget).
2. `notifyDMMessage` POSTs to `/api/notify-social` with `kind: "dm_message"`.
3. The route authenticates via `requireUser`. JWT is verified locally with `SUPABASE_JWT_SECRET` (no GoTrue round trip) when the env var is set; otherwise falls back to `auth.getUser`.
4. The route calls `admin.rpc("peja_notify_dm", { ... })`. The RPC runs the mute check, the digest decision, the delete-old-digest-if-any, and the new INSERT in one transaction.
5. The INSERT into `public.notifications` fires the receiver's `postgres_changes` listener on the realtime publication.
6. `InAppNotificationToasts` (mounted at the root) receives the INSERT event. It suppresses the toast if the receiver is currently in that conversation (`window.__pejaActiveConversationId === data.conversation_id`); otherwise it renders the toast and dispatches a `peja-notifications-changed` event so the header badge refetches.
7. The route, after the RPC, fires `sendPushToUser` for individual delivery_mode (post-toast, doesn't extend perceived latency).

For a group send, the sender's `useSendMessage` fans out one POST per recipient and uses the same path per recipient.

## Mute behavior (non-obvious)

`notification_mode` (column on `conversation_participants`, added in `20260606`) is the source of truth. Values: `all` / `mentions` / `muted`. Defaults to `all` NOT NULL.

The legacy `is_muted` boolean is kept in lock-step by the `peja_conv_set_notification_mode` RPC but is **no longer respected by itself**. Setting `is_muted = true` while leaving `notification_mode = 'all'` does NOT suppress notifications: the RPC's check is `notification_mode = 'muted' OR (notification_mode IS NULL AND is_muted)`, and since the column is NOT NULL after the migration, the legacy fallback never fires.

Every mute toggle in the app (chat list kebab, in-chat header kebab, chat info sheet) calls `setNotificationMode` now. The `setMuted` legacy helper has been deleted.

In-chat toast suppression matches the chat's `conversation_id` and the `__pejaActiveConversationId` window global. It suppresses three notification types: `dm_message`, `dm_reaction`, and `dm_message_digest`. Forgetting the third one let digest toasts leak through when the user was in the chat.

## Performance characteristics

Toast latency (sender click to receiver toast) on a slow client link with ~700ms RTT:

| State | Toast latency |
|---|---|
| Original (sequential REST calls, GoTrue auth) | ~6.8s |
| + Local JWT verify (skip GoTrue) | ~5.8s |
| + JSONB partial indexes on notifications | ~5.2s |
| + Parallel mute + lookup queries | ~3.8s |
| + Single RPC (peja_notify_dm) | **~700-1000ms** |

On a normal-latency network (~50-100ms RTT) the route completes in well under 300ms.

Notable optimizations in place:
- `idx_notifications_user_type_conv_unread` and `idx_notifications_user_type_post_unread` partial indexes on `(user_id, type, data->>'conversation_id'/'post_id') WHERE is_read = false` (migration `20260609`). Confirmed via EXPLAIN ANALYZE that the planner uses them.
- `idx_conv_participants_conv_user` for the mute check select.
- Local JWT verification in [`_auth.ts`](../../app/api/_auth.ts) using `jose@4.15.9` (already transitively present, no new dep).
- Single RPC `peja_notify_dm` (migration `20260610`) collapses 4 REST calls into 1.

## Voice recorder (WhatsApp-style)

[`VoiceRecorderBar.tsx`](../../components/messages-v2/VoiceRecorderBar.tsx). Full architecture rewrite to fix mobile gesture reliability.

- **Persistent mic DOM node.** The `<button>` stays mounted across `idle → holding → locked → trashing → sending` state transitions. Trash, recording-bubble, and Send overlay it as siblings. The previous version unmounted the button on state change, which dropped `setPointerCapture` and broke release-detection on mobile.
- **`stateRef` for handler guards.** Pointer handlers read from `stateRef.current` instead of closure-captured `state`, so a fast tap that fires `pointerdown + pointerup` in the same frame still works on Android (the stale closure used to bail with `state==="idle"` and silently swallow the first tap).
- **Tap detection by setTimeout, not arithmetic.** `tapTimerRef` flips `isHoldRef = true` after `TAP_MAX_MS` (500ms). On `pointerup`, the ref decides tap vs hold. The earlier `Date.now() - startTime` math was unreliable on Capacitor WebViews where event-loop scheduling stretched perceived "held" time past the threshold.
- **Three gestures off `pointerdown`:** slide UP past 50px → enter locked, slide LEFT past 70px → arc-into-trash animation with lid pivot + dust puffs + can shake, release in place → send. Locked mode keeps recording hands-free with explicit Send/Trash buttons.
- **`mr.start()` with no timeslice.** iOS WKWebView's MediaRecorder produces malformed MP4 files when called with timeslice: invalid moov atom, flat waveform, unplayable. Bare `start()` emits one `dataavailable` on `stop()` with a properly-formed file. Android WebM is unaffected.
- **Web Animations cancelled on idle.** Trash animation runs with `fill: forwards` which would otherwise lock the bubble at the off-screen final state. `enterIdle` calls `bubbleRef.current.getAnimations().forEach(a => a.cancel())` + clears inline transform/opacity so subsequent recordings render properly.

Playback ([`AudioBubble.tsx`](../../components/messages-v2/AudioBubble.tsx)):

- **`<audio>` parked offscreen, not `display:none`.** iOS WebKit silently drops audio tracks from non-laid-out elements. Offscreen positioning keeps the element "rendered" without consuming layout.
- **`preload="auto"` + `playsInline`.** Metadata-only preload stalls on iOS. Auto fetches enough to start playing immediately on tap.
- **Skip duration-fix seek on iOS.** The `el.currentTime = 1e10` trick to force end-of-file duration discovery stalls WebKit's seek pipeline. iOS keeps `duration: Infinity`; the scrubber dot stays inert but playback works.
- **Loading spinner.** `isLoading` set optimistically on `togglePlay`, cleared on `playing` event. Bubbles also listen for `waiting` (mid-playback buffer starvation) to flash the spinner again. UI priority: spinner > pause > play.

## Slide-to-reply

[`useSwipeToReply.ts`](useSwipeToReply.ts) + the reply-icon hint in [`MessageBubbleWrapper`](../../app/messages/[id]/page.tsx).

- **Direction lock + damping.** Bubble follows finger at 50% pace so the reply icon has room to fade in before commit.
- **Progress (0..1) returned from the hook.** Saturates at 1 at the commit point. Icon renders with two tiers: below threshold = translucent primary background, above = solid primary + white icon + scale bump.
- **`touch-action: pan-y` on the bubble wrapper.** Critical on Android: Chrome WebView grabs touch ownership for vertical scroll arbitration unless the element explicitly opts horizontal motion to JS, which used to cancel the gesture mid-stream.
- **`VERTICAL_CANCEL = 16`** (was 8). Deliberate sideways drags pick up 10–14px of vertical drift before settling. Old threshold ate real swipes on Android.

## Chat list polish

All in [`ChatListRow.tsx`](../../components/messages-v2/ChatListRow.tsx) unless noted:

- Mute icon (`BellOff`) inline next to timestamp when `notification_mode === 'muted'` or `is_muted` is true.
- Blocked icon (`Ban`, red) inline for DMs where `is_blocked` is true.
- Typing/recording state in the preview line. Driven by [`useListTypingChannels`](useListTypingChannels.ts) hook mounted on the list page that opens a `typing:${convId}` broadcast channel per conversation so the row updates in realtime, not only after the user enters the thread.
- Toast banners stack as layered cards (newest in front, older peek behind with scale + opacity fade). Capped at 3 simultaneous. See [`InAppNotificationToasts.tsx`](../../components/notifications/InAppNotificationToasts.tsx).

## Other UI / UX shipped

- **Sheet headers respect safe-area-top.** [`NewDMSheet`](../../components/messages-v2/NewDMSheet.tsx), [`GroupCreatorSheet`](../../components/messages-v2/GroupCreatorSheet.tsx), [`SearchAllChatsSheet`](../../components/messages-v2/SearchAllChatsSheet.tsx), [`ChatInfoSheet`](../../components/messages-v2/ChatInfoSheet.tsx), [`IncidentForwardSheet`](../../components/messages-v2/IncidentForwardSheet.tsx), and [`ForwardSheet`](../../components/messages-v2/ForwardSheet.tsx). Headers don't sit under the notch / status bar.
- **Forward sheets z-[10001].** Both forward sheets portal to body at z-[10001] so they cover the post detail modal (FullScreenModalShell at z-9999 from the `@modal/(.)post/[id]` intercepting route).
- **MessageActionMenu bottom margin.** Re-clamps position when emoji picker expands so all rows stay visible. Bottom-edge clamp uses `BOTTOM_MARGIN = 72` for breathing room above the home indicator.
- **Pin: one per conversation.** Pinning a new message when one is already pinned opens a confirm dialog ("Unpin X, pin Y?"). Pin state syncs across devices because the realtime UPDATE handler now patches `is_pinned` + `pinned_at` (it used to drop those fields).
- **Pinned banner full-bleed.** Uses `width: 100vw` + `marginLeft/Right: calc(50% - 50vw)` so it spans edge-to-edge regardless of parent padding.
- **Desktop chevron action button is touch-inert.** `pointer-events-none group-hover:pointer-events-auto` so accidental taps on the top corner of bubbles on mobile no longer trigger the menu.
- **In-chat suppression covers v2.** `window.__pejaActiveConversationId` is set/cleared in the v2 thread page mount/unmount, mirroring v1's MessageCacheContext convention.
- **Header title.** "Messages (v2)" → "Messages".
- **Composer placeholder positioning** (`pt-3 pb-1`) so the "Message" placeholder sits visually centered against the iOS-forced 16px input font-size.

## Admin tools

`/admin/vips` supports bulk MVP/VIP toggles. Click "Select" in the top-right to enter select mode: rows swap their crown badge for a checkbox, per-row action buttons hide, and a sticky bottom bar exposes Make MVP / Make VIP / Revoke MVP / Revoke VIP. Batch runs are parallel (`Promise.allSettled`), refetch once at the end, and report aggregate results in a toast (e.g. "MVP granted for 4, 1 failed").

SOS button:
- VN record row themed via `var(--glass-input-bg)` + `var(--glass-border)` (matches incident-type buttons). Used to be hardcoded `#ffffff` which was painfully bright on dark mode.

## Migrations applied (chat + notifications)

| Migration | Purpose |
|---|---|
| `20260605_group_chats.sql` | Groups schema + RPCs |
| `20260606_group_chat_features.sql` | `notification_mode`, pin, system messages, per-message reports |
| `20260607_fix_group_triggers_and_system_messages.sql` | Trigger fixes |
| `20260608_notifications_realtime_publication.sql` | Adds `notifications` to `supabase_realtime` |
| `20260609_notifications_perf_indexes.sql` | JSONB partial indexes |
| `20260610_peja_notify_dm.sql` | Single-RPC DM notification dispatcher |

## What's next (priority order)

### 1. SOS / SML SMS + offline outbox  (BIG, primary next workstream)

Was named the "biggest remaining workstream" in the pre-cutover handoff and is the only feature item left. Concrete questions to nail down before writing code:

- Recipients: just emergency contacts? Guardians too? Geographic-radius opt-in users?
- SMS provider: Twilio? Africa's Talking (best Nigeria coverage / pricing)? Vonage?
- "Offline outbox" semantics: does the alert queue locally and ship when network returns, or does SMS act as fallback when realtime push fails?
- "SML": confirm what this stands for and how it differs from SOS. Send-My-Location?
- Delivery confirmation / retry policy.
- Per-user rate-limit + abuse prevention.

Patterns to reuse from chat: [`outbox.ts`](outbox.ts) + [`useOutboxDrain.ts`](useOutboxDrain.ts) for the local-queue + retry-on-reconnect loop. The SOS write path can mirror the same shape.

### 2. Refresh sibling [`HANDOFF.md`](HANDOFF.md)  (small)

Still references `messages-v2/` route paths that don't exist post-cutover. Probably easiest to retire it and merge anything useful into this doc.

### 3. Rename `components/messages-v2/` → `components/messages/`  (small-medium, mechanical)

Touches every chat-component import. Pure naming hygiene with no behavior change. Worth doing in one sweep to retire the last "v2" reference.

### 4. Polish trickle (small, low priority)

- Deep-link audit: confirm `/api/send-push` and any other surface that builds in-app deep links points at the right v2-equivalent paths (most already do).
- Conversation list preview for system messages ("X joined / X left") currently shows raw text; consider showing the prior text-message preview or a friendlier summary.
- Group avatar uploads don't GC the old Storage object on replacement. Low-priority leak; add a sweep later.
- `grantVIP()` legacy wrapper in `/admin/vips/page.tsx` still called by the search-modal grant path. `setElevatedFlag` does the same work; consolidating later would drop the wrapper.

### 5. Tracked-cache download button for chat media  (deferred per user)

User wants images + videos downloadable to phone storage without incurring extra Cloudinary / Supabase egress. Plan we agreed on:

1. Capture media blob into IndexedDB during first view (extend the existing `mediaBlobs.ts` pattern that the upload outbox uses).
2. Render the download button only when the blob is in IDB.
3. Download reads from IDB → object URL → save. Zero re-fetch.
4. On Capacitor: `@capacitor/filesystem` → `Filesystem.writeFile(Directory.Documents)`, then `@capacitor/share` so the user can pick Save to Files / Photos. On web: standard `<a download>`.

Deferred until after SOS workstream.

## Where to look

| Concern | File |
|---|---|
| Root chat boot | [`components/chat/ChatBootstrap.tsx`](../../components/chat/ChatBootstrap.tsx) |
| Conversation list page | [`app/messages/page.tsx`](../../app/messages/page.tsx) |
| Thread page | [`app/messages/[id]/page.tsx`](../../app/messages/[id]/page.tsx) |
| Header (DM badge) | [`components/layout/Header.tsx`](../../components/layout/Header.tsx) |
| Send pipeline | [`features/chat/useSendMessage.ts`](useSendMessage.ts) |
| Voice recorder UI | [`components/messages-v2/VoiceRecorderBar.tsx`](../../components/messages-v2/VoiceRecorderBar.tsx) |
| Audio playback (receiver) | [`components/messages-v2/AudioBubble.tsx`](../../components/messages-v2/AudioBubble.tsx) |
| Swipe-to-reply | [`features/chat/useSwipeToReply.ts`](useSwipeToReply.ts) + [`MessageBubbleWrapper`](../../app/messages/[id]/page.tsx) |
| Notification route | [`app/api/notify-social/route.ts`](../../app/api/notify-social/route.ts) |
| In-app toast renderer | [`components/notifications/InAppNotificationToasts.tsx`](../../components/notifications/InAppNotificationToasts.tsx) |
| List-wide typing channels | [`features/chat/useListTypingChannels.ts`](useListTypingChannels.ts) |
| Mute / pin / mode RPCs | [`features/chat/api.ts`](api.ts) (`setNotificationMode`, `setConversationPinned`, `setMessagePinned`) |
| Auth (local JWT verify) | [`app/api/_auth.ts`](../../app/api/_auth.ts) |
| Bulk admin tooling | [`app/admin/vips/page.tsx`](../../app/admin/vips/page.tsx) |
| Realtime UPDATE patches | [`features/chat/realtime.ts`](realtime.ts) |
| Forward sheets | [`components/messages-v2/ForwardSheet.tsx`](../../components/messages-v2/ForwardSheet.tsx), [`IncidentForwardSheet.tsx`](../../components/messages-v2/IncidentForwardSheet.tsx) |

## Required env

- `NEXT_PUBLIC_SUPABASE_URL` and the public anon key (existing).
- `SUPABASE_SERVICE_ROLE_KEY` for the admin client in API routes.
- `SUPABASE_JWT_SECRET` to enable local JWT verification in `requireUser` (fast path). Without it, the route falls back to a network call to GoTrue and the toast latency spikes by ~2-3s.
- `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_PROJECT_ID` for FCM push.
- (For the upcoming SOS workstream) SMS provider credentials, TBD based on provider choice.
