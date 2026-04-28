import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AccessibilityProvider } from "./contexts/AccessibilityContext";
import Login, { SetPassword } from "./pages/Login";
import ForgotPassword, { ResetPassword } from "./pages/ForgotPassword";
import ClientLayout from "./pages/ClientLayout";
import ClientPortal from "./pages/ClientPortal";
import MessagesPage from "./pages/Messages";
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
  if (role === "WS_PARTNER") return "/ws/dashboard";
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

export default function App() {
  return (
    <AccessibilityProvider>
      <AuthProvider>
        <BrowserRouter>
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

          <Route path="/ws/dashboard" element={<Protected roles={["WS_PARTNER"]}><WsDashboard /></Protected>} />
          <Route path="/ws/onboarding/:eid" element={<Protected roles={["WS_PARTNER", "ADMIN"]}><WsOnboardingDetail /></Protected>} />
          <Route path="/ws/file/:eid" element={<Protected roles={["WS_PARTNER", "ADMIN"]}><WsFileDetail /></Protected>} />

          <Route path="/cpa/files" element={<Protected roles={["CPA", "ADMIN"]}><CpaFiles /></Protected>} />
          <Route path="/cpa/engagement/:eid" element={<Protected roles={["CPA", "ADMIN"]}><CpaEngagement /></Protected>} />

          <Route path="/admin/dashboard" element={<Protected roles={["ADMIN"]}><AdminDashboard /></Protected>} />
          <Route path="/admin/client/:eid" element={<Protected roles={["ADMIN"]}><AdminClientDetail /></Protected>} />
          <Route path="/admin/users" element={<Protected roles={["ADMIN"]}><AdminUsers /></Protected>} />
          <Route path="/admin/settings" element={<Protected roles={["ADMIN"]}><AdminSettings /></Protected>} />

          <Route path="/account" element={<Protected><AccountPage /></Protected>} />

          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
        </BrowserRouter>
      </AuthProvider>
    </AccessibilityProvider>
  );
}
