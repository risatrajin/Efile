import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Login, { SetPassword } from "./pages/Login";
import ClientPortal from "./pages/ClientPortal";
import WsDashboard from "./pages/WsDashboard";
import CpaFiles from "./pages/CpaFiles";
import CpaEngagement from "./pages/CpaEngagement";
import AdminDashboard from "./pages/AdminDashboard";
import AdminUsers from "./pages/AdminUsers";

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
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/set-password" element={<SetPassword />} />

          <Route path="/portal" element={<Protected roles={["CLIENT"]}><ClientPortal /></Protected>} />
          <Route path="/portal/:eid" element={<Protected roles={["CLIENT"]}><ClientPortal /></Protected>} />

          <Route path="/ws/dashboard" element={<Protected roles={["WS_PARTNER"]}><WsDashboard /></Protected>} />

          <Route path="/cpa/files" element={<Protected roles={["CPA", "ADMIN"]}><CpaFiles /></Protected>} />
          <Route path="/cpa/engagement/:eid" element={<Protected roles={["CPA", "ADMIN"]}><CpaEngagement /></Protected>} />

          <Route path="/admin/dashboard" element={<Protected roles={["ADMIN"]}><AdminDashboard /></Protected>} />
          <Route path="/admin/users" element={<Protected roles={["ADMIN"]}><AdminUsers /></Protected>} />

          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
