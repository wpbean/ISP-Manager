import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Permission } from '@isp/shared';
import { useAuth } from '@/lib/auth';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState, PageLoader } from '@/components/ui';
import { LoginPage } from '@/pages/Login';

// Route-level code splitting (keeps Leaflet / Recharts out of the initial bundle).
const DashboardPage = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.DashboardPage })));
const CustomersPage = lazy(() => import('@/pages/Customers').then((m) => ({ default: m.CustomersPage })));
const CustomerDetailPage = lazy(() => import('@/pages/CustomerDetail').then((m) => ({ default: m.CustomerDetailPage })));
const CustomerFormPage = lazy(() => import('@/pages/CustomerForm').then((m) => ({ default: m.CustomerFormPage })));
const PaymentsPage = lazy(() => import('@/pages/Payments').then((m) => ({ default: m.PaymentsPage })));
const ReceiptPage = lazy(() => import('@/pages/Receipt').then((m) => ({ default: m.ReceiptPage })));
const NetworkBuilderPage = lazy(() => import('@/pages/network/NetworkBuilder').then((m) => ({ default: m.NetworkBuilderPage })));
const UsersPage = lazy(() => import('@/pages/Users').then((m) => ({ default: m.UsersPage })));
const SettingsPage = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.SettingsPage })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function Gate({ perm, anyOf, children }: { perm?: Permission; anyOf?: Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  const ok = perm ? can(perm) : anyOf ? anyOf.some(can) : true;
  if (!ok) return <EmptyState title="Access denied" message="Your role does not have permission to view this page." />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/payments/:id/receipt"
        element={
          <RequireAuth>
            <Gate perm="payments:read">
              <ReceiptPage />
            </Gate>
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Gate perm="dashboard:read"><DashboardPage /></Gate>} />
        <Route path="customers" element={<Gate perm="customers:read"><CustomersPage /></Gate>} />
        <Route path="customers/new" element={<Gate perm="customers:create"><CustomerFormPage /></Gate>} />
        <Route path="customers/:id" element={<Gate perm="customers:read"><CustomerDetailPage /></Gate>} />
        <Route
          path="customers/:id/edit"
          element={<Gate anyOf={['customers:update', 'customers:update_network']}><CustomerFormPage /></Gate>}
        />
        <Route path="payments" element={<Gate perm="payments:read"><PaymentsPage /></Gate>} />
        <Route path="map" element={<Navigate to="/network" replace />} />
        <Route path="network" element={<Gate perm="network:read"><NetworkBuilderPage /></Gate>} />
        <Route path="users" element={<Gate perm="users:manage"><UsersPage /></Gate>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<EmptyState title="Page not found" message="The page you are looking for does not exist." />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
