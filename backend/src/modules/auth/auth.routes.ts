import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../../db/index.js';
import { AppError } from '../../errors/AppError.js';
import { authenticate, currentUser } from '../../middleware/authenticate.js';
import { validateBody } from '../../middleware/validate.js';
import { permissionsForRole, roleMatrix } from '../../rbac/permissions.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { toMajorUnits } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import {
  currencySchema,
  emailSchema,
  passwordSchema,
  requiredString,
} from '../common/schemas.js';
import {
  insertMembership,
  insertOrganization,
  listOrganizationsForUser,
} from '../organizations/organizations.repository.js';
import { signAccessToken } from './token.service.js';
import { findUserByEmail, insertUser, serializeUser } from './users.repository.js';

const BCRYPT_ROUNDS = 10;

const registerSchema = z.object({
  name: requiredString('name', 120),
  email: emailSchema,
  password: passwordSchema,
  organization_name: requiredString('organization_name', 120).optional(),
  currency: currencySchema.optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ required_error: 'password is required' }).min(1, 'password is required'),
});

export const authRouter = Router();

/**
 * Sign up. A first organization is created in the same transaction and the new user
 * becomes its OWNER, so a fresh account is immediately usable.
 */
authRouter.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>;

    if (findUserByEmail(body.email)) {
      throw AppError.conflict('EMAIL_ALREADY_REGISTERED', 'This email is already registered');
    }

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);

    const result = withTransaction((db) => {
      const user = insertUser({ email: body.email, name: body.name, passwordHash }, db);
      const organization = insertOrganization(
        {
          name: body.organization_name ?? `${body.name.split(' ')[0]}'s Organization`,
          currency: body.currency ?? 'INR',
          createdBy: user.id,
        },
        db,
      );
      const membership = insertMembership(
        { orgId: organization.id, userId: user.id, role: 'OWNER' },
        db,
      );
      return { user, organization, membership };
    });

    req.auth = { userId: result.user.id, email: result.user.email, name: result.user.name };
    recordAudit(req, {
      orgId: result.organization.id,
      action: 'auth.registered',
      entityType: 'user',
      entityId: result.user.id,
      metadata: { organization_id: result.organization.id },
    });

    const { token, expiresIn } = signAccessToken({
      sub: result.user.id,
      email: result.user.email,
      name: result.user.name,
    });

    res.status(201).json({
      data: {
        token,
        token_type: 'Bearer',
        expires_in: expiresIn,
        user: serializeUser(result.user),
        organization: {
          id: result.organization.id,
          name: result.organization.name,
          slug: result.organization.slug,
          currency: result.organization.currency,
          role: result.membership.role,
        },
      },
    });
  }),
);

authRouter.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof loginSchema>;
    const user = findUserByEmail(body.email);

    // Same error for "no such user" and "wrong password" so the endpoint cannot be used
    // to enumerate registered emails.
    const invalid = AppError.unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect');
    if (!user) throw invalid;

    const matches = await bcrypt.compare(body.password, user.password_hash);
    if (!matches) throw invalid;

    req.auth = { userId: user.id, email: user.email, name: user.name };
    const organizations = listOrganizationsForUser(user.id);
    recordAudit(req, {
      orgId: organizations[0]?.id ?? null,
      action: 'auth.logged_in',
      entityType: 'user',
      entityId: user.id,
    });

    const { token, expiresIn } = signAccessToken({
      sub: user.id,
      email: user.email,
      name: user.name,
    });

    res.json({
      data: {
        token,
        token_type: 'Bearer',
        expires_in: expiresIn,
        user: serializeUser(user),
        organizations: organizations.map((org) => ({
          id: org.id,
          name: org.name,
          slug: org.slug,
          currency: org.currency,
          role: org.role,
        })),
      },
    });
  }),
);

/** Current identity plus every organization membership and its permission set. */
authRouter.get(
  '/me',
  authenticate,
  asyncHandler((req, res) => {
    const auth = currentUser(req);
    const organizations = listOrganizationsForUser(auth.userId);
    res.json({
      data: {
        user: { id: auth.userId, name: auth.name, email: auth.email },
        organizations: organizations.map((org) => ({
          id: org.id,
          name: org.name,
          slug: org.slug,
          currency: org.currency,
          role: org.role,
          permissions: permissionsForRole(org.role),
          account_count: org.account_count,
          member_count: org.member_count,
          transaction_count: org.transaction_count,
          total_balance: toMajorUnits(org.total_balance_minor),
        })),
      },
    });
  }),
);

/** Static role -> permission matrix, rendered by the Access Control screen. */
authRouter.get('/roles', (_req, res) => {
  res.json({ data: roleMatrix() });
});
