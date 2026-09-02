import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout';
import { useAuthorization, type UserRole } from '@/hooks/useAuthorization';
import { useApp } from '@/context/AppContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { hasStaleProfile } from '@/lib/auth/sessionIdentity';

import Dashboard from '@/pages/Dashboard';
import Clients from '@/pages/Clients';
import ClientDetails from '@/pages/ClientDetails';
import NewClient from '@/pages/NewClient';
import AutomationLeads from '@/pages/AutomationLeads';
import SendEmail from '@/pages/SendEmail';
import IncomeAnalysis from '@/pages/IncomeAnalysis';
import Amortization from '@/pages/Amortization';
import Schedule from '@/pages/Schedule';
import More from '@/pages/More';
import Developments from '@/pages/Developments';
import DevelopmentDetails from '@/pages/DevelopmentDetails';
import Tasks from '@/pages/Tasks';
import Training from '@/pages/Training';
import Settings from '@/pages/Settings';
import Reports from '@/pages/Reports';
import PotentialClients from '@/pages/PotentialClients';
import AdminPanel from '@/pages/admin/AdminPanel';
import PresenceReport from '@/pages/admin/PresenceReport';
import SecurityPanel from '@/pages/admin/SecurityPanel';
import PdfTools from '@/pages/PdfTools';
import Portals from '@/pages/Portals';
import Login from '@/pages/Login';
import V3Showcase from '@/pages/V3Showcase';
import ResetPassword from '@/pages/ResetPassword';
import PendingApproval from '@/pages/PendingApproval';
import CheckIn from '@/pages/CheckIn';
import CheckInDisplay from '@/pages/CheckInDisplay';

const isPendingProfile = (status?: string) => {
  const normalized = (status || '').toLowerCase();
  return normalized === 'pendente' || normalized === 'pending';
};

const isInactiveProfile = (status?: string) => {
  const normalized = (status || '').toLowerCase();
  return normalized === 'inativo' || normalized === 'inactive';
};

// ─── Auth guard (all authenticated users) ───────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { profile, loading, session } = useApp();
  const { isAnalyst, isReception } = useAuthorization();
  const location = useLocation();

  // Show a blank loading screen (or simple spinner) while Auth context initializes
  if (loading || hasStaleProfile(profile, session)) {
    return (
      <div className="min-h-screen bg-surface-50 flex flex-col justify-center items-center">
        <div className="w-8 h-8 rounded-full border-4 border-surface-200 border-t-gold-500 animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (profile && isPendingProfile(profile.status)) {
    return <Navigate to="/pending" replace />;
  }

  if (profile && isInactiveProfile(profile.status)) {
    return <Navigate to="/login" replace />;
  }

  if (isReception) {
    if (location.pathname !== '/checkin/display') {
      return <Navigate to="/checkin/display" replace />;
    }
    return <>{children}</>;
  }

  if (isAnalyst) {
    const allowedAnalystPaths = ['/income', '/settings'];
    if (!allowedAnalystPaths.includes(location.pathname)) {
      return <Navigate to="/income" replace />;
    }
  }

  return <ResponsiveLayout>{children}</ResponsiveLayout>;
}

// ─── Role-based guard (only for specific restricted routes) ──────────────────
// Currently only used for /admin (ADMIN-only).
// All other routes use ProtectedRoute — data scoping is handled by RLS on the backend.
function RoleRoute({
  children,
  allowed,
}: {
  children: React.ReactNode;
  allowed: UserRole[];
}) {
  const { role, isReception } = useAuthorization();
  const { profile, loading, session } = useApp();
  const location = useLocation();

  if (loading || hasStaleProfile(profile, session)) {
    return (
      <div className="min-h-screen bg-surface-50 flex flex-col justify-center items-center">
        <div className="w-8 h-8 rounded-full border-4 border-surface-200 border-t-gold-500 animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (profile && isPendingProfile(profile.status)) {
    return <Navigate to="/pending" replace />;
  }
  if (profile && isInactiveProfile(profile.status)) {
    return <Navigate to="/login" replace />;
  }
  if (!allowed.includes(role)) return <Navigate to="/" replace />;

  if (isReception) {
    if (location.pathname !== '/checkin/display') {
      return <Navigate to="/checkin/display" replace />;
    }
    return <>{children}</>;
  }

  return <ResponsiveLayout>{children}</ResponsiveLayout>;
}

function OfflineBanner() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-[9999] bg-red-500 text-white text-xs font-bold text-center py-2 shadow-lg">
      Sem conexão — verifique sua internet
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <OfflineBanner />
      <Routes>
        {/* Public */}
        <Route path="/v3" element={<V3Showcase />} />
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/pending" element={<PendingApproval />} />

        {/* ── All authenticated roles ───────────────────────────────────── */}
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

        <Route path="/clients" element={<ProtectedRoute><Clients /></ProtectedRoute>} />
        <Route path="/clients/new" element={<ProtectedRoute><NewClient /></ProtectedRoute>} />
        <Route path="/clients/:id" element={<ProtectedRoute><ClientDetails /></ProtectedRoute>} />
        <Route path="/clients/:id/email" element={<ProtectedRoute><SendEmail /></ProtectedRoute>} />

        <Route path="/automation-leads" element={<ProtectedRoute><AutomationLeads /></ProtectedRoute>} />
        <Route path="/income" element={
          <RoleRoute allowed={['ADMIN', 'DIRETOR', 'GERENTE', 'COORDENADOR', 'ANALISTA']}>
            <IncomeAnalysis />
          </RoleRoute>
        } />
        <Route path="/amortization" element={<ProtectedRoute><Amortization /></ProtectedRoute>} />
        <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
        <Route path="/chat" element={<Navigate to="/" replace />} />
        <Route path="/chat/:id" element={<Navigate to="/" replace />} />
        <Route path="/more" element={<ProtectedRoute><More /></ProtectedRoute>} />

        <Route path="/developments" element={<ProtectedRoute><Developments /></ProtectedRoute>} />
        <Route path="/developments/:id" element={<ProtectedRoute><DevelopmentDetails /></ProtectedRoute>} />
        <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
        <Route path="/training" element={<ProtectedRoute><Training /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/pdf-tools" element={<ProtectedRoute><PdfTools /></ProtectedRoute>} />
        <Route path="/checkin" element={<ProtectedRoute><CheckIn /></ProtectedRoute>} />
        <Route path="/checkin/display" element={
          <RoleRoute allowed={['ADMIN', 'DIRETOR', 'GERENTE', 'RECEPCAO', 'RECEPCAO_ZN']}>
            <CheckInDisplay />
          </RoleRoute>
        } />
        <Route path="/portals" element={<ProtectedRoute><Portals /></ProtectedRoute>} />

        {/* Reports: accessible to all — RLS scopes data by role */}
        <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
        <Route path="/reports/potential-clients" element={<ProtectedRoute><PotentialClients /></ProtectedRoute>} />

        {/* Simulator placeholder */}
        <Route path="/simulator" element={<ProtectedRoute><div className="p-6"><h1 className="text-2xl font-bold">Simulador</h1><p>Em breve...</p></div></ProtectedRoute>} />

        {/* ── ADMIN & DIRETOR ──────────────────────────────────────────── */}
        <Route path="/admin" element={
          <RoleRoute allowed={['ADMIN', 'DIRETOR']}>
            <AdminPanel />
          </RoleRoute>
        } />

        <Route path="/admin/security" element={
          <RoleRoute allowed={['ADMIN', 'DIRETOR']}>
            <SecurityPanel />
          </RoleRoute>
        } />

        {/* ── Presence Report: ADMIN + DIRETOR only ────────────────────── */}
        <Route path="/admin/reports/presence" element={
          <RoleRoute allowed={['ADMIN', 'DIRETOR']}>
            <PresenceReport />
          </RoleRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}
