import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api, fmtError, initials, fmtDate } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { Upload, Check, CircleDashed, AlertCircle, MessageSquare } from "lucide-react";

const PHASES = [
  { key: "profile", label: "Profile" },
  { key: "documents", label: "Documents" },
  { key: "preparation", label: "Preparation" },
  { key: "review", label: "Review" },
  { key: "filed", label: "Filed" },
];

function statusToPhase(status) {
  if (status === "REFERRED") return 1;
  if (status === "INTAKE") return 1;
  if (status === "IN_PREP") return 2;
  if (status === "IN_REVIEW" || status === "DELIVERY") return 3;
  if (status === "FILED") return 4;
  return 0;
}

function ProgressDots({ current }) {
  return (
    <div className="progress-bar" data-testid="progress-bar">
      {PHASES.map((p, i) => (
        <React.Fragment key={p.key}>
          <div className="progress-step">
            <div className={`progress-dot ${i < current ? "done" : i === current ? "active" : ""}`} />
            <div className="progress-label">{p.label}</div>
          </div>
          {i < PHASES.length - 1 && <div className={`progress-line ${i < current ? "done" : ""}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function DocRow({ doc, onUpload, busy }) {
  const statusIcon = {
    REVIEWED: <Check size={14} style={{ color: "#2e7d32" }} />,
    UPLOADED: <Check size={14} style={{ color: "#1565c0" }} />,
    EXTRACTED: <Check size={14} style={{ color: "#6a1b9a" }} />,
    ISSUE: <AlertCircle size={14} style={{ color: "#c62828" }} />,
    PENDING: <CircleDashed size={14} style={{ color: "#b5b0ab" }} />,
  }[doc.status] || <CircleDashed size={14} />;

  const label = {
    REVIEWED: "Reviewed",
    UPLOADED: "Received",
    EXTRACTED: "Received",
    ISSUE: "Issue",
    PENDING: "Needed",
  }[doc.status] || "Needed";

  return (
    <div className="list-row" data-testid={`doc-row-${doc.category}`}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
          {statusIcon} {doc.name}
          {doc.is_required && <span className="tertiary" style={{ fontSize: 11 }}>(required)</span>}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{doc.description}</div>
      </div>
      <div className="flex items-center gap-3">
        <span className="label-caption">{label}</span>
        {doc.status === "PENDING" || doc.status === "ISSUE" ? (
          <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }} data-testid={`upload-${doc.category}`}>
            <Upload size={12} /> Upload
            <input type="file" style={{ display: "none" }} disabled={busy}
              accept=".pdf,.jpg,.jpeg,.png,.xlsx,.csv"
              onChange={(e) => e.target.files?.[0] && onUpload(doc, e.target.files[0])} />
          </label>
        ) : (
          <span className="badge badge-complete">Received</span>
        )}
      </div>
    </div>
  );
}

export default function ClientPortal() {
  const { user } = useAuth();
  const [eng, setEng] = useState(null);
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");

  const loadAll = async () => {
    try {
      const { data: list } = await api.get("/engagements");
      const e = list[0];
      setEng(e);
      if (e) {
        const { data: d } = await api.get(`/engagements/${e.id}/documents`);
        setDocs(d);
      }
    } catch (x) { setErr(fmtError(x)); }
  };

  useEffect(() => { loadAll(); }, []);

  const onUpload = async (doc, file) => {
    setBusy(doc.id); setErr("");
    try {
      const { data } = await api.post(`/documents/${doc.id}/upload-url`, {
        content_type: file.type || "application/octet-stream",
        file_name: file.name,
      });
      // Upload directly to S3
      const putResp = await fetch(data.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream", "x-amz-server-side-encryption": "AES256" },
        body: file,
      });
      if (!putResp.ok) throw new Error(`S3 upload failed (${putResp.status})`);
      await api.post(`/documents/${doc.id}/complete-upload`, {
        object_key: data.object_key,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || "application/octet-stream",
      });
      await loadAll();
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(null);
    }
  };

  if (!eng) return (
    <div className="app-root">
      <AppHeader />
      <div className="page-narrow">
        <div className="card">
          <h2 className="section-title">No active engagement</h2>
          <p className="muted">We will reach out when your engagement begins.</p>
        </div>
      </div>
    </div>
  );

  const phase = statusToPhase(eng.status);
  const corp = eng.corporation || {};
  const cpa = eng.assigned_cpa;
  const pendingReq = docs.filter((d) => d.status === "PENDING" && d.is_required);

  return (
    <div className="app-root">
      <AppHeader />
      <div className="page-narrow stack-lg">
        <div className="animate-in">
          <div className="section-label" style={{ marginBottom: 8 }}>YOUR ENGAGEMENT</div>
          <h1 className="page-title">Your corporate tax filing</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {corp.name} · Fiscal year ending {fmtDate(corp.fiscal_year_end)}
          </p>
        </div>

        <div className="card animate-in-2">
          <ProgressDots current={phase} />
        </div>

        {cpa && (
          <div className="card animate-in-2" data-testid="cpa-card">
            <div className="flex items-center gap-3">
              <div className="avatar" style={{ width: 44, height: 44, fontSize: 14 }}>{initials(cpa.name)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--font-serif)", fontSize: 18 }}>{cpa.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>Your dedicated tax professional</div>
              </div>
              <button className="btn btn-secondary btn-sm"><MessageSquare size={12} /> Message</button>
            </div>
          </div>
        )}

        {pendingReq.length > 0 && (
          <div className="alert alert-attention animate-in-3" data-testid="alert-bar">
            <AlertCircle size={16} />
            <div>
              <strong>{pendingReq[0].name}</strong> is still needed to move forward
              {pendingReq.length > 1 && ` (${pendingReq.length - 1} more to go)`}.
            </div>
          </div>
        )}

        {err && <div className="alert alert-risk">{err}</div>}

        <div className="card animate-in-3">
          <h2 className="card-title">Your documents</h2>
          <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>Upload each item as you have it. PDFs, images, or spreadsheets up to 25 MB.</p>
          <div style={{ marginTop: 8 }}>
            {docs.map((d) => <DocRow key={d.id} doc={d} onUpload={onUpload} busy={busy === d.id} />)}
          </div>
        </div>

        <div className="card animate-in-3">
          <h2 className="card-title">CRA access</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {eng.cra_access_status === "ACCESS_VERIFIED" ? (
              <><Check size={12} style={{ color: "#2e7d32", verticalAlign: "-1px" }} /> CRA access confirmed for your corporation.</>
            ) : eng.cra_access_method === "efile" ? (
              "CloudTax has submitted an authorization request via EFILE. Please log into CRA My Business Account and confirm it under Profile, Authorized representatives, Confirm pending requests."
            ) : eng.cra_access_method === "my_business_account" ? (
              "Please log into CRA My Business Account and add CloudTax as an authorized representative under Profile, Authorized representatives, Add."
            ) : (
              "Your CPA will walk you through granting CRA access shortly."
            )}
          </p>
        </div>

        {eng.status === "FILED" && (
          <div className="card animate-in-3">
            <h2 className="card-title">Filing complete</h2>
            <p className="muted" style={{ fontSize: 12 }}>Confirmation #{eng.filing_confirmation || "—"} · Filed {fmtDate(eng.filing_date)}</p>
          </div>
        )}

        <div className="portal-footer">Powered by CloudTax, in partnership with Wealthsimple</div>
      </div>
    </div>
  );
}
