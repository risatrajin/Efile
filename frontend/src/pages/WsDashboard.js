import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtError, fmtDate } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge } from "../components/shared/Badges";
import EngagementTable, { ViewToggle } from "../components/shared/EngagementTable";
import { Plus, Lock, ArrowRight, X } from "lucide-react";

const COLUMNS = [
  { key: "ONBOARDING", label: "Onboarding", icon: "add" },
  { key: "REFERRED", label: "Referred", icon: "lock" },
  { key: "INTAKE", label: "Intake", icon: "lock" },
  { key: "IN_PREP", label: "In Prep", icon: "lock" },
  { key: "IN_REVIEW", label: "Review", icon: "lock" },
  { key: "FILED", label: "Filed", icon: "lock" },
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

function AddClientModal({ onClose, onCreated, existing = null }) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [eid, setEid] = useState(existing?.id || null);
  const [inviteLink, setInviteLink] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [form, setForm] = useState(() => {
    const c = existing?.client || {};
    const corp = existing?.corporation || {};
    const [, first, last] = (c.name || "").match(/Dr\.?\s+(\w+)\s*(.*)/) || [null, "", ""];
    return {
      first_name: first || "", last_name: last || "",
      client_email: c.email || "",
      phone: c.phone || "",
      province: corp.province || "ON",
      corp_name: corp.name || "",
      fiscal_year_end: corp.fiscal_year_end ? new Date(corp.fiscal_year_end).toISOString().slice(0, 10) : "2025-12-31",
      tier: existing?.tier || "STANDARD",
      notes: existing?.partner_notes || existing?.notes || "",
    };
  });

  const step1Valid = form.first_name && form.last_name && form.client_email && form.corp_name;

  const goNext = async () => {
    setBusy(true); setErr("");
    try {
      if (!eid) {
        const { data } = await api.post("/engagements/onboarding", {
          first_name: form.first_name, last_name: form.last_name,
          client_email: form.client_email, phone: form.phone, province: form.province,
        });
        setEid(data.id);
        if (data.invite_link) setInviteLink(data.invite_link);
      } else {
        await api.patch(`/engagements/${eid}/onboarding`, {
          first_name: form.first_name, last_name: form.last_name,
          client_email: form.client_email, phone: form.phone, province: form.province,
        });
      }
      setStep(2);
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const save = async (markReady) => {
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }} data-testid="add-client-modal">
        <div className="flex items-start between">
          <div>
            <h2 className="section-title" style={{ fontSize: 24 }}>Add new client</h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Step {step} of 2</div>
            <StepDots step={step} />
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 999, background: "var(--bg-subtle)", display: "inline-flex", alignItems: "center", justifyContent: "center" }} data-testid="modal-close"><X size={14} /></button>
        </div>
        <div className="stack-md mt-6">
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
                <input className="input" value={form.corp_name} onChange={(e) => setForm({ ...form, corp_name: e.target.value })} placeholder="Dr Sam Smith Medicine Professional Corporation" data-testid="ac-corp" required /></div>
              <div className="field"><label className="field-label">Province</label>
                <select className="select" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} data-testid="ac-province">
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select></div>
              {err && <div className="alert alert-risk">{err}</div>}
              <div className="flex gap-2 mt-2" style={{ justifyContent: "space-between" }}>
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
                      <button key={t.v} type="button" onClick={() => setForm({ ...form, tier: t.v })} data-testid={`ac-tier-${t.v}`}
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
              <div className="flex gap-2 mt-2" style={{ justifyContent: "space-between" }}>
                <button className="btn btn-secondary" onClick={() => setStep(1)} data-testid="ac-back">← Back</button>
                <div className="flex gap-2">
                  <button className="btn btn-secondary" disabled={busy} onClick={() => save(false)} data-testid="ac-draft">Save as draft</button>
                  <button className="btn btn-primary" disabled={busy} onClick={() => save(true)} data-testid="ac-save-ready">Save & mark ready</button>
                </div>
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

function ReadOnlyCard({ eng, onOpen }) {
  const corp = eng.corporation || {};
  const client = eng.client || {};
  return (
    <div className="kanban-card" onClick={onOpen} data-testid={`pipeline-card-${eng.id}`} style={{ position: "relative", cursor: "pointer" }}>
      <Lock size={11} style={{ position: "absolute", top: 12, right: 12, color: "var(--text-tertiary)" }} />
      <div style={{ fontWeight: 600, fontSize: 13, paddingRight: 16 }}>{withDrPrefix(client.name)}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{corp.name}</div>
      {eng.tier && <div style={{ marginTop: 8 }}><TierBadge tier={eng.tier} /></div>}
      {eng.status === "REFERRED" && (
        <div className="mt-2 flex items-center gap-1" style={{ fontSize: 11 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f57f17" }} />
          <span className="muted">CloudTax reviewing</span>
        </div>
      )}
      {eng.status === "REFERRED" && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>CPA assignment in progress</div>}
      {eng.status !== "REFERRED" && eng.status !== "FILED" && eng.assigned_cpa && (
        <>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Day {eng.days_elapsed || 0}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>CPA: {eng.assigned_cpa.name}</div>
        </>
      )}
      {eng.status === "FILED" && (
        <>
          {eng.filing_confirmation && <div style={{ marginTop: 8 }}><span style={{ background: "#fff3e0", color: "#ef6c00", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500 }}>{eng.filing_confirmation}</span></div>}
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Filed {fmtDate(eng.filing_date)}</div>
        </>
      )}
      <div style={{ marginTop: 10 }}>
        {(() => {
          const map = {
            REFERRED: { bg: "#e3f2fd", fg: "#1565c0", label: "Referred" },
            INTAKE: { bg: "#e3f2fd", fg: "#1565c0", label: "Intake" },
            IN_PREP: { bg: "#fff3e0", fg: "#ef6c00", label: "In Prep" },
            IN_REVIEW: { bg: "#fffde7", fg: "#f57f17", label: "Review" },
            FILED: { bg: "#e8f5e9", fg: "#2e7d32", label: "Filed" },
          };
          const s = map[eng.status] || { bg: "var(--bg-subtle)", fg: "var(--text-secondary)", label: eng.status };
          return <span style={{ background: s.bg, color: s.fg, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500 }}>{s.label}</span>;
        })()}
      </div>
    </div>
  );
}

export default function WsDashboard() {
  const navigate = useNavigate();
  const [engs, setEngs] = useState([]);
  const [progressMap, setProgressMap] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [editingEng, setEditingEng] = useState(null);
  const [err, setErr] = useState("");
  const [view, setView] = useState(() => localStorage.getItem("ct_ws_dash_view") || "kanban");

  const load = async () => {
    try {
      const { data } = await api.get("/engagements");
      setEngs(data);
      const onboarding = data.filter((e) => e.status === "ONBOARDING");
      const map = {};
      await Promise.all(onboarding.map(async (e) => {
        try { const { data: p } = await api.get(`/engagements/${e.id}/onboarding-progress`); map[e.id] = p; } catch { /* ignore */ }
      }));
      setProgressMap(map);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  const setViewPersist = (v) => {
    setView(v);
    try { localStorage.setItem("ct_ws_dash_view", v); } catch { /* ignore */ }
  };

  const moveToCloudtax = async (eng) => {
    try { await api.post(`/engagements/${eng.id}/submit`); await load(); }
    catch (x) { setErr(fmtError(x)); }
  };

  const openOnboarding = (eid) => navigate(`/ws/onboarding/${eid}`);
  const openFile = (eid) => navigate(`/ws/file/${eid}`);

  const tabs = [{ key: "dashboard", to: "/ws/dashboard", label: "Dashboard" }];

  return (
    <div className="app-root">
      <AppHeader tabs={tabs} />
      <div className="page-wide stack-lg">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 className="page-title">Client pipeline</h1>
            <p className="muted" style={{ fontSize: 13 }}>Onboard clients and track their progress through the filing process</p>
          </div>
          <ViewToggle value={view} onChange={setViewPersist} testid="ws-view-toggle" />
        </div>
        {err && <div className="alert alert-risk">{err}</div>}
        {view === "kanban" ? (
          <div className="kanban" style={{ gridTemplateColumns: "repeat(6, minmax(220px, 1fr))" }} data-testid="ws-kanban">
            {COLUMNS.map((col) => {
              const items = engs.filter((e) => e.status === col.key);
              const isOnboarding = col.key === "ONBOARDING";
              return (
                <div className="kanban-col" key={col.key} data-testid={`kanban-col-${col.key}`}>
                  <div className="kanban-col-header">
                    <div>
                      <div className="kanban-col-title">{col.label}</div>
                      <div className="kanban-col-count">{items.length}</div>
                    </div>
                    {isOnboarding ? (
                      <button onClick={() => { setEditingEng(null); setShowAdd(true); }} data-testid="add-client-circle"
                              style={{ width: 28, height: 28, borderRadius: "50%", background: "#1565c0", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        <Plus size={14} />
                      </button>
                    ) : (
                      <Lock size={11} style={{ color: "var(--text-tertiary)" }} />
                    )}
                  </div>
                  <div className="stack-sm">
                    {isOnboarding
                      ? items.map((e) => <OnboardingCard key={e.id} eng={e} progress={progressMap[e.id]} onMove={moveToCloudtax} onOpen={() => openOnboarding(e.id)} />)
                      : items.map((e) => <ReadOnlyCard key={e.id} eng={e} onOpen={() => openFile(e.id)} />)
                    }
                    {items.length === 0 && <div className="tertiary" style={{ fontSize: 11, padding: 12 }}>No clients</div>}
                  </div>
                  {isOnboarding && (
                    <button className="btn btn-primary w-full mt-3"
                            onClick={() => { setEditingEng(null); setShowAdd(true); }} data-testid="add-client-bottom">
                      <Plus size={12} /> Add client
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -8 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { setEditingEng(null); setShowAdd(true); }}
                data-testid="add-client-table"
              >
                <Plus size={12} /> Add client
              </button>
            </div>
            <EngagementTable
              engagements={engs}
              role="WS_PARTNER"
              onRowClick={(e) => (e.status === "ONBOARDING" ? openOnboarding(e.id) : openFile(e.id))}
              testid="ws-engagement-table"
              stageOptions={[
                { key: "all", label: "All stages" },
                { key: "ONBOARDING", label: "Onboarding" },
                { key: "INTAKE", label: "Intake" },
                { key: "IN_PREP", label: "In Prep" },
                { key: "IN_REVIEW", label: "In Review" },
                { key: "DELIVERY", label: "Delivery" },
                { key: "FILED", label: "Filed" },
              ]}
            />
          </>
        )}
      </div>
      {showAdd && <AddClientModal existing={editingEng} onClose={() => { setShowAdd(false); setEditingEng(null); }} onCreated={(newEid) => { load(); if (newEid) navigate(`/ws/onboarding/${newEid}`); }} />}
    </div>
  );
}
