import type { Router } from '../router.js';
import type { Ctx } from '../router.js';
import type { RequestContext } from '../http.js';
import { readJsonBody, sendJson } from '../http.js';
import { conflict, notFound, validationError } from '../errors.js';
import { registerResource } from '../resource.js';
import { Validator } from '../validate.js';
import { escapeLike, paginationMeta, parsePagination } from '../query.js';

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function dbOf(ctx: Ctx) {
  return (ctx as RequestContext).app.db;
}
type Db = ReturnType<typeof dbOf>;

function loanDetails(ctx: Ctx, id: number) {
  const db = dbOf(ctx);
  const row = db.get<Record<string, unknown>>(
    `SELECT l.*, c.barcode, b.title AS book_title, b.isbn, r.full_name AS reader_name, r.card_number,
            CASE WHEN l.status IN ('active','overdue') AND l.due_at < ? THEN 1 ELSE 0 END AS overdue
     FROM lib_loans l JOIN lib_copies c ON c.id = l.copy_id JOIN lib_books b ON b.id = c.book_id
     JOIN lib_readers r ON r.id = l.reader_id WHERE l.id = ?`,
    today(), id,
  );
  if (!row) throw notFound('Préstamo no encontrado');
  const fines = db.all('SELECT * FROM lib_fines WHERE loan_id = ? ORDER BY id', id);
  return { ...row, fines };
}

function activeLoans(db: Db, readerId: number): number {
  return Number(db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM lib_loans WHERE reader_id = ? AND status IN ('active','overdue')",
    readerId,
  )?.n ?? 0);
}

export function registerLibraryRoutes(router: Router, base: string): void {
  const root = `${base}/library`;

  registerResource(router, root, {
    table: 'lib_authors', path: 'authors', tag: 'Library · Catalog', singular: 'autor',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 200 },
      bio: { type: 'string', nullable: true, maxLength: 20_000 },
      birth_date: { type: 'date', nullable: true },
      nationality: { type: 'string', nullable: true, maxLength: 80 },
    },
    defaultSort: 'id', search: ['name', 'bio', 'nationality'], updatedAt: false,
  });

  registerResource(router, root, {
    table: 'lib_publishers', path: 'publishers', tag: 'Library · Catalog', singular: 'editorial',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 160 },
      country: { type: 'string', nullable: true, maxLength: 80 },
      website: { type: 'string', nullable: true, maxLength: 2000 },
    },
    defaultSort: 'id', search: ['name', 'country'], updatedAt: false,
  });

  registerResource(router, root, {
    table: 'lib_genres', path: 'genres', tag: 'Library · Catalog', singular: 'género',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 100 },
      description: { type: 'string', nullable: true, maxLength: 4000 },
    },
    defaultSort: 'id', search: ['name', 'description'], updatedAt: false,
  });

  registerResource(router, root, {
    table: 'lib_books', path: 'books', tag: 'Library · Catalog', singular: 'libro',
    fields: {
      id: { type: 'integer', readOnly: true },
      isbn: { type: 'string', required: true, maxLength: 30 },
      title: { type: 'string', required: true, maxLength: 300 },
      subtitle: { type: 'string', nullable: true, maxLength: 300 },
      publisher_id: { type: 'integer', nullable: true, min: 1 },
      published_year: { type: 'integer', nullable: true, min: 1450, max: 2100 },
      language: { type: 'string', maxLength: 10 },
      pages: { type: 'integer', nullable: true, min: 1 },
      description: { type: 'string', nullable: true, maxLength: 30_000 },
      cover_url: { type: 'string', nullable: true, maxLength: 2000 },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id', search: ['title', 'subtitle', 'description', 'isbn'], updatedAt: false,
    defaults: { created_at: now },
  });

  registerResource(router, root, {
    table: 'lib_book_authors', path: 'book-authors', tag: 'Library · Catalog', singular: 'autor de libro',
    fields: {
      id: { type: 'integer', readOnly: true },
      book_id: { type: 'integer', required: true, min: 1 },
      author_id: { type: 'integer', required: true, min: 1 },
      author_role: { type: 'string', enum: ['author', 'translator', 'editor'] },
    },
    defaultSort: 'id', updatedAt: false,
  });

  registerResource(router, root, {
    table: 'lib_book_genres', path: 'book-genres', tag: 'Library · Catalog', singular: 'género de libro',
    fields: {
      id: { type: 'integer', readOnly: true },
      book_id: { type: 'integer', required: true, min: 1 },
      genre_id: { type: 'integer', required: true, min: 1 },
    },
    defaultSort: 'id', updatedAt: false,
  });

  registerResource(router, root, {
    table: 'lib_copies', path: 'copies', tag: 'Library · Copies', singular: 'ejemplar',
    fields: {
      id: { type: 'integer', readOnly: true },
      book_id: { type: 'integer', required: true, min: 1 },
      barcode: { type: 'string', required: true, maxLength: 80 },
      status: { type: 'string', enum: ['available', 'on_loan', 'reserved', 'maintenance', 'lost'] },
      acquired_at: { type: 'date', required: true },
      shelf: { type: 'string', nullable: true, maxLength: 40 },
    },
    defaultSort: 'id', search: ['barcode', 'shelf'], updatedAt: false,
  });

  registerResource(router, root, {
    table: 'lib_readers', path: 'readers', tag: 'Library · Readers', singular: 'lector',
    fields: {
      id: { type: 'integer', readOnly: true },
      user_id: { type: 'integer', nullable: true, min: 1 },
      card_number: { type: 'string', required: true, maxLength: 60 },
      full_name: { type: 'string', required: true, maxLength: 200 },
      email: { type: 'email', required: true, maxLength: 254 },
      phone: { type: 'string', nullable: true, maxLength: 40 },
      joined_at: { type: 'date', required: true },
      status: { type: 'string', enum: ['active', 'suspended', 'expired'] },
    },
    defaultSort: 'id', search: ['full_name', 'email', 'card_number'], updatedAt: false,
  });

  registerResource(router, root, {
    table: 'lib_fines', path: 'fines', tag: 'Library · Fines', singular: 'multa',
    fields: {
      id: { type: 'integer', readOnly: true },
      loan_id: { type: 'integer', required: true, min: 1 },
      reader_id: { type: 'integer', required: true, min: 1 },
      amount_cents: { type: 'integer', required: true, min: 1 },
      reason: { type: 'string', required: true, maxLength: 500 },
      status: { type: 'string', enum: ['unpaid', 'paid', 'waived'] },
      issued_at: { type: 'datetime', readOnly: true },
      paid_at: { type: 'datetime', nullable: true },
    },
    defaultSort: 'id', updatedAt: false, defaults: { issued_at: now }, allowDelete: false,
  });

  // ---------- Búsqueda de catálogo ----------
  router.add('GET', `${root}/books/search`, (ctx) => {
    const db = dbOf(ctx);
    const app = (ctx as RequestContext).app;
    const pagination = parsePagination(ctx, app.config.maxPageSize);
    const allowed = new Set(['page', 'per_page', 'limit', 'offset', 'q', 'author', 'author_id', 'genre', 'genre_id', 'language', 'available', 'sort', 'order']);
    for (const key of ctx.query.keys()) if (!allowed.has(key)) throw validationError([{ field: key, message: 'parámetro desconocido' }]);
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    const q = ctx.query.get('q');
    if (q) {
      clauses.push("(LOWER(b.title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(COALESCE(b.description,'')) LIKE LOWER(?) ESCAPE '\\' OR LOWER(b.isbn) LIKE LOWER(?) ESCAPE '\\')");
      const like = `%${escapeLike(q)}%`; params.push(like, like, like);
    }
    const author = ctx.query.get('author');
    if (author) { clauses.push("LOWER(a.name) LIKE LOWER(?) ESCAPE '\\'"); params.push(`%${escapeLike(author)}%`); }
    const authorId = ctx.query.get('author_id');
    if (authorId) { clauses.push('a.id = ?'); params.push(Number(authorId)); }
    const genre = ctx.query.get('genre');
    if (genre) { clauses.push('LOWER(g.name) = LOWER(?)'); params.push(genre); }
    const genreId = ctx.query.get('genre_id');
    if (genreId) { clauses.push('g.id = ?'); params.push(Number(genreId)); }
    const language = ctx.query.get('language');
    if (language) { clauses.push('b.language = ?'); params.push(language); }
    const available = ctx.query.get('available');
    if (available === 'true' || available === '1') {
      clauses.push("EXISTS (SELECT 1 FROM lib_copies c2 WHERE c2.book_id = b.id AND c2.status = 'available')");
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const sortRaw = ctx.query.get('sort') ?? 'b.title';
    const sort = sortRaw.startsWith('-') ? sortRaw.slice(1) : sortRaw;
    if (!['b.title', 'b.published_year', 'b.id'].includes(sort) && !['title', 'published_year', 'id'].includes(sort)) {
      throw validationError([{ field: 'sort', message: 'campo no ordenable' }]);
    }
    const sortColumn = sort.includes('.') ? sort : `b.${sort}`;
    const orderRaw = ctx.query.get('order');
    if (orderRaw && !['asc', 'desc'].includes(orderRaw)) throw validationError([{ field: 'order', message: 'use asc o desc' }]);
    const direction = (orderRaw ?? (sortRaw.startsWith('-') ? 'desc' : 'asc')).toUpperCase();
    const joins = ` FROM lib_books b
      LEFT JOIN lib_book_authors ba ON ba.book_id = b.id
      LEFT JOIN lib_authors a ON a.id = ba.author_id
      LEFT JOIN lib_book_genres bg ON bg.book_id = b.id
      LEFT JOIN lib_genres g ON g.id = bg.genre_id`;
    const countRow = db.get<{ n: number }>(`SELECT COUNT(DISTINCT b.id) AS n${joins}${where}`, ...params);
    const total = Number(countRow?.n ?? 0);
    const rows = db.all<Record<string, unknown>>(
      `SELECT b.*,
        (SELECT GROUP_CONCAT(a2.name, ', ') FROM lib_book_authors ba2 JOIN lib_authors a2 ON a2.id = ba2.author_id WHERE ba2.book_id = b.id) AS authors,
        (SELECT GROUP_CONCAT(g2.name, ', ') FROM lib_book_genres bg2 JOIN lib_genres g2 ON g2.id = bg2.genre_id WHERE bg2.book_id = b.id) AS genres,
        (SELECT COUNT(*) FROM lib_copies c3 WHERE c3.book_id = b.id AND c3.status = 'available') AS available_copies
       ${joins}${where} GROUP BY b.id ORDER BY ${sortColumn} ${direction}, b.id LIMIT ? OFFSET ?`,
      ...params, pagination.perPage, pagination.offset,
    );
    sendJson(ctx, 200, { data: rows, meta: paginationMeta(pagination, total) });
  }, { summary: 'Búsqueda de libros por texto, autor, género y disponibilidad', tag: 'Library · Catalog' });

  router.add('GET', `${root}/books/:id/details`, (ctx) => {
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    const book = db.get<Record<string, unknown>>(
      `SELECT b.*, p.name AS publisher_name FROM lib_books b LEFT JOIN lib_publishers p ON p.id = b.publisher_id WHERE b.id = ?`,
      id,
    );
    if (!book) throw notFound('Libro no encontrado');
    const authors = db.all(
      `SELECT a.*, ba.author_role FROM lib_authors a JOIN lib_book_authors ba ON ba.author_id = a.id WHERE ba.book_id = ? ORDER BY a.name`,
      id,
    );
    const genres = db.all(
      `SELECT g.* FROM lib_genres g JOIN lib_book_genres bg ON bg.genre_id = g.id WHERE bg.book_id = ? ORDER BY g.name`,
      id,
    );
    const copies = db.all('SELECT * FROM lib_copies WHERE book_id = ? ORDER BY id', id);
    const reservations = db.all(
      `SELECT r.id, r.status, r.reserved_at, r.expires_at, rd.full_name AS reader_name
       FROM lib_reservations r JOIN lib_readers rd ON rd.id = r.reader_id
       WHERE r.book_id = ? AND r.status IN ('pending','ready') ORDER BY r.id`,
      id,
    );
    sendJson(ctx, 200, { data: { ...book, authors, genres, copies, active_reservations: reservations } });
  }, { summary: 'Libro con autores, géneros, ejemplares y reservas', tag: 'Library · Catalog' });

  router.add('GET', `${root}/books/:id/availability`, (ctx) => {
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    if (!db.get('SELECT 1 AS x FROM lib_books WHERE id = ?', id)) throw notFound('Libro no encontrado');
    const counts = db.all<{ status: string; total: number }>('SELECT status, COUNT(*) AS total FROM lib_copies WHERE book_id = ? GROUP BY status', id);
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.total]));
    sendJson(ctx, 200, {
      data: {
        book_id: id,
        total_copies: Object.values(byStatus).reduce((a, b) => a + Number(b), 0),
        available: Number(byStatus.available ?? 0),
        on_loan: Number(byStatus.on_loan ?? 0),
        reserved: Number(byStatus.reserved ?? 0),
        maintenance: Number(byStatus.maintenance ?? 0),
        lost: Number(byStatus.lost ?? 0),
      },
    });
  }, { summary: 'Disponibilidad de ejemplares de un libro', tag: 'Library · Copies' });

  router.add('GET', `${root}/authors/:id/books`, (ctx) => {
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    if (!db.get('SELECT 1 AS x FROM lib_authors WHERE id = ?', id)) throw notFound('Autor no encontrado');
    const rows = db.all(
      `SELECT b.*, ba.author_role FROM lib_books b JOIN lib_book_authors ba ON ba.book_id = b.id
       WHERE ba.author_id = ? ORDER BY b.title`,
      id,
    );
    sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
  }, { summary: 'Libros de un autor', tag: 'Library · Catalog' });

  // ---------- Préstamos ----------
  router.add('GET', `${root}/loans`, (ctx) => {
    const db = dbOf(ctx);
    const app = (ctx as RequestContext).app;
    const allowed = new Set(['page', 'per_page', 'limit', 'offset', 'status', 'reader_id', 'copy_id', 'overdue', 'sort', 'order']);
    for (const key of ctx.query.keys()) if (!allowed.has(key)) throw validationError([{ field: key, message: 'parámetro desconocido' }]);
    const pagination = parsePagination(ctx, app.config.maxPageSize);
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    const status = ctx.query.get('status');
    if (status) {
      if (!['active', 'returned', 'overdue', 'lost'].includes(status)) throw validationError([{ field: 'status', message: 'valor inválido' }]);
      clauses.push('l.status = ?'); params.push(status);
    }
    const reader = ctx.query.get('reader_id');
    if (reader) { clauses.push('l.reader_id = ?'); params.push(Number(reader)); }
    const copy = ctx.query.get('copy_id');
    if (copy) { clauses.push('l.copy_id = ?'); params.push(Number(copy)); }
    if (['true', '1'].includes(ctx.query.get('overdue') ?? '')) {
      clauses.push("l.status IN ('active','overdue') AND l.due_at < ?"); params.push(today());
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const sortRaw = ctx.query.get('sort') ?? 'id';
    const sort = sortRaw.startsWith('-') ? sortRaw.slice(1) : sortRaw;
    if (!['id', 'loaned_at', 'due_at', 'returned_at'].includes(sort)) throw validationError([{ field: 'sort', message: 'campo no ordenable' }]);
    const orderRaw = ctx.query.get('order');
    if (orderRaw && !['asc', 'desc'].includes(orderRaw)) throw validationError([{ field: 'order', message: 'use asc o desc' }]);
    const direction = (orderRaw ?? (sortRaw.startsWith('-') ? 'desc' : 'asc')).toUpperCase();
    const from = ` FROM lib_loans l JOIN lib_copies c ON c.id = l.copy_id JOIN lib_books b ON b.id = c.book_id
      JOIN lib_readers r ON r.id = l.reader_id${where}`;
    const total = Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n${from}`, ...params)?.n ?? 0);
    const rows = db.all<Record<string, unknown>>(
      `SELECT l.*, c.barcode, b.title AS book_title, r.full_name AS reader_name, r.card_number,
        CASE WHEN l.status IN ('active','overdue') AND l.due_at < ? THEN 1 ELSE 0 END AS overdue
       ${from} ORDER BY l.${sort} ${direction}, l.id ASC LIMIT ? OFFSET ?`,
      today(), ...params, pagination.perPage, pagination.offset,
    );
    sendJson(ctx, 200, { data: rows, meta: paginationMeta(pagination, total) });
  }, { summary: 'Lista préstamos con filtros y cálculo de retraso', tag: 'Library · Loans' });

  router.add('GET', `${root}/loans/:id`, (ctx) => {
    sendJson(ctx, 200, { data: loanDetails(ctx, Number(ctx.params.id)) });
  }, { summary: 'Detalle de préstamo con multas', tag: 'Library · Loans' });

  router.add('POST', `${root}/loans`, async (ctx) => {
    const db = dbOf(ctx);
    const body = await readJsonBody(ctx);
    const input = new Validator(body, ['copy_id', 'book_id', 'reader_id', 'days']);
    const copyId = input.integer('copy_id', { min: 1 });
    const bookId = input.integer('book_id', { min: 1 });
    const readerId = input.integer('reader_id', { required: true, min: 1 })!;
    const days = input.integer('days', { min: 1, max: 60, default: 14 }) ?? 14;
    input.done();
    if (!copyId && !bookId) throw validationError([{ field: 'copy_id', message: 'copy_id o book_id es obligatorio' }]);
    const reader = db.get<{ id: number; status: string; full_name: string }>('SELECT id, status, full_name FROM lib_readers WHERE id = ?', readerId);
    if (!reader) throw notFound('Lector no encontrado');
    if (reader.status !== 'active') throw conflict('El lector no está activo');
    if (activeLoans(db, readerId) >= 5) throw conflict('El lector alcanzó el máximo de 5 préstamos activos');
    let copy: { id: number; status: string; book_id: number; barcode: string } | undefined;
    if (copyId) {
      copy = db.get('SELECT id, status, book_id, barcode FROM lib_copies WHERE id = ?', copyId);
    } else {
      copy = db.get("SELECT id, status, book_id, barcode FROM lib_copies WHERE book_id = ? AND status = 'available' ORDER BY id LIMIT 1", bookId!);
      if (!copy) throw conflict('No hay ejemplares disponibles para el libro');
    }
    if (!copy) throw notFound('Ejemplar no encontrado');
    if (copy.status !== 'available') throw conflict(`El ejemplar no está disponible (${copy.status})`);
    const due = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const loanId = db.transaction(() => {
      const id = db.insert('lib_loans', {
        copy_id: copy.id, reader_id: readerId, loaned_at: today(), due_at: due,
        returned_at: null, status: 'active', fine_cents: 0,
      });
      db.run("UPDATE lib_copies SET status = 'on_loan' WHERE id = ?", copy.id);
      return id;
    });
    sendJson(ctx, 201, { data: loanDetails(ctx, loanId) }, { Location: `${root}/loans/${loanId}` });
  }, { summary: 'Presta un ejemplar a un lector', tag: 'Library · Loans' });

  router.add('POST', `${root}/loans/:id/return`, async (ctx) => {
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    const loan = db.get<{ id: number; copy_id: number; reader_id: number; due_at: string; status: string }>(
      'SELECT id, copy_id, reader_id, due_at, status FROM lib_loans WHERE id = ?', id,
    );
    if (!loan) throw notFound('Préstamo no encontrado');
    if (!['active', 'overdue'].includes(loan.status)) throw conflict('El préstamo ya está cerrado');
    const daysLate = Math.max(0, Math.floor((Date.parse(today()) - Date.parse(loan.due_at)) / 86_400_000));
    const fine = daysLate * 25;
    db.transaction(() => {
      db.run("UPDATE lib_loans SET status = 'returned', returned_at = ?, fine_cents = ? WHERE id = ?", now(), fine, id);
      db.run("UPDATE lib_copies SET status = 'available' WHERE id = ?", loan.copy_id);
      if (fine > 0) {
        db.insert('lib_fines', {
          loan_id: id, reader_id: loan.reader_id, amount_cents: fine,
          reason: `Retraso de ${daysLate} días en la devolución`, status: 'unpaid', issued_at: now(), paid_at: null,
        });
      }
    });
    sendJson(ctx, 200, { data: loanDetails(ctx, id), meta: { days_late: daysLate, fine_cents: fine } });
  }, { summary: 'Devuelve un ejemplar y calcula multa', tag: 'Library · Loans' });

  router.add('POST', `${root}/loans/:id/renew`, async (ctx) => {
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    const loan = db.get<{ due_at: string; status: string; copy_id: number }>('SELECT due_at, status, copy_id FROM lib_loans WHERE id = ?', id);
    if (!loan) throw notFound('Préstamo no encontrado');
    if (!['active', 'overdue'].includes(loan.status)) throw conflict('El préstamo ya está cerrado');
    const reservation = db.get('SELECT 1 AS x FROM lib_reservations r JOIN lib_copies c ON c.book_id = r.book_id WHERE c.id = ? AND r.status IN (\'pending\',\'ready\')', loan.copy_id);
    if (reservation) throw conflict('No se puede renovar: hay reservas pendientes');
    const newDue = new Date(Date.parse(loan.due_at) + 14 * 86_400_000).toISOString().slice(0, 10);
    db.run('UPDATE lib_loans SET due_at = ?, status = ? WHERE id = ?', newDue, 'active', id);
    sendJson(ctx, 200, { data: loanDetails(ctx, id) });
  }, { summary: 'Renueva un préstamo 14 días si no hay reservas', tag: 'Library · Loans' });

  // ---------- Reservas ----------
  router.add('GET', `${root}/reservations`, (ctx) => {
    const status = ctx.query.get('status');
    const rows = status
      ? dbOf(ctx).all(
        `SELECT r.*, b.title AS book_title, rd.full_name AS reader_name FROM lib_reservations r
         JOIN lib_books b ON b.id = r.book_id JOIN lib_readers rd ON rd.id = r.reader_id
         WHERE r.status = ? ORDER BY r.id DESC LIMIT 200`, status,
      )
      : dbOf(ctx).all(
        `SELECT r.*, b.title AS book_title, rd.full_name AS reader_name FROM lib_reservations r
         JOIN lib_books b ON b.id = r.book_id JOIN lib_readers rd ON rd.id = r.reader_id
         ORDER BY r.id DESC LIMIT 200`,
      );
    sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
  }, { summary: 'Lista reservas', tag: 'Library · Reservations' });

  router.add('POST', `${root}/reservations`, async (ctx) => {
    const db = dbOf(ctx);
    const body = await readJsonBody(ctx);
    const input = new Validator(body, ['book_id', 'reader_id', 'expires_in_days']);
    const bookId = input.integer('book_id', { required: true, min: 1 })!;
    const readerId = input.integer('reader_id', { required: true, min: 1 })!;
    const days = input.integer('expires_in_days', { min: 1, max: 60, default: 7 }) ?? 7;
    input.done();
    if (!db.get('SELECT 1 AS x FROM lib_books WHERE id = ?', bookId)) throw notFound('Libro no encontrado');
    const reader = db.get<{ status: string }>('SELECT status FROM lib_readers WHERE id = ?', readerId);
    if (!reader) throw notFound('Lector no encontrado');
    if (reader.status !== 'active') throw conflict('El lector no está activo');
    try {
      const id = db.insert('lib_reservations', {
        book_id: bookId, reader_id: readerId, status: 'pending',
        reserved_at: now(), expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      });
      sendJson(ctx, 201, { data: db.get('SELECT * FROM lib_reservations WHERE id = ?', id) }, { Location: `${root}/reservations/${id}` });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) throw conflict('Ya existe una reserva activa de este lector para el libro');
      throw error;
    }
  }, { summary: 'Crea una reserva', tag: 'Library · Reservations' });

  router.add('POST', `${root}/reservations/:id/cancel`, (ctx) => {
    const id = Number(ctx.params.id);
    const db = dbOf(ctx);
    const row = db.get<{ status: string }>('SELECT status FROM lib_reservations WHERE id = ?', id);
    if (!row) throw notFound('Reserva no encontrada');
    if (!['pending', 'ready'].includes(row.status)) throw conflict('La reserva ya está cerrada');
    db.run("UPDATE lib_reservations SET status = 'cancelled' WHERE id = ?", id);
    sendJson(ctx, 200, { data: db.get('SELECT * FROM lib_reservations WHERE id = ?', id) });
  }, { summary: 'Cancela una reserva', tag: 'Library · Reservations' });

  // ---------- Lectores, multas y resumen ----------
  router.add('GET', `${root}/readers/:id/loans`, (ctx) => {
    const readerId = Number(ctx.params.id);
    const db = dbOf(ctx);
    if (!db.get('SELECT 1 AS x FROM lib_readers WHERE id = ?', readerId)) throw notFound('Lector no encontrado');
    const rows = db.all(
      `SELECT l.*, c.barcode, b.title AS book_title,
        CASE WHEN l.status IN ('active','overdue') AND l.due_at < ? THEN 1 ELSE 0 END AS overdue
       FROM lib_loans l JOIN lib_copies c ON c.id = l.copy_id JOIN lib_books b ON b.id = c.book_id
       WHERE l.reader_id = ? ORDER BY l.id DESC LIMIT 200`,
      today(), readerId,
    );
    sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
  }, { summary: 'Préstamos de un lector', tag: 'Library · Readers' });

  router.add('GET', `${root}/readers/:id/fines`, (ctx) => {
    const readerId = Number(ctx.params.id);
    const db = dbOf(ctx);
    if (!db.get('SELECT 1 AS x FROM lib_readers WHERE id = ?', readerId)) throw notFound('Lector no encontrado');
    const rows = db.all('SELECT * FROM lib_fines WHERE reader_id = ? ORDER BY id DESC', readerId);
    const totals = db.get('SELECT COALESCE(SUM(CASE WHEN status = \'unpaid\' THEN amount_cents ELSE 0 END),0) AS unpaid FROM lib_fines WHERE reader_id = ?', readerId);
    sendJson(ctx, 200, { data: rows, meta: { total: rows.length, unpaid_cents: totals?.unpaid ?? 0 } });
  }, { summary: 'Multas de un lector', tag: 'Library · Readers' });

  router.add('GET', `${root}/readers/:id/summary`, (ctx) => {
    const readerId = Number(ctx.params.id);
    const db = dbOf(ctx);
    const reader = db.get('SELECT * FROM lib_readers WHERE id = ?', readerId);
    if (!reader) throw notFound('Lector no encontrado');
    const active = Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM lib_loans WHERE reader_id = ? AND status IN ('active','overdue')", readerId)?.n ?? 0);
    const overdue = Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM lib_loans WHERE reader_id = ? AND status IN ('active','overdue') AND due_at < ?", readerId, today())?.n ?? 0);
    const unpaid = Number(db.get<{ n: number }>("SELECT COALESCE(SUM(amount_cents),0) AS n FROM lib_fines WHERE reader_id = ? AND status = 'unpaid'", readerId)?.n ?? 0);
    const reservations = Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM lib_reservations WHERE reader_id = ? AND status IN ('pending','ready')", readerId)?.n ?? 0);
    sendJson(ctx, 200, { data: { reader, active_loans: active, overdue_loans: overdue, unpaid_fines_cents: unpaid, active_reservations: reservations } });
  }, { summary: 'Resumen de un lector', tag: 'Library · Readers' });

  const setFineStatus = (status: 'paid' | 'waived') => (ctx: Ctx) => {
    const db = dbOf(ctx);
    const fine = db.get<{ id: number; status: string }>('SELECT id, status FROM lib_fines WHERE id = ?', Number(ctx.params.id));
    if (!fine) throw notFound('Multa no encontrada');
    if (fine.status !== 'unpaid') throw conflict(`La multa ya está ${fine.status}`);
    db.run('UPDATE lib_fines SET status = ?, paid_at = ? WHERE id = ?', status, status === 'paid' ? now() : null, fine.id);
    sendJson(ctx, 200, { data: db.get('SELECT * FROM lib_fines WHERE id = ?', fine.id) });
  };
  router.add('POST', `${root}/fines/:id/pay`, setFineStatus('paid'), { summary: 'Paga una multa', tag: 'Library · Fines' });
  router.add('POST', `${root}/fines/:id/waive`, setFineStatus('waived'), { summary: 'Condona una multa', tag: 'Library · Fines' });

  router.add('GET', `${root}/stats`, (ctx) => {
    const db = dbOf(ctx);
    sendJson(ctx, 200, {
      data: {
        books: db.count('lib_books'),
        copies: db.count('lib_copies'),
        readers: db.count('lib_readers'),
        active_loans: Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM lib_loans WHERE status IN ('active','overdue')")?.n ?? 0),
        overdue_loans: Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM lib_loans WHERE status IN ('active','overdue') AND due_at < ?", today())?.n ?? 0),
        active_reservations: Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM lib_reservations WHERE status IN ('pending','ready')")?.n ?? 0),
        unpaid_fines_cents: Number(db.get<{ n: number }>("SELECT COALESCE(SUM(amount_cents),0) AS n FROM lib_fines WHERE status = 'unpaid'")?.n ?? 0),
      },
    });
  }, { summary: 'Estadísticas de la biblioteca', tag: 'Library · Reports' });
}
