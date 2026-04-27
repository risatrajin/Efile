import React from "react";
import { fmtDate } from "../../lib/api";
import { Upload, ThumbsUp, Flag } from "lucide-react";

/**
 * Renders the chronological CPA-upload + Client-review history for an
 * engagement's tax-return draft cycle. Pass the engagement object — we read
 * `draft_history` (server-tracked array of {type, at, actor_name, file_name,
 * instructions, decision, note}). Returns null if there is no history.
 *
 * Used in:
 *  - CPA Engagement page (after Tax Return draft card)
 *  - Client Portal Review section (inside YOUR REVIEW)
 */
export default function DraftHistoryTable({ eng, title = "Draft & review history" }) {
  const rows = Array.isArray(eng?.draft_history) ? eng.draft_history : [];
  if (rows.length === 0) return null;

  // Newest first
  const sorted = [...rows].sort((a, b) => new Date(b.at + (typeof b.at === "string" && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(b.at) ? "Z" : "")) - new Date(a.at + (typeof a.at === "string" && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(a.at) ? "Z" : "")));

  return (
    <div className="card" data-testid="draft-history-table">
      <div className="flex items-center between" style={{ marginBottom: 12 }}>
        <h2 className="card-title" style={{ margin: 0 }}>{title}</h2>
        <span className="muted" style={{ fontSize: 11 }}>{rows.length} {rows.length === 1 ? "event" : "events"}</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border-default)" }}>
              <th style={th}>Event</th>
              <th style={th}>By</th>
              <th style={th}>Detail</th>
              <th style={th}>Note / instructions</th>
              <th style={{ ...th, whiteSpace: "nowrap" }}>When</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={i} data-testid={`history-row-${i}`} style={{ borderBottom: "1px solid var(--border-default)" }}>
                <td style={td}>
                  {r.type === "upload" ? (
                    <span style={pill}><Upload size={12} /> CPA upload</span>
                  ) : r.decision === "approved" ? (
                    <span style={{ ...pill, color: "#2e7d32", borderColor: "#bbe1bd" }}><ThumbsUp size={12} /> Approved</span>
                  ) : (
                    <span style={{ ...pill, color: "#c62828", borderColor: "#f3c0c0" }}><Flag size={12} /> Issue raised</span>
                  )}
                </td>
                <td style={td}>{r.actor_name || "—"}</td>
                <td style={{ ...td, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.type === "upload" ? (r.file_name || "—") : (r.decision === "approved" ? "Authorized to file" : "Correction requested")}
                </td>
                <td style={{ ...td, color: "var(--text-secondary)" }}>
                  {(r.type === "upload" ? r.instructions : r.note) || <span className="muted">—</span>}
                </td>
                <td style={{ ...td, whiteSpace: "nowrap", color: "var(--text-tertiary)" }}>{fmtDate(r.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = { padding: "8px 10px", fontSize: 11, fontWeight: 500, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" };
const td = { padding: "10px 10px", verticalAlign: "top" };
const pill = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 999, border: "1px solid var(--border-default)", background: "#fff", whiteSpace: "nowrap" };
