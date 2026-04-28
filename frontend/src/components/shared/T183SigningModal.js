import React, { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { X, ChevronLeft, ChevronRight, PenLine, Eraser, Check, Type } from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import { api } from "../../lib/api";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

/**
 * Client-side T183 signing experience:
 *   - Renders the CPA-uploaded PDF.
 *   - Highlights the placeholder region the CPA placed (pulsing yellow box).
 *   - Click placeholder → opens signature pad with Draw + Type tabs.
 *   - On submit, the signature image is POSTed to /t183/sign which merges it
 *     into the PDF server-side and returns a new signed PDF.
 */
export default function T183SigningModal({ engagementId, t183, defaultName = "", onClose, onSigned }) {
  const [numPages, setNumPages] = useState(0);
  const initialPage = t183?.signature_position?.page ?? 0;
  const [pageIndex, setPageIndex] = useState(initialPage);
  const [pageDims, setPageDims] = useState({ w: 0, h: 0 });
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const [signOpen, setSignOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pos = t183?.signature_position;
  const onSamePage = pos && pos.page === pageIndex;

  const onPdfLoad = ({ numPages: n }) => setNumPages(n);
  const onPageLoad = () => {
    const node = stageRef.current?.querySelector(".react-pdf__Page__canvas");
    if (node) setPageDims({ w: node.clientWidth, h: node.clientHeight });
  };

  const submit = async ({ signature, name }) => {
    setBusy(true); setError("");
    try {
      const r = await api.post(`/engagements/${engagementId}/t183/sign`, { signature, signer_name: name });
      onSigned?.(r.data);
      onClose();
    } catch (x) {
      setError(x?.response?.data?.detail || x?.message || "Sign failed");
    } finally { setBusy(false); }
  };

  const pdfUrl = `${process.env.REACT_APP_BACKEND_URL}/api/engagements/${engagementId}/t183/file?variant=original&_=${t183?.uploaded_at || ""}`;
  const authedPdfFile = useAuthedPdf(pdfUrl);

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="t183-signing-modal">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 920, maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div className="flex items-center between" style={{ marginBottom: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Sign T183 — Authorization to E-File</h2>
          <button onClick={onClose} className="btn btn-ghost btn-sm" data-testid="t183-sign-close" aria-label="Close"><X size={16} /></button>
        </div>

        {error && <div className="alert alert-risk" style={{ fontSize: 12 }}>{error}</div>}

        <div ref={containerRef} style={{ flex: 1, overflow: "auto", background: "#525659", borderRadius: 8, padding: 16, position: "relative" }}>
          {authedPdfFile && (
            <Document file={authedPdfFile} onLoadSuccess={onPdfLoad} loading={<div style={{ color: "#fff", padding: 24 }}>Loading PDF…</div>}>
              <div ref={stageRef} style={{ position: "relative", display: "inline-block" }} data-testid="t183-client-pdf-stage">
                <Page pageNumber={pageIndex + 1} width={Math.min(800, (containerRef.current?.clientWidth || 800) - 32)} onRenderSuccess={onPageLoad} renderAnnotationLayer={false} renderTextLayer={false} />
                {pos && onSamePage && pageDims.w > 0 && (
                  <button
                    onClick={() => setSignOpen(true)}
                    data-testid="t183-sign-here-target"
                    style={{
                      position: "absolute",
                      left: pos.x_pct * pageDims.w,
                      top: pos.y_pct * pageDims.h,
                      width: pos.w_pct * pageDims.w,
                      height: pos.h_pct * pageDims.h,
                      border: "2px solid #1565c0",
                      background: "rgba(33, 150, 243, 0.18)",
                      animation: "t183-pulse 1.4s ease-in-out infinite",
                      cursor: "pointer",
                      fontSize: 11, fontWeight: 600, color: "#0d47a1", letterSpacing: "0.04em",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >SIGN HERE</button>
                )}
              </div>
            </Document>
          )}
        </div>

        <style>{`
          @keyframes t183-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(21, 101, 192, 0.45); }
            50%      { box-shadow: 0 0 0 8px rgba(21, 101, 192, 0); }
          }
        `}</style>

        <div className="flex items-center between" style={{ marginTop: 12, gap: 8 }}>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => i - 1)}><ChevronLeft size={12} /> Prev</button>
            <span className="muted" style={{ alignSelf: "center", fontSize: 12 }}>Page {pageIndex + 1} / {numPages || "?"}</span>
            <button className="btn btn-secondary btn-sm" disabled={pageIndex >= numPages - 1} onClick={() => setPageIndex((i) => i + 1)}>Next <ChevronRight size={12} /></button>
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setSignOpen(true)} data-testid="t183-open-pad">
            <PenLine size={12} /> {pos ? "Sign at the highlighted spot" : "Sign T183"}
          </button>
        </div>

        {signOpen && <SignaturePadInline defaultName={defaultName} onCancel={() => setSignOpen(false)} onSubmit={submit} busy={busy} />}
      </div>
    </div>
  );
}

function SignaturePadInline({ defaultName, onCancel, onSubmit, busy }) {
  const [tab, setTab] = useState("draw"); // 'draw' | 'type'
  const [name, setName] = useState(defaultName || "");
  const [typed, setTyped] = useState(defaultName || "");
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState("");
  const padRef = useRef(null);
  const typedCanvasRef = useRef(null);

  // Render the typed signature into a canvas so we can capture as PNG
  useEffect(() => {
    if (tab !== "type") return;
    const c = typedCanvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = 460, h = 110;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "transparent";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "italic 38px 'Segoe Script', 'Brush Script MT', cursive";
    ctx.fillStyle = "#1a1a1a";
    ctx.textBaseline = "middle";
    ctx.fillText(typed || "—", 12, h / 2);
  }, [typed, tab]);

  const clear = () => {
    if (tab === "draw") { padRef.current?.clear(); setHasInk(false); }
    else { setTyped(""); }
  };

  const submit = () => {
    setError("");
    if (!name.trim()) { setError("Please type your full legal name."); return; }
    let signature;
    if (tab === "draw") {
      if (!hasInk) { setError("Please draw your signature."); return; }
      signature = manualTrimCanvas(padRef.current.getCanvas()).toDataURL("image/png");
    } else {
      if (!typed.trim()) { setError("Please type your signature."); return; }
      signature = manualTrimCanvas(typedCanvasRef.current).toDataURL("image/png");
    }
    onSubmit({ signature, name: name.trim() });
  };

  return (
    <div className="modal-overlay" onClick={onCancel} data-testid="t183-sign-pad" style={{ zIndex: 60 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div className="flex items-center between" style={{ marginBottom: 8 }}>
          <h3 className="section-title" style={{ margin: 0 }}>Add your signature</h3>
          <button onClick={onCancel} className="btn btn-ghost btn-sm"><X size={16} /></button>
        </div>

        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Choose <strong>Draw</strong> or <strong>Type</strong>. By signing you authorize your CPA to electronically file your corporate return with the CRA.
        </p>

        <div className="field" style={{ marginTop: 12 }}>
          <label className="field-label">Full legal name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rachel Thompson" data-testid="t183-name" />
        </div>

        <div style={{ display: "inline-flex", marginTop: 14, padding: 3, background: "var(--bg-subtle)", borderRadius: 8 }} data-testid="t183-tabs">
          <button
            type="button"
            onClick={() => setTab("draw")}
            data-testid="t183-tab-draw"
            style={tabStyle(tab === "draw")}
          ><PenLine size={12} /> Draw</button>
          <button
            type="button"
            onClick={() => setTab("type")}
            data-testid="t183-tab-type"
            style={tabStyle(tab === "type")}
          ><Type size={12} /> Type</button>
        </div>

        <div style={{ marginTop: 12, position: "relative" }}>
          {tab === "draw" ? (
            <div style={{ border: "1px solid var(--border-default)", borderRadius: 10, background: "#fafafa" }}>
              <SignatureCanvas
                ref={padRef}
                penColor="#1a1a1a"
                onEnd={() => setHasInk(true)}
                canvasProps={{ width: 460, height: 160, "data-testid": "t183-canvas", style: { width: "100%", height: 160, borderRadius: 10 } }}
              />
            </div>
          ) : (
            <div style={{ border: "1px solid var(--border-default)", borderRadius: 10, background: "#fafafa", padding: 8 }}>
              <canvas ref={typedCanvasRef} data-testid="t183-typed-canvas" style={{ width: "100%", height: 110, borderRadius: 6, background: "transparent" }} />
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your signature" style={{ marginTop: 6 }} data-testid="t183-typed-input" />
            </div>
          )}
          <button className="btn btn-ghost btn-sm" onClick={clear} style={{ position: "absolute", top: 8, right: 8 }} data-testid="t183-clear">
            <Eraser size={12} /> Clear
          </button>
        </div>

        {error && <div className="alert alert-risk" style={{ marginTop: 10, fontSize: 12 }}>{error}</div>}

        <div className="flex gap-2" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onCancel} className="btn btn-secondary btn-sm">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !name.trim() || (tab === "draw" ? !hasInk : !typed.trim())}
            className="btn btn-primary btn-sm"
            data-testid="t183-complete-sign"
          ><Check size={12} /> {busy ? "Submitting…" : "Complete signing"}</button>
        </div>
      </div>
    </div>
  );
}

function tabStyle(active) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
    background: active ? "#fff" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    fontSize: 12, fontWeight: 500, transition: "background-color 120ms ease",
    boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
  };
}

/**
 * Manual replacement for react-signature-canvas's getTrimmedCanvas() — that
 * helper has been broken since trim-canvas v0.1.4 changed its export shape.
 * Walks the imageData, finds the bounding box of non-transparent pixels, and
 * returns a new canvas cropped to that region. Falls back to the source
 * canvas if it's empty.
 */
function manualTrimCanvas(canvas) {
  if (!canvas) return canvas;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return canvas;
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas; // empty
  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = tw;
  out.height = th;
  out.getContext("2d").drawImage(canvas, minX, minY, tw, th, 0, 0, tw, th);
  return out;
}

function useAuthedPdf(url) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!url) { setData(null); return; }
    let cancelled = false;
    api.get(url.replace(`${process.env.REACT_APP_BACKEND_URL}/api`, ""), { responseType: "arraybuffer" })
      .then((resp) => { if (!cancelled) setData({ data: new Uint8Array(resp.data) }); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [url]);
  return data;
}
