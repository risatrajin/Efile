import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtError } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge, StatusBadge } from "../components/shared/Badges";

export default function CpaFiles() {
  const [engs, setEngs] = useState([]);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get("/engagements");
      setEngs(data);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="app-root">
      <AppHeader />
      <div className="page-wide stack-lg">
        <div>
          <h1 className="page-title">Your files</h1>
          <p className="muted" style={{ fontSize: 13 }}>All engagements assigned to you</p>
        </div>
        {err && <div className="alert alert-risk">{err}</div>}
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
              {engs.map((e) => (
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
              {engs.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 40 }}>No engagements assigned yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
