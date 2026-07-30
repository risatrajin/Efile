import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Receipt } from "lucide-react";
import { api, fmtError, fmtDate } from "../lib/api";
import { PLANS, PLAN_LABELS } from "./ClientDashboard";

const PRICE_BY_PLAN = Object.fromEntries(PLANS.map((p) => [p.key, p]));

function amountFor(eng) {
  if (eng.plan === "NIL") return `$${eng.nil_amount ?? 0}`;
  const p = PRICE_BY_PLAN[eng.plan];
  if (!p) return "—";
  return p.pricePrefix ? `${p.pricePrefix} ${p.priceAmount}` : p.priceAmount;
}

// Plan selections made at self-start. Legacy (plan-less) engagements never
// appear — nothing was purchased through the portal for them.
// TODO(payment): once checkout ships, rows gain real charge status/receipts.
export default function PurchaseHistory() {
  const navigate = useNavigate();
  const [engs, setEngs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/engagements");
        setEngs((data || []).filter((e) => e.plan));
      } catch (x) {
        setErr(fmtError(x));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  return (
    <div className="page-narrow stack-lg" style={{ paddingTop: 32, maxWidth: 760 }} data-testid="purchase-history">
      <div>
        <h1 className="page-title">Purchase history</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Plans you&apos;ve selected for your corporate tax filings.
        </p>
      </div>
      {!loaded ? (
        <div className="card">
          <div style={{ height: 14, width: "60%", background: "var(--bg-subtle)", borderRadius: 6, opacity: 0.6 }} />
        </div>
      ) : engs.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "32px 20px" }} data-testid="purchases-empty">
          <Receipt size={22} style={{ color: "var(--text-secondary)" }} />
          <div style={{ fontWeight: 600, fontSize: 14, marginTop: 10 }}>No purchases yet</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            When you start a filing and choose a plan, it will show up here.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            className="tertiary"
            style={{
              display: "grid", gridTemplateColumns: "1fr 1.4fr 1.2fr 0.8fr",
              gap: 10, padding: "10px 16px", fontSize: 10, fontWeight: 600,
              letterSpacing: 0.5, textTransform: "uppercase",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <div>Date</div><div>Corporation</div><div>Plan</div><div style={{ textAlign: "right" }}>Amount</div>
          </div>
          {engs.map((e) => (
            <div
              key={e.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/portal/filing/${e.id}`)}
              onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); navigate(`/portal/filing/${e.id}`); } }}
              data-testid={`purchase-row-${e.id}`}
              style={{
                display: "grid", gridTemplateColumns: "1fr 1.4fr 1.2fr 0.8fr",
                gap: 10, padding: "13px 16px", fontSize: 13, cursor: "pointer",
                borderBottom: "1px solid var(--border-subtle)", alignItems: "center",
              }}
            >
              <div className="muted" style={{ fontSize: 12 }}>{e.created_at ? fmtDate(e.created_at) : "—"}</div>
              <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {(e.corporation || {}).name || "Corporation"}
              </div>
              <div>{PLAN_LABELS[e.plan] || e.plan}</div>
              <div style={{ textAlign: "right", fontWeight: 600 }}>{amountFor(e)}</div>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 11, padding: "10px 16px" }}>
            Payment collection is coming soon — nothing has been charged yet.
          </div>
        </div>
      )}
      {err && <div className="alert alert-risk">{err}</div>}
    </div>
  );
}
