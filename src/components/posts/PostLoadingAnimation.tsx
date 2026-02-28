"use client";

import { useState, useEffect } from "react";
import { 
  Camera, MapPin, Shield, Upload, Radio, CheckCircle, X,
  Loader2
} from "lucide-react";
import { Portal } from "@/components/ui/Portal";

interface PostLoadingAnimationProps {
  isActive: boolean;
  uploadProgress: number;
  toast: string | null;
  onSuccess?: () => void;
}

const STEPS = [
  { icon: Camera, text: "Processing media...", color: "#a78bfa" },
  { icon: MapPin, text: "Pinpointing location...", color: "#60a5fa" },
  { icon: Shield, text: "Identifying threat level...", color: "#f97316" },
  { icon: Upload, text: "Uploading evidence...", color: "#a78bfa" },
  { icon: Radio, text: "Publishing report...", color: "#22c55e" },
];

export function PostLoadingAnimation({ 
  isActive, 
  uploadProgress, 
  toast 
}: PostLoadingAnimationProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setCurrentStep(0);
      setShowSuccess(false);
      return;
    }

    // Map upload progress to steps
    if (uploadProgress >= 100) {
      setCurrentStep(4);
      setShowSuccess(true);
    } else if (uploadProgress >= 85) {
      setCurrentStep(4);
    } else if (uploadProgress >= 60) {
      setCurrentStep(3);
    } else if (uploadProgress >= 30) {
      setCurrentStep(2);
    } else if (uploadProgress >= 10) {
      setCurrentStep(1);
    } else {
      setCurrentStep(0);
    }
  }, [isActive, uploadProgress]);

  if (!isActive) return null;

  const CurrentIcon = STEPS[currentStep]?.icon || Camera;
  const currentColor = STEPS[currentStep]?.color || "#a78bfa";

  return (
    <Portal>
      <div className="fixed inset-0 z-[25000] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
        
        <div className="relative sos-loading-card w-full max-w-sm p-6">
          {!showSuccess ? (
            <>
              {/* Animated Icon */}
              <div className="flex justify-center mb-6">
                <div className="sos-icon-container">
                  <div 
                    className="sos-icon-glow" 
                    style={{ 
                      background: `radial-gradient(circle, ${currentColor}40 0%, transparent 70%)` 
                    }} 
                  />
                  <div 
                    className="sos-icon-inner"
                    style={{ 
                      background: `${currentColor}15`,
                      borderColor: `${currentColor}40`
                    }}
                  >
                    <CurrentIcon className="w-6 h-6" style={{ color: currentColor }} />
                  </div>
                </div>
              </div>
              
              {/* Step Text */}
              <p 
                key={currentStep}
                className="text-center text-lg font-medium text-white mb-2 select-none sos-step-text"
              >
                {toast || STEPS[currentStep]?.text || "Processing..."}
              </p>

              {/* Progress percentage */}
              <p className="text-center text-sm text-dark-400 mb-5 select-none">
                {uploadProgress}%
              </p>

              {/* Progress bar */}
              <div className="w-full bg-dark-700/50 rounded-full h-1.5 mb-5 overflow-hidden">
                <div
                  className="h-1.5 rounded-full transition-all duration-500"
                  style={{ 
                    width: `${uploadProgress}%`,
                    background: `linear-gradient(90deg, #7c3aed, ${currentColor})`,
                    boxShadow: `0 0 12px ${currentColor}60`
                  }}
                />
              </div>

              {/* Progress Dots */}
              <div className="flex justify-center gap-2">
                {STEPS.map((_, index) => (
                  <div
                    key={index}
                    className={`sos-progress-dot ${
                      index < currentStep ? "done" : 
                      index === currentStep ? "active" : "pending"
                    }`}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="sos-notified-card text-center">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle className="w-10 h-10 text-green-400" />
                </div>
              </div>
              <h3 className="text-xl font-bold text-white mb-2 select-none">
                Report Published
              </h3>
              <p className="text-sm text-dark-400 select-none">
                Notifying nearby users...
              </p>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}
