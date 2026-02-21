import { Suspense } from "react";
import { PostDetailSkeleton } from "@/components/posts/PostDetailSkeleton";
import PostModalContent from "@/components/posts/PostModalContent";

export default function PostModalRoute() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-dark-950 p-4"><PostDetailSkeleton /></div>}>
      <PostModalContent />
    </Suspense>
  );
}