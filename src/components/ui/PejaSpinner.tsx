"use client";

const SPINNER_DOTS = [
  { color: "#A23792", orbit: "peja-orbit-cw",  delay: "0s" },
  { color: "#EDB733", orbit: "peja-orbit-cw",  delay: "-1s" },
  { color: "#30A5DD", orbit: "peja-orbit-ccw", delay: "-0.5s" },
  { color: "#0C7949", orbit: "peja-orbit-ccw", delay: "-1.5s" },
];

export function PejaSpinner({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      {SPINNER_DOTS.map((dot) => (
        <div
          key={dot.color}
          className="absolute inset-0"
          style={{
            animation: `${dot.orbit} 2s linear infinite`,
            animationDelay: dot.delay,
            willChange: "transform",
          }}
        >
          <div
            className="absolute left-1/2 rounded-full"
            style={{
              width: "22%",
              height: "22%",
              top: "10%",
              transform: "translateX(-50%)",
              background: dot.color,
              boxShadow: `0 0 8px ${dot.color}60, 0 0 16px ${dot.color}25`,
              animation: "peja-spinner-depth 2s ease-in-out infinite",
              animationDelay: dot.delay,
              willChange: "transform, opacity",
            }}
          />
        </div>
      ))}
    </div>
  );
}