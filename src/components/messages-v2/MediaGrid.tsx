"use client";

// In-bubble album layout for a bundle of image / video media.
//
// Layout matches WhatsApp's standard:
//
//   1 item    →  single full-aspect tile (uses the item's natural
//                aspect ratio so portrait photos don't get cropped)
//   2 items   →  side-by-side, square crops
//   3 items   →  1 large on top, 2 small below (still inside a
//                square frame)
//   4 items   →  2 × 2 grid, square crops
//   5+ items  →  2 × 2 grid; the fourth tile shows a "+N" overlay
//                for the rest
//
// All tiles are buttons so a tap-anywhere opens the carousel at
// that index. Hidden items (5+) are still passed to the carousel,
// so users can swipe through them after tapping the +N tile.

import { Play } from "lucide-react";

export interface MediaGridItem {
  id: string;
  url: string;
  media_type: "image" | "video";
  thumbnail_url?: string | null;
  width?: number;
  height?: number;
}

interface Props {
  items: MediaGridItem[];
  isPending?: boolean;
  onTileTap: (index: number) => void;
}

export function MediaGrid({ items, isPending, onTileTap }: Props) {
  const count = items.length;
  if (count === 0) return null;

  if (count === 1) {
    const item = items[0];
    const ratio =
      item.width && item.height
        ? `${item.width} / ${item.height}`
        : item.media_type === "video"
          ? "16 / 9"
          : "4 / 3";
    // Round the tile itself (not just the bubble) so the inner
    // <video> / <img> is clipped even when the outer bubble's
    // rounded-corner clipping is interfered with by transforms,
    // backdrop-filter ancestors, or browser quirks where
    // border-radius + overflow-hidden doesn't reliably mask
    // media elements.
    return (
      <Tile
        item={item}
        onTap={() => onTileTap(0)}
        isPending={isPending}
        className="rounded-xl"
        style={{ width: 260, maxWidth: "100%", aspectRatio: ratio }}
      />
    );
  }

  // 2-up layout — both items half-width, full square.
  if (count === 2) {
    return (
      <div
        className="grid grid-cols-2 gap-0.5 rounded-xl overflow-hidden"
        style={{ width: 260, maxWidth: "100%", aspectRatio: "2 / 1" }}
      >
        {items.map((item, i) => (
          <Tile
            key={item.id}
            item={item}
            onTap={() => onTileTap(i)}
            isPending={isPending}
            className="aspect-square h-full"
          />
        ))}
      </div>
    );
  }

  // 3-up layout — one full-width on top, two halves below.
  if (count === 3) {
    return (
      <div
        className="grid gap-0.5 rounded-xl overflow-hidden"
        style={{
          width: 260,
          maxWidth: "100%",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          aspectRatio: "1 / 1",
        }}
      >
        <Tile
          item={items[0]}
          onTap={() => onTileTap(0)}
          isPending={isPending}
          style={{ gridColumn: "1 / 3", gridRow: 1 }}
        />
        <Tile
          item={items[1]}
          onTap={() => onTileTap(1)}
          isPending={isPending}
        />
        <Tile
          item={items[2]}
          onTap={() => onTileTap(2)}
          isPending={isPending}
        />
      </div>
    );
  }

  // 4+ items → 2 × 2 grid, last tile shows "+N" if there are more.
  const visible = items.slice(0, 4);
  const hidden = count - 4;
  return (
    <div
      className="grid grid-cols-2 gap-0.5 rounded-xl overflow-hidden"
      style={{
        width: 260,
        maxWidth: "100%",
        aspectRatio: "1 / 1",
      }}
    >
      {visible.map((item, i) => (
        <div key={item.id} className="relative">
          <Tile
            item={item}
            onTap={() => onTileTap(i)}
            isPending={isPending}
            className="w-full h-full"
          />
          {i === 3 && hidden > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTileTap(3);
              }}
              className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-2xl font-semibold"
              aria-label={`Show ${hidden} more`}
            >
              +{hidden}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

interface TileProps {
  item: MediaGridItem;
  onTap: () => void;
  isPending?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

function Tile({ item, onTap, isPending, className, style }: TileProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!isPending) onTap();
      }}
      disabled={isPending}
      className={`relative block bg-black/30 overflow-hidden ${className ?? ""}`}
      style={style}
    >
      {item.media_type === "video" ? (
        <>
          <video
            src={item.url}
            poster={item.thumbnail_url || undefined}
            preload="metadata"
            muted
            playsInline
            className={`w-full h-full object-cover ${isPending ? "opacity-70" : ""}`}
          />
          {!isPending && (
            <span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <span className="w-10 h-10 rounded-full bg-black/55 flex items-center justify-center">
                <Play
                  className="w-4 h-4 text-white"
                  fill="currentColor"
                  style={{ marginLeft: "2px" }}
                />
              </span>
            </span>
          )}
        </>
      ) : (
        <img
          src={item.url}
          alt=""
          className={`w-full h-full object-cover ${isPending ? "opacity-70" : ""}`}
        />
      )}
    </button>
  );
}
