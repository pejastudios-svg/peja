"use client";

import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Updated type to include animation options
type ModalAnimation = "fade" | "scale" | "slide-up";

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
  animation = "scale", // Default to scale to match existing behavior
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  animation?: ModalAnimation;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      // Small delay to allow mount then animate in
      requestAnimationFrame(() => setVisible(true));
      document.body.style.overflow = "hidden";
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 300); // Wait for exit anim
      document.body.style.overflow = "";
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  if (!mounted) return null;

  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-2xl",
    full: "max-w-full h-full rounded-none",
  };

  // Animation Styles Logic
  const getAnimationClass = () => {
    if (animation === "slide-up") {
      return visible 
        ? "translate-y-0 opacity-100" 
        : "translate-y-full opacity-0";
    }
    if (animation === "fade") {
        return visible ? "opacity-100" : "opacity-0";
    }
    // Default 'scale'
    return visible 
      ? "scale-100 opacity-100" 
      : "scale-95 opacity-0";
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Modal Panel */}
      <div
        className={`relative w-full ${sizeClasses[size]} bg-[#121016] border border-white/10 shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh] transition-all duration-300 ease-out ${getAnimationClass()}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 text-dark-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}