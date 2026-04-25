import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { api, fmtError, initials, fmtDate } from "../lib/api";
import { Upload, Check, CircleDashed, AlertCircle, MessageSquare, ChevronDown, RefreshCw } from "lucide-react";

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

function HiddenFileInput({ onPick, accept = ".pdf,.jpg,.jpeg,.png,.xlsx,.csv", testid }) {
  return (
    <input
      type="file"
      accept={accept}
      style={{ display: "none" }}
      onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
      data-testid={testid}
    />
  );
}

function DocChooseDropdown({ doc, onUploadPick, onDefer, busy }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} disabled={busy} data-testid={`choose-${doc.id}`}>
        {doc.deferred_at ? "Deferred" : "Choose option"} <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 10,
          background: "#1a1a1a", color: "#faf9f7", borderRadius: 8, padding: 4, minWidth: 160,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)"
        }}>
          <label style={{ display: "block", padding: "10px 14px", fontSize: 12, cursor: "pointer", borderRadius: 6 }}
                 onMouseEnter={(e) => e.currentTarget.style.background = "#2c2c2c"}
                 onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
            Upload now
            <HiddenFileInput onPick={(f) => { setOpen(false); onUploadPick(f); }} testid={`upload-input-${doc.id}`} />
          </label>
          <button onClick={() => { setOpen(false); onDefer(); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", fontSize: 12, color: "inherit", borderRadius: 6, cursor: "pointer" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#2c2c2c"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  data-testid={`defer-${doc.id}`}>
            I&apos;ll upload later
          </button>
        </div>
      )}
    </div>
  );
}

function DocRow({ doc, onUpload, busy, onDefer }) {
  const isDone = ["UPLOADED", "REVIEWED", "EXTRACTED"].includes(doc.status);
  const isIssue = doc.status === "ISSUE";

  return (
    <div className="list-row" data-testid={`doc-row-${doc.category}-${doc.id}`}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
          {doc.name}
          {doc.is_new_request && <span className="badge badge-active" style={{ fontSize: 10 }}>New request</span>}
          {doc.is_required && !doc.is_new_request && <span className="tertiary" style={{ fontSize: 11, fontWeight: 400 }}>(required)</span>}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{doc.description}</div>
        {doc.is_new_request && doc.request_note && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6, fontStyle: "italic" }}>“{doc.request_note}”</div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {isDone && (
          <>
            <button className="btn-link" onClick={() => onUpload(doc, "view")} data-testid={`view-${doc.id}`}>View</button>
            <span className="badge badge-complete"><Check size={11} /> {doc.status === "REVIEWED" ? "Reviewed" : "Uploaded"}</span>
          </>
        )}
        {!isDone && !isIssue && (
          <DocChooseDropdown
            doc={doc}
            onUploadPick={(f) => onUpload(doc, "upload", f)}
            onDefer={() => onDefer(doc)}
            busy={busy}
          />
        )}
        {isIssue && (
          <label className="btn btn-primary btn-sm" style={{ background: "#c62828", cursor: "pointer" }} data-testid={`reupload-${doc.id}`}>
            Re-upload now
            <HiddenFileInput onPick={(f) => onUpload(doc, "upload", f)} />
          </label>
        )}
      </div>
    </div>
  );
}

function IssueAlert({ doc }) {
  return (
    <div className="alert alert-risk" style={{ alignItems: "flex-start" }} data-testid={`issue-alert-${doc.id}`}>
      <AlertCircle size={16} style={{ marginTop: 2 }} />
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{doc.name} — Issue found</div>
        <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>{doc.issue_note}</div>
      </div>
    </div>
  );
}

export default function ClientPortal() {
  const { user } = useAuth();
  const navigate = useNavigate();
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

  const onUpload = async (doc, kind, file) => {
    if (kind === "view") {
      try { const { data } = await api.get(`/documents/${doc.id}/download-url`); window.open(data.download_url, "_blank"); } catch (x) { setErr(fmtError(x)); }
      return;
    }
    if (!file) return;
    setBusy(doc.id); setErr("");
    try {
      const { data } = await api.post(`/documents/${doc.id}/upload-url`, {
        content_type: file.type || "application/octet-stream",
        file_name: file.name,
      });
      const putResp = await fetch(data.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream", "x-amz-server-side-encryption": "AES256" },
        body: file,
      });
      if (!putResp.ok) throw new Error(`Upload failed (${putResp.status})`);
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

  const onDefer = async (doc) => {
    try { await api.post(`/documents/${doc.id}/defer`); await loadAll(); } catch (x) { setErr(fmtError(x)); }
  };

  if (!eng) return (
    <div className="page-narrow">
      <div className="card">
        <h2 className="section-title">No active engagement</h2>
        <p className="muted">We will reach out when your engagement begins.</p>
      </div>
    </div>
  );

  const phase = statusToPhase(eng.status);
  const corp = eng.corporation || {};
  const cpa = eng.assigned_cpa;
  const issueDocs = docs.filter((d) => d.status === "ISSUE");
  const newRequests = docs.filter((d) => d.is_new_request);
  const pendingReq = docs.filter((d) => d.status === "PENDING" && d.is_required && !d.deferred_at);

  return (
    <div className="page-narrow stack-lg">
      <div className="card animate-in">
          <div className="section-label" style={{ marginBottom: 8 }}>YOUR ENGAGEMENT</div>
          <h1 className="page-title">Your corporate tax filing</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {corp.name} · Fiscal year ending {fmtDate(corp.fiscal_year_end)}
          </p>
        </div>

        <div className="card animate-in-2">
          <ProgressDots current={phase} />
        </div>

        {newRequests.length > 0 && newRequests[0].request_note && pendingReq.some((d) => d.is_new_request) && (
          <div className="alert alert-active animate-in-3" data-testid="new-request-banner">
            <RefreshCw size={16} />
            <div>
              <strong>{cpa?.name || "Your CPA"} requested {newRequests.length} additional {newRequests.length === 1 ? "document" : "documents"}.</strong>
              <span style={{ marginLeft: 6 }}>Look for the <em>New request</em> badge below.</span>
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
          <div className="section-label" style={{ marginBottom: 4 }}>DOCUMENTS WE NEED</div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>Upload each item as you have it. PDFs, images, or spreadsheets up to 25 MB.</p>
          <div>
            {docs.filter((d) => !d.deferred_at).map((d) => <DocRow key={d.id} doc={d} onUpload={onUpload} busy={busy === d.id} onDefer={onDefer} />)}
          </div>
        </div>

        {issueDocs.length > 0 && (
          <div className="stack-md animate-in-3" data-testid="issue-section">
            {issueDocs.map((d) => <IssueAlert key={d.id} doc={d} />)}
          </div>
        )}

        {docs.some((d) => d.deferred_at) && (
          <div className="card animate-in-3" data-testid="deferred-section">
            <div className="section-label" style={{ marginBottom: 4 }}>DEFERRED FOR LATER</div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
              You said you would come back to these. Upload them whenever you are ready, no rush.
            </p>
            <div>
              {docs.filter((d) => d.deferred_at).map((d) => (
                <div className="list-row" key={d.id} data-testid={`deferred-row-${d.id}`}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{d.name}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{d.description}</div>
                    <div className="tertiary" style={{ fontSize: 11, marginTop: 4 }}>Deferred {fmtDate(d.deferred_at)}</div>
                  </div>
                  <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }} data-testid={`undefer-${d.id}`}>
                    <Upload size={12} /> Upload now
                    <HiddenFileInput onPick={(f) => onUpload(d, "upload", f)} />
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid-2 animate-in-3">
          {cpa && (
            <div className="card" data-testid="cpa-card">
              <div className="section-label" style={{ marginBottom: 12 }}>CPA INFORMATION</div>
              <div className="flex items-center gap-3">
                <div className="avatar" style={{ width: 44, height: 44, fontSize: 14 }}>{initials(cpa.name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-serif)", fontSize: 18 }}>{cpa.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>Your tax professional</div>
                </div>
              </div>
              <button className="btn btn-secondary btn-sm mt-3" onClick={() => navigate("/portal/messages")} data-testid="message-cpa"><MessageSquare size={12} /> Message</button>
            </div>
          )}
          <div className="card" data-testid="cra-card">
            <div className="section-label" style={{ marginBottom: 12 }}>CRA ACCESS</div>
            {eng.cra_access_status === "ACCESS_VERIFIED" ? (
              <div className="flex items-center gap-2" style={{ color: "#2e7d32", fontSize: 14 }}>
                <Check size={16} /> Confirmed
              </div>
            ) : eng.cra_access_method === "efile" ? (
              <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>CloudTax has submitted an authorization via EFILE. Please log into CRA My Business Account and confirm it under Profile, Authorized representatives.</p>
            ) : eng.cra_access_method === "my_business_account" ? (
              <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>Please log into CRA My Business Account and add CloudTax as an authorized representative.</p>
            ) : (
              <p className="muted" style={{ fontSize: 12 }}>Your CPA will walk you through CRA access shortly.</p>
            )}
          </div>
        </div>

        {eng.status === "FILED" && (
          <div className="card animate-in-3" style={{ background: "#e8f5e9", borderColor: "#bbe1bd" }} data-testid="filing-complete-card">
            <div className="flex items-center gap-2" style={{ color: "#2e7d32", fontFamily: "var(--font-serif)", fontSize: 18 }}>
              <Check size={18} /> Filing complete
            </div>
            <p style={{ fontSize: 12, marginTop: 8, color: "#2e7d32" }}>Confirmation #{eng.filing_confirmation || "—"} · Filed {fmtDate(eng.filing_date)}</p>
          </div>
        )}

        <div className="portal-footer">Powered by CloudTax, in partnership with Wealthsimple</div>
    </div>
  );
}
