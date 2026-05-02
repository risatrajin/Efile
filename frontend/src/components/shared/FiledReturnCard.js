import React from "react";
import { Download, CheckCircle2 } from "lucide-react";
import { fmtDate } from "../../lib/api";
import { getToken } from "../../lib/tokenStorage";

const BASE = process.env.REACT_APP_BACKEND_URL || "";

function fmtCurrency(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
}

function SumRow({ label, value, testid, emphasize }) {
  return (
    <div
      style={{
        background: emphasize ? "#fff3e0" : "var(--bg-subtle)",
        border: emphasize ? "1px solid #ffd180" : "1px solid var(--border-default)",
        borderRadius: 8, padding: "10px 12px",
      }}
    >
      <div className="tertiary" style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4, color: emphasize ? "#ef6c00" : "var(--text-primary)" }} data-testid={testid}>
        {value}
      </div>
    </div>
  );
}

/**
 * FILED return summary card — shown on AdminClientDetail and CpaEngagement when
 * the engagement status is FILED. Authenticated PDF download via fetch+blob so
 * the auth token rides on the request (anchor href would 401 against /api).
 */
export default function FiledReturnCard({ eng }) {
  const fs = eng.filing_summary || eng.tax_summary || {};
  const draftId = eng.filed_return_doc_id;
  const downloadHref = draftId ? `/api/documents/${draftId}/download` : null;

  const handleDownload = async () => {
    if (!draftId) return;
    try {
      const token = getToken();
      const r = await fetch(`${BASE}${downloadHref}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(`Download failed (${r.status})`);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `T2-filed-${(eng.corporation?.name || eng.id || "return").replace(/\W+/g, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(`Could not download filed return: ${e.message}`);
    }
  };

  return (
    <div className="card" data-testid="filed-return-card" style={{ borderLeft: "3px solid #2e7d32" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, background: "#e8f5e9",
          display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <CheckCircle2 size={18} style={{ color: "#2e7d32" }} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 className="card-title" style={{ margin: 0 }}>Filed return</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            T2 filed with CRA on {fmtDate(eng.filing_date) || "—"}
            {eng.filed_by_name ? ` by ${eng.filed_by_name}` : ""}
          </div>
        </div>
      </div>

      <div className="grid-2 mt-4" style={{ rowGap: 14 }}>
        <div className="field">
          <label className="field-label">CRA confirmation</label>
          <div style={{ fontSize: 13, fontWeight: 600 }} data-testid="filed-confirmation">
            {eng.filing_confirmation || "—"}
          </div>
        </div>
        <div className="field">
          <label className="field-label">Filing note</label>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "pre-wrap" }} data-testid="filed-note">
            {eng.filing_note || "—"}
          </div>
        </div>
      </div>

      <div className="mt-4" style={{ borderTop: "1px solid var(--border-default)", paddingTop: 14 }}>
        <div className="section-label" style={{ marginBottom: 10 }}>FILED RETURN SUMMARY</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <SumRow label="Net income" value={fmtCurrency(fs.net_income)} testid="fs-net-income" />
          <SumRow label="Total tax assessed" value={fmtCurrency(fs.total_tax_assessed)} testid="fs-total-tax" />
          <SumRow label="Instalments paid" value={fmtCurrency(fs.instalments_paid)} testid="fs-instalments" />
          <SumRow label="Balance owing" value={fmtCurrency(fs.balance_owing)} testid="fs-balance" emphasize />
          <SumRow label="Payment due date" value={fmtDate(fs.payment_due_date) || "—"} testid="fs-due-date" emphasize />
        </div>
      </div>

      {draftId && (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            onClick={handleDownload}
            className="btn btn-primary"
            data-testid="filed-download-btn"
          >
            <Download size={12} /> Download filed return (PDF)
          </button>
        </div>
      )}
    </div>
  );
}
