import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest, tokenStore, UNAUTHORIZED_EVENT } from '../lib/api';
import type { Envelope, Organization, Permission, User } from '../lib/types';

const ORG_KEY = 'confluencr.orgId';

type MeResponse = Envelope<{ user: User; organizations: Organization[] }>;

type AuthState = {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: User | null;
  organizations: Organization[];
  organization: Organization | null;
  permissions: Permission[];
  can: (permission: Permission) => boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    organization_name?: string;
  }) => Promise<void>;
  logout: () => void;
  selectOrganization: (orgId: string) => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>(() =>
    tokenStore.get() ? 'loading' : 'anonymous',
  );
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orgId, setOrgId] = useState<string | null>(() => localStorage.getItem(ORG_KEY));

  const loadSession = useCallback(async () => {
    const response = await apiRequest<MeResponse>('/auth/me');
    setUser(response.data.user);
    setOrganizations(response.data.organizations);
    setStatus('authenticated');

    // Keep the stored selection if it is still a membership, otherwise fall back.
    setOrgId((current) => {
      const stillValid = current && response.data.organizations.some((org) => org.id === current);
      const next = stillValid ? current : (response.data.organizations[0]?.id ?? null);
      if (next) localStorage.setItem(ORG_KEY, next);
      else localStorage.removeItem(ORG_KEY);
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    localStorage.removeItem(ORG_KEY);
    setUser(null);
    setOrganizations([]);
    setOrgId(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) return;
    loadSession().catch(() => logout());
  }, [loadSession, logout]);

  // An expired or revoked token anywhere in the app ends the session once.
  useEffect(() => {
    const handler = () => logout();
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, [logout]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await apiRequest<Envelope<{ token: string }>>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      tokenStore.set(response.data.token);
      setStatus('loading');
      await loadSession();
    },
    [loadSession],
  );

  const register = useCallback(
    async (input: { name: string; email: string; password: string; organization_name?: string }) => {
      const response = await apiRequest<Envelope<{ token: string }>>('/auth/register', {
        method: 'POST',
        body: input,
      });
      tokenStore.set(response.data.token);
      setStatus('loading');
      await loadSession();
    },
    [loadSession],
  );

  const selectOrganization = useCallback((nextOrgId: string) => {
    localStorage.setItem(ORG_KEY, nextOrgId);
    setOrgId(nextOrgId);
  }, []);

  const organization = useMemo(
    () => organizations.find((org) => org.id === orgId) ?? organizations[0] ?? null,
    [organizations, orgId],
  );

  const permissions = useMemo<Permission[]>(() => organization?.permissions ?? [], [organization]);

  const can = useCallback(
    (permission: Permission) => permissions.includes(permission),
    [permissions],
  );

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      organizations,
      organization,
      permissions,
      can,
      login,
      register,
      logout,
      selectOrganization,
      refresh: loadSession,
    }),
    [
      status,
      user,
      organizations,
      organization,
      permissions,
      can,
      login,
      register,
      logout,
      selectOrganization,
      loadSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Convenience for screens that cannot render without an organization context. */
export function useOrganization(): Organization {
  const { organization } = useAuth();
  if (!organization) throw new Error('No organization is selected');
  return organization;
}
