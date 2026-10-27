import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { Button, Card, EmptyState, Spinner, ToastProvider } from './components/ui';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AccessControlPage } from './pages/AccessControlPage';
import { AccountDetailPage } from './pages/AccountDetailPage';
import { AccountsPage } from './pages/AccountsPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { TransfersPage } from './pages/TransfersPage';
import type { Permission } from './lib/types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      // A 401/403 is an answer, not a transient failure — do not hammer the API.
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status ?? 0;
        if (status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedShell />}>
              <Route path="/" element={<DashboardPage />} />
              <Route
                path="/accounts"
                element={
                  <RequirePermission permission="account:read">
                    <AccountsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/accounts/:accountId"
                element={
                  <RequirePermission permission="account:read">
                    <AccountDetailPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/transactions"
                element={
                  <RequirePermission permission="transaction:read">
                    <TransactionsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/transfers"
                element={
                  <RequirePermission permission="transfer:read">
                    <TransfersPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/access"
                element={
                  <RequirePermission permission="member:read">
                    <AccessControlPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/audit"
                element={
                  <RequirePermission permission="audit:read">
                    <AuditLogPage />
                  </RequirePermission>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function ProtectedShell() {
  const { status, organizations } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-plane text-sm text-ink-3">
        <Spinner />
        Restoring your session…
      </div>
    );
  }

  if (status === 'anonymous') return <Navigate to="/login" replace />;

  if (organizations.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-plane px-4">
        <Card className="max-w-md">
          <EmptyState
            title="You are not a member of any organization"
            description="Ask an owner or admin to add you, or register again to create your own."
          />
        </Card>
      </div>
    );
  }

  return <AppShell />;
}

/**
 * Route-level guard. The API is the real authority — this only keeps the UI from
 * offering a screen the caller's role would be refused for.
 */
function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  const { can, organization } = useAuth();
  if (can(permission)) return <>{children}</>;

  return (
    <Card>
      <EmptyState
        title="Your role cannot open this screen"
        description={`The ${organization?.role} role does not include the "${permission}" permission in ${organization?.name}.`}
        action={
          <Button onClick={() => window.history.back()} size="sm">
            Go back
          </Button>
        }
      />
    </Card>
  );
}

function NotFound() {
  return (
    <Card>
      <EmptyState
        title="Page not found"
        description="The link you followed does not match any screen in the console."
        action={
          <Button size="sm" onClick={() => window.location.assign('/')}>
            Back to the dashboard
          </Button>
        }
      />
    </Card>
  );
}
