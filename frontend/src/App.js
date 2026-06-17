import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AccessibilityProvider } from "./contexts/AccessibilityContext";
import Login, { SetPassword } from "./pages/Login";
import ForgotPassword, { ResetPassword } from "./pages/ForgotPassword";
import ClientLayout from "./pages/ClientLayout";
import ClientPortal from "./pages/ClientPortal";
import MessagesPage from "./pages/Messages";
import StaffMessagesPage from "./pages/MessagesPage";
import AccountPage from "./pages/Account";
import WsDashboard from "./pages/WsDashboard";
import WsFileDetail from "./pages/WsFileDetail";
import WsOnboardingDetail from "./pages/WsOnboardingDetail";
import CpaFiles from "./pages/CpaFiles";
import CpaEngagement from "./pages/CpaEngagement";
import AdminDashboard from "./pages/AdminDashboard";
import AdminClientDetail from "./pages/AdminClientDetail";
import AdminUsers from "./pages/AdminUsers";
import AdminSettings from "./pages/AdminSettings";

function roleHome(role) {
  if (role === "CLIENT") return "/portal";
  if (role === "PARTNER") return "/partner/dashboard";
  if (role === "CPA") return "/cpa/files";
  if (role === "ADMIN") return "/admin/dashboard";
  return "/login";
}

function Protected({ roles, children }) {
  const { user, booting } = useAuth();
  if (booting || user === null) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span className="spinner" />
    </div>
  );
  if (user === false) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={roleHome(user.role)} replace />;
  return children;
}

function RootRedirect() {
  const { user, booting } = useAuth();
  if (booting || user === null) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><span className="spinner" /></div>;
  if (user === false) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(user.role)} replace />;
}
// ---------- Dynamic browser-tab title ----------
// Runs on every route change. Maps the current pathname to a human label and
// sets ``document.title = "<label> | CloudTax's Portal"``. Falls back to the
// base title alone if the route doesn't have a friendly name yet. Keeps all
// portals (Admin/CPA/Partner/Client) on the same brand suffix.
const BASE_TITLE = "CloudTax\u2019s Portal";

function labelForPath(pathname) {
  if (!pathname) return null;
  // Public / auth pages
  if (pathname === "/login") return "Sign in";
  if (pathname === "/forgot-password") return "Forgot password";
  if (pathname === "/reset-password") return "Reset password";
  if (pathname === "/set-password") return "Set password";
  // Client portal
  if (pathname === "/portal") return "Dashboard";
  if (pathname.startsWith("/portal/messages")) return "Messages";
  if (pathname.startsWith("/portal/account")) return "Account";
  // Partner
  if (pathname === "/partner/dashboard") return "Client Pipeline";
  if (pathname.startsWith("/partner/onboarding/")) return "Onboarding";
  if (pathname.startsWith("/partner/file/")) return "Client file";
  // CPA
  if (pathname === "/cpa/files") return "My files";
  if (pathname.startsWith("/cpa/engagement/")) return "Engagement";
  if (pathname.startsWith("/cpa/messages")) return "Messages";
  // Admin
  if (pathname === "/admin/dashboard") return "Dashboard";
  if (pathname.startsWith("/admin/client/")) return "Client";
  if (pathname === "/admin/users") return "Users";
  if (pathname === "/admin/settings") return "Settings";
  if (pathname.startsWith("/admin/messages")) return "Messages";
  // Shared
  if (pathname === "/account") return "Account";
  return null;
}

function PageTitle() {
  const { pathname } = useLocation();
  React.useEffect(() => {
    const label = labelForPath(pathname);
    document.title = label ? `${label} | ${BASE_TITLE}` : BASE_TITLE;
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <AccessibilityProvider>
      <AuthProvider>
        <BrowserRouter>
        <PageTitle />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route element={<Protected roles={["CLIENT"]}><ClientLayout /></Protected>}>
            <Route path="/portal" element={<ClientPortal />} />
            <Route path="/portal/messages" element={<MessagesPage />} />
            <Route path="/portal/account" element={<AccountPage />} />
          </Route>

          <Route path="/partner/dashboard" element={<Protected roles={["PARTNER"]}><WsDashboard /></Protected>} />
          {/* Onboarding is CloudTax-only now; partners are view-only. ADMIN guard, not just hidden UI. */}
          <Route path="/partner/onboarding/:eid" element={<Protected roles={["ADMIN"]}><WsOnboardingDetail /></Protected>} />
          <Route path="/partner/file/:eid" element={<Protected roles={["PARTNER", "ADMIN"]}><WsFileDetail /></Protected>} />

          <Route path="/cpa/files" element={<Protected roles={["CPA", "ADMIN"]}><CpaFiles /></Protected>} />
          <Route path="/cpa/engagement/:eid" element={<Protected roles={["CPA", "ADMIN"]}><CpaEngagement /></Protected>} />
          <Route path="/cpa/messages" element={<Protected roles={["CPA", "ADMIN"]}><StaffMessagesPage /></Protected>} />

          <Route path="/admin/dashboard" element={<Protected roles={["ADMIN"]}><AdminDashboard /></Protected>} />
          <Route path="/admin/client/:eid" element={<Protected roles={["ADMIN"]}><AdminClientDetail /></Protected>} />
          <Route path="/admin/users" element={<Protected roles={["ADMIN"]}><AdminUsers /></Protected>} />
          <Route path="/admin/settings" element={<Protected roles={["ADMIN"]}><AdminSettings /></Protected>} />
          <Route path="/admin/messages" element={<Protected roles={["ADMIN"]}><StaffMessagesPage /></Protected>} />

          <Route path="/account" element={<Protected><AccountPage /></Protected>} />

          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
        </BrowserRouter>
      </AuthProvider>
    </AccessibilityProvider>
  );
}
