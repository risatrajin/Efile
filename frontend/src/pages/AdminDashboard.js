import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtError, fmtDate, initials } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge } from "../components/shared/Badges";
import EngagementTable, { ViewToggle } from "../components/shared/EngagementTable";
import UsersTable from "../components/shared/UsersTable";
import { Plus, X } from "lucide-react";

const COLUMNS = [
  { key: "ONBOARDING", label: "Onboarding" },
  { key: "REFERRED", label: "Referred" },
  { key: "INTAKE", label: "Intake" },
  { key: "IN_PREP", label: "In prep" },
  { key: "IN_REVIEW", label: "Review" },
  { key: "FILED", label: "Filed" },
];

const PROVINCES = ["ON", "BC", "AB", "QC", "MB", "SK", "NS", "NB", "NL", "PE", "YT", "NT", "NU"];

function StepDots({ step }) {
  return (
    <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
      <div style={{ height: 4, width: step >= 1 ? 32 : 24, borderRadius: 4, background: step >= 1 ? "#1565c0" : "#d9d5cf", transition: "all 200ms ease" }} />
      <div style={{ height: 4, width: step >= 2 ? 56 : 24, borderRadius: 4, background: step >= 2 ? "#1565c0" : "#d9d5cf", transition: "all 200ms ease" }} />
    </div>
  );
}

// Ported from the pre-Phase-1 partner AddClientModal. Onboarding is CloudTax-only
// now, so this lives on the Admin dashboard and uses the neutral CloudTax accent
// (#1565c0 / #1e88e5) — no partner purple. Same 2-step flow + fields the
// onboarding endpoint accepts (WsOnboardingIn). business_number / assigned_cpa
// are NOT set here (CPA assigned later via PATCH /engagements/{eid}).
function AddClientModal({ onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [eid, setEid] = useState(null);
  const [inviteLink, setInviteLink] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [form, setForm] = useState({
    first_name: "", last_name: "", client_email: "", phone: "",
    province: "ON", corp_name: "", fiscal_year_end: "2025-12-31",
    tier: "STANDARD", notes: "",
  });

  // Only first_name is strictly required alongside email + corp — allow mononyms
  // and multi-word first names where the operator left last name empty.
  const step1Valid = form.first_name && form.client_email && form.corp_name;

  const goNext = async () => {
    setBusy(true); setErr("");
    try {
      const payload = {
        first_name: form.first_name, last_name: form.last_name,
        client_email: form.client_email, phone: form.phone, province: form.province,
        corp_name: form.corp_name,
      };
      if (!eid) {
        const { data } = await api.post("/engagements/onboarding", payload);
        setEid(data.id);
        if (data.invite_link) setInviteLink(data.invite_link);
      } else {
        await api.patch(`/engagements/${eid}/onboarding`, payload);
      }
      setStep(2);
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true); setErr("");
    try {
      await api.patch(`/engagements/${eid}/onboarding`, {
        corp_name: form.corp_name,
        fiscal_year_end: form.fiscal_year_end ? new Date(form.fiscal_year_end + "T00:00:00Z").toISOString() : null,
        tier: form.tier,
        notes: form.notes,
      });
      await onCreated(eid);
      onClose();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} data-testid="add-client-modal">
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 520, maxHeight: "90vh", overflowY: "auto", padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600 }}>Add new client</h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Step {step} of 2</div>
            <StepDots step={step} />
          </div>
          <button onClick={onClose} data-testid="modal-close"><X size={18} /></button>
        </div>
        <div className="stack-md" style={{ marginTop: 20 }}>
          {step === 1 && (
            <>
              <div className="grid-2">
                <div className="field"><label className="field-label">First name</label>
                  <input className="input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} placeholder="Marcus" data-testid="ac-first" /></div>
                <div className="field"><label className="field-label">Last name</label>
                  <input className="input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} placeholder="Webb" data-testid="ac-last" /></div>
              </div>
              <div className="field"><label className="field-label">Email</label>
                <input className="input" type="email" value={form.client_email} onChange={(e) => setForm({ ...form, client_email: e.target.value })} placeholder="dr@clinicmail.ca" data-testid="ac-email" /></div>
              <div className="field"><label className="field-label">Phone</label>
                <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 (416) 555-0000" data-testid="ac-phone" /></div>
              <div className="field"><label className="field-label">Corporation name <span style={{ color: "#c62828" }}>*</span></label>
                <input className="input" value={form.corp_name} onChange={(e) => setForm({ ...form, corp_name: e.target.value })} placeholder="Northpath IT Solutions Inc." data-testid="ac-corp" required /></div>
              <div className="field"><label className="field-label">Province</label>
                <select className="select" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} data-testid="ac-province">
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select></div>
              {err && <div className="alert alert-risk">{err}</div>}
              <div className="flex gap-2" style={{ justifyContent: "space-between", marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" disabled={!step1Valid || busy} onClick={goNext} data-testid="ac-next">
                  {busy ? <span className="spinner" /> : <>Next →</>}
                </button>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              {inviteLink && (
                <div data-testid="invite-link-banner" style={{ padding: 14, borderLeft: "3px solid #1e88e5", background: "#e3f2fd", borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Client invite created</div>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                    An invite email was sent to <strong>{form.client_email}</strong>. If they don&apos;t receive it, share this link manually:
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <code style={{ flex: 1, padding: "8px 10px", background: "#fff", borderRadius: 6, fontSize: 11, wordBreak: "break-all", border: "1px solid var(--border-default)" }}>{inviteLink}</code>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(inviteLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); }}
                      data-testid="copy-invite-link"
                      style={{ padding: "8px 12px", borderRadius: 6, background: linkCopied ? "#2e7d32" : "#1e88e5", color: "#fff", fontSize: 12, fontWeight: 500 }}
                    >{linkCopied ? "Copied" : "Copy"}</button>
                  </div>
                </div>
              )}
              <div className="field"><label className="field-label">Fiscal year end</label>
                <input className="input" type="date" value={form.fiscal_year_end} onChange={(e) => setForm({ ...form, fiscal_year_end: e.target.value })} data-testid="ac-fye" /></div>
              <div className="field">
                <label className="field-label">Service tier</label>
                <div className="stack-sm" style={{ marginTop: 4 }}>
                  {[
                    { v: "WHITE_GLOVE", label: "White-Glove", desc: "Full service — prep, filing, advisory" },
                    { v: "BOOKS_COMPLETE", label: "Books Complete", desc: "We handle bookkeeping + T2" },
                    { v: "STANDARD", label: "Standard", desc: "T2 filing only" },
                  ].map((t) => {
                    const sel = form.tier === t.v;
                    return (
                      <button key={t.v} type="button" aria-pressed={sel} onClick={() => setForm({ ...form, tier: t.v })} data-testid={`ac-tier-${t.v}`}
                        style={{ width: "100%", textAlign: "left", padding: 14, borderRadius: 12, border: `1.5px solid ${sel ? "#1565c0" : "var(--border-default)"}`, background: sel ? "#e3f2fd" : "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", transition: "all 120ms ease" }}>
                        <div>
                          <TierBadge tier={t.v} />
                          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t.desc}</div>
                        </div>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${sel ? "#1565c0" : "#d9d5cf"}`, background: sel ? "#1565c0" : "transparent", flexShrink: 0 }} />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="field"><label className="field-label">Tax situation / notes</label>
                <textarea className="textarea" rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any relevant background or tax situation details..." data-testid="ac-notes" /></div>
              {err && <div className="alert alert-risk">{err}</div>}
              <div className="flex gap-2" style={{ justifyContent: "space-between", marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={() => setStep(1)} data-testid="ac-back">← Back</button>
                <button className="btn btn-primary" disabled={busy} onClick={save} data-testid="ac-save">Save & continue</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function withDrPrefix(name) {
  if (!name) return "—";
  return (/^dr\.?\s/i).test(name) ? name : `Dr. ${name}`;
}

function OnboardingCard({ eng, progress, onMove, onOpen }) {
  const corp = eng.corporation || {};
  const client = eng.client || {};
  const ready = progress?.ready;
  return (
    <div className="kanban-card" onClick={onOpen} data-testid={`onboarding-card-${eng.id}`} style={{ cursor: "pointer" }}>
      <div className="flex between items-start gap-2">
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{withDrPrefix(client.name)}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{corp.name || "Corporation pending"}</div>
        </div>
      </div>
      {eng.tier && <div style={{ marginTop: 10 }}><TierBadge tier={eng.tier} /></div>}
      <div className="muted" style={{ fontSize: 11, marginTop: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${client.email || ""}${corp.province ? " · " + corp.province : ""}`}>
        {client.email}{corp.province ? ` · ${corp.province}` : ""}
      </div>
      <div className="mt-3">
        {ready ? (
          <span className="badge badge-complete">Ready</span>
        ) : (
          <div>
            <div className="flex items-center between" style={{ fontSize: 11 }}>
              <span className="muted">Draft</span>
              <span className="muted">{progress?.completed || 0}/{progress?.total || 6} checklist</span>
            </div>
            <div className="mini-bar" style={{ width: "100%", marginTop: 6 }}>
              <div className="fill" style={{ width: `${((progress?.completed || 0) / (progress?.total || 6)) * 100}%`, background: "#1565c0" }} />
            </div>
          </div>
        )}
      </div>
      <div className="mt-3">
        {ready ? (
          <button
            onClick={(e) => { e.stopPropagation(); onMove(eng); }}
            data-testid={`move-${eng.id}`}
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 8,
              border: "1px solid var(--border-default)", background: "#fff",
              fontSize: 13, fontWeight: 500, color: "var(--text-primary)",
            }}
          >Move to CloudTax →</button>
        ) : (
          <button
            onClick={onOpen}
            data-testid={`continue-${eng.id}`}
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 8,
              border: "1px dashed var(--border-default)", background: "transparent",
              fontSize: 13, color: "var(--text-tertiary)",
            }}
          >Complete checklist to submit</button>
        )}
      </div>
    </div>
  );
}

function AdminCard({ eng, onClick }) {
  const corp = eng.corporation || {};
  const client = eng.client || {};
  const needsCpa = !eng.assigned_cpa_id && eng.status === "REFERRED";
  const isFiled = eng.status === "FILED";
  const craRef = eng.cra_confirmation_number || (isFiled ? `CRA-${(eng.id || "").slice(0, 6).toUpperCase()}` : null);
  const displayName = (/^dr\.?\s/i).test(client.name || "") ? client.name : `Dr. ${client.name || "—"}`;
  return (
    <div className="kanban-card" onClick={onClick} data-testid={`admin-card-${eng.id}`} style={{ cursor: "pointer", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{displayName}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{corp.name}</div>
        </div>
        <TierBadge tier={eng.tier} />
      </div>
      {needsCpa ? (
        <div className="mt-3 flex items-center gap-1" style={{ fontSize: 11 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f57f17" }} />
          <span style={{ color: "#f57f17", fontWeight: 500 }}>Needs CPA assignment</span>
        </div>
      ) : isFiled ? (
        <div style={{ marginTop: 12 }}>
          {craRef && <span className="badge" style={{ background: "#fff3e0", color: "#ef6c00", fontSize: 11, fontWeight: 600 }}>{craRef}</span>}
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Filed {fmtDate(eng.filing_date)}</div>
        </div>
      ) : (
        <>
          {eng.assigned_cpa && <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>CPA: {eng.assigned_cpa.name}</div>}
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Day {eng.days_elapsed || 0}</div>
        </>
      )}
    </div>
  );
}

function AddCpaModal({ onClose, onDone }) {
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [link, setLink] = useState(null);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const { data } = await api.post("/users/invite", {
        email: form.email,
        name: `${form.first_name} ${form.last_name}`.trim(),
        role: "CPA",
        display_role: "CPA",
        phone: form.phone || null,
      });
      setLink(data.invite_link);
      await onDone();
    } catch (e) { setErr(fmtError(e)); }
    setBusy(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} data-testid="add-cpa-modal">
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 460, maxHeight: "90vh", overflowY: "auto", padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Add CPA</h2>
          <button onClick={onClose} data-testid="add-cpa-close"><X size={18} /></button>
        </div>
        {link ? (
          <div className="stack-md">
            <div className="muted" style={{ fontSize: 13 }}>Invitation sent. You can copy this link and share it directly if needed:</div>
            <code style={{ display: "block", padding: 12, background: "var(--bg-subtle)", borderRadius: 8, fontSize: 11, wordBreak: "break-all" }} data-testid="cpa-invite-link">{link}</code>
            <button onClick={onClose} className="btn btn-primary w-full" data-testid="add-cpa-done">Done</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>CPA information</div>
            <div className="stack-md">
              <div className="field"><label className="field-label">FIRST NAME</label>
                <input className="input" placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} data-testid="cpa-first-name" /></div>
              <div className="field"><label className="field-label">LAST NAME</label>
                <input className="input" placeholder="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} data-testid="cpa-last-name" /></div>
              <div className="field"><label className="field-label">EMAIL</label>
                <input type="email" className="input" placeholder="email@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="cpa-email" /></div>
              <div className="field"><label className="field-label">PHONE (OPTIONAL)</label>
                <input className="input" placeholder="(555) 123-4567" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="cpa-phone" /></div>
            </div>
            <div style={{ marginTop: 20, padding: 14, borderLeft: "3px solid #1e88e5", background: "var(--bg-subtle)", borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Default CPA permissions will be granted</div>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>View Clients · Send Reminders · Send Messages · View Docs · View CPA Hours</div>
            </div>
            {err && <div className="alert alert-risk" style={{ marginTop: 12 }}>{err}</div>}
            <button onClick={submit} disabled={busy || !form.email || !form.first_name}
              className="btn btn-primary w-full"
              style={{ marginTop: 20 }}
              data-testid="add-cpa-submit"
            >{busy ? "Adding…" : "Add CPA"}</button>
            <button onClick={onClose} className="btn btn-secondary w-full" style={{ marginTop: 8 }}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

function EditProfileModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({ name: user.name || "", phone: user.phone || "", is_active: !!user.is_active });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      await api.patch(`/users/${user.id}`, { name: form.name, phone: form.phone || null, is_active: form.is_active });
      await onSaved();
      onClose();
    } catch (e) { setErr(fmtError(e)); }
    setBusy(false);
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} data-testid="edit-profile-modal">
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 420, padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Edit profile</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="stack-md">
          <div className="field"><label className="field-label">NAME</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="edit-name" /></div>
          <div className="field"><label className="field-label">EMAIL</label>
            <input className="input" value={user.email} disabled /></div>
          <div className="field"><label className="field-label">PHONE</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="edit-phone" /></div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", padding: "10px 0" }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} data-testid="edit-active" />
            <span>Account active</span>
          </label>
          {err && <div className="alert alert-risk">{err}</div>}
          <button onClick={submit} disabled={busy} style={{ width: "100%", padding: "12px", borderRadius: 8, background: "#1a1a1a", color: "#fff", fontWeight: 500, fontSize: 14 }} data-testid="edit-save">{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

function CpasTab({ engs }) {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/users");
      // Only show active experts (CPA + ADMIN). The /users endpoint already
      // filters out soft-deleted rows, but we double-guard here in case
      // clients cache an older payload.
      setUsers(
        data
          .filter((u) => (u.role === "CPA" || u.role === "ADMIN") && u.is_active !== false)
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      );
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  // Compute team capacity
  const cpaCount = users.filter((u) => u.role === "CPA").length;
  const totalClients = engs.length;
  const avgPerCpa = cpaCount > 0 ? (totalClients / cpaCount).toFixed(1) : "0";
  const pendingAssignment = engs.filter((e) => !e.assigned_cpa_id).length;

  // Clients per CPA / Admin
  const clientsForUser = (uid) => engs.filter((e) => e.assigned_cpa_id === uid).length;

  const roleBadge = (role) => {
    const map = {
      ADMIN: { bg: "#fce4ec", fg: "#c2185b", label: "Admin" },
      CPA: { bg: "#ede7f6", fg: "#5e35b1", label: "CPA" },
    };
    return map[role] || { bg: "#eceff1", fg: "#546e7a", label: role };
  };

  return (
    <div data-testid="admin-cpas-tab">
      {err && <div className="alert alert-risk">{err}</div>}

      {/* Team capacity — match Users-tab stat-card style for a unified look */}
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Team capacity</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }} data-testid="team-capacity">
        <div className="card" style={{ padding: 16 }} data-testid="cap-total-clients-card">
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Total clients</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }} data-testid="cap-total-clients">{totalClients}</div>
        </div>
        <div className="card" style={{ padding: 16 }} data-testid="cap-avg-per-cpa-card">
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Avg per CPA</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }} data-testid="cap-avg-per-cpa">{avgPerCpa}</div>
        </div>
        <div className="card" style={{ padding: 16 }} data-testid="cap-pending-card">
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Pending assignment</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }} data-testid="cap-pending">{pendingAssignment}</div>
        </div>
      </div>

      {/* Experts */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Experts</h2>
        <button
          onClick={() => setShowAdd(true)}
          className="btn btn-primary"
          data-testid="add-cpa-open"
        ><Plus size={14} /> Add CPA</button>
      </div>

      <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-default)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="experts-table">
          <thead>
            <tr style={{ background: "var(--bg-subtle)" }}>
              <th style={{ textAlign: "left", padding: "14px 24px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: 0.5 }}>NAME</th>
              <th style={{ textAlign: "left", padding: "14px 24px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: 0.5 }}>ROLE</th>
              <th style={{ textAlign: "left", padding: "14px 24px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: 0.5 }}>CLIENTS</th>
              <th style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const rb = roleBadge(u.role);
              return (
                <tr key={u.id} style={{ borderTop: "1px solid var(--border-default)" }} data-testid={`expert-row-${u.id}`}>
                  <td style={{ padding: "18px 24px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div className="avatar avatar-sm">{initials(u.name)}</div>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{u.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "18px 24px" }}>
                    <span style={{ background: rb.bg, color: rb.fg, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>{rb.label}</span>
                  </td>
                  <td style={{ padding: "18px 24px", fontSize: 14 }}>{clientsForUser(u.id)}</td>
                  <td style={{ padding: "18px 24px", textAlign: "right" }}>
                    <button onClick={() => setEditing(u)} style={{ color: "#1e88e5", fontSize: 13, fontWeight: 500 }} data-testid={`edit-profile-${u.id}`}>Edit profile</button>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && <tr><td colSpan={4} className="muted" style={{ padding: 32, textAlign: "center" }}>No experts yet</td></tr>}
          </tbody>
        </table>
      </div>

      {showAdd && <AddCpaModal onClose={() => setShowAdd(false)} onDone={load} />}
      {editing && <EditProfileModal user={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [engs, setEngs] = useState([]);
  const [progressMap, setProgressMap] = useState({});
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("clients");
  const [view, setView] = useState(() => localStorage.getItem("ct_admin_dash_view") || "kanban");
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/engagements");
      setEngs(data);
      // ONBOARDING drafts carry a pre-filing checklist whose completion drives
      // the card's progress bar + "Ready" state. Fetch progress for each.
      const onboarding = data.filter((e) => e.status === "ONBOARDING");
      const map = {};
      await Promise.all(onboarding.map(async (e) => {
        try { const { data: p } = await api.get(`/engagements/${e.id}/onboarding-progress`); map[e.id] = p; }
        catch (x) { console.debug("[AdminDashboard] onboarding-progress for", e.id, "failed:", x?.response?.status); }
      }));
      setProgressMap(map);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  const openOnboarding = (eid) => navigate(`/admin/onboarding/${eid}`);
  const moveToCloudtax = async (eng) => {
    try { await api.post(`/engagements/${eng.id}/submit`); await load(); }
    catch (x) { setErr(fmtError(x)); }
  };

  const setViewPersist = (v) => {
    setView(v);
    try { localStorage.setItem("ct_admin_dash_view", v); } catch { /* ignore */ }
  };

  const adminTabs = [
    { key: "clients", label: "Clients" },
    { key: "cpas", label: "CPA's" },
    { key: "users", label: "Users" },
  ];

  return (
    <div className="app-root">
      <AppHeader />
      <div className="page-wide stack-lg" style={{ paddingTop: 12 }}>
        <div data-testid="admin-tabs" style={{ display: "flex", gap: 28, borderBottom: "1px solid var(--border-default)", marginBottom: 32 }}>
          {adminTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              data-testid={`admin-${t.key}-tab`}
              style={{
                padding: "12px 4px",
                fontSize: 14,
                fontWeight: tab === t.key ? 600 : 500,
                color: tab === t.key ? "var(--text-primary)" : "var(--text-secondary)",
                borderBottom: tab === t.key ? "2px solid #1565c0" : "2px solid transparent",
                marginBottom: -1,
              }}
            >{t.label}</button>
          ))}
        </div>

        {err && <div className="alert alert-risk">{err}</div>}

        {tab === "clients" && (
          <>
            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}
              data-testid="admin-clients-toolbar"
            >
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>Clients pipeline</h2>
              <div className="flex items-center gap-3">
                <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)} data-testid="add-client-open">
                  <Plus size={14} /> Add Client
                </button>
                <ViewToggle value={view} onChange={setViewPersist} testid="admin-view-toggle" />
              </div>
            </div>
            {view === "kanban" ? (
              <div className="kanban" style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(220px, 1fr))` }} data-testid="admin-kanban">
                {COLUMNS.map((col) => {
                  const items = engs.filter((e) => e.status === col.key);
                  const isOnboarding = col.key === "ONBOARDING";
                  return (
                    <div className="kanban-col" key={col.key} data-testid={`admin-kanban-col-${col.key}`}>
                      <div className="kanban-col-header">
                        <div>
                          <div className="kanban-col-title">{col.label}</div>
                          <div className="kanban-col-count">{items.length}</div>
                        </div>
                      </div>
                      <div className="stack-sm">
                        {isOnboarding
                          ? items.map((e) => <OnboardingCard key={e.id} eng={e} progress={progressMap[e.id]} onMove={moveToCloudtax} onOpen={() => openOnboarding(e.id)} />)
                          : items.map((e) => <AdminCard key={e.id} eng={e} onClick={() => navigate(`/admin/client/${e.id}`)} />)
                        }
                        {isOnboarding && (
                          <button className="btn btn-secondary w-full" style={{ marginTop: 4 }}
                                  onClick={() => setShowAdd(true)} data-testid="add-client-bottom">
                            <Plus size={12} /> Add client
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EngagementTable
                engagements={engs}
                onRowClick={(e) => (e.status === "ONBOARDING" ? openOnboarding(e.id) : navigate(`/admin/client/${e.id}`))}
                role="ADMIN"
                testid="admin-engagement-table"
                stageOptions={[
                  { key: "all", label: "All stages" },
                  { key: "ONBOARDING", label: "Onboarding" },
                  { key: "REFERRED", label: "Referred" },
                  { key: "INTAKE", label: "Intake" },
                  { key: "IN_PREP", label: "In Prep" },
                  { key: "IN_REVIEW", label: "In Review" },
                  { key: "DELIVERY", label: "Delivery" },
                  { key: "FILED", label: "Filed" },
                ]}
              />
            )}
          </>
        )}

        {tab === "cpas" && <CpasTab engs={engs} />}

        {tab === "users" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700 }}>Users</h2>
                <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>All users across CloudTax — search, filter, and manage lifecycle.</p>
              </div>
            </div>
            <UsersTable navigate={navigate} />
          </>
        )}
      </div>
      {showAdd && (
        <AddClientModal
          onClose={() => setShowAdd(false)}
          onCreated={(newEid) => { load(); if (newEid) navigate(`/admin/onboarding/${newEid}`); }}
        />
      )}
    </div>
  );
}
