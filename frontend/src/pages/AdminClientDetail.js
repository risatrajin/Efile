import React, { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api, fmtError, fmtDate, initials } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge, StatusBadge } from "../components/shared/Badges";
import { ArrowLeft, ArrowRight, MessageSquare, CalendarDays, Video } from "lucide-react";

export default function AdminClientDetail() {
  const navigate = useNavigate();
  const { eid } = useParams();
  const [eng, setEng] = useState(null);
  const [cpas, setCpas] = useState([]);
  const [selectedCpa, setSelectedCpa] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [a, b] = await Promise.all([
        api.get(`/engagements/${eid}`),
        api.get("/users"),
      ]);
      setEng(a.data);
      setCpas(b.data.filter((u) => u.role === "CPA" && u.is_active));
      setSelectedCpa(a.data.assigned_cpa_id || "");
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eid]);

  const assignAndMove = async () => {
    setBusy(true); setErr("");
    try {
      if (selectedCpa && selectedCpa !== eng.assigned_cpa_id) {
        await api.patch(`/engagements/${eid}`, { assigned_cpa_id: selectedCpa });
      }
      if (eng.status === "REFERRED") {
        await api.patch(`/engagements/${eid}`, { status: "INTAKE" });
      }
      navigate("/admin/dashboard");
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const justAssign = async () => {
    setBusy(true); setErr("");
    try {
      await api.patch(`/engagements/${eid}`, { assigned_cpa_id: selectedCpa });
      await load();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const saveNote = async () => {
    if (!note.trim()) return;
    setBusy(true); setErr("");
    try {
      const next = (eng.notes ? eng.notes + "\n\n" : "") + `[${new Date().toLocaleString("en-CA")}] ${note.trim()}`;
      await api.patch(`/engagements/${eid}`, { notes: next });
      setNote("");
      await load();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const tabs = [
    { key: "dashboard", to: "/admin/dashboard", label: "Dashboard" },
    { key: "users", to: "/admin/users", label: "Users" },
  ];

  if (!eng) return <div className="app-root"><AppHeader tabs={tabs} /><div className="page-wide">Loading…</div></div>;
  const corp = eng.corporation || {};
  const client = eng.client || {};
  const noteLines = eng.notes ? eng.notes.split(/\n\n+/) : [];
  const ready = !!selectedCpa;
  const meetingDate = new Date(Date.now() + 2 * 86400000);

  return (
    <div className="app-root">
      <AppHeader tabs={tabs} />
      <div className="page-wide stack-lg" data-testid="admin-client-detail">
        <Link to="/admin/dashboard" className="btn-link" style={{ width: "fit-content" }}><ArrowLeft size={12} /> Back to Dashboard</Link>
        {err && <div className="alert alert-risk">{err}</div>}

        <div className="flex between items-start" style={{ flexWrap: "wrap", gap: 16 }}>
          <div className="flex items-start gap-4">
            <div className="avatar" style={{ width: 56, height: 56, fontSize: 16 }}>{initials(client.name || "")}</div>
            <div>
              <h1 className="page-title">{client.name}</h1>
              <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>{corp.name}</p>
              <div className="flex items-center gap-2 mt-3">
                <TierBadge tier={eng.tier} />
                <StatusBadge status={eng.status} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary"><MessageSquare size={12} /> Message client</button>
            <button
              className="btn btn-primary"
              style={{ background: ready ? "#1565c0" : "#9bc4ea", cursor: ready ? "pointer" : "not-allowed" }}
              disabled={!ready || busy}
              onClick={assignAndMove}
              data-testid="move-to-intake"
            >
              {eng.status === "REFERRED" ? "Move to Intake" : "Update assignment"} <ArrowRight size={12} />
            </button>
          </div>
        </div>

        <div className="two-col">
          <div className="stack-lg">
            <div className="card" data-testid="client-info-card">
              <h2 className="card-title">Client information</h2>
              <div className="grid-2 mt-3" style={{ rowGap: 18 }}>
                <div className="field"><label className="field-label">Email</label><div style={{ fontSize: 13, fontWeight: 500 }}>{client.email}</div></div>
                <div className="field"><label className="field-label">Phone</label><div style={{ fontSize: 13, fontWeight: 500 }}>{client.phone || "—"}</div></div>
                <div className="field"><label className="field-label">Corporation</label><div style={{ fontSize: 13, fontWeight: 500 }}>{corp.name}</div></div>
                <div className="field"><label className="field-label">Business number</label><div style={{ fontSize: 13, fontWeight: 500 }}>{corp.business_number || "—"}</div></div>
                <div className="field"><label className="field-label">Fiscal year end</label><div style={{ fontSize: 13, fontWeight: 500 }}>{fmtDate(corp.fiscal_year_end)}</div></div>
                <div className="field"><label className="field-label">Address</label><div style={{ fontSize: 13, fontWeight: 500 }}>{corp.address || "—"}</div></div>
              </div>
            </div>

            <div className="card" data-testid="tax-situation-card">
              <h2 className="card-title">Tax situation</h2>
              <div className="mt-3">
                {noteLines.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No notes yet. Add background or context for the assigned CPA below.</div>}
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  {noteLines.map((l, i) => <li key={i} style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 6 }}>{l}</li>)}
                </ul>
              </div>
              <div className="mt-4">
                <textarea className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the CPA..." data-testid="add-note-text" />
                <button className="btn btn-secondary btn-sm mt-2" onClick={saveNote} disabled={busy || !note.trim()} data-testid="add-note-save">Add note</button>
              </div>
            </div>
          </div>

          <div className="stack-lg">
            <div className="card" data-testid="meeting-card" style={{ background: "#e3f2fd", borderColor: "#bbdefb" }}>
              <div className="flex items-center gap-2"><CalendarDays size={14} style={{ color: "#1565c0" }} /><h2 className="card-title" style={{ margin: 0 }}>Scheduled meeting</h2></div>
              <div style={{ fontSize: 13, marginTop: 10, fontWeight: 500 }}>Initial Tax Consultation</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Google Meet</div>
              <div style={{ fontSize: 13, marginTop: 10 }}>{meetingDate.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}</div>
              <div className="muted" style={{ fontSize: 12 }}>2:00 PM EST</div>
              <button className="btn btn-primary btn-sm mt-4" style={{ background: "#1565c0", width: "100%", justifyContent: "center" }}><Video size={12} /> Join meeting</button>
            </div>

            <div className="card" data-testid="assign-cpa-card">
              <h2 className="card-title">Assign CPA</h2>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Select a CPA to take over from intake.</div>
              <div className="field mt-3">
                <label className="field-label">CPA</label>
                <select className="select" value={selectedCpa} onChange={(e) => setSelectedCpa(e.target.value)} data-testid="cpa-select">
                  <option value="">— Select a CPA —</option>
                  {cpas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 mt-3">
                {eng.status === "REFERRED" ? (
                  <button className="btn btn-primary btn-sm w-full" style={{ background: ready ? "#1565c0" : "#9bc4ea", justifyContent: "center" }} disabled={!ready || busy} onClick={assignAndMove} data-testid="assign-and-move">
                    Assign & Move to Intake
                  </button>
                ) : (
                  <button className="btn btn-secondary btn-sm w-full" style={{ justifyContent: "center" }} disabled={!ready || busy || selectedCpa === eng.assigned_cpa_id} onClick={justAssign}>
                    Reassign CPA
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
