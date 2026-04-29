import React, { useEffect, useState } from "react";
import { initials } from "../../lib/api";

const BASE = process.env.REACT_APP_BACKEND_URL || "";

// Deterministic gradient palette — same name always gets the same colour pair.
const PALETTE = [
  ["#fde2e4", "#f6bdc0"], // peach
  ["#e3f2fd", "#90caf9"], // sky
  ["#e8f5e9", "#a5d6a7"], // mint
  ["#fff3e0", "#ffb74d"], // amber
  ["#ede7f6", "#b39ddb"], // lavender
  ["#fce4ec", "#f48fb1"], // rose
  ["#e0f7fa", "#80deea"], // teal
  ["#f3e5f5", "#ce93d8"], // orchid
  ["#fffde7", "#fff176"], // lemon
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

  const [c1, c2] = paletteFor(name);
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
    background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
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
