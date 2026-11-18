import type { Ctx } from './router.js';
import { validationError } from '../core/errors.js';

/**
 * @file Pagination and LIKE escaping shared by list endpoints.
 */
/** Normalized 1-based page/offset contract. */
export interface Pagination {
  page: number;
  perPage: number;
  offset: number;
}

/** Parses `page`, `per_page`/`limit` and `offset` with explicit bounds. */
export function parsePagination(ctx: Ctx, maxPerPage: number): Pagination {
  const getInt = (name: string, fallback: number, min: number, max: number): number => {
    const raw = ctx.query.get(name);
    if (raw === null || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw validationError([{ field: name, message: `Entero entre ${min} y ${max}` }]);
    }
    return value;
  };
  const perPage = getInt('limit', getInt('per_page', 25, 1, maxPerPage), 1, maxPerPage);
  let page = getInt('page', 1, 1, 1_000_000);
  let offset = (page - 1) * perPage;
  if (ctx.query.has('offset')) {
    offset = getInt('offset', 0, 0, 100_000_000);
    page = Math.floor(offset / perPage) + 1;
  }
  return { page, perPage, offset };
}

/** Escapes user text for SQLite LIKE, used with `ESCAPE '\'`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Builds the stable pagination envelope published by list endpoints. */
export function paginationMeta(pagination: Pagination, total: number) {
  const totalPages = Math.ceil(total / pagination.perPage);
  return {
    page: pagination.page,
    per_page: pagination.perPage,
    offset: pagination.offset,
    total,
    total_pages: totalPages,
    has_next: pagination.offset + pagination.perPage < total,
    has_prev: pagination.offset > 0,
  };
}
