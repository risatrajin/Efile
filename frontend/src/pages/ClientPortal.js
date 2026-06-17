import React, { useEffect, useState, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { api, fmtError, initials, fmtDate } from "../lib/api";
import { Check, AlertCircle, MessageSquare, ChevronDown, FileText, Eye, Download, Calendar, Clock, FileBarChart, Building2, Trash2, ThumbsUp, Flag, PenLine, Plus } from "lucide-react";
import DraftHistoryTable from "../components/shared/DraftHistoryTable";
import T183SigningModal from "../components/shared/T183SigningModal";

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
  // Minimal, compact, modern progress indicator.
  // - 8px filled dots for done/active stages, 8px hollow ring for upcoming.
  // - 1px connecting line, only visible between dots, color shifts at the boundary.
  // - Small uppercase labels below; active stage label uses primary color + medium weight.
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 0, padding: "10px 4px" }} data-testid="stepper">
      {PHASES.map((p, i) => {
        const done = i < current;
        const active = i === current;
        const reached = done || active;
        return (
          <React.Fragment key={p.key}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto", minWidth: 64 }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%",
                background: reached ? "var(--accent-dark)" : "transparent",
                border: `1.5px solid ${reached ? "var(--accent-dark)" : "var(--border-strong)"}`,
                boxShadow: active ? "0 0 0 4px rgba(26,26,26,0.06)" : "none",
                transition: "all 160ms ease",
              }} />
              <div style={{
                fontSize: 11, marginTop: 8,
                fontWeight: active ? 600 : 400,
                color: active ? "var(--text-primary)" : reached ? "var(--text-secondary)" : "var(--text-tertiary)",
                letterSpacing: "0.02em", whiteSpace: "nowrap",
              }}>{p.label}</div>
            </div>
            {i < PHASES.length - 1 && (
              <div style={{
                flex: 1, height: 1, marginTop: 5,
                background: i < current ? "var(--accent-dark)" : "var(--border-default)",
                transition: "background-color 160ms ease",
              }} />
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

function fmtSize(b) {
  if (!b && b !== 0) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function DocStatusDot({ doc }) {
  // Colored dot rendered before the document title to make each request's
  // current state scannable at a glance. Keep this compact (8px) — the
  // text-based badges (REQUIRED / New request / ✓ Uploaded / Upload pending)
  // carry the verbose labeling.
  const isDone = ["UPLOADED", "REVIEWED", "EXTRACTED"].includes(doc.status);
  const isIssue = doc.status === "ISSUE";
  const isDeferred = !!doc.deferred_at && !isDone && !isIssue;
  let color = "#d5d1cc"; // neutral default (not yet actioned)
  let title = "Awaiting your choice";
  if (isIssue) { color = "#c62828"; title = "Issue — please re-upload"; }
  else if (isDone) { color = "#2e7d32"; title = "Uploaded"; }
  else if (isDeferred) { color = "#ef6c00"; title = "Upload pending (you chose to upload later)"; }
  else if (doc.is_required) { color = "#ef6c00"; title = "Required"; }
  return (
    <span
      aria-label={title}
      title={title}
      data-testid={`doc-status-dot-${doc.id}`}
      style={{
        display: "inline-block", width: 8, height: 8, borderRadius: 999,
        background: color, flexShrink: 0,
      }}
    />
  );
}

function DocItem({ doc, onUpload, onDefer, onRemove, onRemoveFile, busy, onView, onViewFile, mode = "list" }) {
  const isDone = ["UPLOADED", "REVIEWED", "EXTRACTED"].includes(doc.status);
  const isIssue = doc.status === "ISSUE";
  const isReUploaded = doc.status === "UPLOADED" && doc.re_uploaded_at;
  const isDeferred = !!doc.deferred_at && !isDone && !isIssue;
  const showUpdated = isReUploaded || (isDone && doc.uploaded_at && (new Date() - new Date(doc.uploaded_at) < 7 * 86400000));
  const canEdit = mode === "interactive";
  // Unified files[] (server normalizes legacy single-file docs) sorted oldest → newest
  const files = (doc.files && doc.files.length ? doc.files : []).slice().sort((a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at));
  const addFileRef = useRef();
  return (
    <div data-testid={`doc-item-${doc.id}`} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "16px 0", borderBottom: "1px solid var(--border-default)", gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <DocStatusDot doc={doc} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>{doc.name}</span>
          {doc.is_new_request && <span style={{ background: "#e3f2fd", color: "#1565c0", fontSize: 11, fontWeight: 500, padding: "2px 10px", borderRadius: 999 }}>New request</span>}
          {doc.is_required && !isDone && !isIssue && !isDeferred && (
            <span style={{ background: "#fff3e0", color: "#ef6c00", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999, letterSpacing: 0.3 }}>REQUIRED</span>
          )}
          {isDeferred && (
            <span
              data-testid={`doc-deferred-badge-${doc.id}`}
              style={{ background: "#fff3e0", color: "#ef6c00", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999, letterSpacing: 0.3 }}
            >UPLOAD PENDING</span>
          )}
          {isDone && files.length > 1 && (
            <span data-testid={`file-count-${doc.id}`} style={{ background: "var(--bg-subtle)", color: "var(--text-secondary)", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999, letterSpacing: 0.3 }}>
              {files.length} FILES
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {doc.description}
          {isDeferred && (
            <span
              className="tertiary"
              data-testid={`doc-deferred-hint-${doc.id}`}
              style={{ display: "block", fontSize: 11, marginTop: 4, color: "#ef6c00" }}
            >You chose to upload this later. Open the menu any time to upload.</span>
          )}
        </div>
        {isDone && files.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {files.map((f) => (
              <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {f.uploaded_by && (
                  <div
                    className="tertiary"
                    data-testid={`uploaded-by-${doc.id}-${f.id}`}
                    style={{ fontSize: 11, lineHeight: 1.3 }}
                  >
                    Uploaded by <strong style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{f.uploaded_by.name}</strong>
                    {(() => {
                      // Prefer the delegate's relationship when present
                      // (Bookkeeper / Spouse / etc.), fall back to a friendly
                      // role label so primary-client uploads aren't blank.
                      const rel = (f.uploaded_by.relationship || "").trim();
                      const role = (f.uploaded_by.role || "").trim();
                      const tag = rel
                        ? rel.charAt(0).toUpperCase() + rel.slice(1)
                        : role === "CLIENT" ? "Client"
                        : role === "CPA" ? "CPA"
                        : role === "ADMIN" ? "Admin"
                        : role === "PARTNER" ? "Partner"
                        : "";
                      return tag ? <> · {tag}</> : null;
                    })()}
                    {f.uploaded_at ? <> · {fmtDate(f.uploaded_at)}</> : null}
                  </div>
                )}
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => onViewFile ? onViewFile(doc, f) : onView?.(doc)}
                  data-testid={`uploaded-file-${doc.id}-${f.id}`}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "6px 10px", background: "var(--bg-subtle)", borderRadius: 6,
                    fontSize: 12, color: "var(--text-primary)", border: "1px solid var(--border-default)",
                    cursor: (onView || onViewFile) ? "pointer" : "default", maxWidth: "100%",
                  }}
                >
                  <FileText size={12} style={{ color: "#1565c0", flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>{f.file_name}</span>
                  {f.file_size > 0 && <span className="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>· {fmtSize(f.file_size)}</span>}
                </button>
                {/* Explicit "View" button — equally visible to primary client AND
                    delegates so the action is discoverable. The whole pill is
                    also clickable, but the icon-button hits the same handler
                    and confirms the doc can be opened. */}
                {(onView || onViewFile) && (
                  <button
                    type="button"
                    onClick={() => onViewFile ? onViewFile(doc, f) : onView?.(doc)}
                    data-testid={`view-file-${doc.id}-${f.id}`}
                    title="View"
                    aria-label={`View ${f.file_name || "file"}`}
                    style={{
                      width: 28, height: 28, borderRadius: 6,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      color: "var(--text-secondary)", background: "transparent",
                      border: "1px solid var(--border-default)",
                      transition: "background-color 120ms ease, color 120ms ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-subtle)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                  ><Eye size={12} /></button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      if (files.length > 1 && onRemoveFile) onRemoveFile(doc, f);
                      else onRemove?.(doc);
                    }}
                    disabled={busy === doc.id}
                    data-testid={`remove-${doc.id}-${f.id}`}
                    title="Remove file"
                    style={{
                      width: 24, height: 24, borderRadius: 6,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      color: "#c62828", background: "transparent", transition: "background-color 120ms ease",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#fef5f5"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  ><Trash2 size={12} /></button>
                )}
                </div>
              </div>
            ))}
            {canEdit && onUpload && (
              <>
                <button
                  type="button"
                  onClick={() => addFileRef.current?.click()}
                  disabled={busy === doc.id}
                  data-testid={`add-another-file-${doc.id}`}
                  className="btn btn-secondary btn-sm"
                  style={{ alignSelf: "flex-start", marginTop: 4 }}
                ><Plus size={12} /> Add another file</button>
                <HiddenFileInput inputRef={addFileRef} onPick={(f) => onUpload(doc, f)} />
              </>
            )}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, marginTop: 2 }}>
        {isDone && mode !== "summary" && (
          <span style={{ background: "#e8f5e9", color: "#2e7d32", padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>
            ✓ {showUpdated ? "Updated" : "Uploaded"}
          </span>
        )}
        {isDone && mode === "summary" && (
          <span style={{ background: "#e8f5e9", color: "#2e7d32", padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>✓ Uploaded</span>
        )}
        {!isDone && !isIssue && doc.status === "PENDING" && !doc.is_new_request && !isDeferred && mode === "summary" && (
          <span style={{ background: "var(--bg-subtle)", color: "var(--text-secondary)", padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>Not uploaded</span>
        )}
        {!isDone && !isIssue && isDeferred && mode === "summary" && (
          <span data-testid={`doc-pending-summary-${doc.id}`} style={{ background: "#fff3e0", color: "#ef6c00", padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>Upload pending</span>
        )}
        {!isDone && !isIssue && mode === "interactive" && (doc.is_new_request || isDeferred || doc.status === "PENDING") && (
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
            className="btn btn-primary btn-sm"
            style={{ marginTop: 10 }}
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

function T183Card({ eng, onPreview, onSign, delegateContext }) {
  // When the current user is a delegate (rather than the primary physician),
  // the T183 must still be signed by the primary client personally — CRA
  // legal authority. Show a friendly message instead of the sign button.
  const ctx = (delegateContext?.contexts || []).find((c) => c.engagement_id === eng.id);
  const isDelegate = !!ctx;
  const primaryName = ctx?.primary_client_first_name || ctx?.primary_client_name || "the primary client";
  return (
    <div className="card" data-testid="t183-card">
      <div data-testid="t183-row" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 36, height: 44, borderRadius: 6, background: "#1a1a1a", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>T183</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>CRA T183 — Authorization to E-File</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {eng.t183_signed_at
              ? <>Signed by {eng.t183_signed_name} · {fmtDate(eng.t183_signed_at)}</>
              : isDelegate
                ? <>Awaiting signature from <strong>{primaryName}</strong>.</>
                : "Required: sign to authorize CPA to file electronically with CRA."}
          </div>
        </div>
        <button onClick={onPreview} className="btn btn-secondary btn-sm" data-testid="t183-preview">
          <Eye size={14} /> Preview
        </button>
        {eng.t183_signed_at ? (
          <span className="badge badge-complete" data-testid="t183-signed-badge" style={{ fontSize: 11 }}>Signed</span>
        ) : isDelegate ? (
          <span
            data-testid="t183-delegate-blocked"
            style={{
              padding: "6px 12px", borderRadius: 999,
              background: "#fff3e0", color: "#ef6c00",
              fontSize: 11, fontWeight: 500,
            }}
            title={`Only ${primaryName} can sign this document.`}
          >Primary client only</span>
        ) : (
          <button onClick={onSign} className="btn btn-primary btn-sm" data-testid="t183-sign-btn">
            <PenLine size={14} /> Sign T183
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewDecisionCard({ onSubmit }) {
  const [mode, setMode] = useState(null); // 'good' | 'issue' | null
  const [issue, setIssue] = useState("");
  const [busy, setBusy] = useState(false);

  const submitGood = async () => {
    setBusy(true);
    await onSubmit("approved");
    setBusy(false);
  };
  const submitIssue = async () => {
    if (!issue.trim()) return;
    setBusy(true);
    await onSubmit("issue", issue.trim());
    setBusy(false);
  };

  // Neutral baseline; hover reveals a subtle accent. No emojis, single-color line icons.
  const optionBase = {
    padding: "16px 18px",
    borderRadius: 12,
    background: "#fff",
    border: "1px solid var(--border-default)",
    color: "var(--text-primary)",
    fontSize: 14,
    fontWeight: 500,
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    cursor: "pointer",
    transition: "border-color 120ms ease, background-color 120ms ease, color 120ms ease",
  };

  if (!mode) {
    return (
      <div className="card" data-testid="review-decision-card">
        <div className="section-label" style={{ marginBottom: 8 }}>YOUR REVIEW</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>After previewing the draft, let us know your decision.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <button
            onClick={() => setMode("good")}
            data-testid="review-good"
            style={optionBase}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#2e7d32"; e.currentTarget.style.background = "#f4faf5"; e.currentTarget.style.color = "#2e7d32"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "var(--text-primary)"; }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><ThumbsUp size={16} strokeWidth={1.75} /> Everything looks good</span>
            <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>Authorize CPA to file with CRA</span>
          </button>
          <button
            onClick={() => setMode("issue")}
            data-testid="review-issue"
            style={optionBase}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#c62828"; e.currentTarget.style.background = "#fdf6f6"; e.currentTarget.style.color = "#c62828"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "var(--text-primary)"; }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Flag size={16} strokeWidth={1.75} /> I found an issue</span>
            <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>Send a correction request to your CPA</span>
          </button>
        </div>
      </div>
    );
  }

  if (mode === "good") {
    return (
      <div className="card" data-testid="review-good-confirm">
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Approve this return?</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Your CPA will file the return with CRA on your behalf. You will not be able to make further changes after this point.
        </p>
        <div className="flex gap-2" style={{ justifyContent: "flex-end" }}>
          <button onClick={() => setMode(null)} className="btn btn-secondary btn-sm">Back</button>
          <button onClick={submitGood} disabled={busy} className="btn btn-primary btn-sm" data-testid="review-good-confirm-btn">
            {busy ? "Submitting…" : "Yes, approve and file"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" data-testid="review-issue-form">
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Describe the issue</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Be as specific as possible — page numbers, line items, expected vs reported figures.</p>
      <textarea
        value={issue} onChange={(e) => setIssue(e.target.value)}
        placeholder="e.g. 'Net income on page 2 doesn't match my Q4 statement — should be $284,500 not $284,000.'"
        data-testid="issue-textarea"
        className="textarea"
        style={{ width: "100%", minHeight: 110 }}
      />
      <div className="flex gap-2" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button onClick={() => setMode(null)} className="btn btn-secondary btn-sm">Back</button>
        <button
          onClick={submitIssue}
          disabled={!issue.trim() || busy}
          className="btn btn-primary btn-sm"
          data-testid="issue-submit-btn"
        >{busy ? "Submitting…" : "Submit issue"}</button>
      </div>
    </div>
  );
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
  const [forceUploadMode, setForceUploadMode] = useState(false);
  const [delegateContext, setDelegateContext] = useState(null);
  // True once the FIRST /engagements response has come back (success OR error).
  // Gates the empty-state render so the "engagement is being set up" card
  // doesn't flash for a fraction of a second on initial page load before the
  // real engagement data arrives. Only after ``loaded`` is true do we trust
  // ``eng === null`` to mean "no active engagement" rather than "still fetching".
  const [loaded, setLoaded] = useState(false);

  const loadAll = async () => {
    try {
      const [{ data: list }, ctxRes] = await Promise.all([
        api.get("/engagements"),
        api.get("/me/delegate-context").catch(() => ({ data: null })),
      ]);
      setDelegateContext(ctxRes.data || null);
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
    finally { setLoaded(true); }
  };
  useEffect(() => { loadAll(); }, []);
  // Poll engagement every 20s so the client sees a fresh ReviewDecisionCard
  // when the CPA uploads a new draft (review_decision is cleared server-side).
  useEffect(() => {
    const id = setInterval(() => { loadAll(); }, 20000);
    return () => clearInterval(id);
  }, []);

  const onUpload = async (doc, file) => {
    if (!file) return;
    setBusy(doc.id); setErr("");
    try {
      // Server-side proxy upload — works regardless of S3 CORS configuration.
      const fd = new FormData();
      fd.append("file", file);
      await api.post(`/documents/${doc.id}/upload`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await loadAll();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(null);
  };

  const onView = async (doc) => {
    try {
      const { data } = await api.get(`/documents/${doc.id}/download-url`);
      const url = data.download_url;
      if (url.startsWith("/api/")) {
        // Local-fallback storage — fetch via our API (auth header) then open as object URL
        const resp = await api.get(url.replace("/api", ""), { responseType: "blob" });
        const blobUrl = URL.createObjectURL(resp.data);
        window.open(blobUrl, "_blank");
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      } else {
        window.open(url, "_blank");
      }
    } catch (x) { setErr(fmtError(x)); }
  };

  const onDefer = async (doc) => {
    try { await api.post(`/documents/${doc.id}/defer`); await loadAll(); } catch (x) { setErr(fmtError(x)); }
  };

  const onRemove = async (doc) => {
    if (!window.confirm(`Remove "${doc.file_name || doc.name}"?`)) return;
    setBusy(doc.id); setErr("");
    try { await api.delete(`/documents/${doc.id}/upload`); await loadAll(); }
    catch (x) { setErr(fmtError(x)); }
    setBusy(null);
  };

  const onRemoveFile = async (doc, file) => {
    if (!window.confirm(`Remove "${file.file_name}"?`)) return;
    setBusy(doc.id); setErr("");
    try {
      // Legacy single-file docs return a synthetic id "<doc.id>-legacy" — fall back to the doc-level delete
      if (String(file.id || "").endsWith("-legacy")) {
        await api.delete(`/documents/${doc.id}/upload`);
      } else {
        await api.delete(`/documents/${doc.id}/files/${file.id}`);
      }
      await loadAll();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(null);
  };

  const onViewFile = async (doc, file) => {
    if (!file?.id || String(file.id).endsWith("-legacy")) return onView(doc);
    try {
      const resp = await api.get(`/documents/${doc.id}/files/${file.id}/download`, { responseType: "blob" });
      const blobUrl = URL.createObjectURL(resp.data);
      window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (x) { setErr(fmtError(x)); }
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

  const submitReviewDecision = async (decision, issueNote) => {
    try {
      await api.post(`/engagements/${eng.id}/review-decision`, { decision, issue_note: issueNote || null });
      await loadAll();
    } catch (x) { setErr(fmtError(x)); }
  };

  const [t183Open, setT183Open] = useState(false);
  const [t183, setT183] = useState(null);
  useEffect(() => {
    if (!eng?.id) return;
    api.get(`/engagements/${eng.id}/t183`).then((r) => setT183(r.data)).catch(() => {});
  }, [eng?.id, eng?.t183_status, eng?.t183_signed_at]);
  const onT183Signed = async () => {
    setT183Open(false);
    await loadAll();
  };
  const previewT183 = async (variant = "auto") => {
    try {
      const url = `/engagements/${eng.id}/t183/file?variant=${variant}`;
      const resp = await api.get(url, { responseType: "blob" });
      const blobUrl = URL.createObjectURL(resp.data);
      window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (x) { setErr(fmtError(x)); }
  };

  // Compose a friendly greeting name. Prefer the dedicated ``first_name``
  // field when present (so "Dr. John Smith" → "John"), and fall back to
  // the full name with title-tokens stripped so we never render a standalone
  // "Welcome, Dr." when the display name starts with a salutation.
  const greetingName = (() => {
    if (!user) return "";
    if (user.first_name) return user.first_name;
    const raw = (user.name || "").trim();
    if (!raw) return "";
    const TITLES = new Set(["dr.", "dr", "mr.", "mr", "mrs.", "mrs", "ms.", "ms", "miss", "prof.", "prof"]);
    const tokens = raw.split(/\s+/);
    const first = tokens[0] || "";
    if (TITLES.has(first.toLowerCase())) return tokens[1] || "";
    return first;
  })();
  // Loading skeleton — shown while the FIRST /engagements fetch is in-flight.
  // Prevents the "engagement is being set up" empty state from flashing for
  // a split second before the real engagement data arrives on page load.
  if (!loaded) return (
    <div className="page-narrow stack-lg" style={{ paddingTop: 32 }} data-testid="portal-loading">
      <div style={{ height: 28, width: 220, background: "var(--bg-subtle)", borderRadius: 6, marginBottom: 8 }} />
      <div style={{ height: 14, width: 360, background: "var(--bg-subtle)", borderRadius: 6, opacity: 0.6 }} />
      <div className="card" style={{ marginTop: 4 }}>
        <div style={{ height: 14, width: "80%", background: "var(--bg-subtle)", borderRadius: 6, marginBottom: 10, opacity: 0.6 }} />
        <div style={{ height: 14, width: "60%", background: "var(--bg-subtle)", borderRadius: 6, opacity: 0.6 }} />
      </div>
    </div>
  );

  // Empty state — only after the API has confirmed there is no active
  // engagement (``loaded === true`` AND ``eng`` is null/ONBOARDING).
  if (!eng || eng.status === "ONBOARDING") return (
    <div className="page-narrow stack-lg" style={{ paddingTop: 32 }} data-testid="empty-state">
      <h1 className="page-title">
        {greetingName ? `Welcome, ${greetingName}` : "Welcome"}
      </h1>
      <p className="muted" style={{ fontSize: 13 }}>Your CloudTax corporate tax engagement is being set up.</p>
      <div className="card">
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          Your CloudTax team is setting up your file. A licensed CPA will be assigned shortly and you&apos;ll be notified to begin uploading documents.
        </p>
      </div>
    </div>
  );

  const phase = statusToPhase(eng.status);
  const stageLabel = PHASES[phase].label;
  const corp = eng.corporation || {};
  const cpa = eng.assigned_cpa;
  const issueDocs = docs.filter((d) => d.status === "ISSUE");
  // Keep deferred ("I'll upload later") items visible — the DocItem now shows
  // an UPLOAD PENDING badge + status dot instead of hiding the row. Only the
  // ISSUE list is rendered separately above, so those are pulled out here.
  const visibleDocs = docs;
  // Use the CPA-entered filing_summary (preferred) and fall back to legacy tax_summary
  const taxSummary = eng.filing_summary || eng.tax_summary || {};
  const t2DraftDoc = eng.t2_draft_doc_id ? docs.find((d) => d.id === eng.t2_draft_doc_id) : null;
  const isFiled = eng.status === "FILED";
  const craConfNum = eng.filing_confirmation || `CRA-FILE-${(eng.id || "").slice(0, 6).toUpperCase()}`;
  const filedReturnDoc = eng.filed_return_doc_id ? docs.find((d) => d.id === eng.filed_return_doc_id) : null;

  return (
    <div className="page-narrow stack-lg" style={{ paddingTop: 24, maxWidth: 760 }} data-testid="client-portal">
      {(() => {
        const ctx = (delegateContext?.contexts || []).find((c) => c.engagement_id === eng.id);
        if (!ctx) return null;
        const primaryName = ctx.primary_client_first_name || ctx.primary_client_name || "the primary client";
        const rel = (ctx.relationship || "delegate").toLowerCase();
        return (
          <div
            data-testid="delegate-banner"
            style={{
              padding: "10px 14px",
              background: "#fff8e1",
              border: "1px solid #ffe082",
              borderRadius: 10,
              fontSize: 12,
              color: "#5d4037",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 14 }}>👥</span>
            <span>
              You&rsquo;re viewing this as <strong>{rel}</strong> for <strong>{primaryName}</strong>&rsquo;s engagement.
              The T183 must still be signed by them personally.
            </span>
          </div>
        );
      })()}
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

      {/* PROFILE + DOCUMENTS combined — always active, no Start uploading button */}
      {(phase === 0 || phase === 1) && (
        <>
          {phase === 0 && (
            <div className="card" data-testid="profile-success">
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#e8f5e9", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Check size={18} style={{ color: "#2e7d32" }} />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Your profile has been created</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>CloudTax has set up your engagement — you can begin uploading documents below</div>
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
          )}

          <div className="card" data-testid="docs-interactive-card">
            <div className="section-label" style={{ marginBottom: 16 }}>DOCUMENTS WE NEED</div>
            {visibleDocs.filter((d) => d.status !== "ISSUE").map((d) => <DocItem key={d.id} doc={d} mode="interactive" onUpload={onUpload} onView={onView} onViewFile={onViewFile} onDefer={onDefer} onRemove={onRemove} onRemoveFile={onRemoveFile} busy={busy} />)}
            {issueDocs.map((d) => <div key={d.id} style={{ marginTop: 18 }}><IssueCard doc={d} onUpload={onUpload} /></div>)}
          </div>
        </>
      )}

      {/* PREPARATION STAGE */}
      {phase === 2 && (
        <>
          <div className="card" data-testid="docs-summary-card">
            <div className="section-label" style={{ marginBottom: 16 }}>DOCUMENTS WE NEED</div>
            {visibleDocs.map((d) => <DocItem key={d.id} doc={d} mode="summary" onView={onView} onViewFile={onViewFile} />)}
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
              <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {eng.review_instructions || "Your draft T2 return is ready for your review. Please open the preview, then let us know if everything looks good or if you spot an issue."}
              </div>
            </div>
          </div>

          <div className="card" data-testid="tax-summary-card">
            <div className="section-label" style={{ marginBottom: 16 }}>ACTION REQUIRED</div>

            {/* Item 1 — Preview */}
            <div className="muted" style={{ fontSize: 11, fontWeight: 500, marginBottom: 6, letterSpacing: "0.01em" }}>Preview your tax summary.</div>
            {t2DraftDoc ? (
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "var(--bg-subtle)", borderRadius: 10 }}>
                <div style={{ width: 36, height: 44, borderRadius: 6, background: "#c62828", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>PDF</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t2DraftDoc.file_name}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    Uploaded by {cpa?.name || "your CPA"} · {fmtDate(t2DraftDoc.uploaded_at)} · {t2DraftDoc.file_size ? `${Math.round(t2DraftDoc.file_size / 1024)} KB` : ""}
                  </div>
                </div>
                <button
                  onClick={() => onView(t2DraftDoc)}
                  className="btn btn-primary btn-sm"
                  data-testid="preview-t2"
                ><Eye size={14} /> Preview</button>
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 13, padding: 14, background: "var(--bg-subtle)", borderRadius: 10 }}>Your CPA will share the draft return shortly.</div>
            )}

            {/* Item 2 — T183 signature */}
            <div className="muted" style={{ fontSize: 11, fontWeight: 500, margin: "18px 0 6px", letterSpacing: "0.01em" }}>Need a signature.</div>
            <div data-testid="t183-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "var(--bg-subtle)", borderRadius: 10 }}>
              <div style={{ width: 36, height: 44, borderRadius: 6, background: "#1a1a1a", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>T183</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>CRA T183 — Authorization to E-File</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {t183?.status === "signed" || eng.t183_signed_at
                    ? <>Signed by {t183?.signed_name || eng.t183_signed_name} · {fmtDate(t183?.signed_at || eng.t183_signed_at)}</>
                    : t183?.status === "sent"
                      ? "Your CPA has prepared your T183 — open it to sign at the highlighted spot."
                      : "Waiting on your CPA to prepare the T183 for your signature."}
                </div>
              </div>
              {(t183?.has_signed_pdf || t183?.has_original) && (
                <button onClick={() => previewT183(t183?.has_signed_pdf ? "signed" : "original")} className="btn btn-secondary btn-sm" data-testid="t183-preview">
                  <Eye size={14} /> {t183?.has_signed_pdf ? "Download signed" : "Preview"}
                </button>
              )}
              {(t183?.status === "signed" || eng.t183_signed_at) ? (
                <span className="badge badge-complete" data-testid="t183-signed-badge" style={{ fontSize: 11 }}>Signed</span>
              ) : t183?.status === "sent" ? (
                <button onClick={() => setT183Open(true)} className="btn btn-primary btn-sm" data-testid="t183-view-sign-btn">
                  <PenLine size={14} /> View & sign T183
                </button>
              ) : (
                <span className="badge" data-testid="t183-waiting-badge" style={{ fontSize: 11, background: "var(--bg-subtle)", color: "var(--text-tertiary)", padding: "4px 10px", borderRadius: 999 }}>Awaiting CPA</span>
              )}
            </div>
          </div>

          {eng.review_decision?.decision === "approved" ? (
            <div className="card" data-testid="approved-card" style={{ background: "#e8f5e9", border: "1px solid #bbe1bd" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#2e7d32", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Check size={18} style={{ color: "#fff" }} />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "#2e7d32" }}>You approved the return</div>
                  <div style={{ fontSize: 13, color: "#2e7d32", marginTop: 4 }}>Your CPA has been notified and will file with CRA shortly.</div>
                </div>
              </div>
            </div>
          ) : eng.review_decision?.decision === "issue" ? (
            <div className="card" data-testid="issue-submitted-card" style={{ background: "#fef5f5", border: "1px solid #f3c0c0" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <AlertCircle size={20} style={{ color: "#c62828", marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#c62828" }}>Issue submitted to your CPA</div>
                  <div style={{ fontSize: 13, color: "var(--text-primary)", marginTop: 8, lineHeight: 1.6, whiteSpace: "pre-wrap", padding: "10px 12px", background: "#fff", borderRadius: 8 }}>{eng.review_decision.issue_note}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Your CPA will fix this and re-share the draft.</div>
                </div>
              </div>
            </div>
          ) : (
            <ReviewDecisionCard onSubmit={submitReviewDecision} />
          )}

          {/* Draft + review cycle history (client-visible — only renders if events exist) */}
          <DraftHistoryTable eng={eng} title="Your review history" />

          <div className="card" data-testid="docs-submitted-card">
            <div className="section-label" style={{ marginBottom: 16 }}>DOCUMENTS SUBMITTED</div>
            {visibleDocs.map((d) => <DocItem key={d.id} doc={d} mode="summary" onView={onView} onViewFile={onViewFile} />)}
          </div>
        </>
      )}

      {/* FILED STAGE */}
      {isFiled && (
        <>
          <div data-testid="filed-success" className="card" style={{ background: "#fff", border: "1px solid var(--border-default)", borderRadius: 16, padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#2e7d32", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Check size={16} style={{ color: "#fff" }} strokeWidth={2.5} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#2e7d32" }}>Filed with CRA</div>
            </div>

            <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: 0, lineHeight: 1.2 }}>
              Congratulations — your T2 has been filed.
            </h2>

            <p className="muted" style={{ fontSize: 13, marginTop: 10, lineHeight: 1.6, maxWidth: 560 }}>
              Filed by <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{eng.filed_by_name || cpa?.name || "your CPA"}</span> on <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{fmtDate(eng.filing_date)}</span>. CRA has acknowledged the submission. A PDF copy is below for your records.
            </p>

            {/* CPA's filing note — surfaced to the client so they get any "how to pay
                the balance / next steps" context the CPA wrote at filing time. */}
            {eng.filing_note && (
              <div
                data-testid="client-filing-note"
                style={{
                  marginTop: 16,
                  padding: "12px 14px",
                  background: "#e8f5e9",
                  border: "1px solid #c8e6c9",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                }}
              >
                <MessageSquare size={14} style={{ color: "#2e7d32", flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: "#1b5e20", textTransform: "uppercase", marginBottom: 4 }}>
                    Note from {eng.filed_by_name || cpa?.name || "your CPA"}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: "#0d2914", whiteSpace: "pre-wrap" }}>
                    {eng.filing_note}
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 24, marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--border-default)", flexWrap: "wrap" }}>
              <div>
                <div className="muted" style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>CRA confirmation</div>
                <code data-testid="cra-conf-num" style={{ fontSize: 14, fontWeight: 600, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--text-primary)" }}>{craConfNum}</code>
              </div>
              {filedReturnDoc && (
                <button
                  onClick={() => onView(filedReturnDoc)}
                  className="btn btn-primary btn-sm"
                  style={{ marginLeft: "auto" }}
                  data-testid="download-filed-pdf"
                ><Download size={14} /> Download filed return</button>
              )}
            </div>
          </div>

          {/* Signed T183 stays visible after filing for client's records */}
          <T183Card eng={eng} onPreview={previewT183} onSign={() => setT183Open(true)} delegateContext={delegateContext} />

          <div className="card" data-testid="filed-summary-card">
            <div className="section-label" style={{ marginBottom: 16 }}>FILED RETURN SUMMARY</div>
            {[
              { k: "net_income", label: "Net income for tax purposes", val: taxSummary.net_income != null ? fmtCurrency(taxSummary.net_income) : "—" },
              { k: "total_tax", label: "Total tax assessed", val: (taxSummary.total_tax_assessed ?? taxSummary.total_tax) != null ? fmtCurrency(taxSummary.total_tax_assessed ?? taxSummary.total_tax) : "—" },
              { k: "instalments_paid", label: "Instalments paid", val: taxSummary.instalments_paid != null ? fmtCurrency(-Math.abs(taxSummary.instalments_paid)) : "—" },
              { k: "balance_owing", label: "Balance owing", val: taxSummary.balance_owing != null ? fmtCurrency(taxSummary.balance_owing) : "—", bold: true, color: taxSummary.balance_owing > 0 ? "#ef6c00" : "var(--text-primary)" },
              { k: "payment_due_date", label: "Payment due date", val: taxSummary.payment_due_date ? fmtDate(taxSummary.payment_due_date) : "—", color: "#ef6c00" },
            ].map((row) => (
              <div key={row.k} style={{ display: "flex", justifyContent: "space-between", padding: "14px 0", borderBottom: "1px solid var(--border-default)" }}>
                <span style={{ fontSize: 13, fontWeight: row.bold ? 600 : 500 }}>{row.label}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: row.color || "var(--text-primary)" }} data-testid={`fs-${row.k}`}>{row.val}</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                onClick={() => filedReturnDoc && onView(filedReturnDoc)}
                disabled={!filedReturnDoc}
                className="btn btn-primary btn-sm"
                data-testid="download-filed"
              ><Download size={14} /> Download filed return</button>
              <button
                onClick={() => window.open("https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/business-account.html", "_blank")}
                className="btn btn-secondary btn-sm"
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
      {t183Open && (
        <T183SigningModal
          engagementId={eng.id}
          t183={t183}
          defaultName={user?.name || ""}
          onClose={() => setT183Open(false)}
          onSigned={onT183Signed}
        />
      )}
    </div>
  );
}
