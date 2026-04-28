import React, { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { X, Upload, ChevronLeft, ChevronRight, Send } from "lucide-react";
import { api } from "../../lib/api";

// pdf.js worker — bundled with the same version as react-pdf 10
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const DEFAULT_BOX = { w_pct: 0.28, h_pct: 0.07 };

/**
 * CPA-side T183 management modal.
 * Two phases inside the same modal:
 *   1. Pick a pre-filled T183 PDF (uploads to /t183/upload)
 *   2. Drag a "Sign here" placeholder onto the rendered PDF, save position,
 *      then "Send T183 to client" to mark the engagement awaiting signature.
 *
 * Position is stored as page-dimension percentages so it survives any zoom on
 * the client side. Origin is top-left of the PDF page.
 */
export default function T183PlacementModal({ engagementId, t183, onClose, onChange }) {
  const [phase, setPhase] = useState(t183?.has_original ? "place" : "upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [numPages, setNumPages] = useState(0);
  const [pageIndex, setPageIndex] = useState(t183?.signature_position?.page ?? 0);
  const [pageDims, setPageDims] = useState({ w: 0, h: 0 });
  const containerRef = useRef(null);

  // Box position (percentages). If we have a saved position, prefer that.
  const initBox = t183?.signature_position
    ? { x_pct: t183.signature_position.x_pct, y_pct: t183.signature_position.y_pct, w_pct: t183.signature_position.w_pct, h_pct: t183.signature_position.h_pct }
    : { x_pct: 0.55, y_pct: 0.78, ...DEFAULT_BOX };
  const [box, setBox] = useState(initBox);
  const [drag, setDrag] = useState(null); // { startX, startY, startBox }

  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true); setError("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.post(`/engagements/${engagementId}/t183/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      onChange?.(); // tell parent to reload engagement
      setPhase("place");
    } catch (x) {
      setError(x?.response?.data?.detail || x?.message || "Upload failed");
    } finally { setBusy(false); }
  };

  const onPdfLoad = ({ numPages: n }) => {
    setNumPages(n);
    if (pageIndex >= n) setPageIndex(0);
  };

  const onPageLoad = (page) => {
    // Capture rendered page width/height in CSS pixels for drag math
    const node = containerRef.current?.querySelector(".react-pdf__Page__canvas");
    if (node) setPageDims({ w: node.clientWidth, h: node.clientHeight });
  };

  const startDrag = (e) => {
    e.preventDefault();
    const startX = e.clientX ?? e.touches?.[0]?.clientX;
    const startY = e.clientY ?? e.touches?.[0]?.clientY;
    setDrag({ startX, startY, startBox: { ...box } });
  };
  const moveDrag = (e) => {
    if (!drag) return;
    const cx = e.clientX ?? e.touches?.[0]?.clientX;
    const cy = e.clientY ?? e.touches?.[0]?.clientY;
    if (cx == null || cy == null) return;
    const dx = (cx - drag.startX) / pageDims.w;
    const dy = (cy - drag.startY) / pageDims.h;
    let nx = drag.startBox.x_pct + dx;
    let ny = drag.startBox.y_pct + dy;
    nx = Math.max(0, Math.min(1 - box.w_pct, nx));
    ny = Math.max(0, Math.min(1 - box.h_pct, ny));
    setBox({ ...box, x_pct: nx, y_pct: ny });
  };
  const endDrag = () => setDrag(null);

  useEffect(() => {
    if (!drag) return;
    window.addEventListener("mousemove", moveDrag);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchmove", moveDrag, { passive: false });
    window.addEventListener("touchend", endDrag);
    return () => {
      window.removeEventListener("mousemove", moveDrag);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("touchmove", moveDrag);
      window.removeEventListener("touchend", endDrag);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, box.w_pct, box.h_pct, pageDims.w, pageDims.h]);

  const sendToClient = async () => {
    setBusy(true); setError("");
    try {
      await api.post(`/engagements/${engagementId}/t183/position`, {
        page: pageIndex,
        x_pct: box.x_pct, y_pct: box.y_pct, w_pct: box.w_pct, h_pct: box.h_pct,
      });
      await api.post(`/engagements/${engagementId}/t183/send`);
      onChange?.();
      onClose();
    } catch (x) {
      setError(x?.response?.data?.detail || x?.message || "Failed to send T183");
    } finally { setBusy(false); }
  };

  const pdfUrl = `${process.env.REACT_APP_BACKEND_URL}/api/engagements/${engagementId}/t183/file?variant=original&_=${t183?.uploaded_at || ""}`;
  const authedPdfFile = useAuthedPdf(pdfUrl, phase === "place");

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="t183-placement-modal">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 920, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div className="flex items-center between" style={{ marginBottom: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>{phase === "upload" ? "Upload T183" : "Place signature placeholder"}</h2>
          <button onClick={onClose} className="btn btn-ghost btn-sm" data-testid="t183-place-close" aria-label="Close"><X size={16} /></button>
        </div>

        {error && <div className="alert alert-risk" style={{ fontSize: 12 }}>{error}</div>}

        {phase === "upload" && (
          <div style={{ padding: "32px 8px" }}>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Upload the pre-filled T183 PDF. The form should already contain client details — only the signature is missing.</p>
            <div
              onClick={() => fileRef.current?.click()}
              data-testid="t183-upload-dropzone"
              style={{ border: "2px dashed var(--border-default)", background: "#fafafa", borderRadius: 12, padding: "40px 18px", textAlign: "center", cursor: "pointer" }}
            >
              <Upload size={22} style={{ color: "var(--text-tertiary)", marginBottom: 8 }} />
              <div style={{ fontSize: 14, fontWeight: 500 }}>Drop T183 PDF here or click to browse</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>PDF up to 25 MB</div>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={handleFile} data-testid="t183-upload-input" />
            </div>
            {busy && <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>Uploading…</div>}
          </div>
        )}

        {phase === "place" && (
          <>
            <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Drag the highlighted box to where the client must sign. Saved as percentage of page so it stays accurate at any zoom level.
            </p>
            <div ref={containerRef} style={{ flex: 1, overflow: "auto", background: "#525659", borderRadius: 8, padding: 16, position: "relative" }}>
              {authedPdfFile && (
                <Document file={authedPdfFile} onLoadSuccess={onPdfLoad} loading={<div style={{ color: "#fff", padding: 24 }}>Loading PDF…</div>}>
                  <div style={{ position: "relative", display: "inline-block" }} data-testid="t183-pdf-stage">
                    <Page pageNumber={pageIndex + 1} width={Math.min(800, (containerRef.current?.clientWidth || 800) - 32)} onRenderSuccess={onPageLoad} renderAnnotationLayer={false} renderTextLayer={false} />
                    {/* Signature placeholder */}
                    {pageDims.w > 0 && (
                      <div
                        onMouseDown={startDrag}
                        onTouchStart={startDrag}
                        data-testid="t183-sig-placeholder"
                        style={{
                          position: "absolute",
                          left: box.x_pct * pageDims.w,
                          top: box.y_pct * pageDims.h,
                          width: box.w_pct * pageDims.w,
                          height: box.h_pct * pageDims.h,
                          border: "2px dashed #1a1a1a",
                          background: "rgba(255, 235, 59, 0.32)",
                          cursor: drag ? "grabbing" : "grab",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#1a1a1a",
                          letterSpacing: "0.04em",
                          userSelect: "none",
                          touchAction: "none",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                        }}
                      >SIGN HERE</div>
                    )}
                  </div>
                </Document>
              )}
            </div>

            <div className="flex items-center between" style={{ marginTop: 12, gap: 8 }}>
              <div className="flex gap-2" data-testid="t183-pager">
                <button className="btn btn-secondary btn-sm" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => i - 1)}><ChevronLeft size={12} /> Prev</button>
                <span className="muted" style={{ alignSelf: "center", fontSize: 12 }}>Page {pageIndex + 1} / {numPages || "?"}</span>
                <button className="btn btn-secondary btn-sm" disabled={pageIndex >= numPages - 1} onClick={() => setPageIndex((i) => i + 1)}>Next <ChevronRight size={12} /></button>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={sendToClient} data-testid="t183-send-to-client">
                  <Send size={12} /> {busy ? "Sending…" : "Send T183 to client"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Hook: fetch the (auth-protected) PDF as a blob and feed it to react-pdf.
 * react-pdf can't add Authorization headers to its internal requests, so we
 * download the bytes here and hand them over as a Uint8Array.
 */
function useAuthedPdf(url, enabled) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!enabled || !url) { setData(null); return; }
    let cancelled = false;
    api.get(url.replace(`${process.env.REACT_APP_BACKEND_URL}/api`, ""), { responseType: "arraybuffer" })
      .then((resp) => { if (!cancelled) setData({ data: new Uint8Array(resp.data) }); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [url, enabled]);
  return data;
}
