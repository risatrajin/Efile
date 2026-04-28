import React from "react";
import { fmtDate } from "../../lib/api";
import { TierBadge, StatusBadge } from "./Badges";

/**
 * Shared table view for engagement lists. Used by Admin + WS Partner dashboards
 * as an alternative to the kanban board.
 *
 * Props:
 *  - engagements: array of enriched engagements (with .client, .corporation, .assigned_cpa)
 *  - onRowClick: (engagement) => void
 *  - role: "ADMIN" | "WS_PARTNER" — controls a couple of columns (CPA shown for ADMIN)
 *  - testid: data-testid for the table
 */
export default function EngagementTable({ engagements = [], onRowClick, role = "ADMIN", testid = "engagement-table" }) {
  if (engagements.length === 0) {
    return (
      <div
        className="card"
        style={{ textAlign: "center", padding: "48px 24px", color: "var(--text-secondary)" }}
        data-testid={`${testid}-empty`}
      >
        No clients to show
      </div>
    );
  }

  const cellHeader = {
    textAlign: "left",
    padding: "12px 18px",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-secondary)",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  };
  const cellBody = { padding: "16px 18px", fontSize: 13, verticalAlign: "middle" };

  return (
    <div
      style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-default)" }}
      data-testid={testid}
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr style={{ background: "var(--bg-subtle)" }}>
              <th style={cellHeader}>Client</th>
              <th style={cellHeader}>Corporation</th>
              <th style={cellHeader}>Stage</th>
              <th style={cellHeader}>Tier</th>
              {role === "ADMIN" && <th style={cellHeader}>CPA</th>}
              <th style={cellHeader}>Last update</th>
              <th style={{ ...cellHeader, width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {engagements.map((e) => {
              const client = e.client || {};
              const corp = e.corporation || {};
              const lastUpdate = e.updated_at || e.filing_date || e.created_at;
              const displayName = (/^dr\.?\s/i).test(client.name || "") ? client.name : `Dr. ${client.name || "—"}`;
              return (
                <tr
                  key={e.id}
                  onClick={() => onRowClick && onRowClick(e)}
                  data-testid={`${testid}-row-${e.id}`}
                  style={{
                    borderTop: "1px solid var(--border-default)",
                    cursor: onRowClick ? "pointer" : "default",
                    transition: "background-color 120ms ease",
                  }}
                  onMouseEnter={(ev) => { ev.currentTarget.style.background = "var(--bg-subtle)"; }}
                  onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; }}
                >
                  <td style={{ ...cellBody, fontWeight: 600 }}>{displayName}</td>
                  <td style={{ ...cellBody, color: "var(--text-secondary)" }}>{corp.name || "—"}</td>
                  <td style={cellBody}><StatusBadge status={e.status} /></td>
                  <td style={cellBody}><TierBadge tier={e.tier} /></td>
                  {role === "ADMIN" && (
                    <td style={{ ...cellBody, color: "var(--text-secondary)" }}>
                      {e.assigned_cpa?.name || (
                        <span style={{ color: "#f57f17", fontWeight: 500 }}>Unassigned</span>
                      )}
                    </td>
                  )}
                  <td style={{ ...cellBody, color: "var(--text-secondary)" }}>{fmtDate(lastUpdate) || "—"}</td>
                  <td style={{ ...cellBody, textAlign: "right" }}>
                    <span style={{ color: "#1e88e5", fontSize: 12, fontWeight: 500 }}>Open →</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * View toggle pill: Kanban ⇄ Table
 */
export function ViewToggle({ value, onChange, testid = "view-toggle" }) {
  const opts = [
    { key: "kanban", label: "Kanban" },
    { key: "table", label: "Table" },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--bg-subtle)",
        border: "1px solid var(--border-default)",
        borderRadius: 999,
        padding: 3,
        gap: 2,
      }}
      data-testid={testid}
    >
      {opts.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            data-testid={`${testid}-${o.key}`}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 500,
              color: active ? "#fff" : "var(--text-secondary)",
              background: active ? "var(--accent-dark)" : "transparent",
              transition: "all 150ms ease",
              minHeight: 28,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
