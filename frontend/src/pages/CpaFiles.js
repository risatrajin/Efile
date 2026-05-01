import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { api, fmtError, TIER_LABELS } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge, StatusBadge } from "../components/shared/Badges";

const STAGE_OPTIONS = [
  { key: "all", label: "All stages" },
  { key: "INTAKE", label: "Intake" },
  { key: "IN_PREP", label: "In Prep" },
  { key: "IN_REVIEW", label: "In Review" },
  { key: "DELIVERY", label: "Delivery" },
  { key: "FILED", label: "Filed" },
];
// Tier options sourced from the canonical TIER_LABELS map so the filter
// always matches what the backend / pipeline cards actually show.
const TIER_OPTIONS = [
  { key: "all", label: "All tiers" },
  ...Object.entries(TIER_LABELS).map(([key, label]) => ({ key, label })),
];

export default function CpaFiles() {
  const [engs, setEngs] = useState([]);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [tier, setTier] = useState("all");

  const load = async () => {
    try {
      const { data } = await api.get("/engagements");
      setEngs(data);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let out = engs;
    if (stage !== "all") out = out.filter((e) => e.status === stage);
    if (tier !== "all") out = out.filter((e) => e.tier === tier);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((e) => (
        (e.client?.name || "").toLowerCase().includes(q) ||
        (e.corporation?.name || "").toLowerCase().includes(q)
      ));
    }
    return out;
  }, [engs, query, stage, tier]);

  return (
    <div className="app-root">
      <AppHeader />
      <div className="page-wide stack-lg">
        <div>
          <h1 className="page-title">Your files</h1>
          <p className="muted" style={{ fontSize: 13 }}>All engagements assigned to you</p>
        </div>
        {err && <div className="alert alert-risk">{err}</div>}

        <div
          style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
          data-testid="cpa-files-toolbar"
        >
          <div style={{ position: "relative", flex: "1 1 280px", minWidth: 240, maxWidth: 420 }}>
            <Search size={12} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
            <input
              className="input"
              style={{ paddingLeft: 32, height: 36, fontSize: 12 }}
              placeholder="Search by client or corporation…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="cpa-files-search"
            />
          </div>
          <select
            className="select"
            value={stage} onChange={(e) => setStage(e.target.value)}
            style={{ height: 36, fontSize: 12, width: "auto", minWidth: 150 }}
            data-testid="cpa-files-stage-filter"
          >
            {STAGE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <select
            className="select"
            value={tier} onChange={(e) => setTier(e.target.value)}
            style={{ height: 36, fontSize: 12, width: "auto", minWidth: 130 }}
            data-testid="cpa-files-tier-filter"
          >
            {TIER_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <span className="tertiary" style={{ fontSize: 11, marginLeft: "auto" }}>
            {filtered.length} of {engs.length}
          </span>
        </div>

        <div className="card" style={{ padding: 8 }}>
          <table className="table" data-testid="cpa-files-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Corporation</th>
                <th>Tier</th>
                <th>Status</th>
                <th>Days</th>
                <th>Docs</th>
                <th>Hours</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} data-testid={`file-row-${e.id}`}>
                  <td>{e.client?.name || "—"}</td>
                  <td>{e.corporation?.name || "—"}</td>
                  <td><TierBadge tier={e.tier} /></td>
                  <td><StatusBadge status={e.status} /></td>
                  <td className="muted">{e.days_elapsed ?? "—"}</td>
                  <td className="muted">{e.docs_uploaded}/{e.docs_total}</td>
                  <td className="muted">{Number(e.cpa_hours || 0).toFixed(1)}h</td>
                  <td><Link to={`/cpa/engagement/${e.id}`} className="btn-link" data-testid={`open-${e.id}`}>Open</Link></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 40 }}>
                    {engs.length === 0 ? "No engagements assigned yet." : "No engagements match the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
