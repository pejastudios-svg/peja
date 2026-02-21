export default function OverlayLoading() {
  // Full-screen fallback for the @overlay slot
  return <div className="fixed inset-0 bg-dark-950 z-[9999]" />;
}