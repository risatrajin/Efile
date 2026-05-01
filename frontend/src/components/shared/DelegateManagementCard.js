import React, { useEffect, useState, useMemo } from "react";
import { Users, Plus, Trash2, ShieldCheck, Mail, Clock } from "lucide-react";
import { api, fmtError } from "../../lib/api";

const RELATIONSHIP_OPTIONS = [
  { value: "assistant", label: "Assistant" },
  { value: "bookkeeper", label: "Bookkeeper" },
  { value: "spouse", label: "Spouse" },
  { value: "accountant", label: "Accountant" },
  { value: "other", label: "Other" },
];

const STATUS_BADGE = {
  INVITED: { bg: "#fff3e0", color: "#ef6c00", label: "Invited" },
  ACTIVE: { bg: "#e8f5e9", color: "#2e7d32", label: "Active" },
  REVOKED: { bg: "#fafafa", color: "#9e9e9e", label: "Revoked" },
};

/**
 * Lets the primary client invite up to two delegates per engagement and
 * revoke active ones. Hidden for delegates themselves (who do not see this
 * card on their account page).
 */
export default function DelegateManagementCard({ engagementId, primaryClientName }) {
  const [delegates, setDelegates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", relationship: "bookkeeper" });
  const [inviteResult, setInviteResult] = useState(null);

  const load = async () => {
    if (!engagementId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/engagements/${engagementId}/delegates`);
      setDelegates(data.delegates || []);
    } catch (x) { setErr(fmtError(x)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [engagementId]);

  // INVITED + ACTIVE delegates count toward the cap; REVOKED do not.
  const activeCount = useMemo(
    () => delegates.filter((d) => d.status === "INVITED" || d.status === "ACTIVE").length,
    [delegates],
  );
  const atCap = activeCount >= 2;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const { data } = await api.post(`/engagements/${engagementId}/delegates`, form);
      setInviteResult(data);
      setForm({ email: "", name: "", relationship: "bookkeeper" });
      await load();
    } catch (x) { setErr(fmtError(x)); }
    finally { setBusy(false); }
  };

  const revoke = async (id) => {
    if (!window.confirm("Revoke this delegate's access? They will no longer be able to view this engagement.")) return;
    try {
      await api.delete(`/delegates/${id}`);
      await load();
    } catch (x) { setErr(fmtError(x)); }
  };

  return (
    <div className="card" data-testid="delegate-management-card">
      <div className="section-label" style={{ marginBottom: 16 }}>MANAGE ACCESS</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
        Invite up to <strong>two people</strong> (an assistant, bookkeeper, spouse, or accountant) to help with documents and messages on this engagement. They&rsquo;ll get their own login. The T183 still has to be signed by you personally.
      </div>

      {err && <div className="alert" style={{ marginBottom: 12 }}>{err}</div>}

      {loading ? (
        <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
      ) : delegates.length === 0 ? (
        <div className="muted" style={{ fontSize: 12, padding: "10px 0" }}>
          You haven&rsquo;t invited anyone yet.
        </div>
      ) : (
        <div className="stack-sm" data-testid="delegate-list">
          {delegates.map((d) => {
            const badge = STATUS_BADGE[d.status] || STATUS_BADGE.INVITED;
            return (
              <div
                key={d.id}
                className="list-row"
                style={{ background: "var(--bg-subtle)", padding: "12px 14px", borderRadius: 10, borderBottom: "none", marginBottom: 8 }}
                data-testid={`delegate-row-${d.id}`}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{d.name || d.email}</div>
                  <div className="tertiary" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Mail size={11} /> {d.email}
                    </span>
                    <span style={{
                      background: "rgba(0,0,0,0.05)", color: "var(--text-secondary)",
                      padding: "1px 8px", borderRadius: 999, fontSize: 10, fontWeight: 500, letterSpacing: 0.3,
                    }}>{(d.relationship || "").toUpperCase()}</span>
                  </div>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                  <span
                    data-testid={`delegate-status-${d.id}`}
                    style={{
                      background: badge.bg, color: badge.color,
                      padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500,
                    }}
                  >{badge.label}</span>
                  {d.status !== "REVOKED" && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => revoke(d.id)}
                      data-testid={`delegate-revoke-${d.id}`}
                      title="Revoke access"
                      aria-label="Revoke access"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!open ? (
        <button
          className="btn btn-secondary btn-sm mt-3"
          onClick={() => { setOpen(true); setInviteResult(null); }}
          disabled={atCap}
          title={atCap ? "Maximum delegates reached" : "Invite someone"}
          data-testid="delegate-invite-open"
        >
          <Plus size={12} /> {atCap ? "Maximum delegates reached" : "Invite someone"}
        </button>
      ) : (
        <form onSubmit={submit} className="mt-3" style={{ background: "var(--bg-subtle)", padding: 16, borderRadius: 10 }}>
          <div className="field">
            <label className="field-label">Full name</label>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              data-testid="delegate-form-name"
              placeholder="e.g. Sam Patel"
            />
          </div>
          <div className="field">
            <label className="field-label">Email</label>
            <input
              className="input"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              data-testid="delegate-form-email"
              placeholder="sam@example.com"
            />
          </div>
          <div className="field">
            <label className="field-label">Relationship</label>
            <select
              className="input"
              value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
              data-testid="delegate-form-relationship"
            >
              {RELATIONSHIP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={busy}
              data-testid="delegate-form-submit"
            >
              {busy ? <span className="spinner" /> : "Send invitation"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => { setOpen(false); setInviteResult(null); }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {inviteResult && (
        <div className="muted mt-2" style={{ fontSize: 11, color: "var(--status-complete-text)" }} data-testid="delegate-invite-success">
          <ShieldCheck size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
          Invitation sent.
          {inviteResult.invite_link ? " A set-up email is on its way. The link is also above if you'd like to share it directly." : " They've been added immediately because they already have a CloudTax account."}
        </div>
      )}
    </div>
  );
}
