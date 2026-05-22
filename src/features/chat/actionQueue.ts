"use client";

// Offline action queue for chat actions OTHER than send (those have
// their own outbox.ts). Covers:
//
//   • edit          — change a message's content
//   • delete-me     — message_deletions insert for the current user
//   • delete-all    — flip messages.is_deleted to true
//   • react-add     — insert a message_reactions row
//   • react-remove  — delete a message_reactions row by id
//
// Persisted to localStorage so the queue survives reload. Per-user
// keyed so a shared device doesn't replay one user's queue into the
// other's session.
//
// Pattern: caller patches the store optimistically THEN calls
// `enqueueAction` from the catch-or-offline path. The drain hook
// (useActionQueueDrain) walks the queue when the browser regains
// connectivity / the page is foregrounded / Realtime resubscribes,
// runs each item, and removes it on success. Optimistic UI stays in
// place across the queued window so the user can't tell the
// difference from an online action.

import { supabase } from "@/lib/supabase";
import { useChatStore } from "./store";
import type { MessageReaction } from "./types";

const KEY_PREFIX = "peja:chat:actions:v1:";
const MAX_ITEMS = 500;
const MAX_AUTO_ATTEMPTS = 6;

export type ChatActionItem =
  | {
      id: string;
      kind: "edit";
      message_id: string;
      conversation_id: string;
      content: string;
      attempts: number;
      last_error: string | null;
    }
  | {
      id: string;
      kind: "delete-me";
      message_id: string;
      conversation_id: string;
      user_id: string;
      attempts: number;
      last_error: string | null;
    }
  | {
      id: string;
      kind: "delete-all";
      message_id: string;
      conversation_id: string;
      attempts: number;
      last_error: string | null;
    }
  | {
      id: string;
      kind: "react-add";
      message_id: string;
      conversation_id: string;
      user_id: string;
      emoji: string;
      // Temp id we used in the store while optimistic. After the DB
      // insert resolves we swap the store row's id from this to the
      // server-issued one (replaceMyReaction).
      temp_reaction_id: string;
      attempts: number;
      last_error: string | null;
    }
  | {
      id: string;
      kind: "react-remove";
      reaction_id: string;
      // Conversation + message ids so realtime DELETE echo can find
      // the right thread without scanning all of them. Not strictly
      // required (the realtime handler walks threads anyway) but
      // helpful for the drain's local rollback path.
      conversation_id: string;
      message_id: string;
      attempts: number;
      last_error: string | null;
    };

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function read(userId: string): ChatActionItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is ChatActionItem =>
        typeof i === "object" && i !== null && typeof (i as { kind?: unknown }).kind === "string"
    );
  } catch {
    return [];
  }
}

function write(userId: string, items: ChatActionItem[]): void {
  if (typeof window === "undefined") return;
  try {
    const capped = items.slice(-MAX_ITEMS);
    window.localStorage.setItem(keyFor(userId), JSON.stringify(capped));
  } catch {}
}

export function readActions(userId: string): ChatActionItem[] {
  return read(userId);
}

export function enqueueAction(userId: string, item: ChatActionItem): void {
  const items = read(userId);
  if (items.some((i) => i.id === item.id)) return; // dedupe
  items.push(item);
  write(userId, items);
}

export function removeAction(userId: string, id: string): void {
  write(
    userId,
    read(userId).filter((i) => i.id !== id)
  );
}

export function patchAction(
  userId: string,
  id: string,
  patch: Partial<ChatActionItem>
): void {
  write(
    userId,
    read(userId).map((i) =>
      i.id === id
        ? // The discriminated union makes a clean spread tricky in TS
          // (different kinds have different fields). Cast to the union
          // member's shape — runtime is fine because we only patch
          // fields that exist on all variants (attempts, last_error).
          ({ ...i, ...(patch as Partial<ChatActionItem>) } as ChatActionItem)
        : i
    )
  );
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// =====================================================
// Action execution — runs one queued action against the DB.
// =====================================================

/**
 * Returns true if the item was applied (and should be removed from
 * the queue); throws on failure so the drain bumps attempts.
 */
export async function runChatAction(item: ChatActionItem): Promise<void> {
  switch (item.kind) {
    case "edit": {
      const editedAt = new Date().toISOString();
      const { error } = await supabase
        .from("messages")
        .update({ content: item.content, edited_at: editedAt })
        .eq("id", item.message_id);
      if (error) throw error;
      return;
    }
    case "delete-me": {
      const { error } = await supabase
        .from("message_deletions")
        .upsert(
          { message_id: item.message_id, user_id: item.user_id },
          { onConflict: "message_id,user_id" }
        );
      if (error) throw error;
      return;
    }
    case "delete-all": {
      const { error } = await supabase
        .from("messages")
        .update({ is_deleted: true })
        .eq("id", item.message_id);
      if (error) throw error;
      return;
    }
    case "react-add": {
      const { data, error } = await supabase
        .from("message_reactions")
        .insert({
          message_id: item.message_id,
          user_id: item.user_id,
          emoji: item.emoji,
        })
        .select("id, message_id, user_id, emoji, created_at")
        .single();
      if (error) throw error;
      // Swap the optimistic temp row's id for the server-issued one.
      // replaceMyReaction merges the change in a single setState so
      // there's no flicker between temp and real.
      const real = data as MessageReaction;
      useChatStore
        .getState()
        .replaceMyReaction(item.conversation_id, item.message_id, item.user_id, real);
      return;
    }
    case "react-remove": {
      const { error } = await supabase
        .from("message_reactions")
        .delete()
        .eq("id", item.reaction_id);
      if (error) throw error;
      return;
    }
  }
}

// =====================================================
// Inline helper: caller has done the optimistic store patch and now
// wants to either fire the API right away (we're online + healthy)
// or stash the action for later replay.
// =====================================================

export async function dispatchOrQueue(
  userId: string,
  item: ChatActionItem
): Promise<void> {
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    enqueueAction(userId, item);
    return;
  }
  try {
    await runChatAction(item);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    enqueueAction(userId, { ...item, last_error: msg });
  }
}

export const MAX_AUTO_RETRIES = MAX_AUTO_ATTEMPTS;
