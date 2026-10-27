import { z } from 'zod';
import { ROLES } from '../../rbac/permissions.js';

/** Trimmed, non-empty string with a friendly message. */
export const requiredString = (label: string, max = 200) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be a string` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

export const optionalString = (label: string, max = 500) =>
  z
    .string({ invalid_type_error: `${label} must be a string` })
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .nullable();

export const emailSchema = z
  .string({ required_error: 'email is required' })
  .trim()
  .min(3, 'email is required')
  .max(254, 'email must be at most 254 characters')
  .email('email must be a valid email address')
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string({ required_error: 'password is required' })
  .min(8, 'password must be at least 8 characters')
  .max(200, 'password must be at most 200 characters');

export const currencySchema = z
  .string()
  .trim()
  .length(3, 'currency must be a 3 letter ISO code')
  .regex(/^[A-Za-z]{3}$/, 'currency must be a 3 letter ISO code')
  .transform((value) => value.toUpperCase());

export const roleSchema = z.enum(ROLES, {
  errorMap: () => ({ message: `role must be one of: ${ROLES.join(', ')}` }),
});

export const transactionTypeSchema = z.enum(['credit', 'debit'], {
  errorMap: () => ({ message: "type must be either 'credit' or 'debit'" }),
});

/**
 * Amounts arrive as a JSON number or a decimal string; both are converted to integer
 * minor units by `parsePositiveAmount` so no rounding happens in the schema layer.
 */
export const amountInputSchema = z.union(
  [z.number(), z.string().trim().min(1, 'amount is required')],
  { errorMap: () => ({ message: 'amount must be a number or a numeric string' }) },
);

export const referenceIdSchema = z
  .string({ required_error: 'reference_id is required' })
  .trim()
  .min(1, 'reference_id is required')
  .max(100, 'reference_id must be at most 100 characters')
  .regex(
    /^[A-Za-z0-9._:\-/]+$/,
    'reference_id may contain letters, numbers and the characters . _ : - /',
  );

export const isoDateSchema = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), `${label} must be an ISO 8601 date`)
    .transform((value) => new Date(value).toISOString());

export const orgIdParams = z.object({
  orgId: requiredString('orgId', 64),
});

/** `page` / `limit` are re-validated by parsePagination so they survive zod stripping. */
export const paginationQueryShape = {
  page: z.string().trim().optional(),
  limit: z.string().trim().optional(),
};

export const sortOrderSchema = z
  .enum(['asc', 'desc'], { errorMap: () => ({ message: "order must be 'asc' or 'desc'" }) })
  .default('desc');

export const booleanQuerySchema = z
  .enum(['true', 'false', '1', '0'], {
    errorMap: () => ({ message: "value must be 'true' or 'false'" }),
  })
  .transform((value) => value === 'true' || value === '1')
  .optional();
