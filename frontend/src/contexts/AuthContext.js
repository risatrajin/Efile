import React, { createContext, useContext, useEffect, useState } from "react";
import { api, fmtError } from "../lib/api";
import { getToken, setToken, clearToken } from "../lib/tokenStorage";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);   // null = checking, false = unauth'd, object = auth'd
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

  return (
    <AuthCtx.Provider value={{ user, booting, login, verifyLoginOtp, logout, setUser }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
