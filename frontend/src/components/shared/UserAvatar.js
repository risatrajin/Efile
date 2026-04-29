import React, { useEffect, useState } from "react";
import { initials } from "../../lib/api";

const BASE = process.env.REACT_APP_BACKEND_URL || "";

// Subtle flat palette — same name always gets the same colour.
const PALETTE = [
  "#fde2e4", // peach
  "#e3f2fd", // sky
  "#e8f5e9", // mint
  "#fff3e0", // amber
  "#ede7f6", // lavender
  "#fce4ec", // rose
  "#e0f7fa", // teal
  "#f3e5f5", // orchid
  "#fffde7", // lemon
];

function paletteFor(seed = "") {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/**
 * Reusable user avatar with image-first / gradient-initials fallback.
 *
 * Props:
 *  - user: { id, name, avatar_url?, email? }
 *  - size: number (px). Defaults to 36.
 *  - testid: optional data-testid
 */
export default function UserAvatar({ user, size = 36, testid }) {
  const name = user?.name || user?.email || "?";
  const avatarUrl = user?.avatar_url;
  const fullSrc = avatarUrl ? (avatarUrl.startsWith("http") ? avatarUrl : `${BASE}${avatarUrl}`) : null;

  // Reset error flag any time the source URL changes so a new upload does not
  // inherit a stale "errored" from a previous render cycle.
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [fullSrc]);

  const bg = paletteFor(name);
  const fontSize = Math.max(10, Math.round(size * 0.36));

  const baseStyle = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    overflow: "hidden",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize,
    fontWeight: 600,
    color: "#1a1a1a",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    background: bg,
    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
  };

  if (fullSrc && !errored) {
    return (
      <span style={baseStyle} data-testid={testid}>
        <img
          src={fullSrc}
          alt={name}
          onError={() => setErrored(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </span>
    );
  }

  return (
    <span style={baseStyle} data-testid={testid}>
      {initials(name)}
    </span>
  );
}
