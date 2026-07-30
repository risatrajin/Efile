import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Plus } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api, fmtError } from "../lib/api";

const PROVINCES = ["ON", "BC", "AB", "QC", "MB", "SK", "NS", "NB", "NL", "PE", "YT", "NT", "NU"];

// Data-driven plan cards — Review and File may become an add-on (pending
// business confirmation), so the card list must stay data, not layout.
// Keys mirror backend config.PLAN_META; service_model derives server-side.
export const PLANS = [
  {
    key: "NIL",
    label: "T2 Nil",
    price: "Pay What You Want, including $0",
    desc: "Best for eligible corporations with no activity or simple startup costs.",
    bullets: [
      "Guided filing in plain language",
      "Built-in checks before you submit",
      "File online using your CRA Web Access Code",
    ],
  },
  {
    key: "BASIC_DIY",
    label: "T2 Basic DIY",
    price: "$199 per year-end",
    desc: "For owner-managed corporations that want control, with guardrails.",
    bullets: [
      "Guided filing workflow",
      "Built-in validation checks",
      "Downloadable T2 PDF package",
    ],
  },
  {
    key: "REVIEW_FILE",
    label: "Review and File",
    price: "$499 per year-end",
    desc: "You prepare the return. We review it before you submit.",
    bullets: [
      "Expert review of your completed T2",
      "Corrections and feedback included",
      "File online using WAC or EFILE",
    ],
  },
  {
    key: "DFY",
    label: "Done For You",
    price: "From $749 per year-end",
    desc: "We prepare and file the return end-to-end.",
    bullets: [
      "T2 preparation and filing",
      "Intake and sanity checks",
      "Bounded CRA follow-up support",
    ],
  },
];

export const PLAN_LABELS = Object.fromEntries(PLANS.map((p) => [p.key, p.label]));

// Client-facing status labels ONLY — internal pipeline names never reach the
// dashboard. Tier is already stripped server-side (redact_for_client).
const CLIENT_BADGES = {
  ONBOARDING: { label: "Being set up", bg: "#fff3e0", fg: "#6b3f10" },
  REFERRED: { label: "In progress", bg: "#e8f5e9", fg: "#1b5e20" },
  INTAKE: { label: "In progress", bg: "#e8f5e9", fg: "#1b5e20" },
  IN_PREP: { label: "In progress", bg: "#e8f5e9", fg: "#1b5e20" },
  IN_REVIEW: { label: "In progress", bg: "#e8f5e9", fg: "#1b5e20" },
  DELIVERY: { label: "In progress", bg: "#e8f5e9", fg: "#1b5e20" },
  FILED: { label: "Filed", bg: "#e3f2fd", fg: "#1565c0" },
};

const TITLES = new Set(["dr", "dr.", "mr", "mr.", "ms", "ms.", "mrs", "mrs."]);

function firstName(user) {
  const tokens = (user?.name || "").trim().split(/\s+/).filter(Boolean);
  const first = tokens[0] || "";
  if (TITLES.has(first.toLowerCase())) return tokens[1] || "";
  return first;
}

function taxYear(corp) {
  const fye = corp?.fiscal_year_end;
  if (!fye) return null;
  const d = new Date(fye);
  return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
}

function ProfileRow({ eng, onOpen }) {
  const corp = eng.corporation || {};
  const badge = CLIENT_BADGES[eng.status] || CLIENT_BADGES.REFERRED;
  const year = taxYear(corp);
  // "#bn · year · plan label" — legacy engagements have no plan, so the line
  // renders exactly as before (no trailing dot).
  const subBits = [
    corp.business_number ? `#${corp.business_number}` : null,
    year ? String(year) : null,
    eng.plan ? PLAN_LABELS[eng.plan] : null,
  ].filter(Boolean);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      data-testid={`profile-row-${eng.id}`}
      className="flex items-center"
      style={{ gap: 14, padding: "14px 16px", cursor: "pointer", borderTop: "1px solid var(--border-subtle)" }}
    >
      <div
        aria-hidden
        style={{
          width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
          background: "var(--bg-subtle)", border: "1px solid var(--border-default)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 600, fontSize: 15,
        }}
      >
        {(corp.name || "?").charAt(0).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {corp.name || "Corporation"}
        </div>
        {subBits.length > 0 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{subBits.join(" · ")}</div>
        )}
      </div>
      <span style={{ background: badge.bg, color: badge.fg, fontSize: 12, fontWeight: 500, padding: "4px 10px", borderRadius: 999 }}>
        {badge.label}
      </span>
      <ChevronRight size={16} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
    </div>
  );
}

function PlanCard({ plan, selected, onSelect, nilDeclaration, setNilDeclaration, nilAmount, setNilAmount }) {
  const isNil = plan.key === "NIL";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      data-testid={`plan-card-${plan.key.toLowerCase()}`}
      style={{
        padding: "14px 16px",
        border: selected ? "2px solid var(--accent-dark)" : "1px solid var(--border-default)",
        borderRadius: 10,
        cursor: "pointer",
        background: selected ? "var(--bg-subtle)" : "transparent",
        transition: "background-color 150ms ease",
        userSelect: "none",
      }}
    >
      <div className="flex items-center" style={{ justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{plan.label}</div>
        <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>{plan.price}</div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>{plan.desc}</div>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
        {plan.bullets.map((b) => (
          <li key={b} className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>{b}</li>
        ))}
      </ul>
      {isNil && selected && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--border-subtle)", paddingTop: 10 }} onClick={(e) => e.stopPropagation()}>
          <label className="flex items-center" style={{ gap: 8, fontSize: 12, cursor: "pointer" }} data-testid="nil-declaration-label">
            <input
              type="checkbox"
              checked={nilDeclaration}
              onChange={(e) => setNilDeclaration(e.target.checked)}
              data-testid="nil-declaration"
              style={{ width: 15, height: 15, accentColor: "var(--accent-dark)", cursor: "pointer", flexShrink: 0 }}
            />
            <span>My corporation had no activity or only simple startup costs this year.</span>
          </label>
          <div className="field" style={{ marginTop: 10 }}>
            <label className="field-label">What would you like to pay? (CAD)</label>
            <input
              className="input"
              type="number"
              min={0}
              step={1}
              value={nilAmount}
              onChange={(e) => setNilAmount(e.target.value)}
              data-testid="nil-amount"
              style={{ maxWidth: 160 }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CreateProfileForm({ corporations, onDone, onCancel }) {
  const [corpChoice, setCorpChoice] = useState(corporations.length ? corporations[0].id : "NEW");
  const [corpName, setCorpName] = useState("");
  const [province, setProvince] = useState("ON");
  const [fye, setFye] = useState("");
  const [plan, setPlan] = useState(null);
  const [nilDeclaration, setNilDeclaration] = useState(false);
  const [nilAmount, setNilAmount] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isNew = corpChoice === "NEW";

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!plan) return setErr("Choose a plan.");
    if (plan === "NIL" && !nilDeclaration) return setErr("Please confirm the no-activity declaration for T2 Nil.");
    const amount = plan === "NIL" ? Math.max(0, Math.floor(Number(nilAmount) || 0)) : undefined;
    setBusy(true);
    try {
      // TODO(payment): checkout step slots in here after plan selection.
      const payload = {
        province,
        fiscal_year_end: fye,
        plan,
        ...(plan === "NIL" ? { nil_declaration: nilDeclaration, nil_amount: amount } : {}),
        ...(isNew ? { corp_name: corpName } : { corporation_id: corpChoice }),
      };
      const { data } = await api.post("/engagements/self-start", payload);
      await onDone(data.id);
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="stack-md" style={{ padding: "16px", borderTop: "1px solid var(--border-subtle)" }} data-testid="self-start-form">
      <div className="field">
        <label className="field-label">Corporation</label>
        <select className="select" value={corpChoice} onChange={(e) => setCorpChoice(e.target.value)} data-testid="self-start-corp-select">
          {corporations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="NEW">New corporation</option>
        </select>
      </div>
      {isNew && (
        <div className="field">
          <label className="field-label">Corporation name</label>
          <input className="input" value={corpName} onChange={(e) => setCorpName(e.target.value)} required placeholder="e.g. 1234567 Ontario Inc." data-testid="self-start-corp" />
        </div>
      )}
      <div className="field">
        <label className="field-label">Province</label>
        <select className="select" value={province} onChange={(e) => setProvince(e.target.value)} data-testid="self-start-province">
          {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="field-label">Fiscal year end</label>
        <input className="input" type="date" value={fye} onChange={(e) => setFye(e.target.value)} required data-testid="self-start-fye" />
      </div>
      <div className="field">
        <label className="field-label">Choose your plan</label>
        <div className="stack-md" style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 10 }}>
          {PLANS.map((p) => (
            <PlanCard
              key={p.key}
              plan={p}
              selected={plan === p.key}
              onSelect={() => setPlan(p.key)}
              nilDeclaration={nilDeclaration}
              setNilDeclaration={setNilDeclaration}
              nilAmount={nilAmount}
              setNilAmount={setNilAmount}
            />
          ))}
        </div>
      </div>
      {err && <div className="alert alert-risk" data-testid="self-start-error">{err}</div>}
      <div className="flex items-center" style={{ gap: 10 }}>
        <button className="btn btn-primary" disabled={busy} type="submit" data-testid="self-start-submit">
          {busy ? <span className="spinner" /> : "Start your filing"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel} data-testid="self-start-cancel">Cancel</button>
      </div>
    </form>
  );
}

export default function ClientDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [engs, setEngs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get("/engagements");
      setEngs(data || []);
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => { load(); }, []);

  // Distinct corporations across the caller's engagements, for the reuse dropdown.
  const corporations = [];
  const seen = new Set();
  for (const e of engs) {
    const c = e.corporation || {};
    if (c.id && !seen.has(c.id)) { seen.add(c.id); corporations.push(c); }
  }

  const name = firstName(user);

  if (!loaded) return (
    <div className="page-narrow stack-lg" style={{ paddingTop: 32 }} data-testid="dashboard-loading">
      <div style={{ height: 28, width: 220, background: "var(--bg-subtle)", borderRadius: 6, marginBottom: 8 }} />
      <div className="card" style={{ marginTop: 4 }}>
        <div style={{ height: 14, width: "70%", background: "var(--bg-subtle)", borderRadius: 6, opacity: 0.6 }} />
      </div>
    </div>
  );

  return (
    <div className="page-narrow stack-lg" style={{ paddingTop: 32, maxWidth: 760 }} data-testid="client-dashboard">
      <div>
        <h1 className="page-title">{name ? `Hello, ${name}` : "Hello"}</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Welcome to your CloudTax dashboard. Manage your corporate tax returns here.
        </p>
      </div>
      {engs.length === 0 && (
        <p className="muted" style={{ fontSize: 13 }}>Start your first corporate tax filing.</p>
      )}
      <div>
        <div className="tertiary" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
          Tax profiles
        </div>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {engs.map((e) => (
            <ProfileRow key={e.id} eng={e} onOpen={() => navigate(`/portal/filing/${e.id}`)} />
          ))}
          {creating ? (
            <CreateProfileForm
              corporations={corporations}
              onCancel={() => setCreating(false)}
              onDone={async (eid) => {
                await load();
                setCreating(false);
                navigate(`/portal/filing/${eid}`);
              }}
            />
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => setCreating(true)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCreating(true); } }}
              className="flex items-center"
              style={{ gap: 14, padding: "14px 16px", cursor: "pointer", borderTop: engs.length ? "1px solid var(--border-subtle)" : "none" }}
              data-testid="create-profile-row"
            >
              <div
                aria-hidden
                style={{
                  width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                  border: "1px dashed var(--border-default)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <Plus size={18} style={{ color: "var(--text-secondary)" }} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Create a business profile</div>
            </div>
          )}
        </div>
        {/* Promo slot — future banner (e.g. partner offer) renders here, under the list. */}
      </div>
      {err && <div className="alert alert-risk" data-testid="dashboard-error">{err}</div>}
    </div>
  );
}
