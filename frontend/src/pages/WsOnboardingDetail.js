import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, fmtError, fmtDate, initials } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge } from "../components/shared/Badges";
import ChecklistSettingsModal from "../components/shared/ChecklistSettingsModal";
import EngagementNotes from "../components/shared/EngagementNotes";
import { toast } from "../lib/toast";
import { ArrowLeft, ArrowRight, Settings as SettingsIcon, Lock, Check, Mail } from "lucide-react";

const PROVINCES = ["ON", "BC", "AB", "QC", "MB", "SK", "NS", "NB", "NL", "PE", "YT", "NT", "NU"];

function ChecklistRow({ item, onToggle, disabled }) {
  return (
    <div className="flex items-center gap-3" style={{ padding: "8px 0" }} data-testid={`checklist-item-${item.id}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={item.is_completed}
        onClick={onToggle}
        disabled={disabled}
        data-testid={`checklist-toggle-${item.id}`}
        style={{
          width: 20, height: 20, borderRadius: 4,
          border: `1.5px solid ${item.is_completed ? "#1565c0" : "#c5c0b8"}`,
          background: item.is_completed ? "#1565c0" : "#fff",
          display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          cursor: disabled ? "wait" : "pointer", opacity: disabled ? 0.6 : 1,
        }}
      >
        {item.is_completed && <Check size={13} style={{ color: "#fff" }} strokeWidth={3} />}
      </button>
      <span style={{
        fontSize: 13,
        color: item.is_completed ? "var(--text-tertiary)" : "var(--text-primary)",
        textDecoration: item.is_completed ? "line-through" : "none",
      }}>{item.item}</span>
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
  // Authoritative copy of the checklist, mutated synchronously on each toggle so
  // rapid clicks never build a PATCH body off stale state (the old closure bug
  // dropped fast checks). Saves are coalesced + serialized (saveChecklist below)
  // so concurrent full-list PATCHes can't race and clobber each other on the
  // backend — a single in-flight request always carries the latest ref.
  const checklistRef = useRef([]);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [err, setErr] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [resentLink, setResentLink] = useState(null);
  const [resending, setResending] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(`/engagements/${eid}`);
      setEng(data);
      const c = data.client || {};
      const corp = data.corporation || {};
      // Prefer the exact first_name / last_name stored on the user document —
      // multi-word first names like "Dr Bala" would otherwise be mangled by
      // any whitespace split. Only fall back to a split of ``name`` for legacy
      // records that predate the separate fields.
      let firstName = c.first_name;
      let lastName = c.last_name;
      if (firstName == null && lastName == null) {
        const raw = (c.name || "").trim();
        firstName = raw;  // treat the whole legacy ``name`` as first_name to
        lastName = "";    // avoid auto-splitting and losing intent.
      }
      setForm({
        first_name: firstName || "",
        last_name: lastName || "",
        client_email: c.email || "",
        phone: c.phone || "",
        province: corp.province || "ON",
        corp_name: corp.name || "",
        fiscal_year_end: corp.fiscal_year_end ? new Date(corp.fiscal_year_end).toISOString().slice(0, 10) : "",
        tier: data.tier || "STANDARD",
        notes: data.partner_notes || data.notes || "",
      });
      const items = data.pre_filing_checklist || [];
      setChecklist(items);
      checklistRef.current = items;
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eid]);

  // Persist the current checklist, but never more than one PATCH in flight. Any
  // toggles that land while a save is running set dirtyRef; we re-flush once it
  // returns so the backend converges to the latest ref instead of being
  // clobbered by an out-of-order, stale, full-list write.
  const saveChecklist = async () => {
    if (savingRef.current) { dirtyRef.current = true; return; }
    savingRef.current = true;
    dirtyRef.current = false;
    try {
      await api.patch(`/engagements/${eid}/pre-filing-checklist`, { items: checklistRef.current });
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) saveChecklist();
    }
  };

  const toggleItem = (idx) => {
    const cur = checklistRef.current;
    const item = cur[idx];
    if (!item) return;
    const next = cur.map((c, i) => (i === idx ? { ...c, is_completed: !c.is_completed } : c));
    checklistRef.current = next; // synchronous source of truth — no stale closure
    setChecklist(next);          // optimistic UI, instant feedback
    saveChecklist();             // coalesced + serialized persistence
  };

  const onTemplateSaved = async () => {
    // Reload engagement to pick up any new template items the backend may have synced
    await load();
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
      const nm = `${form.first_name} ${form.last_name}`.trim() || form.corp_name || "Client";
      toast(`${nm} referred to CloudTax — now awaiting CPA assignment.`);
      navigate("/admin/dashboard");
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const resendInvite = async () => {
    setResending(true); setErr("");
    try {
      const { data } = await api.post(`/engagements/${eid}/resend-invite`);
      setResentLink(data.invite_link);
    } catch (x) { setErr(fmtError(x)); }
    setResending(false);
  };

  if (!eng || !form) return (
    <div className="app-root">
      <AppHeader tabs={[{ key: "dashboard", to: "/admin/dashboard", label: "Dashboard" }]} />
      <div className="page-wide">Loading…</div>
    </div>
  );

  const completed = checklist.filter((c) => c.is_completed).length;
  const total = checklist.length;
  const ready = total > 0 && completed >= total;
  const fullName = `${form.first_name} ${form.last_name}`.trim();
  const displayName = fullName.replace(/^dr\.?\s+/i, "");

  return (
    <div className="app-root">
      <AppHeader tabs={[{ key: "dashboard", to: "/admin/dashboard", label: "Dashboard" }]} />
      <div className="page-wide stack-lg" data-testid="partner-onboarding-detail" style={{ maxWidth: 1200 }}>
        <Link to="/admin/dashboard" className="muted flex items-center gap-2" style={{ width: "fit-content", fontSize: 13, textDecoration: "none" }} data-testid="back-onboarding">
          <ArrowLeft size={14} /> Dashboard
        </Link>
        {err && <div className="alert alert-risk">{err}</div>}

        {/* Header — name, badges, save changes */}
        <div className="flex between items-start" style={{ flexWrap: "wrap", gap: 16 }}>
          <div className="flex items-start gap-4">
            <div className="avatar" style={{ width: 56, height: 56, fontSize: 16, background: "#dde8f7", color: "#1565c0" }}>{initials(fullName)}</div>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 700 }} data-testid="partner-detail-name">{displayName}</h1>
              <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>{form.corp_name || "Corporation pending"}</p>
              <div className="flex items-center gap-2 mt-3">
                {form.tier && <TierBadge tier={form.tier} />}
                <span className={`badge ${ready ? "badge-complete" : "badge-neutral"}`} data-testid="partner-detail-status-badge">{ready ? "Ready" : "Draft"}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {savedAt && <span className="tertiary" style={{ fontSize: 12 }} data-testid="saved-timestamp">Saved {savedAt.toLocaleTimeString()}</span>}
            <button
              onClick={saveAll}
              disabled={busy}
              data-testid="save-changes"
              className="btn btn-secondary btn-sm"
            >{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </div>

        {/* Two columns */}
        <div className="two-col" style={{ alignItems: "flex-start" }}>
          <div className="stack-lg">
            {/* Client info */}
            <div className="card" data-testid="form-client-info">
              <h2 className="card-title" style={{ fontSize: 16, fontWeight: 600 }}>Client information</h2>
              <div className="grid-2 mt-3" style={{ rowGap: 18 }}>
                <div className="field"><label className="field-label">First name</label><input className="input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} placeholder="First name" data-testid="f-first" /></div>
                <div className="field"><label className="field-label">Last name</label><input className="input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} placeholder="Last name" data-testid="f-last" /></div>
                <div className="field" style={{ gridColumn: "1 / span 2" }}><label className="field-label">Email</label><input className="input" type="email" value={form.client_email} onChange={(e) => setForm({ ...form, client_email: e.target.value })} placeholder="client@example.com" data-testid="f-email" /></div>
                <div className="field" style={{ gridColumn: "1 / span 2" }}><label className="field-label">Phone</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 (416) 555-0000" data-testid="f-phone" /></div>
                <div className="field" style={{ gridColumn: "1 / span 2" }}><label className="field-label">Province</label>
                  <select className="select" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} data-testid="f-prov">{PROVINCES.map((p) => <option key={p}>{p}</option>)}</select>
                </div>
              </div>
            </div>

            {/* Engagement */}
            <div className="card" data-testid="form-engagement">
              <h2 className="card-title" style={{ fontSize: 16, fontWeight: 600 }}>Engagement</h2>
              <div className="stack-md mt-3">
                <div className="field"><label className="field-label">Corporation name <span style={{ color: "#c62828" }}>*</span></label><input className="input" value={form.corp_name} onChange={(e) => setForm({ ...form, corp_name: e.target.value })} placeholder="Northpath IT Solutions Inc." data-testid="f-corp" required /></div>
                <div className="field"><label className="field-label">Fiscal year end</label><input className="input" type="date" value={form.fiscal_year_end} onChange={(e) => setForm({ ...form, fiscal_year_end: e.target.value })} data-testid="f-fye" /></div>
                <div className="field">
                  <label className="field-label">Service tier</label>
                  <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                    {[
                      { v: "WHITE_GLOVE", label: "White-Glove" },
                      { v: "BOOKS_COMPLETE", label: "Books Complete" },
                      { v: "STANDARD", label: "Standard" },
                    ].map((t) => (
                      <button key={t.v} type="button" aria-pressed={form.tier === t.v} onClick={() => setForm({ ...form, tier: t.v })} data-testid={`f-tier-${t.v}`}
                        style={{
                          flex: 1, padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500,
                          border: `1.5px solid ${form.tier === t.v ? "#1565c0" : "var(--border-default)"}`,
                          background: form.tier === t.v ? "#e3f2fd" : "#fff",
                          color: form.tier === t.v ? "#1565c0" : "var(--text-primary)",
                        }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label className="field-label">Advisor</label>
                  <div style={{ position: "relative" }}>
                    <input className="input" value={user?.name || ""} disabled data-testid="f-advisor" style={{ background: "var(--bg-subtle)", paddingRight: 40 }} />
                    <Lock size={14} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="stack-lg">
            {/* Pre-filing checklist (read-only with gear) */}
            <div className="card" data-testid="checklist-card">
              <div className="flex items-center between">
                <h2 className="card-title" style={{ fontSize: 16, fontWeight: 600 }}>Pre-filing checklist</h2>
                <button
                  onClick={() => setShowSettings(true)}
                  data-testid="checklist-settings-open"
                  style={{ width: 30, height: 30, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", transition: "background-color 120ms ease" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <SettingsIcon size={16} />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <div className="mini-bar" style={{ flex: 1 }}>
                  <div className="fill" style={{ width: `${total ? (completed / total) * 100 : 0}%`, background: "#1565c0" }} />
                </div>
                <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>{completed}/{total}</span>
              </div>
              <div style={{ marginTop: 12 }}>
                {checklist.map((c, i) => <ChecklistRow key={c.id || i} item={c} onToggle={() => toggleItem(i)} />)}
                {checklist.length === 0 && <div className="muted" style={{ fontSize: 12, padding: 12, textAlign: "center" }}>No checklist items configured. Click the gear icon to set up.</div>}
              </div>
              {/* Wrapper carries the title so the tooltip shows even while the
                  button is disabled (disabled controls swallow pointer events). */}
              <div style={{ marginTop: 16 }} title={!ready ? "Complete all required checklist items to submit." : undefined}>
                <button
                  onClick={submit}
                  disabled={!ready || busy}
                  data-testid="submit-to-cloudtax"
                  className="btn btn-primary w-full"
                >Move to CloudTax <ArrowRight size={14} /></button>
              </div>
              <p className="muted" style={{ fontSize: 12, textAlign: "center", marginTop: 10 }}>CPA assigned within 1–2 business days</p>
            </div>

            {/* Submission details */}
            <div className="card" data-testid="submission-card">
              <h2 className="card-title" style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Submission details</h2>
              <div className="stack-sm" style={{ fontSize: 13 }}>
                <div className="list-row" style={{ padding: "10px 0" }}><span className="muted">Status</span><span className={`badge ${ready ? "badge-complete" : "badge-neutral"}`} data-testid="submission-status">{ready ? "Ready" : "Draft"}</span></div>
                <div className="list-row" style={{ padding: "10px 0" }}><span className="muted">Added</span><span style={{ fontWeight: 500 }}>{fmtDate(eng.created_at)}</span></div>
                <div className="list-row" style={{ padding: "10px 0" }}><span className="muted">Advisor</span><span style={{ fontWeight: 500 }}>{user?.name}</span></div>
              </div>
              <div style={{ borderTop: "1px solid var(--border-default)", marginTop: 12, paddingTop: 12 }}>
                <button
                  onClick={resendInvite}
                  disabled={resending}
                  data-testid="resend-invite"
                  className="btn btn-secondary w-full"
                >
                  <Mail size={14} /> {resending ? "Sending…" : "Resend client invite"}
                </button>
                {resentLink && (
                  <div data-testid="resent-invite-link" style={{ marginTop: 10, padding: 10, background: "#e3f2fd", borderRadius: 8 }}>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Invitation sent. Copy this link if needed:</div>
                    <code style={{ display: "block", padding: 8, background: "#fff", borderRadius: 6, fontSize: 10, wordBreak: "break-all" }}>{resentLink}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(resentLink)}
                      style={{ marginTop: 6, color: "#1565c0", fontSize: 12, fontWeight: 500 }}
                    >Copy link</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tax situation / Notes — shared feed (newest at top) */}
        <EngagementNotes eid={eid} />

        <div style={{ height: 40 }} />
      </div>

      {showSettings && <ChecklistSettingsModal onClose={() => setShowSettings(false)} onSaved={onTemplateSaved} />}
    </div>
  );
}
