import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { fmtDate } from "../../lib/api";
import { TierBadge, StatusBadge } from "./Badges";

const STAGE_OPTIONS_DEFAULT = [
  { key: "all", label: "All stages" },
  { key: "REFERRED", label: "Referred" },
  { key: "INTAKE", label: "Intake" },
  { key: "IN_PREP", label: "In Prep" },
  { key: "IN_REVIEW", label: "In Review" },
  { key: "DELIVERY", label: "Delivery" },
  { key: "FILED", label: "Filed" },
];
const TIER_OPTIONS = [
  { key: "all", label: "All tiers" },
  { key: "BASIC", label: "Basic" },
  { key: "PREMIUM", label: "Premium" },
];

/**
 * Shared table view for engagement lists. Used by Admin + WS Partner dashboards
 * as an alternative to the kanban board.
 *
 * Props:
 *  - engagements: array of enriched engagements (with .client, .corporation, .assigned_cpa)
 *  - onRowClick: (engagement) => void
 *  - role: "ADMIN" | "WS_PARTNER" | "CPA" — controls a couple of columns
 *  - testid: data-testid for the table
 *  - showSearchFilter: whether to render the search + filter toolbar (default true)
 *  - stageOptions: optional override for the stage filter dropdown
 */
export default function EngagementTable({
  engagements = [],
  onRowClick,
  role = "ADMIN",
  testid = "engagement-table",
  showSearchFilter = true,
  stageOptions = STAGE_OPTIONS_DEFAULT,
}) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [tier, setTier] = useState("all");

  const filtered = useMemo(() => {
    let out = engagements;
    if (stage !== "all") out = out.filter((e) => e.status === stage);
    if (tier !== "all") out = out.filter((e) => e.tier === tier);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((e) => {
        const c = (e.client?.name || "").toLowerCase();
        const corp = (e.corporation?.name || "").toLowerCase();
        const cpa = (e.assigned_cpa?.name || "").toLowerCase();
        return c.includes(q) || corp.includes(q) || cpa.includes(q);
      });
    }
    return out;
  }, [engagements, stage, tier, query]);

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
    <div data-testid={testid}>
      {showSearchFilter && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
          data-testid={`${testid}-toolbar`}
        >
          <div style={{ position: "relative", flex: "1 1 280px", minWidth: 240, maxWidth: 420 }}>
            <Search size={12} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
            <input
              className="input"
              style={{ paddingLeft: 32, height: 36, fontSize: 12 }}
              placeholder={`Search by client${role === "ADMIN" ? ", CPA" : ""} or corporation…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid={`${testid}-search`}
            />
          </div>
          <select
            className="select"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            style={{ height: 36, fontSize: 12, width: "auto", minWidth: 150 }}
            data-testid={`${testid}-stage-filter`}
          >
            {stageOptions.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
          </select>
          <select
            className="select"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            style={{ height: 36, fontSize: 12, width: "auto", minWidth: 130 }}
            data-testid={`${testid}-tier-filter`}
          >
            {TIER_OPTIONS.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
          </select>
          <span className="tertiary" style={{ fontSize: 11, marginLeft: "auto" }}>
            {filtered.length} of {engagements.length}
          </span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div
          className="card"
          style={{ textAlign: "center", padding: "48px 24px", color: "var(--text-secondary)" }}
          data-testid={`${testid}-empty`}
        >
          {engagements.length === 0 ? "No clients to show" : "No clients match the current filters"}
        </div>
      ) : (
        <div
          style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-default)" }}
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
                {filtered.map((e) => {
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
      )}
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
