import React, { useEffect, useState } from "react";
import { api, fmtError } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";
import { MessageSquarePlus, Pencil, Trash2, Check, X } from "lucide-react";

// Partner feedback on a client/engagement.
//  * PARTNER  → compose + edit/remove their OWN items (the one writable thing
//               in the otherwise view-only partner portal).
//  * ADMIN/CPA → read-only list, with the "edited" indicator + removed tombstones.
//  * CLIENT   → this card is never rendered on client routes, and the API blocks
//               them anyway.
// Adapts purely from the current user's role, so the same <PartnerFeedbackCard
// eid={eid} /> drops into the partner file page and both staff client-detail pages.

function ts(iso) {
  if (!iso) return "";
  const isoUtc = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  return new Date(isoUtc).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

export default function PartnerFeedbackCard({ eid }) {
  const { user } = useAuth();
  const isPartner = user?.role === "PARTNER";
  const isStaff = user?.role === "ADMIN" || user?.role === "CPA";

  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get(`/engagements/${eid}/partner-feedback`);
      setItems(data || []);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eid]);

  // Don't render for roles that can't read it (defensive — also gated by route).
  if (!isPartner && !isStaff) return null;

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setErr("");
    try {
      await api.post(`/engagements/${eid}/partner-feedback`, { text });
      setDraft("");
      await load();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const startEdit = (it) => { setEditingId(it.id); setEditText(it.text); };
  const cancelEdit = () => { setEditingId(null); setEditText(""); };
  const saveEdit = async (id) => {
    const text = editText.trim();
    if (!text || busy) return;
    setBusy(true); setErr("");
    try {
      await api.patch(`/partner-feedback/${id}`, { text });
      cancelEdit();
      await load();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };
  const remove = async (id) => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      await api.delete(`/partner-feedback/${id}`);
      await load();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  return (
    <div className="card" data-testid="partner-feedback-card">
      <h2 className="card-title" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Partner feedback</h2>
      <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
        {isPartner
          ? "Your notes on this client. Visible to the CloudTax team only — the client never sees them."
          : "Feedback from the referring partner. Visible to CloudTax staff only — read-only."}
      </p>

      {err && <div className="alert alert-risk" style={{ marginBottom: 12 }}>{err}</div>}

      {/* Partner compose box */}
      {isPartner && (
        <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border-default)", borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <textarea
            className="textarea"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add feedback on this client for the CloudTax team…"
            data-testid="partner-feedback-input"
            style={{ background: "#fff" }}
          />
          <div className="flex" style={{ justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy || !draft.trim()} data-testid="partner-feedback-submit">
              <MessageSquarePlus size={14} /> Add feedback
            </button>
          </div>
        </div>
      )}

      {/* Feedback list */}
      {items.length === 0 && (
        <div className="muted" style={{ fontSize: 13 }} data-testid="partner-feedback-empty">
          {isPartner ? "You haven’t left any feedback yet." : "No partner feedback on this client."}
        </div>
      )}

      <div className="stack-sm">
        {items.map((it) => {
          const removed = it.removed;
          const isEditing = editingId === it.id;
          return (
            <div
              key={it.id}
              data-testid={`partner-feedback-item-${it.id}`}
              style={{
                padding: "10px 12px",
                background: removed ? "#fbeaea" : "var(--bg-subtle)",
                border: `1px solid ${removed ? "#f1c9c9" : "var(--border-default)"}`,
                borderRadius: 10,
              }}
            >
              <div className="flex items-center between" style={{ flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
                <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{it.partner_name || "Partner"}</span>
                  {it.edited && !removed && (
                    <span className="badge badge-neutral" style={{ fontSize: 10 }} title={`Edited ${ts(it.edited_at)}`} data-testid={`partner-feedback-edited-${it.id}`}>edited</span>
                  )}
                  {removed && (
                    <span className="badge" style={{ fontSize: 10, background: "#f8d7da", color: "#a12c2c" }} title={`Removed ${ts(it.removed_at)}`} data-testid={`partner-feedback-removed-${it.id}`}>removed</span>
                  )}
                </div>
                {/* Author-only controls (never for staff or on removed items) */}
                {isPartner && !removed && !isEditing && (
                  <div className="flex gap-1">
                    <button className="btn btn-ghost btn-sm" onClick={() => startEdit(it)} disabled={busy} title="Edit" data-testid={`partner-feedback-edit-${it.id}`}><Pencil size={12} /></button>
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(it.id)} disabled={busy} title="Remove" data-testid={`partner-feedback-remove-${it.id}`} style={{ color: "#c62828" }}><Trash2 size={12} /></button>
                  </div>
                )}
              </div>

              {isEditing ? (
                <div>
                  <textarea className="textarea" rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} data-testid={`partner-feedback-edit-input-${it.id}`} autoFocus />
                  <div className="flex gap-1" style={{ justifyContent: "flex-end", marginTop: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => saveEdit(it.id)} disabled={busy || !editText.trim()} data-testid={`partner-feedback-edit-save-${it.id}`}><Check size={12} /> Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={cancelEdit} disabled={busy}><X size={12} /></button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word", textDecoration: removed ? "line-through" : "none", color: removed ? "var(--text-tertiary)" : "var(--text-primary)" }}>
                  {it.text}
                </div>
              )}

              <div className="tertiary" style={{ fontSize: 11, marginTop: 6 }}>
                {ts(it.created_at)}
                {it.edited && it.edited_at ? ` · edited ${ts(it.edited_at)}` : ""}
                {removed && it.removed_at ? ` · removed ${ts(it.removed_at)}` : ""}
              </div>

              {/* Staff-only audit trail of prior versions */}
              {isStaff && (it.edit_history || []).length > 0 && (
                <details style={{ marginTop: 6 }} data-testid={`partner-feedback-history-${it.id}`}>
                  <summary className="tertiary" style={{ fontSize: 11, cursor: "pointer" }}>Edit history ({it.edit_history.length})</summary>
                  <div className="stack-sm" style={{ marginTop: 6 }}>
                    {it.edit_history.map((h, i) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", borderLeft: "2px solid var(--border-default)", paddingLeft: 8 }}>
                        <span style={{ whiteSpace: "pre-wrap" }}>{h.text}</span>
                        <span className="tertiary" style={{ fontSize: 10, display: "block" }}>{ts(h.at)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
