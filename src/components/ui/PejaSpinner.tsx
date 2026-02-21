"use client";

export function PejaSpinner({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-full h-full text-primary-500 animate-[spin_3s_linear_infinite]"
        style={{ animation: "none" }} // Reset standard spin, we use custom CSS below
      >
        <style jsx>{`
          @keyframes draw {
            0% { stroke-dashoffset: 60; opacity: 0; }
            50% { stroke-dashoffset: 0; opacity: 1; }
            100% { stroke-dashoffset: 0; opacity: 1; }
          }
          @keyframes glow {
            0%, 40% { filter: drop-shadow(0 0 0 transparent); }
            50% { filter: drop-shadow(0 0 8px rgba(255, 100, 50, 0.6)); }
            100% { filter: drop-shadow(0 0 0 transparent); }
          }
          .peja-cone {
            stroke-dasharray: 60;
            animation: draw 1.5s ease-out forwards, glow 2s ease-in-out infinite 1s;
          }
        `}</style>
        
        {/* Cone Triangle */}
        <path 
          d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" 
          className="peja-cone text-primary-500"
        />
        {/* Exclamation Mark */}
        <line x1="12" y1="9" x2="12" y2="13" className="peja-cone text-white" style={{ animationDelay: "0.5s" }} />
        <line x1="12" y1="17" x2="12.01" y2="17" className="peja-cone text-white" style={{ animationDelay: "0.7s" }} />
      </svg>
    </div>
  );
}