export default function OverlayLoading() {
  // Full-screen fallback for the @overlay slot — black in dark, white in light.
  return (
    <div
      className="fixed inset-0 z-[9999]"
      style={{ background: "var(--page-bg)" }}
    />
  );
}
