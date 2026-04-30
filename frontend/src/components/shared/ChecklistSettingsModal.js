import React, { useEffect, useState, useRef } from "react";
import { X, Plus, GripVertical, Check } from "lucide-react";
import { api, fmtError } from "../../lib/api";

/**
 * Shared checklist-settings dialog used by:
 *   • Partner / Admin — manages the pre-filing checklist
 *     (endpoint: ``/partner/checklist-template``).
 *   • CPA / Admin — manages the review checklist
 *     (endpoint: ``/cpa/review-checklist-template``).
 *
 * Both endpoints return/accept ``{items: [{label, optional}]}`` and propagate
 * saves globally to every engagement so the template stays in sync with the
 * render on every client's page.
 */
export default function ChecklistSettingsModal({ onClose, onSaved, mode = "partner" }) {
  const endpoint = mode === "cpa" ? "/cpa/review-checklist-template" : "/partner/checklist-template";
  const title = mode === "cpa" ? "Review checklist settings" : "Checklist settings";
  const [items, setItems] = useState([]);
  const [initial, setInitial] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const savedTimerRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(endpoint);
        const loaded = data.items || [];
        setItems(loaded);
        setInitial(JSON.parse(JSON.stringify(loaded)));
      } catch (e) { setErr(fmtError(e)); }
    })();
  }, [endpoint]);

  useEffect(() => () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); }, []);

  const updateItem = (i, label) => setItems(items.map((it, idx) => idx === i ? { ...it, label } : it));
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i));
  const addItem = () => {
    const v = draft.trim();
    if (!v) return;
    setItems([...items, { label: v, optional: false }]);
    setDraft("");
  };

  const onDragStart = (i) => setDragIdx(i);
  const onDragOver = (e) => e.preventDefault();
  const onDrop = (i) => {
    if (dragIdx === null || dragIdx === i) return;
    const next = [...items];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(i, 0, moved);
    setItems(next);
    setDragIdx(null);
  };

  // Dirty-state check — disables Save until the admin actually changes something.
  const dirty = JSON.stringify(items) !== JSON.stringify(initial);
  // All labels must be non-empty to permit save.
  const hasEmpty = items.some((it) => !String(it.label || "").trim());
  const canSave = dirty && !hasEmpty && items.length > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true); setErr(""); setSaved(false);
    try {
      const { data } = await api.put(endpoint, { items });
      const fresh = data.items || items;
      setInitial(JSON.parse(JSON.stringify(fresh)));
      setItems(fresh);
      setSaved(true);
      await onSaved?.();
      // Auto-dismiss the saved indicator after a moment so the admin can
      // continue editing or close; brief delay on close to let them read it.
      savedTimerRef.current = setTimeout(() => onClose(), 900);
    } catch (e) { setErr(fmtError(e)); }
    setBusy(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} data-testid="checklist-settings-modal">
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 460, maxHeight: "90vh", overflowY: "auto", padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>{title}</h2>
          <button onClick={onClose} data-testid="checklist-settings-close"><X size={18} /></button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>Changes apply to all clients globally</p>

        <div className="stack-sm" data-testid="checklist-settings-list">
          {items.map((it, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragOver={onDragOver}
              onDrop={() => onDrop(i)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 10,
                border: "1px solid var(--border-default)", background: "#fff",
                opacity: dragIdx === i ? 0.5 : 1,
              }}
              data-testid={`checklist-settings-row-${i}`}
            >
              <GripVertical size={14} style={{ color: "var(--text-tertiary)", cursor: "grab", flexShrink: 0 }} />
              <input
                value={it.label}
                onChange={(e) => updateItem(i, e.target.value)}
                style={{ flex: 1, fontSize: 13, border: "none", outline: "none", background: "transparent" }}
                data-testid={`checklist-settings-input-${i}`}
              />
              <button onClick={() => removeItem(i)} style={{ color: "var(--text-tertiary)" }} data-testid={`checklist-settings-remove-${i}`}><X size={14} /></button>
            </div>
          ))}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 10,
            border: "1px dashed var(--border-default)", background: "#fff", marginTop: 4,
          }}>
            <input
              value={draft}
              placeholder="Add new item..."
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addItem()}
              style={{ flex: 1, fontSize: 13, border: "none", outline: "none", background: "transparent" }}
              data-testid="checklist-settings-add-input"
            />
            <button onClick={addItem} style={{ color: "#1565c0" }} data-testid="checklist-settings-add"><Plus size={14} /></button>
          </div>
        </div>

        {err && <div className="alert alert-risk" style={{ marginTop: 12 }} data-testid="checklist-settings-err">{err}</div>}
        {saved && (
          <div
            data-testid="checklist-settings-saved"
            style={{
              marginTop: 12, display: "flex", alignItems: "center", gap: 8,
              padding: "10px 12px", borderRadius: 10,
              background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#1b5e20",
              fontSize: 13,
            }}
          >
            <Check size={14} /> Saved. Applied to all clients.
          </div>
        )}
        {hasEmpty && !err && (
          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Remove or fill in the empty items before saving.
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24 }}>
          <span className="muted" style={{ fontSize: 12 }} data-testid="checklist-settings-count">{items.length} items</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, background: "var(--bg-subtle)", fontSize: 13 }} data-testid="checklist-settings-cancel">Cancel</button>
            <button
              onClick={save}
              disabled={!canSave}
              style={{
                padding: "8px 16px", borderRadius: 8,
                background: canSave ? "#1e88e5" : "#bdbdbd",
                color: "#fff", fontSize: 13, fontWeight: 500,
                cursor: canSave ? "pointer" : "not-allowed",
              }}
              data-testid="checklist-settings-save"
            >{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
