import type { Permission, Role } from '../rbac/permissions.js';

export type AuthContext = {
  userId: string;
  email: string;
  name: string;
};

export type OrgContext = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  membershipId: string;
  role: Role;
  permissions: Permission[];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id echoed on every response and in error payloads. */
      requestId: string;
      auth?: AuthContext;
      org?: OrgContext;
    }
  }
}
