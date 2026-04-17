import React from "react";
import { STATUS_LABELS, TIER_LABELS, OPP_LABELS } from "../../lib/api";

export function TierBadge({ tier }) {
  if (!tier) return null;
  const cls = tier === "BOOKS_COMPLETE" ? "badge-active" : tier === "STANDARD" ? "badge-neutral" : "badge-advisory";
  return <span className={`badge ${cls}`} data-testid={`tier-${tier}`}>{TIER_LABELS[tier]}</span>;
}

export function StatusBadge({ status }) {
  if (!status) return null;
  const cls = status === "FILED" ? "badge-complete" :
              status === "IN_REVIEW" || status === "IN_PREP" || status === "DELIVERY" ? "badge-active" :
              status === "INTAKE" ? "badge-attention" : "badge-neutral";
  return <span className={`badge ${cls}`} data-testid={`status-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function SeverityDot({ severity }) {
  const cls = severity === "HIGH" ? "dot-high" : severity === "MEDIUM" ? "dot-medium" : "dot-low";
  return <span className={`dot ${cls}`} title={severity} data-testid={`severity-${severity}`} />;
}

export function OppCategoryLabel({ category }) {
  return <span className="label-caption" data-testid={`opp-cat-${category}`}>{OPP_LABELS[category] || category}</span>;
}
