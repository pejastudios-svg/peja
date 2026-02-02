"use client";
import { useState, useEffect } from "react";
import { 
  Scan, MapPin, Radio, Users, Shield, Send, 
  CheckCircle, XCircle, Phone 
} from "lucide-react";
interface SOSLoadingAnimationProps {
  isActive: boolean;
  onComplete: (success: boolean) => void;
  simulateFailure?: boolean;
}
const STEPS = [
  { id: 1, label: "Analyzing SOS request", icon: Scan, duration: 800 },
  { id: 2, label: "Pinpointing your location", icon: MapPin, duration: 1000 },
  { id: 3, label: "Scanning for nearby users", icon: Radio, duration: 1200 },
  { id: 4, label: "Capturing available helpers", icon: Users, duration: 1000 },
  { id: 5, label: "Notifying emergency contacts", icon: Shield, duration: 800 },
  { id: 6, label: "Sending help now", icon: Send, duration: 600 },
];
export function SOSLoadingAnimation({ 
  isActive, 
  onComplete, 
  simulateFailure = false 
}: SOSLoadingAnimationProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [status, setStatus] = useState<"loading" | "success" | "failed">("loading");
  useEffect(() => {
    if (!isActive) {
      setCurrentStep(0);
      setStatus("loading");
      return;
    }
    let stepIndex = 0;
    const runStep = () => {
      if (stepIndex < STEPS.length) {
        setCurrentStep(stepIndex + 1);
        stepIndex++;
        setTimeout(runStep, STEPS[stepIndex - 1]?.duration || 800);
      } else {
        // All steps complete
        if (simulateFailure) {
          setStatus("failed");
          setTimeout(() => onComplete(false), 2000);
        } else {
          setStatus("success");
          setTimeout(() => onComplete(true), 1500);
        }
      }
    };
    // Start first step after a brief delay
    setTimeout(runStep, 300);
  }, [isActive, simulateFailure, onComplete]);
  if (!isActive) return null;
  const CurrentIcon = currentStep > 0 && currentStep <= STEPS.length 
    ? STEPS[currentStep - 1].icon 
    : Scan;
  return (
    <div className="fixed inset-0 z-[30000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      
      <div className="relative w-full max-w-sm">
        {/* Main Card */}
        <div className="glass-card text-center relative overflow-hidden">
          {/* Animated background pulse */}
          <div className="absolute inset-0 opacity-20">
            <div 
              className="absolute inset-0 bg-gradient-to-r from-red-500 via-primary-500 to-red-500"
              style={{
                backgroundSize: "200% 100%",
                animation: "sos-gradient 2s linear infinite",
              }}
            />
          </div>
          <div className="relative z-10">
            {/* Status Icon */}
            {status === "loading" && (
              <div className="relative w-24 h-24 mx-auto mb-6">
                {/* Outer ring */}
                <div 
                  className="absolute inset-0 rounded-full border-4 border-red-500/30"
                  style={{ animation: "sos-ring-pulse 1.5s ease-out infinite" }}
                />
                {/* Middle ring */}
                <div 
                  className="absolute inset-2 rounded-full border-2 border-primary-500/40"
                  style={{ animation: "sos-ring-pulse 1.5s ease-out infinite 0.3s" }}
                />
                {/* Inner circle with icon */}
                <div className="absolute inset-4 rounded-full bg-gradient-to-br from-red-600 to-red-700 flex items-center justify-center shadow-lg shadow-red-500/50">
                  <CurrentIcon 
                    className="w-8 h-8 text-white" 
                    style={{ animation: "sos-icon-glow 1s ease-in-out infinite" }}
                  />
                </div>
              </div>
            )}
            {status === "success" && (
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg shadow-green-500/50">
                <CheckCircle className="w-12 h-12 text-white" />
              </div>
            )}
            {status === "failed" && (
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-red-600 to-red-700 flex items-center justify-center shadow-lg shadow-red-500/50">
                <XCircle className="w-12 h-12 text-white" />
              </div>
            )}
            {/* Current Step Text */}
            {status === "loading" && (
              <>
                <h3 className="text-lg font-bold text-white mb-2">
                  {currentStep > 0 && currentStep <= STEPS.length 
                    ? STEPS[currentStep - 1].label 
                    : "Initializing..."}
                </h3>
                <p className="text-sm text-dark-400 mb-6">
                  Please wait, this may take a few seconds
                </p>
              </>
            )}
            {status === "success" && (
              <>
                <h3 className="text-lg font-bold text-green-400 mb-2">
                  SOS Sent Successfully
                </h3>
                <p className="text-sm text-dark-400 mb-6">
                  Help is on the way. Stay calm.
                </p>
              </>
            )}
            {status === "failed" && (
              <>
                <h3 className="text-lg font-bold text-red-400 mb-2">
                  Failed to Send SOS
                </h3>
                <p className="text-sm text-dark-400 mb-4">
                  Please call emergency services directly
                </p>
                <div className="flex gap-2 justify-center">
                  <a 
                    href="tel:112" 
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl font-medium"
                  >
                    <Phone className="w-4 h-4" /> Call 112
                  </a>
                  <a 
                    href="tel:767" 
                    className="flex items-center gap-2 px-4 py-2 glass-sm text-white rounded-xl font-medium"
                  >
                    <Phone className="w-4 h-4" /> Call 767
                  </a>
                </div>
              </>
            )}
            {/* Progress Dots */}
            {status === "loading" && (
              <div className="flex justify-center gap-2">
                {STEPS.map((step, index) => (
                  <div
                    key={step.id}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      index < currentStep 
                        ? "bg-primary-500 scale-100" 
                        : index === currentStep 
                          ? "bg-red-500 scale-125 animate-pulse" 
                          : "bg-dark-600 scale-100"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes sos-gradient {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        @keyframes sos-ring-pulse {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        @keyframes sos-icon-glow {
          0%, 100% { filter: drop-shadow(0 0 4px rgba(255,255,255,0.5)); }
          50% { filter: drop-shadow(0 0 12px rgba(255,255,255,0.9)); }
        }
      `}</style>
    </div>
  );
}