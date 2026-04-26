import React, { useEffect, useState, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { api, fmtError, initials, fmtDate } from "../lib/api";
import { Check, AlertCircle, MessageSquare, ChevronDown, FileText, Eye, Download, Calendar, Clock, FileBarChart, Building2 } from "lucide-react";

const PHASES = [
  { key: "profile", label: "Profile" },
  { key: "documents", label: "Documents" },
  { key: "preparation", label: "Preparation" },
  { key: "review", label: "Review" },
  { key: "filed", label: "Filed" },
];

function statusToPhase(status) {
  if (status === "REFERRED") return 0;
  if (status === "INTAKE") return 1;
  if (status === "IN_PREP") return 2;
  if (status === "IN_REVIEW" || status === "DELIVERY") return 3;
  if (status === "FILED") return 4;
  return 0;
}

function Stepper({ current }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "20px 8px" }} data-testid="stepper">
      {PHASES.map((p, i) => {
        const done = i < current;
        const active = i === current;
        const reached = done || active;
        return (
          <React.Fragment key={p.key}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%",
                border: `2px solid ${reached ? "#1e88e5" : "#d9d5cf"}`,
                background: reached ? "#1e88e5" : "#fff",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
                {reached && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />}
              </div>
              <div style={{
                fontSize: 12, marginTop: 8, fontWeight: active ? 600 : 500,
                color: reached ? "#1e88e5" : "var(--text-tertiary)",
              }}>{p.label}</div>
            </div>
            {i < PHASES.length - 1 && (
              <div style={{ flex: 1, height: 2, background: i < current ? "#1e88e5" : "#d9d5cf", margin: "-22px 6px 0", alignSelf: "center" }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function StagePill({ label }) {
  return <span style={{ background: "var(--bg-subtle)", padding: "5px 14px", borderRadius: 999, fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }} data-testid="stage-pill">{label}</span>;
}

function HiddenFileInput({ onPick, accept = ".pdf,.jpg,.jpeg,.png,.xlsx,.csv", testid, inputRef }) {
  return <input ref={inputRef} type="file" accept={accept} style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} data-testid={testid} />;
}

function ChooseDropdown({ doc, onUpload, onDefer, busy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        data-testid={`choose-${doc.id}`}
        style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border-default)", background: "#fff", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        Choose option <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 10, background: "#1a1a1a", color: "#faf9f7", borderRadius: 8, padding: 4, minWidth: 160, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}>
          <label style={{ display: "block", padding: "10px 14px", fontSize: 12, cursor: "pointer", borderRadius: 6 }}
            onMouseEnter={(e) => e.currentTarget.style.background = "#2c2c2c"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
            Upload now
            <HiddenFileInput onPick={(f) => { setOpen(false); onUpload(f); }} testid={`upload-input-${doc.id}`} />
          </label>
          <button onClick={() => { setOpen(false); onDefer(); }}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", fontSize: 12, color: "inherit", borderRadius: 6 }}
            onMouseEnter={(e) => e.currentTarget.style.background = "#2c2c2c"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            data-testid={`defer-${doc.id}`}>
            I&apos;ll upload later
          </button>
        </div>
      )}
    </div>
  );
}

function DocItem({ doc, onUpload, onDefer, busy, onView, mode = "list" }) {
  const isDone = ["UPLOADED", "REVIEWED", "EXTRACTED"].includes(doc.status);
  const isIssue = doc.status === "ISSUE";
  const isReUploaded = doc.status === "UPLOADED" && doc.re_uploaded_at;
  const showUpdated = isReUploaded || (isDone && doc.uploaded_at && (new Date() - new Date(doc.uploaded_at) < 7 * 86400000));
  return (
    <div data-testid={`doc-item-${doc.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 0", borderBottom: "1px solid var(--border-default)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{doc.name}</span>
          {doc.is_new_request && <span style={{ background: "#e3f2fd", color: "#1565c0", fontSize: 11, fontWeight: 500, padding: "2px 10px", borderRadius: 999 }}>New request</span>}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{doc.description}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {isDone && mode === "list" && (
          <>
            <button onClick={() => onView(doc)} style={{ color: "#1e88e5", fontSize: 13, fontWeight: 500 }} data-testid={`view-${doc.id}`}>View</button>
            <span style={{ background: "#e8f5e9", color: "#2e7d32", padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>
              ✓ {showUpdated ? "Updated" : "Uploaded"}
            </span>
          </>
        )}
        {isDone && mode === "summary" && (
          <span style={{ background: "#e8f5e9", color: "#2e7d32", padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>✓ Uploaded</span>
        )}
        {!isDone && !isIssue && doc.status === "PENDING" && !doc.is_new_request && (
          <span style={{ background: "var(--bg-subtle)", color: "var(--text-secondary)", padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>Not uploaded</span>
        )}
        {!isDone && !isIssue && (doc.is_new_request || (doc.status === "PENDING" && mode === "interactive")) && (
          <ChooseDropdown doc={doc} onUpload={(f) => onUpload(doc, f)} onDefer={() => onDefer(doc)} busy={busy === doc.id} />
        )}
      </div>
    </div>
  );
}

function IssueCard({ doc, onUpload }) {
  const inputRef = useRef();
  return (
    <div style={{
      background: "#fef5f5", border: "1px solid #f3c0c0", borderRadius: 12, padding: "16px 20px",
      display: "flex", alignItems: "flex-start", gap: 14,
    }} data-testid={`issue-card-${doc.id}`}>
      <AlertCircle size={18} style={{ color: "#c62828", marginTop: 2, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#c62828" }}>{doc.name} — Missing statements</div>
        <div style={{ fontSize: 12, color: "#c62828", marginTop: 4, fontWeight: 500 }}>Issue found: {doc.issue_note}</div>
        <div style={{ fontSize: 13, color: "var(--text-primary)", marginTop: 10, lineHeight: 1.6 }}>
          The bank statement provided is incomplete. Please re-upload the missing months.
        </div>
      </div>
      <button
        onClick={() => inputRef.current?.click()}
        style={{ background: "#c62828", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, flexShrink: 0 }}
        data-testid={`reupload-${doc.id}`}
      >Re-upload now</button>
      <HiddenFileInput inputRef={inputRef} onPick={(f) => onUpload(doc, f)} />
    </div>
  );
}

function CpaQuestionItem({ q, onAnswer, busy }) {
  const [draft, setDraft] = useState("");
  if (q.status === "answered") {
    return (
      <div style={{ padding: "16px 0", borderBottom: "1px solid var(--border-default)" }} data-testid={`cpa-q-${q.id}`}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Check size={16} style={{ color: "#2e7d32", marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{q.question}</div>
            <div style={{ fontSize: 12, color: "#2e7d32", marginTop: 6, fontWeight: 500 }}>{q.answer}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ padding: "16px 0", borderBottom: "1px solid var(--border-default)" }} data-testid={`cpa-q-${q.id}`}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Clock size={16} style={{ color: "#ef6c00", marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{q.question}</div>
          {q.helper_text && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{q.helper_text}</div>}
          <textarea
            value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="Type your answer..."
            data-testid={`q-answer-${q.id}`}
            style={{ width: "100%", marginTop: 12, padding: 12, borderRadius: 8, border: "1px solid var(--border-default)", fontSize: 13, minHeight: 80, fontFamily: "inherit", outline: "none" }}
          />
          <button
            onClick={() => draft.trim() && onAnswer(q, draft.trim())}
            disabled={!draft.trim() || busy}
            data-testid={`q-submit-${q.id}`}
            style={{ marginTop: 10, padding: "8px 18px", borderRadius: 8, background: draft.trim() ? "#1e88e5" : "#bbdefb", color: "#fff", fontSize: 13, fontWeight: 500 }}
          >Submit</button>
        </div>
      </div>
    </div>
  );
}

function fmtCurrency(n) {
  if (n === null || n === undefined) return "—";
  return n < 0 ? `($${Math.abs(n).toLocaleString()})` : `$${n.toLocaleString()}`;
}

export default function ClientPortal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [eng, setEng] = useState(null);
  const [docs, setDocs] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");
  const [authChecks, setAuthChecks] = useState({});
  const [authBusy, setAuthBusy] = useState(false);

  const loadAll = async () => {
    try {
      const { data: list } = await api.get("/engagements");
      const e = list[0];
      setEng(e);
      if (e) {
        const [d, q] = await Promise.all([
          api.get(`/engagements/${e.id}/documents`),
          api.get(`/engagements/${e.id}/cpa-questions`),
        ]);
        setDocs(d.data);
        setQuestions(q.data);
      }
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { loadAll(); }, []);

  const onUpload = async (doc, file) => {
    if (!file) return;
    setBusy(doc.id); setErr("");
    try {
      const { data } = await api.post(`/documents/${doc.id}/upload-url`, {
        content_type: file.type || "application/octet-stream", file_name: file.name,
      });
      const putResp = await fetch(data.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream", "x-amz-server-side-encryption": "AES256" },
        body: file,
      });
      if (!putResp.ok) throw new Error(`Upload failed (${putResp.status})`);
      await api.post(`/documents/${doc.id}/complete-upload`, {
        object_key: data.object_key, file_name: file.name, file_size: file.size, mime_type: file.type || "application/octet-stream",
      });
      await loadAll();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(null);
  };

  const onView = async (doc) => {
    try { const { data } = await api.get(`/documents/${doc.id}/download-url`); window.open(data.download_url, "_blank"); }
    catch (x) { setErr(fmtError(x)); }
  };

  const onDefer = async (doc) => {
    try { await api.post(`/documents/${doc.id}/defer`); await loadAll(); } catch (x) { setErr(fmtError(x)); }
  };

  const onAnswer = async (q, answer) => {
    setBusy(q.id);
    try { await api.patch(`/engagements/${eng.id}/cpa-questions/${q.id}`, { answer }); await loadAll(); }
    catch (x) { setErr(fmtError(x)); }
    setBusy(null);
  };

  const AUTH_ITEMS = [
    { k: "income", label: "All business income is included and correct" },
    { k: "shareholder_t4", label: "Shareholder employment income matches T4 issued" },
    { k: "expenses", label: "All deductible business expenses are captured" },
    { k: "cca", label: "Capital cost allowance amounts are accurate" },
    { k: "shareholder_loan", label: "Shareholder loan balance at year-end is reconciled" },
  ];
  const allAuthed = AUTH_ITEMS.every((it) => authChecks[it.k]);

  const onAuthorize = async () => {
    setAuthBusy(true);
    try {
      await api.post(`/engagements/${eng.id}/authorize-filing`, { confirmations: authChecks });
      await loadAll();
    } catch (x) { setErr(fmtError(x)); }
    setAuthBusy(false);
  };

  // Empty state
  if (!eng || eng.status === "ONBOARDING") return (
    <div className="page-narrow stack-lg" style={{ paddingTop: 32 }} data-testid="empty-state">
      <h1 className="page-title">Welcome, {user?.name?.split(" ")[0]}</h1>
      <p className="muted" style={{ fontSize: 13 }}>Your CloudTax × Wealthsimple corporate tax engagement is being set up.</p>
      <div className="card">
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          Your Wealthsimple advisor is setting up your file. A licensed CPA will be assigned shortly and you&apos;ll be notified to begin uploading documents.
        </p>
      </div>
    </div>
  );

  const phase = statusToPhase(eng.status);
  const stageLabel = PHASES[phase].label;
  const corp = eng.corporation || {};
  const cpa = eng.assigned_cpa;
  const issueDocs = docs.filter((d) => d.status === "ISSUE");
  const visibleDocs = docs.filter((d) => !d.deferred_at);
  const taxSummary = eng.tax_summary || {};
  const t2DraftDoc = eng.t2_draft_doc_id ? docs.find((d) => d.id === eng.t2_draft_doc_id) : null;
  const isFiled = eng.status === "FILED";
  const craConfNum = eng.filing_confirmation || `CRA-FILE-${(eng.id || "").slice(0, 6).toUpperCase()}`;

  return (
    <div className="page-narrow stack-lg" style={{ paddingTop: 24, maxWidth: 760 }} data-testid="client-portal">
      {/* Engagement title card */}
      <div className="card" data-testid="engagement-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>YOUR ENGAGEMENT</div>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>Your corporate tax filing</h1>
            <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{corp.name} · Fiscal year ending {fmtDate(corp.fiscal_year_end)}</p>
          </div>
          <StagePill label={stageLabel} />
        </div>
      </div>

      {/* Stepper */}
      <div className="card" data-testid="stepper-card"><Stepper current={phase} /></div>

      {err && <div className="alert alert-risk">{err}</div>}

      {/* PROFILE STAGE */}
      {phase === 0 && (
        <>
          <div className="card" data-testid="profile-success">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#e8f5e9", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Check size={18} style={{ color: "#2e7d32" }} />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Your profile has been created</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>CloudTax has set up your engagement — you&apos;re ready to start</div>
              </div>
            </div>
            <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px" }}>
              <div><div className="section-label">FULL NAME</div><div style={{ fontSize: 14, marginTop: 4 }}>{user?.name}</div></div>
              <div><div className="section-label">CORPORATION</div><div style={{ fontSize: 14, marginTop: 4 }}>{corp.name || "—"}</div></div>
              <div><div className="section-label">BUSINESS NUMBER</div><div style={{ fontSize: 14, marginTop: 4 }}>{corp.business_number || "—"}</div></div>
              <div><div className="section-label">FISCAL YEAR END</div><div style={{ fontSize: 14, marginTop: 4 }}>{fmtDate(corp.fiscal_year_end)}</div></div>
              <div><div className="section-label">PROVINCE</div><div style={{ fontSize: 14, marginTop: 4 }}>{corp.province === "ON" ? "Ontario" : corp.province || "—"}</div></div>
              <div><div className="section-label">ASSIGNED CPA</div><div style={{ fontSize: 14, marginTop: 4 }}>{cpa?.name || "Pending"}</div></div>
            </div>
          </div>

          <div className="card" data-testid="docs-needed-card">
            <div className="section-label" style={{ marginBottom: 16 }}>DOCUMENTS WE NEED</div>
            {visibleDocs.map((d) => <DocItem key={d.id} doc={d} mode="summary" />)}
            <button
              onClick={() => navigate("/portal#documents")}
              style={{ marginTop: 18, width: "100%", padding: "14px", borderRadius: 10, border: "1.5px solid #1e88e5", color: "#1e88e5", background: "#fff", fontSize: 14, fontWeight: 500 }}
              data-testid="start-uploading"
            >Start uploading →</button>
          </div>
        </>
      )}

      {/* DOCUMENTS STAGE */}
      {phase === 1 && (
        <div className="card" data-testid="docs-interactive-card">
          <div className="section-label" style={{ marginBottom: 16 }}>DOCUMENTS WE NEED</div>
          {visibleDocs.filter((d) => d.status !== "ISSUE").map((d) => <DocItem key={d.id} doc={d} mode="interactive" onUpload={onUpload} onView={onView} onDefer={onDefer} busy={busy} />)}
          {issueDocs.map((d) => <div key={d.id} style={{ marginTop: 18 }}><IssueCard doc={d} onUpload={onUpload} /></div>)}
        </div>
      )}

      {/* PREPARATION STAGE */}
      {phase === 2 && (
        <>
          <div className="card" data-testid="docs-summary-card">
            <div className="section-label" style={{ marginBottom: 16 }}>DOCUMENTS WE NEED</div>
            {visibleDocs.map((d) => <DocItem key={d.id} doc={d} mode="summary" />)}
          </div>

          <div className="card" data-testid="cpa-questions-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="section-label">QUESTIONS FROM YOUR CPA</div>
              {questions.filter((q) => q.status === "pending").length > 0 && (
                <span style={{ background: "#fff3e0", color: "#ef6c00", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 500 }} data-testid="pending-questions-count">
                  {questions.filter((q) => q.status === "pending").length} pending
                </span>
              )}
            </div>
            {questions.length === 0 && <div className="muted" style={{ fontSize: 13, padding: 16, textAlign: "center" }}>No questions yet — your CPA will reach out as needed.</div>}
            {questions.map((q) => <CpaQuestionItem key={q.id} q={q} onAnswer={onAnswer} busy={busy === q.id} />)}
          </div>
        </>
      )}

      {/* REVIEW STAGE */}
      {phase === 3 && (
        <>
          <div data-testid="cpa-message-bubble" style={{
            background: "#e3f2fd", border: "1px solid #c5dcf2", borderRadius: 12, padding: 18,
            display: "flex", alignItems: "flex-start", gap: 14,
          }}>
            <div className="avatar" style={{ width: 36, height: 36, fontSize: 12, flexShrink: 0 }}>{initials(cpa?.name || "CPA")}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{cpa?.name || "Your CPA"}</div>
              <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
                Your draft T2 return is ready for your review. Please check the figures below, confirm the checklist, and authorize us to file with CRA.
              </div>
            </div>
          </div>

          <div className="card" data-testid="tax-summary-card">
            <div className="section-label" style={{ marginBottom: 16 }}>TAX SUMMARY</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "var(--bg-subtle)", borderRadius: 10 }}>
              <div style={{ width: 36, height: 44, borderRadius: 6, background: "#c62828", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>PDF</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{t2DraftDoc?.file_name || `T2_Draft_Return_${user?.name?.split(" ").slice(-1)[0] || "Client"}_${new Date().getFullYear()}.pdf`}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  Uploaded by {cpa?.name || "your CPA"} · {fmtDate(eng.updated_at || eng.created_at)} · 284 KB
                </div>
              </div>
              <button
                onClick={() => t2DraftDoc && onView(t2DraftDoc)}
                style={{ background: "#1e88e5", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }}
                data-testid="preview-t2"
              ><Eye size={14} /> Preview</button>
            </div>
          </div>

          <div className="card" data-testid="docs-submitted-card">
            <div className="section-label" style={{ marginBottom: 16 }}>DOCUMENTS SUBMITTED</div>
            {visibleDocs.map((d) => <DocItem key={d.id} doc={d} mode="summary" />)}
          </div>

          <div className="card" data-testid="authorize-card">
            <div className="section-label" style={{ marginBottom: 8 }}>AUTHORIZE FILING</div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>Confirm each item, then authorize your CPA to submit to CRA.</p>
            <div className="stack-sm">
              {AUTH_ITEMS.map((it) => (
                <label key={it.k} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", cursor: "pointer", fontSize: 13 }} data-testid={`auth-item-${it.k}`}>
                  <input
                    type="checkbox" checked={!!authChecks[it.k]}
                    onChange={(e) => setAuthChecks({ ...authChecks, [it.k]: e.target.checked })}
                    style={{ width: 18, height: 18, accentColor: "#1e88e5" }}
                    data-testid={`auth-checkbox-${it.k}`}
                  />
                  <span>{it.label}</span>
                </label>
              ))}
            </div>
            <button
              onClick={onAuthorize}
              disabled={!allAuthed || authBusy}
              data-testid="authorize-btn"
              style={{
                marginTop: 18, width: "100%", padding: "14px", borderRadius: 10,
                background: allAuthed ? "#1e88e5" : "#bbdefb", color: "#fff",
                fontSize: 14, fontWeight: 500, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                cursor: allAuthed ? "pointer" : "not-allowed",
              }}
            >👍 Authorize filing with CRA</button>
          </div>
        </>
      )}

      {/* FILED STAGE */}
      {isFiled && (
        <>
          <div data-testid="filed-success" style={{
            background: "#e8f5e9", border: "1px solid #bbe1bd", borderRadius: 12, padding: "20px 24px",
            display: "flex", alignItems: "flex-start", gap: 14,
          }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#2e7d32", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Check size={20} style={{ color: "#fff" }} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#2e7d32" }}>T2 return filed with CRA</div>
              <div style={{ fontSize: 13, color: "#2e7d32", marginTop: 4 }}>Filed by {cpa?.name || "your CPA"} · {fmtDate(eng.filing_date)}</div>
              <div style={{ marginTop: 12 }}>
                <span style={{ background: "#fff", padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500, marginRight: 8 }}>CRA confirmation #</span>
                <code style={{ fontSize: 12, fontWeight: 600 }} data-testid="cra-conf-num">{craConfNum}</code>
              </div>
            </div>
          </div>

          <div className="card" data-testid="filed-summary-card">
            <div className="section-label" style={{ marginBottom: 16 }}>FILED RETURN SUMMARY</div>
            {[
              { k: "net_income", label: "Net income for tax purposes", val: fmtCurrency(taxSummary.net_income) },
              { k: "total_tax", label: "Total tax assessed", val: fmtCurrency(taxSummary.total_tax) },
              { k: "instalments_paid", label: "Instalments paid", val: taxSummary.instalments_paid != null ? fmtCurrency(-Math.abs(taxSummary.instalments_paid)) : "—" },
              { k: "balance_owing", label: "Balance owing", val: fmtCurrency(taxSummary.balance_owing), bold: true, color: taxSummary.balance_owing > 0 ? "#ef6c00" : "var(--text-primary)" },
              { k: "payment_due_date", label: "Payment due date", val: taxSummary.payment_due_date ? fmtDate(taxSummary.payment_due_date) : "—", color: "#ef6c00" },
            ].map((row) => (
              <div key={row.k} style={{ display: "flex", justifyContent: "space-between", padding: "14px 0", borderBottom: "1px solid var(--border-default)" }}>
                <span style={{ fontSize: 13, fontWeight: row.bold ? 600 : 500 }}>{row.label}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: row.color || "var(--text-primary)" }}>{row.val}</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                onClick={() => t2DraftDoc && onView(t2DraftDoc)}
                style={{ background: "#1e88e5", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }}
                data-testid="download-filed"
              ><Download size={14} /> Download filed return</button>
              <button
                onClick={() => window.open("https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/business-account.html", "_blank")}
                style={{ background: "#fff", border: "1px solid var(--border-default)", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }}
                data-testid="view-cra"
              ><Eye size={14} /> View in CRA My Account</button>
            </div>
          </div>

          <div className="card" data-testid="whats-next-card">
            <div className="section-label" style={{ marginBottom: 16 }}>WHAT&apos;S NEXT</div>
            {[
              { Icon: FileBarChart, color: "#ef6c00", bg: "#fff3e0", title: "Pay your balance owing", desc: `${fmtCurrency(taxSummary.balance_owing)} is due by ${taxSummary.payment_due_date ? fmtDate(taxSummary.payment_due_date) : "the due date"}. Pay via CRA My Payment, online banking, or at your financial institution to avoid interest charges.` },
              { Icon: Clock, color: "#1565c0", bg: "#e3f2fd", title: "Notice of Assessment in 4–8 weeks", desc: "CRA will process your return and issue a Notice of Assessment. We'll notify you when it arrives." },
              { Icon: Calendar, color: "#5e35b1", bg: "#ede7f6", title: "Plan 2026 corporate tax instalments", desc: `Based on this year's tax of ${fmtCurrency(taxSummary.total_tax)}, quarterly instalments may be required starting March 2026.` },
            ].map((row, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 0", borderBottom: i < 2 ? "1px solid var(--border-default)" : "none" }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: row.bg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <row.Icon size={16} style={{ color: row.color }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{row.title}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>{row.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* CPA Information + CRA access (always shown) */}
      <div className="card" data-testid="cpa-cra-card">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div className="section-label" style={{ marginBottom: 12 }}>CPA INFORMATION</div>
            {cpa ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="avatar" style={{ width: 36, height: 36, fontSize: 12 }}>{initials(cpa.name)}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{cpa.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>Your tax professional</div>
                  </div>
                </div>
                <button onClick={() => navigate("/portal/messages")} style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border-default)", background: "#fff", fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }} data-testid="message-cpa">
                  <MessageSquare size={12} /> Message
                </button>
              </>
            ) : <div className="muted" style={{ fontSize: 12 }}>CPA assignment in progress</div>}
          </div>
          <div>
            <div className="section-label" style={{ marginBottom: 12 }}>CRA ACCESS</div>
            {eng.cra_access_status === "ACCESS_VERIFIED" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#2e7d32", fontSize: 14, fontWeight: 500 }}>
                <Check size={16} /> Confirmed
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>Your CPA will guide you through CRA authorization.</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ height: 40 }} />
    </div>
  );
}
