"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const AdminLiveMap = dynamic(() => import("@/components/admin/AdminLiveMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-dark-950">
      <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

export default function AdminMapFullscreenPage() {
  const router = useRouter();

  return (
    <div className="fixed inset-0 z-[9999] bg-dark-950 flex flex-col">
      {/* Header */}
      <header className="shrink-0 flex items-center gap-3 px-4 h-12 bg-dark-950/90 backdrop-blur-sm border-b border-white/5 z-10">
        <button
          onClick={() => router.back()}
          className="p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-dark-200" />
        </button>
        <h1 className="text-sm font-semibold text-dark-100">Live Map</h1>
      </header>

      {/* Map fills remaining space */}
      <div className="flex-1">
        <AdminLiveMap />
      </div>
    </div>
  );
}