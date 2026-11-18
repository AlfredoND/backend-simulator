/**
 * @file HR domain: organization, employees, contracts, payroll and vacations.
 *
 * Vacation requests validate date order, overlaps and annual balance before
 * insertion; approval rechecks overlaps. Termination closes active contracts
 * and sets the termination date in one transaction.
 */
import type { Router } from '../http/router.js';
import type { Ctx } from '../http/router.js';
import type { RequestContext } from '../http/index.js';
import { readJsonBody, sendJson } from '../http/index.js';
import { conflict, notFound, validationError } from '../core/errors.js';
import { registerResource } from '../http/resource.js';
import { Validator } from '../core/validate.js';

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const ANNUAL_VACATION_DAYS = 30;

function dbOf(ctx: Ctx) {
  return (ctx as RequestContext).app.db;
}

/** Registers `/api/v1/hr` organization, payroll, vacation and report routes. */
export function registerHrRoutes(router: Router, base: string): void {
  const root = `${base}/hr`;

  registerResource(router, root, {
    table: 'hr_departments',
    path: 'departments',
    tag: 'HR · Organization',
    singular: 'departamento',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 120 },
      code: { type: 'string', required: true, maxLength: 20 },
      manager_id: { type: 'integer', nullable: true, min: 1 },
      budget_cents: { type: 'integer', min: 0 },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    search: ['name', 'code'],
    updatedAt: false,
    defaults: { created_at: now },
  });

  registerResource(router, root, {
    table: 'hr_positions',
    path: 'positions',
    tag: 'HR · Organization',
    singular: 'puesto',
    fields: {
      id: { type: 'integer', readOnly: true },
      title: { type: 'string', required: true, maxLength: 160 },
      department_id: { type: 'integer', required: true, min: 1 },
      level: { type: 'string', required: true, enum: ['junior', 'mid', 'senior', 'lead', 'director'] },
      min_salary_cents: { type: 'integer', required: true, min: 0 },
      max_salary_cents: { type: 'integer', required: true, min: 0 },
    },
    defaultSort: 'id',
    search: ['title'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'hr_employees',
    path: 'employees',
    tag: 'HR · Employees',
    singular: 'empleado',
    fields: {
      id: { type: 'integer', readOnly: true },
      employee_code: { type: 'string', required: true, maxLength: 40 },
      full_name: { type: 'string', required: true, maxLength: 200 },
      email: { type: 'email', required: true, maxLength: 254 },
      department_id: { type: 'integer', required: true, min: 1 },
      position_id: { type: 'integer', required: true, min: 1 },
      manager_id: { type: 'integer', nullable: true, min: 1 },
      hire_date: { type: 'date', required: true },
      termination_date: { type: 'date', nullable: true },
      status: { type: 'string', enum: ['active', 'on_leave', 'terminated'] },
    },
    defaultSort: 'id',
    search: ['full_name', 'email', 'employee_code'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'hr_contracts',
    path: 'contracts',
    tag: 'HR · Employees',
    singular: 'contrato',
    fields: {
      id: { type: 'integer', readOnly: true },
      employee_id: { type: 'integer', required: true, min: 1 },
      kind: { type: 'string', required: true, enum: ['permanent', 'temporary', 'internship', 'contractor'] },
      start_date: { type: 'date', required: true },
      end_date: { type: 'date', nullable: true },
      weekly_hours: { type: 'integer', required: true, min: 1, max: 60 },
      gross_annual_cents: { type: 'integer', required: true, min: 0 },
      signed_at: { type: 'datetime', nullable: true },
      status: { type: 'string', enum: ['active', 'ended', 'draft'] },
    },
    defaultSort: 'id',
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'hr_salaries',
    path: 'salaries',
    tag: 'HR · Payroll',
    singular: 'salario',
    fields: {
      id: { type: 'integer', readOnly: true },
      employee_id: { type: 'integer', required: true, min: 1 },
      period_start: { type: 'date', required: true },
      period_end: { type: 'date', required: true },
      base_cents: { type: 'integer', required: true, min: 0 },
      bonus_cents: { type: 'integer', min: 0 },
      deductions_cents: { type: 'integer', min: 0 },
      net_cents: { type: 'integer', required: true, min: 0 },
      paid_at: { type: 'datetime', nullable: true },
    },
    defaultSort: 'id',
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'hr_vacations',
    path: 'vacations',
    tag: 'HR · Vacations',
    singular: 'vacación',
    fields: {
      id: { type: 'integer', readOnly: true },
      employee_id: { type: 'integer', required: true, min: 1 },
      start_date: { type: 'date', required: true },
      end_date: { type: 'date', required: true },
      days: { type: 'integer', required: true, min: 1, max: 365 },
      status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'] },
      reason: { type: 'string', nullable: true, maxLength: 2000 },
      requested_at: { type: 'datetime', readOnly: true },
      decided_at: { type: 'datetime', nullable: true },
    },
    defaultSort: 'id',
    updatedAt: false,
    defaults: { requested_at: now },
  });

  registerResource(router, root, {
    table: 'hr_attendance',
    path: 'attendance',
    tag: 'HR · Attendance',
    singular: 'asistencia',
    fields: {
      id: { type: 'integer', readOnly: true },
      employee_id: { type: 'integer', required: true, min: 1 },
      work_date: { type: 'date', required: true },
      check_in: { type: 'string', nullable: true, maxLength: 10 },
      check_out: { type: 'string', nullable: true, maxLength: 10 },
      hours_worked: { type: 'number', min: 0, max: 24 },
      status: { type: 'string', required: true, enum: ['present', 'remote', 'late', 'absent', 'holiday'] },
    },
    defaultSort: 'id',
    updatedAt: false,
  });

  // ---------- Vacaciones ----------
  router.add(
    'POST',
    `${root}/vacations/request`,
    async (ctx) => {
      const db = dbOf(ctx);
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['employee_id', 'start_date', 'end_date', 'days', 'reason']);
      const employeeId = input.integer('employee_id', { required: true, min: 1 })!;
      const startDate = input.date('start_date', { required: true })!;
      const endDate = input.date('end_date', { required: true })!;
      const days = input.integer('days', { required: true, min: 1, max: 365 })!;
      const reason = input.string('reason', { nullable: true, maxLength: 2000 }) ?? null;
      input.done();
      if (endDate < startDate) throw validationError([{ field: 'end_date', message: 'debe ser >= start_date' }]);
      const employee = db.get<{ status: string }>('SELECT status FROM hr_employees WHERE id = ?', employeeId);
      if (!employee) throw notFound('Empleado no encontrado');
      if (employee.status === 'terminated') throw conflict('El empleado está dado de baja');
      const overlap = db.get(
        `SELECT id FROM hr_vacations WHERE employee_id = ? AND status IN ('pending','approved')
       AND start_date <= ? AND end_date >= ?`,
        employeeId,
        endDate,
        startDate,
      );
      if (overlap) throw conflict('Existe una solicitud solapada');
      const year = startDate.slice(0, 4);
      const used = Number(
        db.get<{ n: number }>(
          `SELECT COALESCE(SUM(days),0) AS n FROM hr_vacations
       WHERE employee_id = ? AND status = 'approved' AND start_date LIKE ?`,
          employeeId,
          `${year}%`,
        )?.n ?? 0,
      );
      const pending = Number(
        db.get<{ n: number }>(
          `SELECT COALESCE(SUM(days),0) AS n FROM hr_vacations
       WHERE employee_id = ? AND status = 'pending' AND start_date LIKE ?`,
          employeeId,
          `${year}%`,
        )?.n ?? 0,
      );
      if (used + pending + days > ANNUAL_VACATION_DAYS) {
        throw conflict('Saldo de vacaciones insuficiente', {
          annual_days: ANNUAL_VACATION_DAYS,
          used,
          pending,
          requested: days,
          remaining: ANNUAL_VACATION_DAYS - used - pending,
        });
      }
      const id = db.insert('hr_vacations', {
        employee_id: employeeId,
        start_date: startDate,
        end_date: endDate,
        days,
        status: 'pending',
        reason,
        requested_at: now(),
        decided_at: null,
      });
      sendJson(
        ctx,
        201,
        { data: db.get('SELECT * FROM hr_vacations WHERE id = ?', id) },
        { Location: `${root}/vacations/${id}` },
      );
    },
    { summary: 'Solicita vacaciones con validación de solape y saldo', tag: 'HR · Vacations' },
  );

  router.add(
    'PATCH',
    `${root}/vacations/:id/decision`,
    async (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const vacation = db.get<{
        id: number;
        employee_id: number;
        status: string;
        start_date: string;
        end_date: string;
      }>('SELECT id, employee_id, status, start_date, end_date FROM hr_vacations WHERE id = ?', id);
      if (!vacation) throw notFound('Solicitud no encontrada');
      if (vacation.status !== 'pending') throw conflict(`La solicitud ya está ${vacation.status}`);
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['status']);
      const status = input.string('status', { required: true, enum: ['approved', 'rejected'] })!;
      input.done();
      if (status === 'approved') {
        const overlap = db.get(
          `SELECT id FROM hr_vacations WHERE employee_id = ? AND status = 'approved' AND id <> ?
         AND start_date <= ? AND end_date >= ?`,
          vacation.employee_id,
          id,
          vacation.end_date,
          vacation.start_date,
        );
        if (overlap) throw conflict('La aprobación solapa con vacaciones ya aprobadas');
      }
      db.run('UPDATE hr_vacations SET status = ?, decided_at = ? WHERE id = ?', status, now(), id);
      sendJson(ctx, 200, { data: db.get('SELECT * FROM hr_vacations WHERE id = ?', id) });
    },
    { summary: 'Aprueba o rechaza una solicitud de vacaciones', tag: 'HR · Vacations' },
  );

  router.add(
    'GET',
    `${root}/vacations/balance/:employeeId`,
    (ctx) => {
      const employeeId = Number(ctx.params.employeeId);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM hr_employees WHERE id = ?', employeeId)) throw notFound('Empleado no encontrado');
      const year = ctx.query.get('year') ?? today().slice(0, 4);
      const used = Number(
        db.get<{ n: number }>(
          "SELECT COALESCE(SUM(days),0) AS n FROM hr_vacations WHERE employee_id = ? AND status = 'approved' AND start_date LIKE ?",
          employeeId,
          `${year}%`,
        )?.n ?? 0,
      );
      const pending = Number(
        db.get<{ n: number }>(
          "SELECT COALESCE(SUM(days),0) AS n FROM hr_vacations WHERE employee_id = ? AND status = 'pending' AND start_date LIKE ?",
          employeeId,
          `${year}%`,
        )?.n ?? 0,
      );
      sendJson(ctx, 200, {
        data: {
          employee_id: employeeId,
          year,
          annual_days: ANNUAL_VACATION_DAYS,
          used,
          pending,
          remaining: ANNUAL_VACATION_DAYS - used - pending,
        },
      });
    },
    { summary: 'Saldo de vacaciones de un empleado', tag: 'HR · Vacations' },
  );

  // ---------- Empleado ----------
  router.add(
    'GET',
    `${root}/employees/:id/details`,
    (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const employee = db.get<Record<string, unknown>>(
        `SELECT e.*, d.name AS department_name, d.code AS department_code, p.title AS position_title, p.level AS position_level,
              m.full_name AS manager_name
       FROM hr_employees e JOIN hr_departments d ON d.id = e.department_id
       JOIN hr_positions p ON p.id = e.position_id LEFT JOIN hr_employees m ON m.id = e.manager_id
       WHERE e.id = ?`,
        id,
      );
      if (!employee) throw notFound('Empleado no encontrado');
      const contracts = db.all('SELECT * FROM hr_contracts WHERE employee_id = ? ORDER BY start_date DESC', id);
      const salaries = db.all(
        'SELECT * FROM hr_salaries WHERE employee_id = ? ORDER BY period_start DESC LIMIT 12',
        id,
      );
      const vacations = db.all(
        'SELECT * FROM hr_vacations WHERE employee_id = ? ORDER BY start_date DESC LIMIT 20',
        id,
      );
      const attendance = db.all(
        'SELECT * FROM hr_attendance WHERE employee_id = ? ORDER BY work_date DESC LIMIT 10',
        id,
      );
      sendJson(ctx, 200, { data: { ...employee, contracts, salaries, vacations, recent_attendance: attendance } });
    },
    { summary: 'Empleado con contratos, nóminas, vacaciones y asistencia', tag: 'HR · Employees' },
  );

  router.add(
    'GET',
    `${root}/employees/:id/vacations`,
    (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM hr_employees WHERE id = ?', id)) throw notFound('Empleado no encontrado');
      const rows = db.all('SELECT * FROM hr_vacations WHERE employee_id = ? ORDER BY start_date DESC', id);
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Vacaciones de un empleado', tag: 'HR · Vacations' },
  );

  router.add(
    'GET',
    `${root}/employees/:id/attendance`,
    (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM hr_employees WHERE id = ?', id)) throw notFound('Empleado no encontrado');
      const from = ctx.query.get('from') ?? '0000-01-01';
      const to = ctx.query.get('to') ?? '9999-12-31';
      const rows = db.all(
        'SELECT * FROM hr_attendance WHERE employee_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date DESC',
        id,
        from,
        to,
      );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length, from, to } });
    },
    { summary: 'Asistencia de un empleado por rango', tag: 'HR · Attendance' },
  );

  router.add(
    'POST',
    `${root}/employees/:id/terminate`,
    async (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const employee = db.get<{ status: string }>('SELECT status FROM hr_employees WHERE id = ?', id);
      if (!employee) throw notFound('Empleado no encontrado');
      if (employee.status === 'terminated') throw conflict('El empleado ya está dado de baja');
      const body =
        ctx.req.headers['content-length'] === '0' || !ctx.req.headers['content-type'] ? {} : await readJsonBody(ctx);
      const input = new Validator(body, ['termination_date']);
      const terminationDate = input.date('termination_date', { default: today() }) ?? today();
      input.done();
      db.transaction(() => {
        db.run("UPDATE hr_employees SET status = 'terminated', termination_date = ? WHERE id = ?", terminationDate, id);
        db.run(
          "UPDATE hr_contracts SET status = 'ended', end_date = COALESCE(end_date, ?) WHERE employee_id = ? AND status = 'active'",
          terminationDate,
          id,
        );
      });
      sendJson(ctx, 200, { data: db.get('SELECT * FROM hr_employees WHERE id = ?', id) });
    },
    { summary: 'Da de baja a un empleado y cierra contratos', tag: 'HR · Employees' },
  );

  // ---------- Reportes ----------
  router.add(
    'GET',
    `${root}/departments/:id/summary`,
    (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const department = db.get<Record<string, unknown>>('SELECT * FROM hr_departments WHERE id = ?', id);
      if (!department) throw notFound('Departamento no encontrado');
      const headcount = db.get(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM hr_employees WHERE department_id = ?",
        id,
      );
      const salary = db.get(
        `SELECT ROUND(AVG(s.net_cents),2) AS avg_net_cents, COALESCE(SUM(s.net_cents),0) AS total_net_cents
       FROM hr_salaries s JOIN hr_employees e ON e.id = s.employee_id
       WHERE e.department_id = ? AND s.period_start = (SELECT MAX(period_start) FROM hr_salaries)`,
        id,
      );
      const vacations = db.get(
        "SELECT COUNT(*) AS total, COALESCE(SUM(days),0) AS days FROM hr_vacations WHERE employee_id IN (SELECT id FROM hr_employees WHERE department_id = ?) AND status = 'pending'",
        id,
      );
      sendJson(ctx, 200, { data: { department, headcount, latest_salary: salary, pending_vacations: vacations } });
    },
    { summary: 'Resumen de un departamento', tag: 'HR · Reports' },
  );

  router.add(
    'GET',
    `${root}/reports/payroll`,
    (ctx) => {
      const db = dbOf(ctx);
      const periodStart = ctx.query.get('period_start');
      const periodEnd = ctx.query.get('period_end');
      const clauses: string[] = [];
      const params: string[] = [];
      if (periodStart) {
        clauses.push('s.period_start >= ?');
        params.push(periodStart);
      }
      if (periodEnd) {
        clauses.push('s.period_end <= ?');
        params.push(periodEnd);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const totals = db.get(
        `SELECT COALESCE(SUM(s.base_cents),0) AS base, COALESCE(SUM(s.bonus_cents),0) AS bonus,
              COALESCE(SUM(s.deductions_cents),0) AS deductions, COALESCE(SUM(s.net_cents),0) AS net,
              COUNT(*) AS records
       FROM hr_salaries s${where}`,
        ...(params as []),
      );
      const byDepartment = db.all(
        `SELECT d.name AS department, COUNT(*) AS records, COALESCE(SUM(s.net_cents),0) AS net
       FROM hr_salaries s JOIN hr_employees e ON e.id = s.employee_id JOIN hr_departments d ON d.id = e.department_id
       ${where} GROUP BY d.id ORDER BY net DESC`,
        ...(params as []),
      );
      sendJson(ctx, 200, {
        data: { totals, by_department: byDepartment, filters: { period_start: periodStart, period_end: periodEnd } },
      });
    },
    { summary: 'Reporte de nóminas agregado', tag: 'HR · Reports' },
  );

  router.add(
    'GET',
    `${root}/reports/headcount`,
    (ctx) => {
      const db = dbOf(ctx);
      const byDepartment = db.all(
        `SELECT d.id, d.name, COUNT(e.id) AS total,
              SUM(CASE WHEN e.status = 'active' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN e.status = 'on_leave' THEN 1 ELSE 0 END) AS on_leave,
              SUM(CASE WHEN e.status = 'terminated' THEN 1 ELSE 0 END) AS terminated
       FROM hr_departments d LEFT JOIN hr_employees e ON e.department_id = d.id
       GROUP BY d.id ORDER BY d.name`,
      );
      sendJson(ctx, 200, { data: { total_employees: db.count('hr_employees'), by_department: byDepartment } });
    },
    { summary: 'Plantilla agregada por departamento', tag: 'HR · Reports' },
  );
}
