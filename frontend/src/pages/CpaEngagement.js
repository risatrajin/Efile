import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, fmtError, fmtDate, TIME_LABELS, OPP_LABELS } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge, StatusBadge, SeverityDot } from "../components/shared/Badges";
import StatusHistoryTimeline, { StatusHistoryHeader } from "../components/shared/StatusHistoryTimeline";
import { ChatThread } from "./Messages";
import { Check, CircleDashed, AlertCircle, FileText, Sparkles, Plus, Download, Flag, FilePlus, Bell, Upload, X, Send } from "lucide-react";
import MoveToDropdown from "../components/shared/MoveToDropdown";
import DraftHistoryTable from "../components/shared/DraftHistoryTable";

const STATUS_FLOW = ["REFERRED", "INTAKE", "IN_PREP", "IN_REVIEW", "DELIVERY", "FILED"];

function DocIcon({ status }) {
  if (status === "REVIEWED") return <Check size={14} style={{ color: "#2e7d32" }} />;
  if (status === "EXTRACTED") return <Check size={14} style={{ color: "#6a1b9a" }} />;
  if (status === "UPLOADED") return <Check size={14} style={{ color: "#1565c0" }} />;
  if (status === "ISSUE") return <AlertCircle size={14} style={{ color: "#c62828" }} />;
  return <CircleDashed size={14} style={{ color: "#b5b0ab" }} />;
}

function UploadDraftCard({ eng, docs, onUpload, onCancelDraft, onDownload, busy }) {
  const [dragOver, setDragOver] = useState(false);
  const [pickedFile, setPickedFile] = useState(null);
  const [instructions, setInstructions] = useState(eng.review_instructions || "");
  const [savedAt, setSavedAt] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const inputRef = React.useRef();
  const confirmTimerRef = React.useRef(null);
  const draftDoc = eng.t2_draft_doc_id ? docs.find((d) => d.id === eng.t2_draft_doc_id) : null;

  // Sync instructions when engagement reloads after upload
  React.useEffect(() => { setInstructions(eng.review_instructions || ""); }, [eng.review_instructions]);

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) setPickedFile(f);
  };

  const submit = async () => {
    if (!pickedFile) return;
    await onUpload(pickedFile, instructions);
    setPickedFile(null);
    // Reset the file input so re-picking the same file (or any file) reliably fires onChange next time
    if (inputRef.current) inputRef.current.value = "";
    setSavedAt(new Date());
  };

  // Inline 2-step confirm — avoids window.confirm (blocked by some browsers)
  const handleCancelClick = async () => {
    if (!draftDoc) return;
    if (!confirmCancel) {
      setConfirmCancel(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmCancel(false), 4000);
      return;
    }
    if (confirmTimerRef.current) { clearTimeout(confirmTimerRef.current); confirmTimerRef.current = null; }
    setConfirmCancel(false);
    await onCancelDraft();
  };

  return (
    <div className="card" data-testid="upload-draft-card">
      <div className="flex items-center between" style={{ marginBottom: 4 }}>
        <h2 className="card-title" style={{ margin: 0 }}>Tax Return draft (for client review)</h2>
        {draftDoc && <span className="badge badge-complete" style={{ fontSize: 11 }}>Uploaded</span>}
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        Upload the T2 draft PDF — the client will preview this in their portal before authorizing filing.
      </p>

      {/* Existing draft */}
      {draftDoc && (
        <div data-testid="existing-draft" style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", background: "var(--bg-subtle)", borderRadius: 10, marginBottom: 14 }}>
          <div style={{ width: 32, height: 40, borderRadius: 4, background: "#c62828", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>PDF</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{draftDoc.file_name}</div>
            <div className="muted" style={{ fontSize: 11 }}>Uploaded {fmtDate(draftDoc.uploaded_at)} · {draftDoc.file_size ? `${Math.round(draftDoc.file_size / 1024)} KB` : ""}</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => onDownload(draftDoc)} data-testid="download-draft"><Download size={12} /> Download</button>
          <button
            type="button"
            onClick={handleCancelClick}
            disabled={busy}
            data-testid="cancel-draft"
            className="btn btn-secondary btn-sm"
            title={confirmCancel ? "Click again to confirm removal" : "Remove this draft"}
            style={confirmCancel ? { background: "#fef5f5", color: "#c62828", borderColor: "#f3c0c0" } : undefined}
          >
            {confirmCancel ? <><X size={12} /> Confirm?</> : <X size={12} />}
          </button>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        data-testid="draft-dropzone"
        style={{
          border: `2px dashed ${dragOver ? "#1565c0" : "var(--border-default)"}`,
          background: dragOver ? "#e3f2fd" : "#fafafa",
          borderRadius: 12, padding: "28px 18px",
          textAlign: "center", cursor: "pointer", transition: "all 120ms ease",
        }}
      >
        <Upload size={20} style={{ color: dragOver ? "#1565c0" : "var(--text-tertiary)", marginBottom: 8 }} />
        <div style={{ fontSize: 13, fontWeight: 500 }}>{pickedFile ? pickedFile.name : draftDoc ? "Drop a new PDF to replace" : "Drop the T2 draft PDF here or click to browse"}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>PDF up to 50 MB</div>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && setPickedFile(e.target.files[0])} data-testid="draft-file-input" />
      </div>

      {/* Instructions */}
      <div className="field" style={{ marginTop: 14 }}>
        <label className="field-label">Instructions for client (optional)</label>
        <textarea
          className="textarea" rows={3}
          value={instructions} onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. 'Please review pages 2-3 carefully — note the new RRSP deduction.'"
          data-testid="draft-instructions"
        />
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Saved automatically when you upload the draft. Appears in the client&apos;s Tax Summary section.</div>
      </div>

      <div className="flex gap-2" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        {pickedFile && <button onClick={() => { setPickedFile(null); if (inputRef.current) inputRef.current.value = ""; }} className="btn btn-secondary btn-sm" data-testid="draft-clear"><X size={12} /> Clear</button>}
        <button onClick={submit} disabled={!pickedFile || busy} className="btn btn-primary btn-sm" data-testid="upload-draft-submit">
          {busy ? "Uploading…" : "Send and Move to Review"}
        </button>
      </div>
      {savedAt && <span className="tertiary" style={{ fontSize: 11, display: "block", textAlign: "right", marginTop: 6 }}>Saved {savedAt.toLocaleTimeString()}</span>}
    </div>
  );
}


function FileWithCRACard({ eng, onSubmit, busy }) {
  const [open, setOpen] = useState(false);
  const [pickedFile, setPickedFile] = useState(null);
  const [conf, setConf] = useState("");
  const [filingAt, setFilingAt] = useState(() => {
    const d = new Date(); d.setSeconds(0, 0);
    // ISO local for input[type=datetime-local]
    const tz = d.getTimezoneOffset();
    return new Date(d.getTime() - tz * 60000).toISOString().slice(0, 16);
  });
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const inputRef = React.useRef();

  const submit = async () => {
    setError("");
    if (!conf.trim()) { setError("CRA confirmation number is required."); return; }
    if (!filingAt) { setError("Filing date and time are required."); return; }
    if (!pickedFile) { setError("Please upload a PDF copy of the filed return."); return; }
    try {
      const isoFiling = new Date(filingAt).toISOString();
      await onSubmit({ cra_confirmation: conf.trim(), filing_datetime: isoFiling, note: note.trim() || null, file: pickedFile });
    } catch (x) {
      setError(x?.response?.data?.detail || x?.message || "Failed to file");
    }
  };

  if (!open) {
    return (
      <div className="card" data-testid="file-with-cra-card" style={{ borderLeft: "3px solid var(--accent-dark)" }}>
        <div className="flex items-center between" style={{ gap: 16 }}>
          <div>
            <h2 className="card-title" style={{ margin: 0 }}>Ready to file with CRA</h2>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>The client approved the return. Submit your CRA confirmation and filed PDF to mark this engagement as filed.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setOpen(true)} data-testid="file-now-open"><Send size={14} /> File Now</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" data-testid="file-with-cra-form" style={{ borderLeft: "3px solid var(--accent-dark)" }}>
      <div className="flex items-center between" style={{ marginBottom: 4 }}>
        <h2 className="card-title" style={{ margin: 0 }}>File with CRA</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} data-testid="file-now-close"><X size={14} /></button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>Enter the CRA acknowledgement details and upload the final filed PDF.</p>

      <div className="stack-md">
        <div className="field">
          <label className="field-label">CRA confirmation number *</label>
          <input className="input" value={conf} onChange={(e) => setConf(e.target.value)} placeholder="e.g. 1234-AB-56789" data-testid="cra-conf-input" />
        </div>
        <div className="field">
          <label className="field-label">Filing date &amp; time *</label>
          <input className="input" type="datetime-local" value={filingAt} onChange={(e) => setFilingAt(e.target.value)} data-testid="filing-datetime-input" />
        </div>
        <div className="field">
          <label className="field-label">Filed return PDF *</label>
          <div
            onClick={() => inputRef.current?.click()}
            data-testid="filed-pdf-dropzone"
            style={{
              border: "2px dashed var(--border-default)", background: "#fafafa",
              borderRadius: 12, padding: "20px 18px", textAlign: "center", cursor: "pointer",
            }}
          >
            <Upload size={18} style={{ color: "var(--text-tertiary)", marginBottom: 6 }} />
            <div style={{ fontSize: 13, fontWeight: 500 }}>{pickedFile ? pickedFile.name : "Drop PDF here or click to browse"}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>PDF up to 50 MB</div>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && setPickedFile(e.target.files[0])} data-testid="filed-pdf-input" />
          </div>
        </div>
        <div className="field">
          <label className="field-label">Note (optional)</label>
          <textarea className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any internal note about this filing..." data-testid="filing-note" />
        </div>
      </div>

      {error && <div className="alert alert-risk" style={{ marginTop: 10, fontSize: 12 }}>{error}</div>}

      <div className="flex gap-2" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy} data-testid="file-now-submit">
          <Send size={12} /> {busy ? "Filing…" : "Submit filing"}
        </button>
      </div>
    </div>
  );
}


function AddOppModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ category: "COMPENSATION_STRATEGY", severity: "MEDIUM", title: "", description: "" });
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title">Add opportunity</h2>
        <div className="stack-md mt-4">
          <div className="field">
            <label className="field-label">Category</label>
            <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="opp-category">
              {Object.entries(OPP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Severity</label>
            <select className="select" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} data-testid="opp-severity">
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Title</label>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="opp-title" />
          </div>
          <div className="field">
            <label className="field-label">Description</label>
            <textarea className="textarea" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="opp-description" />
          </div>
          <div className="flex gap-2" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !form.title} onClick={async () => { setBusy(true); await onCreate(form); setBusy(false); onClose(); }} data-testid="opp-save">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FlagIssueModal({ doc, onClose, onSave }) {
  const [note, setNote] = useState(doc?.issue_note || "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title">Flag issue: {doc?.name}</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>The client will see this note on their portal and be prompted to re-upload.</p>
        <div className="stack-md mt-4">
          <div className="field">
            <label className="field-label">What is wrong with this document?</label>
            <textarea className="textarea" rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Missing months June, July, August 2025" data-testid="issue-note" />
          </div>
          <div className="flex gap-2" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !note.trim()} onClick={async () => { setBusy(true); await onSave(note.trim()); setBusy(false); onClose(); }} data-testid="issue-save">Send to client</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewDocRequestModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ name: "", description: "", request_note: "", is_required: true });
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title">Request additional document</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>The client will see this on their portal as a new request with your note.</p>
        <div className="stack-md mt-4">
          <div className="field">
            <label className="field-label">Document name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. T5 slips" data-testid="newreq-name" />
          </div>
          <div className="field">
            <label className="field-label">Short description (visible to client)</label>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Investment income documentation" data-testid="newreq-desc" />
          </div>
          <div className="field">
            <label className="field-label">Why you need it (visible to client)</label>
            <textarea className="textarea" rows={4} value={form.request_note} onChange={(e) => setForm({ ...form, request_note: e.target.value })} placeholder="During preparation we noticed..." data-testid="newreq-note" />
          </div>
          <label className="flex items-center gap-2" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={form.is_required} onChange={(e) => setForm({ ...form, is_required: e.target.checked })} /> Required
          </label>
          <div className="flex gap-2" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !form.name.trim() || !form.request_note.trim()} onClick={async () => { setBusy(true); await onCreate(form); setBusy(false); onClose(); }} data-testid="newreq-save">Send request</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CpaEngagement() {
  const { eid } = useParams();
  const [eng, setEng] = useState(null);
  const [docs, setDocs] = useState([]);
  const [extracted, setExtracted] = useState([]);
  const [opps, setOpps] = useState([]);
  const [time, setTime] = useState([]);
  const [cl, setCl] = useState([]);
  const [showOppModal, setShowOppModal] = useState(false);
  const [flagDoc, setFlagDoc] = useState(null);
  const [showNewReq, setShowNewReq] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [newTime, setNewTime] = useState({ category: "T2_PREPARATION", hours: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [a, b, c, d, e, f, h] = await Promise.all([
        api.get(`/engagements/${eid}`),
        api.get(`/engagements/${eid}/documents`),
        api.get(`/engagements/${eid}/extracted-data`),
        api.get(`/engagements/${eid}/opportunities`),
        api.get(`/engagements/${eid}/time-entries`),
        api.get(`/engagements/${eid}/checklist`),
        api.get(`/engagements/${eid}/history`),
      ]);
      setEng(a.data); setDocs(b.data); setExtracted(c.data); setOpps(d.data); setTime(e.data); setCl(f.data); setHistory(h.data);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, [eid]);

  const advanceStatus = async (next) => {
    setBusy(true); setErr("");
    try {
      // IN_PREP -> IN_REVIEW requires the dedicated endpoint that enforces a draft has been uploaded
      if (eng?.status === "IN_PREP" && next === "IN_REVIEW") {
        await api.post(`/engagements/${eid}/move-to-review`, { instructions: eng.review_instructions || null });
      } else {
        await api.patch(`/engagements/${eid}`, { status: next });
      }
      await load();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const uploadDraft = async (file, instructions) => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const url = instructions ? `/engagements/${eid}/upload-draft?instructions=${encodeURIComponent(instructions)}` : `/engagements/${eid}/upload-draft`;
      await api.post(url, fd, { headers: { "Content-Type": "multipart/form-data" } });
      await load();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const cancelDraft = async () => {
    setBusy(true); setErr("");
    try { await api.delete(`/engagements/${eid}/draft`); await load(); }
    catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const fileWithCRA = async ({ cra_confirmation, filing_datetime, note, file }) => {
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const params = new URLSearchParams({ cra_confirmation, filing_datetime });
      if (note) params.set("note", note);
      await api.post(`/engagements/${eid}/file-with-cra?${params.toString()}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      await load();
    } catch (x) { setErr(fmtError(x)); throw x; }
    finally { setBusy(false); }
  };

  const toggleCheck = async (item) => {
    try { await api.patch(`/checklist/${item.id}`, { is_completed: !item.is_completed }); await load(); } catch (x) { setErr(fmtError(x)); }
  };

  const runExtract = async (doc) => {
    setBusy(true); setErr("");
    try { await api.post(`/documents/${doc.id}/extract`); await load(); } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const downloadDoc = async (doc) => {
    try { const { data } = await api.get(`/documents/${doc.id}/download-url`); window.open(data.download_url, "_blank"); } catch (x) { setErr(fmtError(x)); }
  };

  const createOpp = async (f) => { try { await api.post(`/engagements/${eid}/opportunities`, f); await load(); } catch (x) { setErr(fmtError(x)); } };

  const flagIssue = async (note) => {
    try { await api.patch(`/documents/${flagDoc.id}`, { status: "ISSUE", issue_note: note }); await load(); } catch (x) { setErr(fmtError(x)); }
  };

  const requestNewDoc = async (form) => {
    try { await api.post(`/engagements/${eid}/documents/request`, form); await load(); } catch (x) { setErr(fmtError(x)); }
  };

  const markReviewed = async (doc) => {
    try { await api.patch(`/documents/${doc.id}`, { status: "REVIEWED" }); await load(); } catch (x) { setErr(fmtError(x)); }
  };

  const sendDeferredReminder = async () => {
    setReminderBusy(true); setErr("");
    try {
      await api.post(`/engagements/${eid}/remind-deferred`);
      await load();
    } catch (x) { setErr(fmtError(x)); }
    setReminderBusy(false);
  };

  const shareOpp = async (opp) => {
    try { await api.patch(`/opportunities/${opp.id}`, { shared_with_ws: true }); await load(); } catch (x) { setErr(fmtError(x)); }
  };

  const addTime = async () => {
    if (!newTime.hours) return;
    try {
      await api.post(`/engagements/${eid}/time-entries`, { category: newTime.category, hours: parseFloat(newTime.hours), description: newTime.description || null });
      setNewTime({ ...newTime, hours: "", description: "" });
      await load();
    } catch (x) { setErr(fmtError(x)); }
  };

  if (!eng) return (<div className="app-root"><AppHeader /><div className="page-wide">Loading…</div></div>);

  const corp = eng.corporation || {};
  const client = eng.client || {};
  const totalHours = time.reduce((s, t) => s + (t.hours || 0), 0);
  const hoursByCat = time.reduce((acc, t) => { acc[t.category] = (acc[t.category] || 0) + t.hours; return acc; }, {});
  const nextStatus = STATUS_FLOW[Math.min(STATUS_FLOW.indexOf(eng.status) + 1, STATUS_FLOW.length - 1)];
  const deferredCount = docs.filter((d) => d.deferred_at).length;
  const docsUploaded = docs.filter((d) => ["UPLOADED", "REVIEWED", "EXTRACTED"].includes(d.status)).length;

  return (
    <div className="app-root">
      <AppHeader />
      <div className="page-wide stack-lg">
        <div className="flex between items-center" style={{ flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>
              <Link to="/cpa/files" className="link-underline">Files</Link> · {client.name}
            </div>
            <h1 className="page-title" style={{ marginTop: 4 }}>{corp.name}</h1>
            <div className="flex items-center gap-3 mt-2" style={{ flexWrap: "wrap" }}>
              <TierBadge tier={eng.tier} />
              <StatusBadge status={eng.status} />
              <span className="muted" style={{ fontSize: 12 }}>Day {eng.days_elapsed || 0} · Fiscal year {fmtDate(corp.fiscal_year_end)}</span>
              <span className="badge badge-neutral" data-testid="docs-progress">{docsUploaded}/{docs.length} docs</span>
              {deferredCount > 0 && (
                <span className="badge badge-attention" data-testid="deferred-counter">Deferred ({deferredCount})</span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {eng.status !== "FILED" && (
              <MoveToDropdown
                current={eng.status}
                onChange={(next) => advanceStatus(next)}
                disabledKeys={
                  // Block IN_REVIEW until a draft is uploaded
                  eng.status === "IN_PREP" && !eng.t2_draft_doc_id ? ["IN_REVIEW"] : []
                }
                note={eng.status === "IN_PREP" && !eng.t2_draft_doc_id ? "Upload the T2 draft PDF below before moving to Review." : null}
                testid="cpa-move-to"
              />
            )}
          </div>
        </div>

        {err && <div className="alert alert-risk">{err}</div>}

        {/* Client review feedback (Review stage) */}
        {eng.review_decision && (
          eng.review_decision.decision === "issue" ? (
            <div data-testid="client-issue-callout" className="card" style={{ background: "#fef5f5", border: "1px solid #f3c0c0" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <AlertCircle size={20} style={{ color: "#c62828", marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#c62828" }}>Client flagged an issue with the draft</div>
                  <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.6, whiteSpace: "pre-wrap", padding: "10px 12px", background: "#fff", borderRadius: 8 }}>{eng.review_decision.issue_note}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Submitted {fmtDate(eng.review_decision.submitted_at)} — re-upload an updated draft once resolved.</div>
                </div>
              </div>
            </div>
          ) : eng.review_decision.decision === "approved" ? (
            <>
              {/* File-with-CRA workflow appears BEFORE the approved confirmation, per UX spec */}
              {eng.status !== "FILED" && (
                <FileWithCRACard eng={eng} onSubmit={fileWithCRA} busy={busy} />
              )}
              <div data-testid="client-approved-callout" className="card" style={{ background: "#e8f5e9", border: "1px solid #bbe1bd" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <Check size={20} style={{ color: "#2e7d32", marginTop: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#2e7d32" }}>Client approved the return</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Approved {fmtDate(eng.review_decision.submitted_at)} — ready to file with CRA.</div>
                  </div>
                </div>
              </div>
            </>
          ) : null
        )}

        <div className="two-col">
          <div className="stack-lg">
            {/* Upload Tax Return PDF (visible during In Prep / Review) */}
            {(eng.status === "IN_PREP" || eng.status === "IN_REVIEW") && (
              <UploadDraftCard
                eng={eng}
                docs={docs}
                onUpload={uploadDraft}
                onCancelDraft={cancelDraft}
                onDownload={downloadDoc}
                busy={busy}
              />
            )}

            {/* Draft + review cycle history (only renders if events exist) */}
            <DraftHistoryTable eng={eng} />

            {/* Document checklist */}
            <div className="card" data-testid="doc-checklist">
              <div className="flex items-center between">
                <h2 className="card-title">Document checklist</h2>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowNewReq(true)} data-testid="request-new-doc">
                  <FilePlus size={12} /> Request additional
                </button>
              </div>
              <div className="mt-3">
                {docs.filter((d) => !d.deferred_at).map((d) => (
                  <div className="list-row" key={d.id} data-testid={`cpa-doc-${d.id}`}>
                    <div style={{ flex: 1 }}>
                      <div className="flex items-center gap-2">
                        <DocIcon status={d.status} />
                        <span style={{ fontWeight: 500 }}>{d.name}</span>
                        {d.is_new_request && <span className="badge badge-active" style={{ fontSize: 10 }}>New request</span>}
                        {d.status === "ISSUE" && <span className="badge badge-risk" style={{ fontSize: 10 }}>Issue flagged</span>}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>{d.description}{d.file_name ? ` · ${d.file_name}` : ""}</div>
                      {d.status === "ISSUE" && d.issue_note && (
                        <div className="alert alert-risk mt-2" style={{ fontSize: 12 }}>
                          <AlertCircle size={14} /> <div><strong>Issue note: </strong>{d.issue_note}</div>
                        </div>
                      )}
                      {d.is_new_request && d.request_note && (
                        <div className="alert alert-active mt-2" style={{ fontSize: 12 }}>
                          <FileText size={14} /> <div><strong>Your note: </strong>{d.request_note}</div>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {d.object_key && <button className="btn btn-ghost btn-sm" onClick={() => downloadDoc(d)} data-testid={`download-${d.id}`}><Download size={12} /></button>}
                      {d.object_key && d.status !== "EXTRACTED" && (
                        <button className="btn btn-secondary btn-sm" onClick={() => runExtract(d)} disabled={busy} data-testid={`extract-${d.id}`}>
                          <Sparkles size={12} /> AI extract
                        </button>
                      )}
                      {d.object_key && (d.status === "UPLOADED" || d.status === "EXTRACTED") && (
                        <button className="btn btn-secondary btn-sm" onClick={() => markReviewed(d)} data-testid={`review-${d.id}`}>
                          <Check size={12} /> Mark reviewed
                        </button>
                      )}
                      {(d.object_key || d.status === "UPLOADED" || d.status === "REVIEWED" || d.status === "EXTRACTED" || d.status === "ISSUE") && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setFlagDoc(d)} data-testid={`flag-${d.id}`}>
                          <Flag size={12} /> {d.status === "ISSUE" ? "Edit issue" : "Flag issue"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Deferred docs */}
            {docs.some((d) => d.deferred_at) && (() => {
              const lastReminder = eng.deferred_reminder_sent_at;
              let cooldownActive = false;
              let cooldownLabel = null;
              if (lastReminder) {
                const sentDt = new Date(lastReminder);
                const nextOk = sentDt.getTime() + 48 * 3600 * 1000;
                if (Date.now() < nextOk) {
                  cooldownActive = true;
                  cooldownLabel = `Reminder sent ${sentDt.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
                }
              }
              return (
                <div className="card" style={{ background: "var(--bg-subtle)" }} data-testid="cpa-deferred-section">
                  <h2 className="card-title">Deferred by client ({docs.filter((d) => d.deferred_at).length})</h2>
                  <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>The client said they would upload these later. One reminder sends a single email listing all of them, with a 48-hour cooldown.</p>
                  <div>
                    {docs.filter((d) => d.deferred_at).map((d) => (
                      <div className="list-row" key={d.id} data-testid={`cpa-deferred-${d.id}`} style={{ borderBottomColor: "var(--border-default)" }}>
                        <div style={{ flex: 1 }}>
                          <div className="flex items-center gap-2"><CircleDashed size={14} style={{ color: "#f57f17" }} /><span style={{ fontWeight: 500 }}>{d.name}</span></div>
                          <div className="muted" style={{ fontSize: 12 }}>Deferred {fmtDate(d.deferred_at)}</div>
                        </div>
                        {cooldownActive ? (
                          <span className="badge badge-complete" data-testid={`reminder-sent-${d.id}`}>
                            <Bell size={11} /> {cooldownLabel}
                          </span>
                        ) : (
                          <button className="btn btn-secondary btn-sm" onClick={sendDeferredReminder} disabled={reminderBusy} data-testid={`remind-${d.id}`}>
                            {reminderBusy ? <span className="spinner" /> : <><Bell size={12} /> Send reminder</>}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Extracted data */}
            <div className="card" data-testid="extracted-card">
              <div className="flex items-center between">
                <h2 className="card-title">Extracted data</h2>
                <span className="muted" style={{ fontSize: 11 }}>{extracted.length} fields</span>
              </div>
              <div className="mt-3">
                {extracted.length === 0 && <div className="muted">No data extracted yet. Upload prior T2 and NOA, then click AI extract on the document.</div>}
                {extracted.map((r) => {
                  const amber = String(r.value).match(/\$4[5-9],|\$5[0-9],/); // rough passive-income flag
                  return (
                    <div className="list-row" key={r.id} style={{ background: amber ? "#fff8e1" : "transparent", borderRadius: 8, padding: "10px 12px", marginLeft: -12, marginRight: -12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{r.field}</div>
                        <div className="muted" style={{ fontSize: 11 }}>Source: {r.source || "—"}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span>{r.value}</span>
                        {r.verified_by_cpa ? <span className="badge badge-complete">verified</span> : <span className="badge badge-attention">review</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Opportunities */}
            <div className="card" data-testid="opp-card">
              <div className="flex items-center between">
                <h2 className="card-title">Opportunities</h2>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowOppModal(true)} data-testid="add-opp"><Plus size={12} /> Add</button>
              </div>
              <div className="mt-3">
                {opps.length === 0 && <div className="muted">No opportunities tagged.</div>}
                {opps.map((o) => (
                  <div className="list-row" key={o.id}>
                    <div style={{ flex: 1 }}>
                      <div className="flex items-center gap-2"><SeverityDot severity={o.severity} /><span style={{ fontWeight: 500 }}>{o.title}</span></div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{o.description}</div>
                      <div className="label-caption mt-2">{OPP_LABELS[o.category]}</div>
                    </div>
                    <div>
                      {o.shared_with_ws ? <span className="badge badge-complete">shared</span> : <button className="btn btn-secondary btn-sm" onClick={() => shareOpp(o)} data-testid={`share-opp-${o.id}`}>Share with WS</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="stack-lg">
            <div className="card" data-testid="review-checklist">
              <h2 className="card-title">Review checklist</h2>
              <div className="mt-3">
                {cl.map((c) => (
                  <label key={c.id} className="list-row" style={{ cursor: "pointer" }}>
                    <div className="flex items-center gap-2" style={{ flex: 1 }}>
                      <input type="checkbox" checked={c.is_completed} onChange={() => toggleCheck(c)} data-testid={`check-${c.id}`} />
                      <span style={{ textDecoration: c.is_completed ? "line-through" : "none", color: c.is_completed ? "var(--text-secondary)" : "inherit" }}>{c.item}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="card" data-testid="time-tracker">
              <div className="flex items-center between">
                <h2 className="card-title">Time logged</h2>
                <span className="muted" style={{ fontSize: 12 }}>{totalHours.toFixed(1)}h total</span>
              </div>
              <div className="mt-3 stack-sm">
                {Object.entries(hoursByCat).map(([k, v]) => (
                  <div className="flex between" key={k} style={{ fontSize: 12 }}>
                    <span className="muted">{TIME_LABELS[k] || k}</span>
                    <span>{v.toFixed(1)}h</span>
                  </div>
                ))}
              </div>
              <div className="divider" />
              <div className="stack-sm">
                <select className="select" value={newTime.category} onChange={(e) => setNewTime({ ...newTime, category: e.target.value })} data-testid="time-cat">
                  {Object.entries(TIME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input className="input" type="number" step="0.25" placeholder="Hours" value={newTime.hours} onChange={(e) => setNewTime({ ...newTime, hours: e.target.value })} data-testid="time-hours" />
                <button className="btn btn-secondary btn-sm" onClick={addTime} data-testid="time-add"><Plus size={12} /> Log time</button>
              </div>
            </div>

            <div className="card">
              <h2 className="card-title">Client</h2>
              <div className="mt-3 stack-sm" style={{ fontSize: 12 }}>
                <div><span className="muted">Name: </span>{client.name}</div>
                <div><span className="muted">Email: </span>{client.email}</div>
                <div><span className="muted">Phone: </span>{client.phone || "—"}</div>
                <div><span className="muted">Province: </span>{corp.province}</div>
                <div><span className="muted">Practice: </span>{corp.practice_type || "—"}</div>
                <div><span className="muted">WS advisor: </span>{eng.ws_advisor?.name || "—"}</div>
              </div>
            </div>

            <div className="card" data-testid="cra-card">
              <h2 className="card-title">CRA access</h2>
              <div className="mt-3 stack-sm" style={{ fontSize: 12 }}>
                <div><span className="muted">Status: </span>{eng.cra_access_status?.replace(/_/g, " ").toLowerCase()}</div>
                <div><span className="muted">Method: </span>{eng.cra_access_method || "—"}</div>
                {eng.cra_programs && (
                  <div className="flex gap-2 mt-2">
                    {Object.entries(eng.cra_programs).map(([k, v]) => <span key={k} className={`badge ${v ? "badge-complete" : "badge-neutral"}`}>{k}</span>)}
                  </div>
                )}
                {eng.cra_access_status !== "ACCESS_VERIFIED" && (
                  <button className="btn btn-secondary btn-sm mt-3" onClick={async () => { await api.patch(`/engagements/${eid}`, { cra_access_status: "ACCESS_VERIFIED", cra_programs: { RC0001: true, RZ0001: false, RP0001: false } }); await load(); }} data-testid="verify-cra">
                    Mark CRA access verified
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="card" style={{ padding: 0 }} data-testid="cpa-messages-card">
          <div style={{ padding: "20px 28px 0 28px" }}>
            <h2 className="card-title">Messages</h2>
            <p className="muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 16 }}>Real-time chat with {client.name}.</p>
          </div>
          <div style={{ padding: "0 28px 28px 28px" }}>
            <ChatThread
              engagementId={eid}
              headerUser={{ name: client.name, subtitle: corp.name }}
              mineRightAlign={true}
              mineColor="dark"
              height={520}
            />
          </div>
        </div>

        {/* Status history timeline */}
        <div className="card" data-testid="status-history-card">
          <StatusHistoryHeader count={history.length} open={historyOpen} onToggle={() => setHistoryOpen(!historyOpen)} />
          {historyOpen && (
            <div className="mt-4">
              <StatusHistoryTimeline rows={history} />
            </div>
          )}
        </div>
      </div>

      {showOppModal && <AddOppModal onClose={() => setShowOppModal(false)} onCreate={createOpp} />}
      {flagDoc && <FlagIssueModal doc={flagDoc} onClose={() => setFlagDoc(null)} onSave={flagIssue} />}
      {showNewReq && <NewDocRequestModal onClose={() => setShowNewReq(false)} onCreate={requestNewDoc} />}
    </div>
  );
}
