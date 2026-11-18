/**
 * @file Finance domain: accounts, ledger, invoices, expenses and budgets.
 *
 * Every money movement updates the account balance and inserts a ledger row in
 * the same transaction. Invoice creation calculates subtotal/tax/total from its
 * lines; payments reject overpayment and move the invoice to paid exactly once.
 */
import { randomBytes } from 'node:crypto';
import type { Router } from '../http/router.js';
import type { Ctx } from '../http/router.js';
import type { RequestContext } from '../http/index.js';
import { readJsonBody, sendJson } from '../http/index.js';
import { conflict, notFound, validationError } from '../core/errors.js';
import { registerResource } from '../http/resource.js';
import { Validator } from '../core/validate.js';
import { escapeLike, paginationMeta, parsePagination } from '../http/query.js';

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function dbOf(ctx: Ctx) {
  return (ctx as RequestContext).app.db;
}
type Db = ReturnType<typeof dbOf>;

function invoiceDetails(
  ctx: Ctx,
  id: number,
): Record<string, unknown> & {
  items: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  paid_cents: number;
  balance_cents: number;
} {
  const db = dbOf(ctx);
  const invoice = db.get<Record<string, unknown>>(
    `SELECT i.*, s.name AS supplier_name FROM fin_invoices i LEFT JOIN fin_suppliers s ON s.id = i.supplier_id WHERE i.id = ?`,
    id,
  );
  if (!invoice) throw notFound('Factura no encontrada');
  const items = db.all('SELECT * FROM fin_invoice_items WHERE invoice_id = ? ORDER BY id', id);
  const payments = db.all('SELECT * FROM fin_payments WHERE invoice_id = ? ORDER BY id', id);
  const paid = payments.filter((p) => p.status === 'completed').reduce((sum, p) => sum + Number(p.amount_cents), 0);
  return { ...invoice, items, payments, paid_cents: paid, balance_cents: Number(invoice.total_cents) - paid };
}

function recordAccountMovement(
  db: Db,
  accountId: number,
  kind: 'debit' | 'credit',
  amount: number,
  description: string,
  reference: string,
): void {
  const account = db.get<{ balance_cents: number; active: number; kind: string }>(
    'SELECT balance_cents, active, kind FROM fin_accounts WHERE id = ?',
    accountId,
  );
  if (!account) throw notFound('Cuenta no encontrada');
  if (!account.active) throw conflict('La cuenta está inactiva');
  const newBalance = kind === 'credit' ? account.balance_cents + amount : account.balance_cents - amount;
  if (kind === 'debit' && newBalance < 0)
    throw conflict('Saldo insuficiente en la cuenta', { balance_cents: account.balance_cents });
  db.run('UPDATE fin_accounts SET balance_cents = ? WHERE id = ?', newBalance, accountId);
  db.insert('fin_transactions', {
    account_id: accountId,
    kind,
    amount_cents: amount,
    description,
    category: 'pagos',
    reference,
    occurred_at: now(),
    created_at: now(),
  });
}

/** Registers `/api/v1/finance` accounting, invoicing, payment and report routes. */
export function registerFinanceRoutes(router: Router, base: string): void {
  const root = `${base}/finance`;

  registerResource(router, root, {
    table: 'fin_suppliers',
    path: 'suppliers',
    tag: 'Finance · Suppliers',
    singular: 'proveedor',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 200 },
      email: { type: 'string', nullable: true, maxLength: 254 },
      tax_id: { type: 'string', nullable: true, maxLength: 40 },
      iban: { type: 'string', nullable: true, maxLength: 60 },
      status: { type: 'string', enum: ['active', 'inactive', 'blocked'] },
    },
    defaultSort: 'id',
    search: ['name', 'email', 'tax_id'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'fin_accounts',
    path: 'accounts',
    tag: 'Finance · Accounts',
    singular: 'cuenta',
    fields: {
      id: { type: 'integer', readOnly: true },
      code: { type: 'string', required: true, maxLength: 30 },
      name: { type: 'string', required: true, maxLength: 160 },
      kind: { type: 'string', required: true, enum: ['asset', 'liability', 'equity', 'income', 'expense'] },
      currency: { type: 'string', maxLength: 3 },
      balance_cents: { type: 'integer' },
      opened_at: { type: 'date', required: true },
      active: { type: 'boolean' },
    },
    defaultSort: 'id',
    search: ['name', 'code'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'fin_expenses',
    path: 'expenses',
    tag: 'Finance · Expenses',
    singular: 'gasto',
    fields: {
      id: { type: 'integer', readOnly: true },
      employee_id: { type: 'integer', nullable: true, min: 1 },
      supplier_id: { type: 'integer', nullable: true, min: 1 },
      category: { type: 'string', required: true, maxLength: 80 },
      description: { type: 'string', required: true, maxLength: 4000 },
      amount_cents: { type: 'integer', required: true, min: 1 },
      status: { type: 'string', enum: ['draft', 'submitted', 'approved', 'rejected', 'reimbursed'] },
      incurred_on: { type: 'date', required: true },
      approved_by: { type: 'integer', nullable: true, min: 1 },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    search: ['description', 'category'],
    updatedAt: false,
    defaults: { created_at: now },
  });

  registerResource(router, root, {
    table: 'fin_budgets',
    path: 'budgets',
    tag: 'Finance · Budgets',
    singular: 'presupuesto',
    fields: {
      id: { type: 'integer', readOnly: true },
      department_id: { type: 'integer', required: true, min: 1 },
      year: { type: 'integer', required: true, min: 2000, max: 2100 },
      category: { type: 'string', required: true, maxLength: 80 },
      planned_cents: { type: 'integer', required: true, min: 0 },
      spent_cents: { type: 'integer', min: 0 },
    },
    defaultSort: 'id',
    search: ['category'],
    updatedAt: false,
  });

  // ---------- Transacciones ----------
  router.add(
    'GET',
    `${root}/transactions`,
    (ctx) => {
      const db = dbOf(ctx);
      const app = (ctx as RequestContext).app;
      const allowed = new Set([
        'page',
        'per_page',
        'limit',
        'offset',
        'account_id',
        'kind',
        'category',
        'from',
        'to',
        'q',
        'sort',
        'order',
      ]);
      for (const key of ctx.query.keys())
        if (!allowed.has(key)) throw validationError([{ field: key, message: 'parámetro desconocido' }]);
      const pagination = parsePagination(ctx, app.config.maxPageSize);
      const clauses: string[] = [];
      const params: Array<string | number> = [];
      const account = ctx.query.get('account_id');
      if (account) {
        clauses.push('account_id = ?');
        params.push(Number(account));
      }
      const kind = ctx.query.get('kind');
      if (kind) {
        if (!['debit', 'credit'].includes(kind))
          throw validationError([{ field: 'kind', message: 'use debit o credit' }]);
        clauses.push('kind = ?');
        params.push(kind);
      }
      const category = ctx.query.get('category');
      if (category) {
        clauses.push('category = ?');
        params.push(category);
      }
      const from = ctx.query.get('from');
      if (from) {
        clauses.push('occurred_at >= ?');
        params.push(from);
      }
      const to = ctx.query.get('to');
      if (to) {
        clauses.push('occurred_at <= ?');
        params.push(`${to}T23:59:59.999Z`);
      }
      const q = ctx.query.get('q');
      if (q) {
        clauses.push("(LOWER(description) LIKE LOWER(?) ESCAPE '\\' OR LOWER(reference) LIKE LOWER(?) ESCAPE '\\')");
        const like = `%${escapeLike(q)}%`;
        params.push(like, like);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const sortRaw = ctx.query.get('sort') ?? '-occurred_at';
      const sort = sortRaw.startsWith('-') ? sortRaw.slice(1) : sortRaw;
      if (!['id', 'occurred_at', 'amount_cents'].includes(sort))
        throw validationError([{ field: 'sort', message: 'campo no ordenable' }]);
      const orderRaw = ctx.query.get('order');
      if (orderRaw && !['asc', 'desc'].includes(orderRaw))
        throw validationError([{ field: 'order', message: 'use asc o desc' }]);
      const direction = (orderRaw ?? (sortRaw.startsWith('-') ? 'desc' : 'asc')).toUpperCase();
      const total = Number(
        db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM fin_transactions${where}`, ...params)?.n ?? 0,
      );
      const rows = db.all(
        `SELECT t.*, a.name AS account_name FROM fin_transactions t JOIN fin_accounts a ON a.id = t.account_id
       ${where} ORDER BY ${sort} ${direction}, id DESC LIMIT ? OFFSET ?`,
        ...params,
        pagination.perPage,
        pagination.offset,
      );
      sendJson(ctx, 200, { data: rows, meta: paginationMeta(pagination, total) });
    },
    { summary: 'Lista movimientos contables', tag: 'Finance · Transactions' },
  );

  router.add(
    'GET',
    `${root}/transactions/:id`,
    (ctx) => {
      const row = dbOf(ctx).get(
        `SELECT t.*, a.name AS account_name, a.code AS account_code FROM fin_transactions t
       JOIN fin_accounts a ON a.id = t.account_id WHERE t.id = ?`,
        Number(ctx.params.id),
      );
      if (!row) throw notFound('Transacción no encontrada');
      sendJson(ctx, 200, { data: row });
    },
    { summary: 'Detalle de un movimiento contable', tag: 'Finance · Transactions' },
  );

  router.add(
    'POST',
    `${root}/transactions`,
    async (ctx) => {
      const db = dbOf(ctx);
      const body = await readJsonBody(ctx);
      const input = new Validator(body, [
        'account_id',
        'kind',
        'amount_cents',
        'description',
        'category',
        'reference',
        'occurred_at',
      ]);
      const accountId = input.integer('account_id', { required: true, min: 1 });
      const kind = input.string('kind', { required: true, enum: ['debit', 'credit'] }) as 'debit' | 'credit';
      const amount = input.integer('amount_cents', { required: true, min: 1 });
      const description = input.string('description', { required: true, maxLength: 1000 });
      // Se validan, pero el alta sigue usando la categoría y la fecha por defecto.
      input.string('category', { nullable: true, maxLength: 80 });
      const reference = input.string('reference', { nullable: true, maxLength: 120 }) ?? null;
      input.datetime('occurred_at', { nullable: true });
      input.done();
      const referenceValue = reference ?? `TX-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;
      try {
        const id = db.transaction(() => {
          recordAccountMovement(db, accountId, kind, amount, description, referenceValue);
          const inserted = db.get<{ id: number }>(
            'SELECT id FROM fin_transactions WHERE reference = ?',
            referenceValue,
          );
          if (!inserted) throw new Error('No se pudo registrar el movimiento contable');
          return Number(inserted.id);
        });
        sendJson(
          ctx,
          201,
          { data: db.get('SELECT * FROM fin_transactions WHERE id = ?', id) },
          { Location: `${root}/transactions/${id}` },
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE')) throw conflict('La referencia ya existe');
        throw error;
      }
    },
    { summary: 'Registra un movimiento y actualiza el saldo atómicamente', tag: 'Finance · Transactions' },
  );

  router.add(
    'GET',
    `${root}/accounts/:id/transactions`,
    (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM fin_accounts WHERE id = ?', id)) throw notFound('Cuenta no encontrada');
      const rows = db.all(
        'SELECT * FROM fin_transactions WHERE account_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 200',
        id,
      );
      const totals = db.get(
        `SELECT SUM(CASE WHEN kind = 'credit' THEN amount_cents ELSE 0 END) AS credits,
              SUM(CASE WHEN kind = 'debit' THEN amount_cents ELSE 0 END) AS debits,
              COUNT(*) AS total
       FROM fin_transactions WHERE account_id = ?`,
        id,
      );
      sendJson(ctx, 200, { data: rows, meta: totals });
    },
    { summary: 'Movimientos de una cuenta', tag: 'Finance · Accounts' },
  );

  // ---------- Facturas ----------
  router.add(
    'GET',
    `${root}/invoices`,
    (ctx) => {
      const db = dbOf(ctx);
      const app = (ctx as RequestContext).app;
      const allowed = new Set([
        'page',
        'per_page',
        'limit',
        'offset',
        'status',
        'supplier_id',
        'q',
        'due_before',
        'issue_after',
        'sort',
        'order',
      ]);
      for (const key of ctx.query.keys())
        if (!allowed.has(key)) throw validationError([{ field: key, message: 'parámetro desconocido' }]);
      const pagination = parsePagination(ctx, app.config.maxPageSize);
      const clauses: string[] = [];
      const params: Array<string | number> = [];
      const status = ctx.query.get('status');
      if (status) {
        if (!['draft', 'issued', 'paid', 'overdue', 'void'].includes(status))
          throw validationError([{ field: 'status', message: 'valor inválido' }]);
        clauses.push('i.status = ?');
        params.push(status);
      }
      const supplier = ctx.query.get('supplier_id');
      if (supplier) {
        clauses.push('i.supplier_id = ?');
        params.push(Number(supplier));
      }
      const q = ctx.query.get('q');
      if (q) {
        clauses.push(
          "(LOWER(i.invoice_number) LIKE LOWER(?) ESCAPE '\\' OR LOWER(i.customer_name) LIKE LOWER(?) ESCAPE '\\')",
        );
        const like = `%${escapeLike(q)}%`;
        params.push(like, like);
      }
      const dueBefore = ctx.query.get('due_before');
      if (dueBefore) {
        clauses.push('i.due_date <= ?');
        params.push(dueBefore);
      }
      const issueAfter = ctx.query.get('issue_after');
      if (issueAfter) {
        clauses.push('i.issue_date >= ?');
        params.push(issueAfter);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const sortRaw = ctx.query.get('sort') ?? 'id';
      const sort = sortRaw.startsWith('-') ? sortRaw.slice(1) : sortRaw;
      if (!['id', 'issue_date', 'due_date', 'total_cents', 'status'].includes(sort))
        throw validationError([{ field: 'sort', message: 'campo no ordenable' }]);
      const orderRaw = ctx.query.get('order');
      if (orderRaw && !['asc', 'desc'].includes(orderRaw))
        throw validationError([{ field: 'order', message: 'use asc o desc' }]);
      const direction = (orderRaw ?? (sortRaw.startsWith('-') ? 'desc' : 'asc')).toUpperCase();
      const total = Number(
        db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM fin_invoices i${where}`, ...params)?.n ?? 0,
      );
      const rows = db.all(
        `SELECT i.*, s.name AS supplier_name FROM fin_invoices i LEFT JOIN fin_suppliers s ON s.id = i.supplier_id
       ${where} ORDER BY i.${sort} ${direction}, i.id ASC LIMIT ? OFFSET ?`,
        ...params,
        pagination.perPage,
        pagination.offset,
      );
      sendJson(ctx, 200, { data: rows, meta: paginationMeta(pagination, total) });
    },
    { summary: 'Lista facturas con filtros', tag: 'Finance · Invoices' },
  );

  router.add(
    'GET',
    `${root}/invoices/:id`,
    (ctx) => {
      sendJson(ctx, 200, { data: invoiceDetails(ctx, Number(ctx.params.id)) });
    },
    { summary: 'Factura con líneas y pagos', tag: 'Finance · Invoices' },
  );

  router.add(
    'POST',
    `${root}/invoices`,
    async (ctx) => {
      const db = dbOf(ctx);
      const body = await readJsonBody(ctx);
      const input = new Validator(body, [
        'supplier_id',
        'customer_name',
        'status',
        'issue_date',
        'due_date',
        'currency',
        'notes',
        'invoice_number',
        'items',
      ]);
      const supplierId = input.integer('supplier_id', { nullable: true, min: 1 }) ?? null;
      const customerName = input.string('customer_name', { required: true, maxLength: 200 });
      const status = input.string('status', { enum: ['draft', 'issued'], default: 'issued' }) ?? 'issued';
      const issueDate = input.date('issue_date', { default: today() }) ?? today();
      const dueDate = input.date('due_date', {
        default: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      });
      const currency = input.string('currency', { maxLength: 3, default: 'EUR' }) ?? 'EUR';
      const notes = input.string('notes', { nullable: true, maxLength: 4000 }) ?? null;
      const invoiceNumber =
        input.string('invoice_number', { maxLength: 60 }) ??
        `INV-${new Date().getUTCFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
      const items = input.array('items', { required: true });
      input.done();
      if (dueDate < issueDate) throw validationError([{ field: 'due_date', message: 'debe ser >= issue_date' }]);
      if (items.length === 0 || items.length > 50)
        throw validationError([{ field: 'items', message: 'entre 1 y 50 líneas' }]);
      if (supplierId && !db.get('SELECT 1 AS x FROM fin_suppliers WHERE id = ?', supplierId))
        throw notFound('Proveedor no encontrado');
      const lines: Array<{ description: string; quantity: number; unit: number; taxRate: number; total: number }> = [];
      for (let i = 0; i < items.length; i++) {
        const li = new Validator(items[i], ['description', 'quantity', 'unit_price_cents', 'tax_rate']);
        const description = li.string('description', { required: true, maxLength: 500 });
        const quantity = li.integer('quantity', { required: true, min: 1, max: 100_000 });
        const unit = li.integer('unit_price_cents', { required: true, min: 0 });
        const taxRate = li.number('tax_rate', { min: 0, max: 1, default: 0.21 }) ?? 0.21;
        try {
          li.done();
        } catch (error) {
          if (error instanceof Error) error.message = `items[${i}]: ${error.message}`;
          throw error;
        }
        lines.push({ description, quantity, unit, taxRate, total: quantity * unit });
      }
      const subtotal = lines.reduce((sum, l) => sum + l.total, 0);
      const tax = lines.reduce((sum, l) => sum + Math.round(l.total * l.taxRate), 0);
      const total = subtotal + tax;
      try {
        const id = db.transaction(() => {
          const invoiceId = db.insert('fin_invoices', {
            invoice_number: invoiceNumber,
            supplier_id: supplierId,
            customer_name: customerName,
            status,
            issue_date: issueDate,
            due_date: dueDate,
            subtotal_cents: subtotal,
            tax_cents: tax,
            total_cents: total,
            currency,
            notes,
          });
          for (const line of lines) {
            db.insert('fin_invoice_items', {
              invoice_id: invoiceId,
              description: line.description,
              quantity: line.quantity,
              unit_price_cents: line.unit,
              tax_rate: line.taxRate,
              total_cents: line.total,
            });
          }
          return invoiceId;
        });
        sendJson(ctx, 201, { data: invoiceDetails(ctx, id) }, { Location: `${root}/invoices/${id}` });
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE'))
          throw conflict('El número de factura ya existe');
        throw error;
      }
    },
    { summary: 'Emite una factura con líneas y totales calculados', tag: 'Finance · Invoices' },
  );

  router.add(
    'PATCH',
    `${root}/invoices/:id/status`,
    async (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const invoice = db.get<{ status: string }>('SELECT status FROM fin_invoices WHERE id = ?', id);
      if (!invoice) throw notFound('Factura no encontrada');
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['status']);
      const status = input.string('status', { required: true, enum: ['draft', 'issued', 'paid', 'overdue', 'void'] });
      input.done();
      const transitions: Record<string, string[]> = {
        draft: ['issued', 'void'],
        issued: ['paid', 'overdue', 'void'],
        overdue: ['paid', 'void'],
        paid: [],
        void: [],
      };
      if (!(transitions[invoice.status] ?? []).includes(status))
        throw conflict(`Transición no permitida: ${invoice.status} -> ${status}`);
      db.run('UPDATE fin_invoices SET status = ? WHERE id = ?', status, id);
      sendJson(ctx, 200, { data: invoiceDetails(ctx, id) });
    },
    { summary: 'Cambia el estado de una factura', tag: 'Finance · Invoices' },
  );

  router.add(
    'POST',
    `${root}/invoices/:id/pay`,
    async (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const details = invoiceDetails(ctx, id);
      if (details.status === 'void') throw conflict('La factura está anulada');
      if (details.balance_cents <= 0) throw conflict('La factura ya está pagada');
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['account_id', 'method', 'amount_cents', 'reference']);
      const accountId = input.integer('account_id', { required: true, min: 1 });
      const method = input.string('method', { required: true, enum: ['transfer', 'card', 'cash', 'direct_debit'] });
      const amount = input.integer('amount_cents', { min: 1, default: details.balance_cents }) ?? details.balance_cents;
      const reference = input.string('reference', { nullable: true, maxLength: 120 }) ?? null;
      input.done();
      if (amount > details.balance_cents)
        throw validationError([{ field: 'amount_cents', message: 'supera el saldo pendiente' }]);
      const referenceValue = reference ?? `PAY-INV-${id}-${randomBytes(3).toString('hex').toUpperCase()}`;
      try {
        db.transaction(() => {
          db.insert('fin_payments', {
            invoice_id: id,
            expense_id: null,
            account_id: accountId,
            amount_cents: amount,
            method,
            status: 'completed',
            paid_at: now(),
            reference: referenceValue,
          });
          recordAccountMovement(
            db,
            accountId,
            'debit',
            amount,
            `Pago de factura ${String(details.invoice_number)}`,
            referenceValue,
          );
          if (amount >= details.balance_cents) db.run("UPDATE fin_invoices SET status = 'paid' WHERE id = ?", id);
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE'))
          throw conflict('La referencia de pago ya existe');
        throw error;
      }
      sendJson(ctx, 201, { data: invoiceDetails(ctx, id) });
    },
    { summary: 'Registra el pago de una factura', tag: 'Finance · Invoices' },
  );

  // ---------- Gastos ----------
  router.add(
    'PATCH',
    `${root}/expenses/:id/decision`,
    async (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const expense = db.get<{ status: string }>('SELECT status FROM fin_expenses WHERE id = ?', id);
      if (!expense) throw notFound('Gasto no encontrado');
      if (!['draft', 'submitted'].includes(expense.status)) throw conflict(`El gasto ya está ${expense.status}`);
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['status', 'approved_by']);
      const status = input.string('status', { required: true, enum: ['approved', 'rejected'] });
      const approvedBy = input.integer('approved_by', { nullable: true, min: 1 }) ?? null;
      input.done();
      if (approvedBy && !db.get('SELECT 1 AS x FROM hr_employees WHERE id = ?', approvedBy))
        throw notFound('Aprobador no encontrado');
      db.run('UPDATE fin_expenses SET status = ?, approved_by = ? WHERE id = ?', status, approvedBy, id);
      sendJson(ctx, 200, { data: db.get('SELECT * FROM fin_expenses WHERE id = ?', id) });
    },
    { summary: 'Aprueba o rechaza un gasto', tag: 'Finance · Expenses' },
  );

  router.add(
    'GET',
    `${root}/expenses/:id/details`,
    (ctx) => {
      const row = dbOf(ctx).get(
        `SELECT e.*, s.name AS supplier_name, emp.full_name AS employee_name
       FROM fin_expenses e LEFT JOIN fin_suppliers s ON s.id = e.supplier_id
       LEFT JOIN hr_employees emp ON emp.id = e.employee_id WHERE e.id = ?`,
        Number(ctx.params.id),
      );
      if (!row) throw notFound('Gasto no encontrado');
      sendJson(ctx, 200, { data: row });
    },
    { summary: 'Gasto con proveedor y empleado', tag: 'Finance · Expenses' },
  );

  router.add(
    'GET',
    `${root}/payments`,
    (ctx) => {
      const invoiceId = ctx.query.get('invoice_id');
      const status = ctx.query.get('status');
      const clauses: string[] = [];
      const params: Array<string | number> = [];
      if (invoiceId) {
        clauses.push('invoice_id = ?');
        params.push(Number(invoiceId));
      }
      if (status) {
        clauses.push('status = ?');
        params.push(status);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const rows = dbOf(ctx).all(`SELECT * FROM fin_payments${where} ORDER BY id DESC LIMIT 200`, ...params);
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Lista pagos financieros', tag: 'Finance · Payments' },
  );

  // ---------- Presupuestos ----------
  router.add(
    'GET',
    `${root}/budgets/utilization`,
    (ctx) => {
      const year = ctx.query.get('year');
      const department = ctx.query.get('department_id');
      const clauses: string[] = [];
      const params: Array<string | number> = [];
      if (year) {
        clauses.push('b.year = ?');
        params.push(Number(year));
      }
      if (department) {
        clauses.push('b.department_id = ?');
        params.push(Number(department));
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const rows = dbOf(ctx).all(
        `SELECT b.*, d.name AS department_name, ROUND(b.spent_cents * 100.0 / NULLIF(b.planned_cents,0), 2) AS utilization_percent
       FROM fin_budgets b JOIN hr_departments d ON d.id = b.department_id
       ${where} ORDER BY utilization_percent DESC, b.id`,
        ...params,
      );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Utilización de presupuestos', tag: 'Finance · Budgets' },
  );

  // ---------- Reportes ----------
  router.add(
    'GET',
    `${root}/reports/balance`,
    (ctx) => {
      const db = dbOf(ctx);
      const byKind = db.all(
        `SELECT kind, COUNT(*) AS accounts, COALESCE(SUM(balance_cents),0) AS balance_cents
       FROM fin_accounts WHERE active = 1 GROUP BY kind ORDER BY kind`,
      );
      const totals = Object.fromEntries(byKind.map((r) => [r.kind, r.balance_cents]));
      const assets = Number(totals.asset ?? 0);
      const liabilities = Math.abs(Number(totals.liability ?? 0));
      sendJson(ctx, 200, {
        data: {
          by_kind: byKind,
          assets_cents: assets,
          liabilities_cents: liabilities,
          equity_cents: Number(totals.equity ?? 0),
          net_worth_cents: assets - liabilities,
          accounts: db.count('fin_accounts'),
        },
      });
    },
    { summary: 'Balance agregado por tipo de cuenta', tag: 'Finance · Reports' },
  );

  router.add(
    'GET',
    `${root}/reports/expenses`,
    (ctx) => {
      const db = dbOf(ctx);
      const from = ctx.query.get('from');
      const to = ctx.query.get('to');
      const groupBy = ctx.query.get('group_by') ?? 'category';
      if (!['category', 'status', 'supplier'].includes(groupBy))
        throw validationError([{ field: 'group_by', message: 'use category, status o supplier' }]);
      const clauses: string[] = [];
      const params: Array<string | number> = [];
      if (from) {
        clauses.push('incurred_on >= ?');
        params.push(from);
      }
      if (to) {
        clauses.push('incurred_on <= ?');
        params.push(to);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const groupColumn = groupBy === 'supplier' ? 'supplier_id' : groupBy;
      const rows = db.all(
        `SELECT ${groupColumn} AS group_key, COUNT(*) AS count, COALESCE(SUM(amount_cents),0) AS total_cents
       FROM fin_expenses${where} GROUP BY ${groupColumn} ORDER BY total_cents DESC`,
        ...params,
      );
      const total = db.get(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents),0) AS total_cents FROM fin_expenses${where}`,
        ...params,
      );
      sendJson(ctx, 200, { data: rows, meta: { ...total, group_by: groupBy, from, to } });
    },
    { summary: 'Gastos agregados por categoría, estado o proveedor', tag: 'Finance · Reports' },
  );

  router.add(
    'GET',
    `${root}/reports/aging`,
    (ctx) => {
      const rows = dbOf(ctx).all(
        `SELECT i.*, CAST(julianday(?) - julianday(i.due_date) AS INTEGER) AS days_overdue,
              (SELECT COALESCE(SUM(p.amount_cents),0) FROM fin_payments p WHERE p.invoice_id = i.id AND p.status = 'completed') AS paid_cents
       FROM fin_invoices i WHERE i.status IN ('issued','overdue') AND i.due_date < ?
       ORDER BY i.due_date ASC`,
        today(),
        today(),
      );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Antigüedad de facturas vencidas', tag: 'Finance · Reports' },
  );

  router.add(
    'GET',
    `${root}/reports/summary`,
    (ctx) => {
      const db = dbOf(ctx);
      const invoiceTotals = db.get(
        `SELECT COUNT(*) AS total, COALESCE(SUM(total_cents),0) AS amount_cents,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN total_cents ELSE 0 END),0) AS paid_cents,
              COALESCE(SUM(CASE WHEN status IN ('issued','overdue') THEN total_cents ELSE 0 END),0) AS outstanding_cents
       FROM fin_invoices`,
      );
      const expenseTotals = db.get(
        'SELECT COUNT(*) AS total, COALESCE(SUM(amount_cents),0) AS amount_cents FROM fin_expenses',
      );
      sendJson(ctx, 200, {
        data: {
          invoices: invoiceTotals,
          expenses: expenseTotals,
          payments: db.count('fin_payments'),
          transactions: db.count('fin_transactions'),
          suppliers: db.count('fin_suppliers'),
          budgets: db.count('fin_budgets'),
        },
      });
    },
    { summary: 'Resumen financiero general', tag: 'Finance · Reports' },
  );
}
