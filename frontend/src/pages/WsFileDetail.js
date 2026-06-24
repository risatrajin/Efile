import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, fmtError, fmtDate, initials, TIME_LABELS } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge, StatusBadge } from "../components/shared/Badges";
import PartnerFeedbackCard from "../components/shared/PartnerFeedbackCard";
import { Lock, FileText, Clock, Activity, ArrowLeft, Check, CircleDashed, AlertCircle } from "lucide-react";

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

// Stage copy differs by service model: DFY = CloudTax CPA does the work; DIY =
// the client files on their own (no CPA in the loop).
const STAGE_COPY = {
  REFERRED: {
    dfy: ["Awaiting CPA assignment", "Client has been referred to CloudTax. Our team will assign a CPA and reach out to begin the intake process within 1–2 business days."],
    diy: ["Getting started", "Client is setting up their self-file workspace and will start their own return shortly."],
  },
  INTAKE: {
    dfy: ["Intake in progress", "The CPA is collecting documents from the client."],
    diy: ["Gathering documents", "Client is collecting and uploading their own documents."],
  },
  IN_PREP: {
    dfy: ["T2 preparation underway", "The CPA is preparing the corporate tax return."],
    diy: ["Preparing return", "Client is preparing their own T2 corporate return."],
  },
  IN_REVIEW: {
    dfy: ["Internal review", "The return is being reviewed by senior CPA before filing."],
    diy: ["Final review", "Client is reviewing their own return before filing it themselves."],
  },
  FILED: {
    dfy: ["Return filed with CRA", "The T2 return has been filed with the CRA. The client should expect a Notice of Assessment in approximately 6–8 weeks."],
    diy: ["Return filed with CRA", "Client filed their own T2 return with the CRA. They should expect a Notice of Assessment in approximately 6–8 weeks."],
  },
};

function StageMessage({ status, isDIY }) {
  const copy = STAGE_COPY[status];
  if (!copy) return null;
  const [title, body] = isDIY ? copy.diy : copy.dfy;
  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 14, marginTop: 16 }}>{title}</div>
      <p className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>{body}</p>
    </div>
  );
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = async () => {
    try {
      const [a, b] = await Promise.all([
        api.get(`/engagements/${eid}`),
        api.get(`/engagements/${eid}/history`).catch(() => ({ data: [] })),
      ]);
      setEng(a.data);
      setHistory(b.data || []);
      setLoadFailed(false); setNotFound(false);
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
    } catch (x) {
      setErr(fmtError(x));
      // A failed initial load (bad/stale id 404'd) must not spin on "Loading…"
      // forever — show a recoverable state instead. Partners view the whole
      // pilot, so there's no 403 case here; only the 404/bad-id path.
      setLoadFailed(true);
      setNotFound(x?.response?.status === 404);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eid]);

  if (!eng) {
    if (loadFailed) return (
      <div className={rootClass}>
        <AppHeader tabs={[{ key: "dashboard", to: "/partner/dashboard", label: "Dashboard" }]} />
        <div className="page-wide stack-lg" data-testid="partner-file-error">
          <div className="card" style={{ textAlign: "center", padding: "48px 24px", maxWidth: 480, margin: "40px auto" }}>
            <AlertCircle size={32} style={{ color: "var(--text-tertiary)", margin: "0 auto 12px" }} />
            <h1 className="page-title" style={{ fontSize: 20 }}>{notFound ? "Client not found" : "Couldn’t load this client"}</h1>
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              {notFound
                ? "This client may have been removed, or the link is out of date."
                : "Something went wrong loading this client. Please try again."}
            </p>
            <div className="flex gap-2" style={{ justifyContent: "center", marginTop: 20 }}>
              {!notFound && <button className="btn btn-secondary btn-sm" onClick={() => { setLoadFailed(false); setErr(""); load(); }} data-testid="partner-file-retry">Try again</button>}
              <Link to="/partner/dashboard" className="btn btn-primary btn-sm" data-testid="partner-file-back"><ArrowLeft size={12} /> Back to dashboard</Link>
            </div>
          </div>
        </div>
      </div>
    );
    return (
      <div className={rootClass}><AppHeader tabs={[{ key: "dashboard", to: "/partner/dashboard", label: "Dashboard" }]} /><div className="page-wide">Loading…</div></div>
    );
  }

  const corp = eng.corporation || {};
  const client = eng.client || {};
  const isOnboarding = eng.status === "ONBOARDING";
  const isDIY = eng.service_model === "DIY";
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
                {isDIY && (
                  <span style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 600, color: "#fff", background: "var(--accent-dark)", borderRadius: 999, padding: "2px 10px" }}>Do it yourself</span>
                )}
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
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{isDIY ? "Slips received" : "Docs received"}</div>
            </div>
          </div>
        </div>

        <div className="two-col">
          <div className="stack-lg">
            {/* Filing progress */}
            <div className="card" data-testid="filing-progress-card">
              <h2 className="card-title">Filing progress</h2>
              <FilingProgress status={isOnboarding ? "REFERRED" : eng.status} />
              <StageMessage status={isOnboarding ? "REFERRED" : eng.status} isDIY={isDIY} />
            </div>

            {/* Document status */}
            <div className="card" data-testid="doc-status-card">
              <div className="flex items-center gap-2"><FileText size={14} style={{ color: "var(--text-secondary)" }} /><h2 className="card-title" style={{ margin: 0 }}>{isDIY ? "Tax slips" : "Document status"}</h2></div>
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{isDIY ? "Self-serve — the client gathers and uploads their own tax slips" : "Managed by CloudTax — documents are collected directly from the client by their assigned CPA"}</p>
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

            {/* Time log — CPA-only. DIY clients are self-serve, so there's no
                CPA time to surface; hide the card entirely. */}
            {!isDIY && (
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
            )}

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
                  isDIY ? ["Filing method", "Self-file (no CPA)"] : ["Assigned CPA", eng.assigned_cpa?.name || "Pending assignment"],
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

            {/* The one writable surface in the otherwise view-only partner portal */}
            <PartnerFeedbackCard eid={eid} />
          </div>

          {/* Right rail */}
          <div className="stack-lg">
            <div className="card" data-testid="current-stage-card">
              <h2 className="card-title">Current stage</h2>
              <div className="list-row mt-3"><span className="muted" style={{ fontSize: 13 }}>Stage</span><StatusBadge status={eng.status} /></div>
              {isDIY ? (
                <div className="list-row"><span className="muted" style={{ fontSize: 13 }}>Filing method</span><span style={{ fontWeight: 500, fontSize: 13 }}>Self-file</span></div>
              ) : eng.assigned_cpa && (
                <div className="list-row"><span className="muted" style={{ fontSize: 13 }}>Assigned CPA</span><span style={{ fontWeight: 500, fontSize: 13 }}>{eng.assigned_cpa.name}</span></div>
              )}
              {eng.status === "FILED" && (
                <>
                  <div className="list-row"><span className="muted" style={{ fontSize: 13 }}>Filed date</span><span style={{ fontWeight: 500, fontSize: 13 }}>{fmtDate(eng.filing_date)}</span></div>
                  {eng.filing_confirmation && <div className="list-row"><span className="muted" style={{ fontSize: 13 }}>CRA ref</span><span style={{ color: "#f57f17", fontWeight: 600, fontSize: 13 }}>{eng.filing_confirmation}</span></div>}
                </>
              )}
              {/* "Message CloudTax team" intentionally hidden until partner
                  messaging is built — it was a permanently-disabled placeholder.
                  Restore this block (prompt + button) once the feature exists. */}
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
