import React from "react";
import { History } from "lucide-react";

export default function StatusHistoryTimeline({ rows = [], compact = false }) {
  if (!rows || rows.length === 0) {
    return <div className="muted">No status transitions recorded yet.</div>;
  }
  return (
    <div style={{ position: "relative", paddingLeft: 20 }} data-testid="status-timeline">
      <div style={{ position: "absolute", left: 4, top: 6, bottom: 6, width: 1, background: "var(--border-default)" }} />
      {rows.map((h, idx) => (
        <div
          key={h.id || idx}
          className="stack-sm"
          style={{ position: "relative", paddingBottom: compact ? 12 : 18 }}
          data-testid={`history-row-${idx}`}
        >
          <div
            style={{
              position: "absolute",
              left: -20,
              top: 4,
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: idx === 0 ? "var(--accent-dark)" : "var(--bg-card)",
              border: `2px solid ${idx === 0 ? "var(--accent-dark)" : "var(--border-strong)"}`,
            }}
          />
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
            {h.from_status && (
              <>
                <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                  {h.from_status.replace(/_/g, " ").toLowerCase()}
                </span>
                <span className="tertiary">→</span>
              </>
            )}
            <span className="badge badge-active" style={{ fontSize: 10 }}>
              {h.to_status.replace(/_/g, " ").toLowerCase()}
            </span>
            <span className="tertiary" style={{ fontSize: 11 }}>
              by {h.changed_by?.name || "—"}
            </span>
            <span className="tertiary" style={{ fontSize: 11 }}>
              · {new Date(h.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
            </span>
          </div>
          {h.note && (
            <div className="muted" style={{ fontSize: 12, fontStyle: "italic" }}>
              "{h.note}"
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function StatusHistoryHeader({ count, open, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center between"
      style={{ width: "100%", textAlign: "left" }}
      data-testid="history-toggle"
    >
      <div className="flex items-center gap-2">
        <History size={14} />
        <h2 className="card-title" style={{ margin: 0 }}>
          Status history
        </h2>
        <span className="muted" style={{ fontSize: 12 }}>
          ({count} {count === 1 ? "transition" : "transitions"})
        </span>
      </div>
      <span
        style={{
          transform: open ? "rotate(180deg)" : "rotate(0)",
          transition: "transform 200ms ease",
          color: "var(--text-secondary)",
          fontSize: 14,
        }}
      >
        ▾
      </span>
    </button>
  );
}
