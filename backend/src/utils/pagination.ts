import { AppError } from '../errors/AppError.js';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export type PageRequest = {
  page: number;
  limit: number;
  offset: number;
};

export type PageMeta = {
  page: number;
  limit: number;
  total_records: number;
  total_pages: number;
  has_next_page: boolean;
  has_previous_page: boolean;
};

function parseIntegerParam(raw: unknown, field: string): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (Array.isArray(raw)) {
    throw AppError.badRequest('INVALID_PAGINATION', `${field} must be supplied at most once`, [
      { field, message: `${field} must be supplied at most once` },
    ]);
  }
  const value = String(raw).trim();
  if (!/^\d+$/.test(value)) {
    throw AppError.badRequest('INVALID_PAGINATION', `${field} must be a positive integer`, [
      { field, message: `${field} must be a positive integer` },
    ]);
  }
  return Number.parseInt(value, 10);
}

/** Validates `page`/`limit` query parameters and converts them into a SQL offset. */
export function parsePagination(query: Record<string, unknown>): PageRequest {
  const page = parseIntegerParam(query.page, 'page') ?? DEFAULT_PAGE;
  const limit = parseIntegerParam(query.limit, 'limit') ?? DEFAULT_LIMIT;

  if (page < 1) {
    throw AppError.badRequest('INVALID_PAGINATION', 'page must be greater than or equal to 1', [
      { field: 'page', message: 'page must be greater than or equal to 1' },
    ]);
  }
  if (limit < 1) {
    throw AppError.badRequest('INVALID_PAGINATION', 'limit must be greater than or equal to 1', [
      { field: 'limit', message: 'limit must be greater than or equal to 1' },
    ]);
  }
  if (limit > MAX_LIMIT) {
    throw AppError.badRequest('INVALID_PAGINATION', `limit must be at most ${MAX_LIMIT}`, [
      { field: 'limit', message: `limit must be at most ${MAX_LIMIT}` },
    ]);
  }

  return { page, limit, offset: (page - 1) * limit };
}

export function buildPageMeta(request: PageRequest, totalRecords: number): PageMeta {
  const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / request.limit);
  return {
    page: request.page,
    limit: request.limit,
    total_records: totalRecords,
    total_pages: totalPages,
    has_next_page: request.page < totalPages,
    has_previous_page: request.page > 1 && totalRecords > 0,
  };
}
