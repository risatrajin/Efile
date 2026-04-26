import React from "react";
import { STATUS_LABELS, TIER_LABELS, OPP_LABELS } from "../../lib/api";

const TIER_STYLES = {
  WHITE_GLOVE: { bg: "#ede7f6", fg: "#5e35b1" },
  BOOKS_COMPLETE: { bg: "#e3f2fd", fg: "#1565c0" },
  STANDARD: { bg: "#eceff1", fg: "#546e7a" },
};

export function TierBadge({ tier }) {
  if (!tier) return null;
  const s = TIER_STYLES[tier] || TIER_STYLES.STANDARD;
  return (
    <span
      data-testid={`tier-${tier}`}
      style={{ background: s.bg, color: s.fg, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500, display: "inline-block" }}
    >{TIER_LABELS[tier]}</span>
  );
}

const STATUS_STYLES = {
  REFERRED: { bg: "#e3f2fd", fg: "#1565c0" },
  INTAKE: { bg: "#e3f2fd", fg: "#1565c0" },
  IN_PREP: { bg: "#fff3e0", fg: "#ef6c00" },
  IN_REVIEW: { bg: "#fffde7", fg: "#f57f17" },
  DELIVERY: { bg: "#fffde7", fg: "#f57f17" },
  FILED: { bg: "#e8f5e9", fg: "#2e7d32" },
};

export function StatusBadge({ status }) {
  if (!status) return null;
  const s = STATUS_STYLES[status] || { bg: "var(--bg-subtle)", fg: "var(--text-secondary)" };
  return (
    <span
      data-testid={`status-${status}`}
      style={{ background: s.bg, color: s.fg, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500, display: "inline-block" }}
    >{STATUS_LABELS[status]}</span>
  );
}

export function SeverityDot({ severity }) {
  const cls = severity === "HIGH" ? "dot-high" : severity === "MEDIUM" ? "dot-medium" : "dot-low";
  return <span className={`dot ${cls}`} title={severity} data-testid={`severity-${severity}`} />;
}

export function OppCategoryLabel({ category }) {
  return <span className="label-caption" data-testid={`opp-cat-${category}`}>{OPP_LABELS[category] || category}</span>;
}
