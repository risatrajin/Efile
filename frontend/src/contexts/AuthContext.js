import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, fmtError } from "../lib/api";
import { getToken, setToken, clearToken } from "../lib/tokenStorage";

const AuthCtx = createContext(null);

// Phase 1.5 transition: collapse WS_PARTNER/PARTNER to one canonical role so
// every role check (roleHome, Protected, ===) accepts either value while the
// rename is in flight. Canonical is WS_PARTNER in stages A-B; flips in stage C.
const PARTNER_ROLE_ALIASES = ["WS_PARTNER", "PARTNER"];
const normalizeUser = (u) =>
  u && typeof u === "object" && PARTNER_ROLE_ALIASES.includes(u.role)
    ? { ...u, role: "WS_PARTNER" }
    : u;

export function AuthProvider({ children }) {
  const [user, setUserRaw] = useState(null);   // null = checking, false = unauth'd, object = auth'd
  const setUser = (u) => setUserRaw(typeof u === "function" ? (prev) => normalizeUser(u(prev)) : normalizeUser(u));
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    (async () => {
      // Skip the /auth/me round-trip entirely when there's no token — avoids
      // producing a loud 401 in the network tab + Playwright/Sentry noise
      // for every unauthenticated first-paint.
      const token = getToken();
      if (!token) {
        setUser(false);
        setBooting(false);
        return;
      }
      try {
        const { data } = await api.get("/auth/me");
        setUser(data);
      } catch {
        setUser(false);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const login = async (email, password) => {
    try {
      const { data } = await api.post("/auth/login", { email, password });
      // 2FA gate: backend returned a challenge instead of a token
      if (data && data.two_factor_required) {
        return {
          ok: false,
          twoFactorRequired: true,
          challengeId: data.challenge_id,
          sentViaEmail: !!data.sent_via_email,
          debugOtp: data.debug_otp || null,
          email: data.email || email,
          expiresInSec: data.expires_in_sec || 300,
          resendAfterSec: data.resend_after_sec || 30,
        };
      }
      if (data.token) setToken(data.token);
      setUser(data.user);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: fmtError(e) };
    }
  };

  const verifyLoginOtp = async (challengeId, code, trustDevice = false) => {
    try {
      const { data } = await api.post("/auth/2fa/verify-login", {
        challenge_id: challengeId,
        code,
        trust_device: !!trustDevice,
      });
      if (data.token) setToken(data.token);
      setUser(data.user);
      return { ok: true, trustedDeviceIssued: !!data.trusted_device_issued };
    } catch (e) {
      return { ok: false, error: fmtError(e) };
    }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    clearToken();
    setUser(false);
  };

  // Memoise so consumers don't re-render on every AuthProvider parent render.
  const value = useMemo(
    () => ({ user, booting, login, verifyLoginOtp, logout, setUser }),
    [user, booting]
  );

  return (
    <AuthCtx.Provider value={value}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
