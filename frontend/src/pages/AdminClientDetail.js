import React, { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api, fmtError, fmtDate, initials } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge, StatusBadge } from "../components/shared/Badges";
import { ArrowLeft, ArrowRight, MessageSquare, X, Pencil, Trash2, Check, FileText, Download, CheckCircle2 } from "lucide-react";
import MoveToDropdown from "../components/shared/MoveToDropdown";
import StatusHistoryTimeline, { StatusHistoryHeader } from "../components/shared/StatusHistoryTimeline";
import { ChatThread } from "./Messages";

// ----- Tax Situation: parse the legacy "[time] note\n\nnote" string back into rows -----
function parseNotes(notes) {
  if (!notes) return [];
  return notes
    .split(/\n\n+/)
    .map((block, idx) => {
      const m = block.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
      return m
        ? { id: idx, ts: m[1], text: m[2] }
        : { id: idx, ts: null, text: block };
    })
    .filter((r) => (r.text || "").trim().length > 0);
}

function serializeNotes(rows) {
  return rows
    .map((r) => (r.ts ? `[${r.ts}] ${r.text.trim()}` : r.text.trim()))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

function MessageClientModal({ eid, client, corp, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      data-testid="admin-message-modal"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, width: "min(720px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Message {client?.name || "client"}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{corp?.name}</div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" data-testid="admin-message-close" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 20, flex: 1, minHeight: 480, display: "flex" }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChatThread
              engagementId={eid}
              headerUser={{ name: client?.name || "Client", subtitle: corp?.name || "" }}
              mineRightAlign={true}
              mineColor="dark"
              height={520}
              hideHeader={true}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function TaxSituationCard({ rows, onSave, busy }) {
  const [adding, setAdding] = useState("");
  const [editingIdx, setEditingIdx] = useState(-1);
  const [editText, setEditText] = useState("");

  const addNote = async () => {
    if (!adding.trim()) return;
    const next = [...rows, { id: Date.now(), ts: new Date().toLocaleString("en-CA"), text: adding.trim() }];
    await onSave(next);
    setAdding("");
  };

  const startEdit = (i) => { setEditingIdx(i); setEditText(rows[i].text); };
  const cancelEdit = () => { setEditingIdx(-1); setEditText(""); };
  const saveEdit = async () => {
    const next = rows.map((r, i) => (i === editingIdx ? { ...r, text: editText.trim() } : r)).filter((r) => r.text);
    await onSave(next);
    cancelEdit();
  };
  const removeNote = async (i) => {
    const next = rows.filter((_, idx) => idx !== i);
    await onSave(next);
  };

  return (
    <div className="card" data-testid="tax-situation-card">
      <h2 className="card-title">Tax situation</h2>
      <div className="mt-3">
        {rows.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No notes yet. Add background or context for the assigned CPA below.</div>}
        <div className="stack-sm">
          {rows.map((r, i) => (
            <div
              key={r.id}
              data-testid={`tax-note-${i}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 12px",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border-default)",
                borderRadius: 10,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {editingIdx === i ? (
                  <textarea
                    className="textarea"
                    rows={2}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    data-testid={`tax-note-edit-${i}`}
                    autoFocus
                  />
                ) : (
                  <>
                    {r.ts && (
                      <div className="tertiary" style={{ fontSize: 10, fontWeight: 500, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>
                        {r.ts}
                      </div>
                    )}
                    <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {r.text}
                    </div>
                  </>
                )}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {editingIdx === i ? (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={saveEdit}
                      disabled={busy || !editText.trim()}
                      data-testid={`tax-note-save-${i}`}
                      title="Save"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={cancelEdit}
                      disabled={busy}
                      title="Cancel"
                      data-testid={`tax-note-cancel-${i}`}
                    >
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => startEdit(i)}
                      disabled={busy}
                      title="Edit"
                      data-testid={`tax-note-edit-btn-${i}`}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeNote(i)}
                      disabled={busy}
                      title="Remove"
                      data-testid={`tax-note-remove-${i}`}
                      style={{ color: "#c62828" }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <textarea
          className="textarea"
          rows={3}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="Add a note for the CPA..."
          data-testid="add-note-text"
        />
        <button
          className="btn btn-secondary btn-sm mt-2"
          onClick={addNote}
          disabled={busy || !adding.trim()}
          data-testid="add-note-save"
        >
          Add note
        </button>
      </div>
    </div>
  );
}

function DocumentsCard({ documents }) {
  if (!documents || documents.length === 0) return null;
  const docByCategory = (d) => {
    if (d.files && d.files.length) return d.files.length;
    return d.s3_object_key || d.object_key ? 1 : 0;
  };
  return (
    <div className="card" data-testid="admin-documents-card">
      <h2 className="card-title">Documents</h2>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Across all stages — same view the CPA has access to.
      </div>
      <div className="mt-3 stack-sm">
        {documents.map((d) => {
          const count = docByCategory(d);
          const uploaded = count > 0;
          return (
            <div
              key={d.id}
              data-testid={`admin-doc-${d.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border-default)",
                borderRadius: 10,
              }}
            >
              <FileText size={14} style={{ color: "var(--text-secondary)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{d.name || d.label}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {uploaded ? `${count} file${count > 1 ? "s" : ""} uploaded` : "Not uploaded"}
                </div>
              </div>
              <span
                className="badge"
                style={{
                  background: uploaded ? "#e8f5e9" : "#fff3e0",
                  color: uploaded ? "#1b5e20" : "#ef6c00",
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                {uploaded ? "Uploaded" : "Pending"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmtCurrency(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
}

function FiledReturnCard({ eng }) {
  const fs = eng.filing_summary || eng.tax_summary || {};
  const draftId = eng.filed_return_doc_id;
  const downloadHref = draftId ? `/api/documents/${draftId}/download` : null;
  const BASE = process.env.REACT_APP_BACKEND_URL || "";
  const handleDownload = async () => {
    if (!draftId) return;
    try {
      const token = localStorage.getItem("ct_token");
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
    <div className="card" data-testid="admin-filed-return-card" style={{ borderLeft: "3px solid #2e7d32" }}>
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

export default function AdminClientDetail() {
  const navigate = useNavigate();
  const { eid } = useParams();
  const [eng, setEng] = useState(null);
  const [cpas, setCpas] = useState([]);
  const [selectedCpa, setSelectedCpa] = useState("");
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [documents, setDocuments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showMessageModal, setShowMessageModal] = useState(false);

  const load = async () => {
    try {
      const [a, b, h, d] = await Promise.all([
        api.get(`/engagements/${eid}`),
        api.get("/users"),
        api.get(`/engagements/${eid}/history`).catch(() => ({ data: [] })),
        api.get(`/engagements/${eid}/documents`).catch(() => ({ data: [] })),
      ]);
      setEng(a.data);
      setCpas(b.data.filter((u) => u.role === "CPA" && u.is_active));
      setSelectedCpa(a.data.assigned_cpa_id || "");
      setHistory(h.data || []);
      setDocuments(d.data || []);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eid]);

  const assignAndMove = async () => {
    setBusy(true); setErr("");
    try {
      if (selectedCpa && selectedCpa !== eng.assigned_cpa_id) {
        await api.patch(`/engagements/${eid}`, { assigned_cpa_id: selectedCpa });
      }
      if (eng.status === "REFERRED") {
        await api.patch(`/engagements/${eid}`, { status: "INTAKE" });
      }
      navigate("/admin/dashboard");
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const justAssign = async () => {
    setBusy(true); setErr("");
    try {
      await api.patch(`/engagements/${eid}`, { assigned_cpa_id: selectedCpa });
      await load();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const saveNotesFromRows = async (rows) => {
    setBusy(true); setErr("");
    try {
      await api.patch(`/engagements/${eid}`, { notes: serializeNotes(rows) });
      await load();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const tabs = [
    { key: "dashboard", to: "/admin/dashboard", label: "Dashboard" },
    { key: "users", to: "/admin/users", label: "Users" },
  ];

  if (!eng) return <div className="app-root"><AppHeader tabs={tabs} /><div className="page-wide">Loading…</div></div>;
  const corp = eng.corporation || {};
  const client = eng.client || {};
  const noteRows = parseNotes(eng.notes);
  const ready = !!selectedCpa;

  return (
    <div className="app-root">
      <AppHeader tabs={tabs} />
      <div className="page-wide stack-lg" data-testid="admin-client-detail">
        <Link to="/admin/dashboard" className="btn-link" style={{ width: "fit-content" }}><ArrowLeft size={12} /> Back to Dashboard</Link>
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
              </div>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <button
              className="btn btn-secondary"
              onClick={() => setShowMessageModal(true)}
              data-testid="admin-message-client-btn"
            >
              <MessageSquare size={12} /> Message client
            </button>
            <MoveToDropdown
              current={eng.status}
              onChange={async (next) => {
                setBusy(true); setErr("");
                try {
                  if (next === "IN_REVIEW" && !eng.t2_draft_doc_id) {
                    await api.post(`/engagements/${eid}/move-to-review`, {});
                  } else {
                    await api.patch(`/engagements/${eid}`, { status: next });
                  }
                  await load();
                } catch (x) { setErr(fmtError(x)); }
                setBusy(false);
              }}
              disabledKeys={
                eng.status === "IN_PREP" && !eng.t2_draft_doc_id ? ["IN_REVIEW"] : []
              }
              note={eng.status === "IN_PREP" && !eng.t2_draft_doc_id ? "CPA must upload the T2 draft PDF before moving to Review." : null}
              testid="admin-move-to"
            />
            {ready && eng.status === "REFERRED" && (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={assignAndMove}
                data-testid="move-to-intake"
              >Assign &amp; Move to Intake <ArrowRight size={12} /></button>
            )}
          </div>
        </div>

        <div className="two-col">
          <div className="stack-lg">
            {eng.status === "FILED" && <FiledReturnCard eng={eng} />}
            <div className="card" data-testid="client-info-card">
              <h2 className="card-title">Client information</h2>
              <div className="grid-2 mt-3" style={{ rowGap: 18 }}>
                <div className="field"><label className="field-label">Email</label><div style={{ fontSize: 13, fontWeight: 500 }}>{client.email}</div></div>
                <div className="field"><label className="field-label">Phone</label><div style={{ fontSize: 13, fontWeight: 500 }}>{client.phone || "—"}</div></div>
                <div className="field"><label className="field-label">Corporation</label><div style={{ fontSize: 13, fontWeight: 500 }}>{corp.name}</div></div>
                <div className="field"><label className="field-label">Business number</label><div style={{ fontSize: 13, fontWeight: 500 }}>{corp.business_number || "—"}</div></div>
                <div className="field"><label className="field-label">Fiscal year end</label><div style={{ fontSize: 13, fontWeight: 500 }}>{fmtDate(corp.fiscal_year_end)}</div></div>
                <div className="field"><label className="field-label">Address</label><div style={{ fontSize: 13, fontWeight: 500 }}>{corp.address || "—"}</div></div>
              </div>
            </div>

            <TaxSituationCard rows={noteRows} onSave={saveNotesFromRows} busy={busy} />

            <DocumentsCard documents={documents} />
          </div>

          <div className="stack-lg">
            <div className="card" data-testid="assign-cpa-card">
              <h2 className="card-title">Assign CPA</h2>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Select a CPA to take over from intake.</div>
              <div className="field mt-3">
                <label className="field-label">CPA</label>
                <select className="select" value={selectedCpa} onChange={(e) => setSelectedCpa(e.target.value)} data-testid="cpa-select">
                  <option value="">— Select a CPA —</option>
                  {cpas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 mt-3">
                {eng.status === "REFERRED" ? (
                  <button className="btn btn-primary btn-sm w-full" disabled={!ready || busy} onClick={assignAndMove} data-testid="assign-and-move">
                    Assign & Move to Intake
                  </button>
                ) : (
                  <button className="btn btn-secondary btn-sm w-full" style={{ justifyContent: "center" }} disabled={!ready || busy || selectedCpa === eng.assigned_cpa_id} onClick={justAssign}>
                    Reassign CPA
                  </button>
                )}
              </div>
            </div>

            <div className="card" data-testid="status-history-card">
              <StatusHistoryHeader count={history.length} open={historyOpen} onToggle={() => setHistoryOpen(!historyOpen)} />
              {historyOpen && (
                <div className="mt-4">
                  <StatusHistoryTimeline rows={history} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showMessageModal && (
        <MessageClientModal
          eid={eid}
          client={client}
          corp={corp}
          onClose={() => setShowMessageModal(false)}
        />
      )}
    </div>
  );
}
