"use client";

import { useEffect, Suspense } from "react";
import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import PostDetailPage from "@/app/post/[id]/page";
import { PostDetailSkeleton } from "@/components/posts/PostDetailSkeleton";

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
      animation="slide-up" 
    >
      <Suspense fallback={<div className="min-h-screen bg-dark-950 p-4"><PostDetailSkeleton /></div>}>
        <PostDetailPage />
      </Suspense>
    </FullScreenModalShell>
  );
}