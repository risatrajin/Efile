import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, fmtError, fmtDate, initials } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge } from "../components/shared/Badges";
import { ArrowLeft, ArrowRight, Plus, X, GripVertical, Check } from "lucide-react";

const PROVINCES = ["ON", "BC", "AB", "QC", "MB", "SK", "NS", "NB", "NL", "PE", "YT", "NT", "NU"];

function ChecklistEditor({ items, onChange, readOnly = false }) {
  const [editingIdx, setEditingIdx] = useState(null);
  const [draftText, setDraftText] = useState("");

  const toggle = (i) => {
    if (readOnly) return;
    const next = items.map((c, idx) => idx === i ? { ...c, is_completed: !c.is_completed } : c);
    onChange(next);
  };
  const startEdit = (i) => { setEditingIdx(i); setDraftText(items[i].item); };
  const saveEdit = () => {
    if (editingIdx === null) return;
    const next = items.map((c, idx) => idx === editingIdx ? { ...c, item: draftText } : c);
    onChange(next);
    setEditingIdx(null);
  };
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const addNew = () => onChange([...items, { id: `new-${Date.now()}`, item: "New item", is_completed: false, sort_order: items.length }]);
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="stack-sm" data-testid="checklist-editor">
      {items.map((c, i) => (
        <div key={c.id || i} className="flex items-center gap-2" style={{ padding: "10px 12px", background: c.is_completed ? "var(--bg-subtle)" : "transparent", borderRadius: 8, border: "1px solid var(--border-default)" }} data-testid={`checklist-row-${i}`}>
          {!readOnly && (
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <button onClick={() => move(i, -1)} className="muted" style={{ fontSize: 9 }} disabled={i === 0}>▲</button>
              <button onClick={() => move(i, +1)} className="muted" style={{ fontSize: 9 }} disabled={i === items.length - 1}>▼</button>
            </div>
          )}
          <button
            type="button"
            onClick={() => toggle(i)}
            data-testid={`checklist-toggle-${i}`}
            style={{
              width: 18, height: 18, borderRadius: 4,
              border: `1.5px solid ${c.is_completed ? "#1565c0" : "#d9d5cf"}`,
              background: c.is_completed ? "#1565c0" : "#fff",
              display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >
            {c.is_completed && <Check size={11} style={{ color: "#fff" }} />}
          </button>
          {editingIdx === i ? (
            <input className="input" style={{ flex: 1, height: 32 }} autoFocus value={draftText} onChange={(e) => setDraftText(e.target.value)} onBlur={saveEdit} onKeyDown={(e) => e.key === "Enter" && saveEdit()} data-testid={`checklist-edit-input-${i}`} />
          ) : (
            <span
              onClick={() => !readOnly && startEdit(i)}
              style={{ flex: 1, fontSize: 13, color: c.is_completed ? "var(--text-tertiary)" : "var(--text-primary)", textDecoration: c.is_completed ? "line-through" : "none", cursor: readOnly ? "default" : "text" }}
              data-testid={`checklist-label-${i}`}
            >
              {c.item}
            </span>
          )}
          {!readOnly && (
            <button onClick={() => remove(i)} className="btn-ghost" style={{ padding: 4, color: "var(--text-tertiary)" }} data-testid={`checklist-remove-${i}`}><X size={12} /></button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button onClick={addNew} className="btn-link" style={{ fontSize: 12, marginTop: 4 }} data-testid="checklist-add"><Plus size={11} /> Add item</button>
      )}
    </div>
  );
}

export default function WsOnboardingDetail() {
  const { eid } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [eng, setEng] = useState(null);
  const [form, setForm] = useState(null);
  const [checklist, setChecklist] = useState([]);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get(`/engagements/${eid}`);
      setEng(data);
      const c = data.client || {};
      const corp = data.corporation || {};
      const parts = (c.name || "").trim().split(/\s+/);
      setForm({
        first_name: parts[0] || "",
        last_name: parts.slice(1).join(" ") || "",
        client_email: c.email || "",
        phone: c.phone || "",
        province: corp.province || "ON",
        corp_name: corp.name || "",
        fiscal_year_end: corp.fiscal_year_end ? new Date(corp.fiscal_year_end).toISOString().slice(0, 10) : "",
        tier: data.tier || "STANDARD",
        notes: data.notes || "",
      });
      setChecklist(data.pre_filing_checklist || []);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eid]);

  const persistChecklist = async (next) => {
    setChecklist(next);
    try { await api.patch(`/engagements/${eid}/pre-filing-checklist`, { items: next }); } catch (x) { setErr(fmtError(x)); }
  };

  const saveAll = async () => {
    setBusy(true); setErr("");
    try {
      await api.patch(`/engagements/${eid}/onboarding`, {
        first_name: form.first_name, last_name: form.last_name,
        client_email: form.client_email, phone: form.phone, province: form.province,
        corp_name: form.corp_name,
        fiscal_year_end: form.fiscal_year_end ? new Date(form.fiscal_year_end + "T00:00:00Z").toISOString() : null,
        tier: form.tier,
        notes: form.notes,
      });
      setSavedAt(new Date());
      await load();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      await api.post(`/engagements/${eid}/submit`);
      navigate("/ws/dashboard");
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  if (!eng || !form) return <div className="app-root"><AppHeader tabs={[{ key: "dashboard", to: "/ws/dashboard", label: "Dashboard" }]} /><div className="page-wide">Loading…</div></div>;

  const completed = checklist.filter((c) => c.is_completed).length;
  const total = checklist.length;
  const ready = total > 0 && completed >= total;
  const remaining = Math.max(0, total - completed);
  const corp = eng.corporation || {};

  return (
    <div className="app-root">
      <AppHeader tabs={[{ key: "dashboard", to: "/ws/dashboard", label: "Dashboard" }]} />
      <div className="page-wide stack-lg" data-testid="ws-onboarding-detail">
        <Link to="/ws/dashboard" className="btn-link" style={{ width: "fit-content" }}><ArrowLeft size={12} /> Onboarding</Link>
        {err && <div className="alert alert-risk">{err}</div>}

        <div className="flex between items-start" style={{ flexWrap: "wrap", gap: 16 }}>
          <div className="flex items-start gap-4">
            <div className="avatar" style={{ width: 56, height: 56, fontSize: 16 }}>{initials(`${form.first_name} ${form.last_name}`)}</div>
            <div>
              <h1 className="page-title">{form.first_name} {form.last_name}</h1>
              <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>{form.corp_name || "Corporation pending"}</p>
              <div className="flex items-center gap-2 mt-3">
                {form.tier && <TierBadge tier={form.tier} />}
                <span className={`badge ${ready ? "badge-complete" : "badge-neutral"}`}>{ready ? "Ready" : "Draft"}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {savedAt && <span className="tertiary" style={{ fontSize: 11 }}>Saved {savedAt.toLocaleTimeString()}</span>}
            <button className="btn btn-secondary" onClick={saveAll} disabled={busy} data-testid="save-changes">Save changes</button>
          </div>
        </div>

        <div className="two-col">
          <div className="stack-lg">
            <div className="card" data-testid="form-client-info">
              <h2 className="card-title">Client information</h2>
              <div className="grid-2 mt-3" style={{ rowGap: 18 }}>
                <div className="field"><label className="field-label">First name</label><input className="input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} data-testid="f-first" /></div>
                <div className="field"><label className="field-label">Last name</label><input className="input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} data-testid="f-last" /></div>
                <div className="field"><label className="field-label">Email</label><input className="input" type="email" value={form.client_email} onChange={(e) => setForm({ ...form, client_email: e.target.value })} data-testid="f-email" /></div>
                <div className="field"><label className="field-label">Phone</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="f-phone" /></div>
                <div className="field"><label className="field-label">Province</label>
                  <select className="select" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} data-testid="f-prov">{PROVINCES.map((p) => <option key={p}>{p}</option>)}</select>
                </div>
              </div>
            </div>

            <div className="card" data-testid="form-engagement">
              <h2 className="card-title">Engagement</h2>
              <div className="grid-2 mt-3" style={{ rowGap: 18 }}>
                <div className="field" style={{ gridColumn: "1 / span 2" }}><label className="field-label">Corporation name</label><input className="input" value={form.corp_name} onChange={(e) => setForm({ ...form, corp_name: e.target.value })} data-testid="f-corp" /></div>
                <div className="field"><label className="field-label">Fiscal year end</label><input className="input" type="date" value={form.fiscal_year_end} onChange={(e) => setForm({ ...form, fiscal_year_end: e.target.value })} data-testid="f-fye" /></div>
                <div className="field"><label className="field-label">WS Advisor</label><div style={{ fontSize: 13, fontWeight: 500, paddingTop: 2 }}>{user?.name}</div></div>
              </div>
              <div className="field mt-3">
                <label className="field-label">Service tier</label>
                <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                  {[
                    { v: "WHITE_GLOVE", label: "White-Glove" },
                    { v: "BOOKS_COMPLETE", label: "Books Complete" },
                    { v: "STANDARD", label: "Standard" },
                  ].map((t) => (
                    <button key={t.v} type="button" onClick={() => setForm({ ...form, tier: t.v })} data-testid={`f-tier-${t.v}`}
                      style={{
                        padding: "10px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                        border: `1.5px solid ${form.tier === t.v ? "#1565c0" : "var(--border-default)"}`,
                        background: form.tier === t.v ? "#e3f2fd" : "#fff",
                        color: form.tier === t.v ? "#1565c0" : "var(--text-primary)",
                      }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="card" data-testid="form-notes">
              <h2 className="card-title">Tax situation / Notes</h2>
              <textarea className="textarea" rows={5} style={{ marginTop: 12 }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Background, planning notes, special considerations..." data-testid="f-notes" />
              <button className="btn btn-secondary btn-sm mt-3" onClick={saveAll} disabled={busy}>Save notes</button>
            </div>
          </div>

          <div className="stack-lg">
            <div className="card" data-testid="checklist-card">
              <div className="flex items-center between">
                <h2 className="card-title">Pre-filing checklist</h2>
                <span className="muted" style={{ fontSize: 12 }}>{completed}/{total}</span>
              </div>
              <div className="mini-bar" style={{ width: "100%", marginTop: 8, marginBottom: 12 }}>
                <div className="fill" style={{ width: `${total ? (completed / total) * 100 : 0}%`, background: ready ? "#2e7d32" : "#1565c0" }} />
              </div>
              <ChecklistEditor items={checklist} onChange={persistChecklist} />
              <button
                className="btn btn-primary w-full mt-4"
                style={{
                  background: ready ? "#1565c0" : "#9bc4ea",
                  cursor: ready ? "pointer" : "not-allowed",
                  justifyContent: "center",
                }}
                disabled={!ready || busy}
                onClick={submit}
                data-testid="submit-to-cloudtax"
              >
                {ready ? <>Move to CloudTax <ArrowRight size={11} /></> : `Complete all checklist items to submit · ${remaining} remaining`}
              </button>
            </div>

            <div className="card" data-testid="submission-card">
              <h2 className="card-title">Submission details</h2>
              <div className="mt-3 stack-sm" style={{ fontSize: 13 }}>
                <div className="list-row"><span className="muted">Status</span><span className={`badge ${ready ? "badge-complete" : "badge-neutral"}`}>{ready ? "Ready" : "Draft"}</span></div>
                <div className="list-row"><span className="muted">Added</span><span style={{ fontWeight: 500 }}>{fmtDate(eng.created_at)}</span></div>
                <div className="list-row"><span className="muted">WS Advisor</span><span style={{ fontWeight: 500 }}>{user?.name}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
