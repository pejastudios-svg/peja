// src/app/components/notifications/FlaggedContentListener.tsx

"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface Props {
  onNewFlaggedContent: () => void;
}

export function FlaggedContentListener({ onNewFlaggedContent }: Props) {
  const callbackRef = useRef(onNewFlaggedContent);

  useEffect(() => {
    callbackRef.current = onNewFlaggedContent;
  }, [onNewFlaggedContent]);

  useEffect(() => {

    const channelName = `flagged-content-${Date.now()}`;
    
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "flagged_content",
        },
        (payload) => {
          callbackRef.current();
          
          // Also dispatch events for badge refresh
          window.dispatchEvent(new Event("admin-badge-refresh"));
          window.dispatchEvent(new Event("guardian-badge-refresh"));
        }
      )
      .subscribe((status) => {
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return null;
}