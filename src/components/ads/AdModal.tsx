"use client";

import { Globe, Instagram, Facebook, Youtube, MessageCircle, Navigation, Music2 } from "lucide-react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";

/**
 * What opens when somebody taps a sponsored pin, result or slide.
 *
 * Every outbound tap is reported back so the advertiser's dashboard
 * counts what actually happened rather than an estimate. Tapping the
 * distance hands the viewer to the map, which is where the rest of the
 * inventory lives.
 */
const SOCIAL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  instagram: Instagram,
  facebook: Facebook,
  youtube: Youtube,
  tiktok: Music2,
  whatsapp: MessageCircle,
  website: Globe,
};

const socialHref = (key: string, value: string) => {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  switch (key) {
    case "instagram": return `https://instagram.com/${handle}`;
    case "facebook": return `https://facebook.com/${handle}`;
    case "youtube": return `https://youtube.com/@${handle}`;
    case "tiktok": return `https://tiktok.com/@${handle}`;
    case "whatsapp": return `https://wa.me/${handle.replace(/\D/g, "")}`;
    default: return `https://${v}`;
  }
};

export function AdModal({
  open,
  onClose,
  businessName,
  tagline,
  category,
  logoUrl,
  socials,
  distanceLabel,
  onSocial,
  onDirections,
}: {
  open: boolean;
  onClose: () => void;
  businessName: string;
  tagline?: string | null;
  category?: string | null;
  logoUrl?: string | null;
  socials?: Record<string, string>;
  distanceLabel?: string | null;
  onSocial?: () => void;
  onDirections?: () => void;
}) {
  const entries = Object.entries(socials || {}).filter(([, v]) => v && v.trim());

  return (
    <Modal isOpen={open} onClose={onClose} title={businessName}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
          )}
          <div className="min-w-0">
            {category && <p className="text-xs text-dark-400 uppercase tracking-wide">{category}</p>}
            {tagline && <p className="text-sm text-dark-200 mt-0.5 break-words">{tagline}</p>}
          </div>
        </div>

        {distanceLabel && (
          <button
            onClick={() => {
              onDirections?.();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform"
          >
            <Navigation className="w-4 h-4" />
            {distanceLabel} away, show me
          </button>
        )}

        {entries.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {entries.map(([key, value]) => {
              const Icon = SOCIAL_ICONS[key] || Globe;
              return (
                <a
                  key={key}
                  href={socialHref(key, value)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onSocial?.()}
                  className="w-11 h-11 rounded-xl flex items-center justify-center bg-[var(--glass-input-bg)] border border-[var(--glass-border)] active:scale-[0.97] transition-transform"
                  aria-label={key}
                >
                  <Icon className="w-5 h-5 beacon-accent-text" />
                </a>
              );
            })}
          </div>
        )}

        <p className="text-[11px] text-dark-500 text-center">
          Sponsored. Peja does not share your details with advertisers.
        </p>

        {/* The best-targeted line in the app. Whoever is reading this
            opened an advert and can see for themselves that it works,
            and it costs nothing to everyone who is not a business
            owner. Deliberately quiet: a link, not a button. */}
        <Link
          href="/advertise"
          onClick={onClose}
          className="block text-[11px] text-center text-dark-500 hover:text-primary-400 transition-ui"
        >
          Run a business? Advertise here too
        </Link>
      </div>
    </Modal>
  );
}
