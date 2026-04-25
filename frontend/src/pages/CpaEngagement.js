import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, fmtError, fmtDate, TIME_LABELS, OPP_LABELS } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge, StatusBadge, SeverityDot } from "../components/shared/Badges";
import StatusHistoryTimeline, { StatusHistoryHeader } from "../components/shared/StatusHistoryTimeline";
import { Check, CircleDashed, AlertCircle, FileText, Sparkles, Plus, Download, Flag, FilePlus, Bell } from "lucide-react";

const STATUS_FLOW = ["REFERRED", "INTAKE", "IN_PREP", "IN_REVIEW", "DELIVERY", "FILED"];

function DocIcon({ status }) {
  if (status === "REVIEWED") return <Check size={14} style={{ color: "#2e7d32" }} />;
  if (status === "EXTRACTED") return <Check size={14} style={{ color: "#6a1b9a" }} />;
  if (status === "UPLOADED") return <Check size={14} style={{ color: "#1565c0" }} />;
  if (status === "ISSUE") return <AlertCircle size={14} style={{ color: "#c62828" }} />;
  return <CircleDashed size={14} style={{ color: "#b5b0ab" }} />;
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
    setBusy(true);
    try { await api.patch(`/engagements/${eid}`, { status: next }); await load(); } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
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
              <>
                <button className="btn btn-secondary" onClick={() => advanceStatus(nextStatus)} disabled={busy} data-testid="advance-status">
                  Move to {nextStatus.replace("_", " ").toLowerCase()}
                </button>
                {eng.status === "DELIVERY" && <button className="btn btn-success" onClick={() => advanceStatus("FILED")} data-testid="mark-filed">Mark filed</button>}
              </>
            )}
          </div>
        </div>

        {err && <div className="alert alert-risk">{err}</div>}

        <div className="two-col">
          <div className="stack-lg">
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
