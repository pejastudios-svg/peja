# Chat. State & Handoff

Last updated: 2026-05-23

This doc replaces the old "Chat v2" state doc. The v1 chat has been deleted and the v2 implementation is now the only chat. Anywhere this file says "the chat", it means the single implementation at [`/messages`](../../app/messages/).

## TL;DR

- v1 is gone. There is one chat, mounted at `/messages` and `/messages/[id]`.
- Notification system is shipped end to end: realtime publication, server RPC for the DM/group fanout, digest rotation, in-chat suppression, and FCM push for individual messages.
- Toast latency on a slow client/Supabase link is ~700-1000ms (was ~6.8s before the optimization arc).
- Chat list rows show mute/blocked status inline and update with the other party's "typing.." / "recording.." in realtime.
- Admin `/admin/vips` now supports bulk MVP/VIP grant + revoke via a sticky bottom bar.
- Em dashes are banned in any user-facing string. See [`MEMORY.md`](~/.claude/projects/-Users-mac-Desktop-peja-app/memory/MEMORY.md) for the convention.

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

## Chat list polish

Recent additions, all in [`ChatListRow.tsx`](../../components/messages-v2/ChatListRow.tsx) unless noted:

- Mute icon (`BellOff`) inline next to timestamp when `notification_mode === 'muted'` or `is_muted` is true.
- Blocked icon (`Ban`, red) inline for DMs where `is_blocked` is true.
- Typing/recording state in the preview line. Driven by a new [`useListTypingChannels`](useListTypingChannels.ts) hook mounted on the list page that opens a `typing:${convId}` broadcast channel per conversation so the row updates in realtime, not only after the user enters the thread.
- Toast banners now stack as layered cards (newest in front, older peek behind with scale + opacity fade). Capped at 3 simultaneous. See [`InAppNotificationToasts.tsx`](../../components/notifications/InAppNotificationToasts.tsx).
- Voice note tap/hold UX rebalanced. `HOLD_THRESHOLD_MS` is now 400ms (was 250). The pre-threshold "Lift to lock" hint was removed because it was flashing on every interaction and being misread as the hold UI. Now: press shows timer + amplitude pulse, quick release goes to locked mode (Trash on left, Send on right), past 400ms swaps to the slide-to-cancel hint.

## Admin tools

`/admin/vips` now supports bulk MVP/VIP toggles. Click "Select" in the top-right to enter select mode: rows swap their crown badge for a checkbox, per-row action buttons hide, and a sticky bottom bar exposes Make MVP / Make VIP / Revoke MVP / Revoke VIP. Batch runs are parallel (Promise.allSettled), refetch once at the end, and report aggregate results in a toast (e.g. "MVP granted for 4, 1 failed").

## Migrations applied (chat + notifications)

| Migration | Purpose |
|---|---|
| `20260605_group_chats.sql` | Groups schema + RPCs |
| `20260606_group_chat_features.sql` | `notification_mode`, pin, system messages, per-message reports |
| `20260607_fix_group_triggers_and_system_messages.sql` | Trigger fixes |
| `20260608_notifications_realtime_publication.sql` | Adds `notifications` to `supabase_realtime` |
| `20260609_notifications_perf_indexes.sql` | JSONB partial indexes |
| `20260610_peja_notify_dm.sql` | Single-RPC DM notification dispatcher |

## Known cleanup items (not blocking)

- **`components/messages-v2/` folder name**: still says "v2" though there's no v1 anymore. Renaming to `components/messages/` would touch every import that consumes a chat component. Deferred. Treat as a future PR.
- **`HANDOFF.md`** (the sibling doc in this folder): predates the cutover and references `messages-v2/` route paths that no longer exist. Worth refreshing or retiring next to this file.
- **`grantVIP()`** legacy wrapper in `/admin/vips/page.tsx` is still called by the search-modal grant button. `setElevatedFlag` does the same work; consolidating later would let us drop the wrapper.

## Where to look

| Concern | File |
|---|---|
| Root chat boot | [`components/chat/ChatBootstrap.tsx`](../../components/chat/ChatBootstrap.tsx) |
| Conversation list page | [`app/messages/page.tsx`](../../app/messages/page.tsx) |
| Thread page | [`app/messages/[id]/page.tsx`](../../app/messages/[id]/page.tsx) |
| Header (DM badge) | [`components/layout/Header.tsx`](../../components/layout/Header.tsx) |
| Send pipeline | [`features/chat/useSendMessage.ts`](useSendMessage.ts) |
| Voice recorder UI | [`components/messages-v2/VoiceRecorderBar.tsx`](../../components/messages-v2/VoiceRecorderBar.tsx) |
| Notification route | [`app/api/notify-social/route.ts`](../../app/api/notify-social/route.ts) |
| In-app toast renderer | [`components/notifications/InAppNotificationToasts.tsx`](../../components/notifications/InAppNotificationToasts.tsx) |
| List-wide typing channels | [`features/chat/useListTypingChannels.ts`](useListTypingChannels.ts) |
| Mute / pin / mode RPCs | [`features/chat/api.ts`](api.ts) (`setNotificationMode`, `setConversationPinned`, `setMessagePinned`) |
| Auth (local JWT verify) | [`app/api/_auth.ts`](../../app/api/_auth.ts) |
| Bulk admin tooling | [`app/admin/vips/page.tsx`](../../app/admin/vips/page.tsx) |

## Required env

- `NEXT_PUBLIC_SUPABASE_URL` and the public anon key (existing).
- `SUPABASE_SERVICE_ROLE_KEY` for the admin client in API routes.
- `SUPABASE_JWT_SECRET` to enable local JWT verification in `requireUser` (fast path). Without it, the route falls back to a network call to GoTrue and the toast latency spikes by ~2-3s.
- `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_PROJECT_ID` for FCM push.
