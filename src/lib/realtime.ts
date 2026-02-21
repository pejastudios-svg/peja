import { supabase } from "./supabase";
import { RealtimeChannel } from "@supabase/supabase-js";

type Callback = (payload: any) => void;

class RealtimeManager {
  private channels: Map<string, RealtimeChannel> = new Map();
  private retryCount: Map<string, number> = new Map();
  private maxRetries = 3;

  subscribeToPosts(onInsert?: Callback, onUpdate?: Callback, onDelete?: Callback): () => void {
    const channelName = 'posts-realtime';
    
    if (this.channels.has(channelName)) {
      return () => this.unsubscribe(channelName);
    }

    // Check retry count to prevent spam
    const retries = this.retryCount.get(channelName) || 0;
    if (retries >= this.maxRetries) {
      console.log('Realtime: Max retries reached, skipping subscription');
      return () => {};
    }

    try {
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'posts' },
          (payload) => onInsert?.(payload.new)
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'posts' },
          (payload) => onUpdate?.(payload.new)
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'posts' },
          (payload) => onDelete?.(payload.old)
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            this.retryCount.set(channelName, retries + 1);
            console.log(`Realtime subscription failed (attempt ${retries + 1}/${this.maxRetries})`);
          }
        });

      this.channels.set(channelName, channel);
    } catch (error) {
      console.error('Realtime subscription error:', error);
    }

    return () => this.unsubscribe(channelName);
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
      console.error('Notification subscription error:', error);
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
      console.error('SOS subscription error:', error);
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
      console.error('Comments subscription error:', error);
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