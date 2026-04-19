import { supabase } from "./supabase";
import { RealtimeChannel } from "@supabase/supabase-js";

type Callback = (payload: any) => void;

class RealtimeManager {
  private channels: Map<string, RealtimeChannel> = new Map();
  private retryCount: Map<string, number> = new Map();
  private maxRetries = 3;

  // Fan-out listeners for the shared posts channel so multiple pages can
  // subscribe at once (home, search, profile, admin).
  private postListeners: Set<{
    onInsert?: Callback;
    onUpdate?: Callback;
    onDelete?: Callback;
  }> = new Set();

  subscribeToPosts(onInsert?: Callback, onUpdate?: Callback, onDelete?: Callback): () => void {
    const channelName = 'posts-realtime';
    const listener = { onInsert, onUpdate, onDelete };
    this.postListeners.add(listener);

    if (!this.channels.has(channelName)) {
      const retries = this.retryCount.get(channelName) || 0;
      if (retries >= this.maxRetries) {
        return () => {
          this.postListeners.delete(listener);
        };
      }

      try {
        const channel = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'posts' },
            (payload) => {
              console.log('[realtime] posts INSERT', payload.new);
              this.postListeners.forEach((l) => l.onInsert?.(payload.new));
            }
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'posts' },
            (payload) => {
              console.log('[realtime] posts UPDATE', payload.new);
              this.postListeners.forEach((l) => l.onUpdate?.(payload.new));
            }
          )
          .on(
            'postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'posts' },
            (payload) => {
              console.log('[realtime] posts DELETE', payload.old);
              this.postListeners.forEach((l) => l.onDelete?.(payload.old));
            }
          )
          .subscribe((status) => {
            console.log('[realtime] posts channel status:', status);
            if (status === 'CHANNEL_ERROR') {
              this.retryCount.set(channelName, retries + 1);
            }
          });

        this.channels.set(channelName, channel);
      } catch (err) {
        console.log('[realtime] posts subscribe failed', err);
      }
    }

    return () => {
      this.postListeners.delete(listener);
      if (this.postListeners.size === 0) {
        this.unsubscribe(channelName);
      }
    };
  }

  subscribeToNotifications(userId: string, onInsert?: Callback, onUpdate?: Callback): () => void {
    const channelName = `notifications-${userId}`;
    
    if (this.channels.has(channelName)) {
      return () => this.unsubscribe(channelName);
    }

    try {
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          (payload) => onInsert?.(payload.new)
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          (payload) => onUpdate?.(payload.new)
        )
        .subscribe();

      this.channels.set(channelName, channel);
    } catch (error) {
    }

    return () => this.unsubscribe(channelName);
  }

  subscribeToSOS(onInsert?: Callback, onUpdate?: Callback): () => void {
    const channelName = 'sos-realtime';
    
    if (this.channels.has(channelName)) {
      return () => this.unsubscribe(channelName);
    }

    try {
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'sos_alerts' },
          (payload) => onInsert?.(payload.new)
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'sos_alerts' },
          (payload) => onUpdate?.(payload.new)
        )
        .subscribe();

      this.channels.set(channelName, channel);
    } catch (error) {
    }

    return () => this.unsubscribe(channelName);
  }

  subscribeToComments(postId: string, onInsert?: Callback, onUpdate?: Callback, onDelete?: Callback): () => void {
    const channelName = `comments-${postId}`;
    
    if (this.channels.has(channelName)) {
      return () => this.unsubscribe(channelName);
    }

    try {
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'post_comments', filter: `post_id=eq.${postId}` },
          (payload) => onInsert?.(payload.new)
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'post_comments', filter: `post_id=eq.${postId}` },
          (payload) => onUpdate?.(payload.new)
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'post_comments', filter: `post_id=eq.${postId}` },
          (payload) => onDelete?.(payload.old)
        )
        .subscribe();

      this.channels.set(channelName, channel);
    } catch (error) {
    }

    return () => this.unsubscribe(channelName);
  }

  private unsubscribe(channelName: string) {
    const channel = this.channels.get(channelName);
    if (channel) {
      try {
        supabase.removeChannel(channel);
      } catch (e) {
        // Ignore errors when removing channel
      }
      this.channels.delete(channelName);
    }
  }

  unsubscribeAll() {
    this.channels.forEach((channel, name) => {
      try {
        supabase.removeChannel(channel);
      } catch (e) {
        // Ignore
      }
    });
    this.channels.clear();
    this.retryCount.clear();
  }
}

export const realtimeManager = new RealtimeManager();