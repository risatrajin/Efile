import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;

export const api = axios.create({
  baseURL: `${BASE}/api`,
  headers: { "Content-Type": "application/json" },
});

// Attach token from localStorage as fallback (belt + suspenders for SameSite=None issues)
api.interceptors.request.use((config) => {
  const t = localStorage.getItem("ct_token");
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

// Global 401 handler — if the server says our token is invalid/expired, clear
// local auth and bounce to login. 403 is NOT treated globally because some
// routes (e.g. admin-only endpoints) can legitimately return 403 and we want
// the calling component to show a contextual error instead of force-logging
// out. Callers that want to handle 403 can inspect `e.response.status`.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    if (status === 401) {
      // Only show "session expired" when the user *had* a token that became
      // invalid (explicit log-out-prompt UX). A 401 with no local token
      // simply means "you're not logged in" — don't bully them with a
      // banner saying their session expired when it never existed.
      const hadToken = !!localStorage.getItem("ct_token");
      try { localStorage.removeItem("ct_token"); } catch (_) {}
      const p = window.location.pathname || "";
      const isAuthPage = p === "/login" || p.startsWith("/set-password") || p.startsWith("/forgot-password") || p.startsWith("/reset-password");
      if (!isAuthPage && hadToken) {
        window.location.href = "/login?session=expired";
      }
    }
    return Promise.reject(err);
  },
);

export function fmtError(e) {
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || "Something went wrong";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join("; ");
  return JSON.stringify(d);
}

export function initials(name) {
  if (!name) return "??";
  const parts = name.replace(/^Dr\.?\s+/i, "").trim().split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[parts.length - 1]?.[0] || "");
}

export function fmtDate(iso) {
  if (!iso) return "—";
  try {
    // Backend may return naive ISO strings (no Z); values are UTC. Force UTC parsing.
    const isoUtc = typeof iso === "string" && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso + "Z" : iso;
    return new Date(isoUtc).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  } catch { return "—"; }
}

export const TIER_LABELS = {
  BOOKS_COMPLETE: "Books Complete",
  STANDARD: "Standard",
  WHITE_GLOVE: "White-Glove",
};

export const STATUS_LABELS = {
  ONBOARDING: "Onboarding",
  REFERRED: "Referred",
  INTAKE: "Intake",
  IN_PREP: "In prep",
  IN_REVIEW: "In review",
  DELIVERY: "Delivery",
  FILED: "Filed",
  POST_FILING: "Post-filing",
};

export const STATUS_ORDER = ["REFERRED", "INTAKE", "IN_PREP", "IN_REVIEW", "FILED"];

export const OPP_LABELS = {
  COMPENSATION_STRATEGY: "Compensation strategy",
  SBD_CLAWBACK: "SBD clawback",
  CDA_EXTRACTION: "CDA extraction",
  HOLDCO_STRUCTURE: "Holdco structure",
  IPP_CANDIDATE: "IPP candidate",
  ESTATE_PLANNING: "Estate planning",
  RDTOH_OPTIMIZATION: "RDTOH optimization",
  INSURANCE_GAP: "Insurance gap",
  PRIOR_YEAR_ERROR: "Prior year error",
  OTHER: "Other",
};

export const TIME_LABELS = {
  DOCUMENT_REVIEW: "Document review",
  BOOKKEEPING_CLEANUP: "Bookkeeping cleanup",
  INVESTMENT_RECONCILIATION: "Investment reconciliation",
  T2_PREPARATION: "T2 preparation",
  REVIEW_QA: "Review / QA",
  PLANNING_MEMO: "Planning memo",
  CLIENT_CALL: "Client call",
  CRA_CORRESPONDENCE: "CRA correspondence",
  OTHER: "Other",
};
