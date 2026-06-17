import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, fmtError, fmtDate, initials, TIME_LABELS } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge, StatusBadge } from "../components/shared/Badges";
import { Lock, FileText, Clock, Activity, ArrowLeft, Check, CircleDashed } from "lucide-react";

const PHASES = ["Referred", "Intake", "In Prep", "Review", "Filed"];
const STATUS_INDEX = { REFERRED: 0, INTAKE: 1, IN_PREP: 2, IN_REVIEW: 3, DELIVERY: 3, FILED: 4 };

function FilingProgress({ status }) {
  const idx = STATUS_INDEX[status] ?? -1;
  return (
    <div className="flex items-center gap-2" data-testid="filing-progress" style={{ marginTop: 12 }}>
      {PHASES.map((label, i) => (
        <React.Fragment key={label}>
          <div className="flex flex-col items-center" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%",
              background: i < idx ? "#1565c0" : i === idx ? "#fff" : "#fff",
              border: `2px solid ${i <= idx ? "#1565c0" : "#d9d5cf"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {i < idx ? <Check size={12} style={{ color: "#fff" }} /> :
                i === idx ? <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1565c0" }} /> : null}
            </div>
            <div style={{ fontSize: 11, color: i <= idx ? "var(--text-primary)" : "var(--text-tertiary)" }}>{label}</div>
          </div>
          {i < PHASES.length - 1 && (
            <div style={{ flex: 1, height: 1, background: i < idx ? "#1565c0" : "#d9d5cf", marginTop: -22 }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function StageMessage({ status }) {
  if (status === "REFERRED") {
    return (
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, marginTop: 16 }}>Awaiting CPA assignment</div>
        <p className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
          Client has been referred to CloudTax. Our team will assign a CPA and reach out to begin the intake process within 1–2 business days.
        </p>
      </div>
    );
  }
  if (status === "INTAKE") return <div><div style={{ fontWeight: 600, fontSize: 14, marginTop: 16 }}>Intake in progress</div><p className="muted" style={{ fontSize: 13, marginTop: 6 }}>The CPA is collecting documents from the client.</p></div>;
  if (status === "IN_PREP") return <div><div style={{ fontWeight: 600, fontSize: 14, marginTop: 16 }}>T2 preparation underway</div><p className="muted" style={{ fontSize: 13, marginTop: 6 }}>The CPA is preparing the corporate tax return.</p></div>;
  if (status === "IN_REVIEW") return <div><div style={{ fontWeight: 600, fontSize: 14, marginTop: 16 }}>Internal review</div><p className="muted" style={{ fontSize: 13, marginTop: 6 }}>The return is being reviewed by senior CPA before filing.</p></div>;
  if (status === "FILED") {
    return (
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, marginTop: 16 }}>Return filed with CRA</div>
        <p className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
          The T2 return has been filed with the CRA. The client should expect a Notice of Assessment in approximately 6–8 weeks.
        </p>
      </div>
    );
  }
  return null;
}

export default function WsFileDetail() {
  const { eid } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Partner viewers get the Ownr purple scope; ADMIN viewing this shared route
  // stays on the CloudTax warm-neutral palette.
  const rootClass = "app-root" + (user?.role === "PARTNER" ? " ownr-portal" : "");
  const [eng, setEng] = useState(null);
  const [docs, setDocs] = useState([]);
  const [time, setTime] = useState([]);
  const [history, setHistory] = useState([]);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [a, b] = await Promise.all([
        api.get(`/engagements/${eid}`),
        api.get(`/engagements/${eid}/history`).catch(() => ({ data: [] })),
      ]);
      setEng(a.data);
      setHistory(b.data || []);
      // Partner safe summary (no S3 keys / download URLs); fall back to full /documents for CPA/Admin
      try {
        const { data: d } = await api.get(`/engagements/${eid}/documents/summary`);
        setDocs(d);
      } catch (e1) {
        // Fall back to the legacy non-summary endpoint when summary fails
        // (some older engagements don't have a summary). Both failing is
        // still non-fatal — surface in console for diagnosis.
        try { const { data: d } = await api.get(`/engagements/${eid}/documents`); setDocs(d); }
        catch (e2) { console.debug("[WsFileDetail] documents fetch failed:", e1, e2); }
      }
      try { const { data: t } = await api.get(`/engagements/${eid}/time-entries`); setTime(t); }
      catch (e) { console.debug("[WsFileDetail] time-entries fetch (expected for PARTNER):", e?.response?.status); }
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eid]);

  if (!eng) return (
    <div className={rootClass}><AppHeader tabs={[{ key: "dashboard", to: "/partner/dashboard", label: "Dashboard" }]} /><div className="page-wide">Loading…</div></div>
  );

  const corp = eng.corporation || {};
  const client = eng.client || {};
  const isOnboarding = eng.status === "ONBOARDING";
  const totalHours = time.reduce((s, t) => s + (t.hours || 0), 0);
  const docsTotal = docs.length || eng.docs_total || 0;
  const docsReceived = docs.filter((d) => ["UPLOADED", "REVIEWED", "EXTRACTED"].includes(d.status)).length;
  const tabs = [{ key: "dashboard", to: "/partner/dashboard", label: "Dashboard" }];

  const docList = docs.map((d) => ({ name: d.name, status: d.status }));

  return (
    <div className={rootClass}>
      <AppHeader tabs={tabs} />
      <div className="page-wide stack-lg" data-testid="partner-file-detail">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate("/partner/dashboard")} style={{ width: "fit-content" }} data-testid="back-link"><ArrowLeft size={12} /> Dashboard</button>
        {err && <div className="alert alert-risk">{err}</div>}

        <div className="flex between items-start" style={{ flexWrap: "wrap", gap: 16 }}>
          <div className="flex items-start gap-4">
            <div className="avatar" style={{ width: 56, height: 56, fontSize: 16 }}>{initials(client.name || "")}</div>
            <div>
              <h1 className="page-title">{client.name}</h1>
              <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>{corp.name}</p>
              <div className="flex items-center gap-2 mt-3">
                <TierBadge tier={eng.tier} />
                <StatusBadge status={eng.status} />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-secondary)" }}><Lock size={11} /> Read only</span>
              </div>
            </div>
          </div>
          <div className="card" style={{ display: "flex", gap: 32, padding: "20px 28px" }} data-testid="stats-tile">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-serif)" }}>{totalHours > 0 ? `${totalHours}h` : "—"}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Hours logged</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-serif)" }}>{eng.days_elapsed != null && eng.status !== "REFERRED" ? eng.days_elapsed : "—"}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Days in stage</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-serif)" }}>{docsReceived}/{docsTotal}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Docs received</div>
            </div>
          </div>
        </div>

        <div className="two-col">
          <div className="stack-lg">
            {/* Filing progress */}
            <div className="card" data-testid="filing-progress-card">
              <h2 className="card-title">Filing progress</h2>
              <FilingProgress status={isOnboarding ? "REFERRED" : eng.status} />
              <StageMessage status={isOnboarding ? "REFERRED" : eng.status} />
            </div>

            {/* Document status */}
            <div className="card" data-testid="doc-status-card">
              <div className="flex items-center gap-2"><FileText size={14} style={{ color: "var(--text-secondary)" }} /><h2 className="card-title" style={{ margin: 0 }}>Document status</h2></div>
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Managed by CloudTax — documents are collected directly from the client by their assigned CPA</p>
              <div className="mt-3">
                {docList.map((d, i) => {
                  const received = ["UPLOADED", "REVIEWED", "EXTRACTED"].includes(d.status);
                  return (
                    <div key={i} className="list-row" style={{ paddingTop: 12, paddingBottom: 12 }}>
                      <div className="flex items-center gap-2">
                        {received ? <Check size={14} style={{ color: "#2e7d32" }} /> : <CircleDashed size={14} style={{ color: "#b5b0ab" }} />}
                        <span style={{ fontSize: 13 }}>{d.name}</span>
                      </div>
                      <span className={`badge ${received ? "badge-complete" : "badge-neutral"}`}>{received ? "Received" : "Pending"}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Time log */}
            <div className="card" data-testid="time-log-card">
              <div className="flex items-center between">
                <div className="flex items-center gap-2"><Clock size={14} style={{ color: "var(--text-secondary)" }} /><h2 className="card-title" style={{ margin: 0 }}>Time log</h2></div>
                {totalHours > 0 && <span className="muted" style={{ fontSize: 12 }}>{totalHours.toFixed(1)}h total</span>}
              </div>
              <div className="mt-3">
                {time.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12 }}>{eng.status === "REFERRED" ? "No time logged yet — awaiting CPA assignment." : "Time entries are private to the CPA."}</div>
                ) : (
                  time.map((t) => (
                    <div key={t.id} className="list-row" style={{ paddingTop: 12, paddingBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 13 }}>{TIME_LABELS[t.category] || t.category}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{eng.assigned_cpa?.name || ""} · {fmtDate(t.date)}</div>
                      </div>
                      <span className="badge badge-neutral">{t.hours}h</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Client information */}
            <div className="card" data-testid="client-info-card">
              <h2 className="card-title">Client information</h2>
              <div className="mt-3" style={{ fontSize: 13 }}>
                {[
                  ["Full name", client.name],
                  ["Email", client.email],
                  ["Province", corp.province],
                  ["Corporation", corp.name],
                  ["Fiscal year end", fmtDate(corp.fiscal_year_end)],
                  ["Assigned CPA", eng.assigned_cpa?.name || "Pending assignment"],
                  ...(eng.status === "FILED" ? [
                    ["CRA ref number", eng.filing_confirmation || "—"],
                    ["Filed date", fmtDate(eng.filing_date)],
                  ] : []),
                ].map(([k, v]) => (
                  <div key={k} className="list-row" style={{ paddingTop: 12, paddingBottom: 12 }}>
                    <span className="muted">{k}</span>
                    <span style={{ fontWeight: 500 }}>{v || "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right rail */}
          <div className="stack-lg">
            <div className="card" data-testid="current-stage-card">
              <h2 className="card-title">Current stage</h2>
              <div className="list-row mt-3"><span className="muted" style={{ fontSize: 13 }}>Stage</span><StatusBadge status={eng.status} /></div>
              {eng.assigned_cpa && (
                <div className="list-row"><span className="muted" style={{ fontSize: 13 }}>Assigned CPA</span><span style={{ fontWeight: 500, fontSize: 13 }}>{eng.assigned_cpa.name}</span></div>
              )}
              {eng.status === "FILED" && (
                <>
                  <div className="list-row"><span className="muted" style={{ fontSize: 13 }}>Filed date</span><span style={{ fontWeight: 500, fontSize: 13 }}>{fmtDate(eng.filing_date)}</span></div>
                  {eng.filing_confirmation && <div className="list-row"><span className="muted" style={{ fontSize: 13 }}>CRA ref</span><span style={{ color: "#f57f17", fontWeight: 600, fontSize: 13 }}>{eng.filing_confirmation}</span></div>}
                </>
              )}
              <div style={{ marginTop: 16 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Have a question about this file?</div>
                <button className="btn btn-secondary btn-sm w-full" disabled style={{ justifyContent: "center", color: "var(--text-tertiary)" }} data-testid="message-cloudtax-team">Message CloudTax team</button>
              </div>
            </div>

            <div className="card" data-testid="activity-card">
              <div className="flex items-center gap-2"><Activity size={14} style={{ color: "var(--text-secondary)" }} /><h2 className="card-title" style={{ margin: 0 }}>Activity</h2></div>
              <div className="mt-3 stack-sm">
                {history.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No activity yet.</div>}
                {history.map((h) => (
                  <div key={h.id} className="flex items-start gap-2" style={{ paddingTop: 8, paddingBottom: 8 }}>
                    <div className="avatar avatar-sm">{initials(h.changed_by?.name || "")}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12 }}>
                        {h.note || `${h.from_status ? `${h.from_status.replace(/_/g, " ").toLowerCase()} → ` : ""}${h.to_status.replace(/_/g, " ").toLowerCase()}`}
                        {h.changed_by && <span className="muted"> by {h.changed_by.name}</span>}
                      </div>
                      <div className="tertiary" style={{ fontSize: 11, marginTop: 2 }}>{fmtDate(h.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" data-testid="key-dates-card">
              <h2 className="card-title">Key dates</h2>
              <div className="mt-3 stack-sm" style={{ fontSize: 13 }}>
                <div className="list-row"><span className="muted">Fiscal year end</span><span style={{ fontWeight: 500 }}>{fmtDate(corp.fiscal_year_end)}</span></div>
                <div className="list-row"><span className="muted">Province</span><span style={{ fontWeight: 500 }}>{corp.province || "—"}</span></div>
                {corp.fiscal_year_end && (
                  <>
                    <div className="list-row"><span className="muted">T2 filing deadline</span><span style={{ fontWeight: 500 }}>{fmtDate(new Date(new Date(corp.fiscal_year_end).getTime() + 6 * 30 * 86400000))}</span></div>
                    <div className="list-row"><span className="muted">T2 payment deadline</span><span style={{ fontWeight: 500 }}>{fmtDate(new Date(new Date(corp.fiscal_year_end).getTime() + 3 * 30 * 86400000))}</span></div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
