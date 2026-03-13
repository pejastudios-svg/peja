"use client";

import { useEffect, useState } from "react";

interface Particle {
  id: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  shape: "circle" | "square" | "star";
}

const COLORS = [
  "#a78bfa", // purple
  "#c4b5fd", // light purple
  "#8b5cf6", // violet
  "#7c3aed", // deep violet
  "#60a5fa", // blue
  "#34d399", // green
  "#fbbf24", // yellow
  "#f472b6", // pink
  "#fb923c", // orange
  "#ffffff", // white
];

export function ConfirmConfetti({
  trigger,
  originRef,
}: {
  trigger: boolean;
  originRef?: React.RefObject<HTMLElement | null>;
}) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!trigger) return;

    const newParticles: Particle[] = [];
    const count = 24;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      newParticles.push({
        id: i,
        x: 0,
        y: 0,
        angle,
        speed: 40 + Math.random() * 60,
        size: 4 + Math.random() * 4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 720,
        shape: (["circle", "square", "star"] as const)[Math.floor(Math.random() * 3)],
      });
    }

    setParticles(newParticles);
    setVisible(true);

    const timer = setTimeout(() => {
      setVisible(false);
      setParticles([]);
    }, 700);

    return () => clearTimeout(timer);
  }, [trigger]);

  if (!visible || particles.length === 0) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-visible z-50"
      style={{ perspective: "500px" }}
    >
      {particles.map((p) => {
        const dx = Math.cos(p.angle) * p.speed;
        const dy = Math.sin(p.angle) * p.speed - 20; // bias upward

        return (
          <div
            key={p.id}
            className="absolute"
            style={{
              left: "50%",
              top: "50%",
              width: p.size,
              height: p.size,
              marginLeft: -p.size / 2,
              marginTop: -p.size / 2,
              backgroundColor: p.shape !== "star" ? p.color : "transparent",
              borderRadius: p.shape === "circle" ? "50%" : p.shape === "square" ? "2px" : "0",
              boxShadow: p.shape !== "star" ? `0 0 ${p.size}px ${p.color}40` : "none",
              animation: `confetti-burst 0.65s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards`,
              // Custom properties for the animation
              ["--dx" as any]: `${dx}px`,
              ["--dy" as any]: `${dy}px`,
              ["--rot" as any]: `${p.rotation + p.rotationSpeed}deg`,
            }}
          >
            {p.shape === "star" && (
              <svg width={p.size} height={p.size} viewBox="0 0 10 10">
                <polygon
                  points="5,0 6.5,3.5 10,4 7.5,6.5 8,10 5,8 2,10 2.5,6.5 0,4 3.5,3.5"
                  fill={p.color}
                />
              </svg>
            )}
          </div>
        );
      })}

      <style jsx>{`
        @keyframes confetti-burst {
          0% {
            transform: translate(0, 0) rotate(0deg) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(0.2);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}