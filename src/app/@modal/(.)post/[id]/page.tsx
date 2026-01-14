"use client";

import { useEffect } from "react";
import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import PostDetailPage from "@/app/post/[id]/page";

export default function PostModalRoute() {
  // Let the PostDetail header know it’s inside the modal stack
  useEffect(() => {
    (window as any).__pejaPostModalOpen = true;
    return () => {
      (window as any).__pejaPostModalOpen = false;
    };
  }, []);

  return (
    <FullScreenModalShell
      closeOnBackdrop={true}
      zIndex={9999}
      scrollable={true}
      closeEventName="peja-close-post"
      emitOverlayEvents={false}
      emitModalEvents={true}
    >
      <PostDetailPage />
    </FullScreenModalShell>
  );
}