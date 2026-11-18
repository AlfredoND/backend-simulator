/**
 * @file Education domain: students, courses, sections, grades and attendance.
 *
 * Enrollment checks section capacity and duplicate course/term pairs before
 * inserting. Grades are stored 0–100 with an automatic letter, and bulk
 * attendance is an idempotent upsert keyed by student/section/date.
 */
import type { Router } from '../http/router.js';
import type { Ctx } from '../http/router.js';
import type { RequestContext } from '../http/index.js';
import { readJsonBody, sendJson } from '../http/index.js';
import { conflict, notFound, validationError } from '../core/errors.js';
import { registerResource } from '../http/resource.js';
import { Validator } from '../core/validate.js';
import { paginationMeta, parsePagination } from '../http/query.js';

const now = () => new Date().toISOString();
function dbOf(ctx: Ctx) {
  return (ctx as RequestContext).app.db;
}

function letterFor(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/** Registers `/api/v1/education` enrollment, grade, attendance and report routes. */
export function registerEducationRoutes(router: Router, base: string): void {
  const root = `${base}/education`;

  registerResource(router, root, {
    table: 'edu_teachers',
    path: 'teachers',
    tag: 'Education · People',
    singular: 'profesor',
    fields: {
      id: { type: 'integer', readOnly: true },
      employee_code: { type: 'string', required: true, maxLength: 40 },
      full_name: { type: 'string', required: true, maxLength: 200 },
      email: { type: 'email', required: true, maxLength: 254 },
      department: { type: 'string', nullable: true, maxLength: 100 },
      hired_at: { type: 'date', required: true },
    },
    defaultSort: 'id',
    search: ['full_name', 'email', 'department'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'edu_students',
    path: 'students',
    tag: 'Education · People',
    singular: 'estudiante',
    fields: {
      id: { type: 'integer', readOnly: true },
      student_code: { type: 'string', required: true, maxLength: 40 },
      full_name: { type: 'string', required: true, maxLength: 200 },
      email: { type: 'email', required: true, maxLength: 254 },
      birth_date: { type: 'date', nullable: true },
      status: { type: 'string', enum: ['active', 'graduated', 'suspended', 'withdrawn'] },
      enrolled_at: { type: 'date', required: true },
    },
    defaultSort: 'id',
    search: ['full_name', 'email', 'student_code'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'edu_courses',
    path: 'courses',
    tag: 'Education · Courses',
    singular: 'curso',
    fields: {
      id: { type: 'integer', readOnly: true },
      code: { type: 'string', required: true, maxLength: 40 },
      name: { type: 'string', required: true, maxLength: 200 },
      description: { type: 'string', nullable: true, maxLength: 10_000 },
      credits: { type: 'integer', required: true, min: 1, max: 300 },
      department: { type: 'string', required: true, maxLength: 100 },
      active: { type: 'boolean' },
    },
    defaultSort: 'id',
    search: ['name', 'code', 'description'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'edu_subjects',
    path: 'subjects',
    tag: 'Education · Courses',
    singular: 'asignatura',
    fields: {
      id: { type: 'integer', readOnly: true },
      code: { type: 'string', required: true, maxLength: 40 },
      name: { type: 'string', required: true, maxLength: 200 },
      course_id: { type: 'integer', required: true, min: 1 },
      credits: { type: 'integer', required: true, min: 1, max: 30 },
      area: { type: 'string', nullable: true, maxLength: 100 },
      description: { type: 'string', nullable: true, maxLength: 10_000 },
    },
    defaultSort: 'id',
    search: ['name', 'code', 'description'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'edu_sections',
    path: 'sections',
    tag: 'Education · Sections',
    singular: 'sección',
    fields: {
      id: { type: 'integer', readOnly: true },
      subject_id: { type: 'integer', required: true, min: 1 },
      term: { type: 'string', required: true, maxLength: 40 },
      section_code: { type: 'string', required: true, maxLength: 60 },
      teacher_id: { type: 'integer', nullable: true, min: 1 },
      capacity: { type: 'integer', required: true, min: 1, max: 1000 },
      room: { type: 'string', nullable: true, maxLength: 80 },
      schedule: { type: 'string', nullable: true, maxLength: 200 },
    },
    defaultSort: 'id',
    search: ['section_code', 'term', 'room'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'edu_enrollments',
    path: 'enrollments',
    tag: 'Education · Enrollment',
    singular: 'matrícula',
    fields: {
      id: { type: 'integer', readOnly: true },
      student_id: { type: 'integer', required: true, min: 1 },
      course_id: { type: 'integer', required: true, min: 1 },
      section_id: { type: 'integer', nullable: true, min: 1 },
      term: { type: 'string', required: true, maxLength: 40 },
      enrolled_at: { type: 'datetime', readOnly: true },
      status: { type: 'string', enum: ['enrolled', 'completed', 'dropped', 'withdrawn'] },
    },
    defaultSort: 'id',
    updatedAt: false,
    defaults: { enrolled_at: now },
  });

  registerResource(router, root, {
    table: 'edu_evaluations',
    path: 'evaluations',
    tag: 'Education · Grades',
    singular: 'evaluación',
    fields: {
      id: { type: 'integer', readOnly: true },
      section_id: { type: 'integer', required: true, min: 1 },
      name: { type: 'string', required: true, maxLength: 160 },
      kind: { type: 'string', required: true, enum: ['exam', 'quiz', 'assignment', 'project'] },
      max_score: { type: 'number', required: true, min: 0.01 },
      weight: { type: 'number', required: true, min: 0.01, max: 1 },
      due_date: { type: 'date', nullable: true },
    },
    defaultSort: 'id',
    search: ['name'],
    updatedAt: false,
  });

  const gradeHooks = {
    afterCreate: (ctx: Ctx, id: number) => {
      const db = dbOf(ctx);
      const grade = db.get<{ score: number }>('SELECT score FROM edu_grades WHERE id = ?', id);
      if (grade) db.run('UPDATE edu_grades SET letter = ? WHERE id = ?', letterFor(grade.score), id);
    },
    afterUpdate: (ctx: Ctx, id: number) => {
      const db = dbOf(ctx);
      const grade = db.get<{ score: number }>('SELECT score FROM edu_grades WHERE id = ?', id);
      if (grade) db.run('UPDATE edu_grades SET letter = ? WHERE id = ?', letterFor(grade.score), id);
    },
  };
  registerResource(router, root, {
    table: 'edu_grades',
    path: 'grades',
    tag: 'Education · Grades',
    singular: 'calificación',
    fields: {
      id: { type: 'integer', readOnly: true },
      student_id: { type: 'integer', required: true, min: 1 },
      section_id: { type: 'integer', required: true, min: 1 },
      evaluation_id: { type: 'integer', nullable: true, min: 1 },
      score: { type: 'number', required: true, min: 0, max: 100 },
      letter: { type: 'string', nullable: true, enum: ['A', 'B', 'C', 'D', 'F'] },
      comments: { type: 'string', nullable: true, maxLength: 4000 },
      graded_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    updatedAt: false,
    defaults: { graded_at: now },
    ...gradeHooks,
  });

  registerResource(router, root, {
    table: 'edu_attendance',
    path: 'attendance',
    tag: 'Education · Attendance',
    singular: 'asistencia',
    fields: {
      id: { type: 'integer', readOnly: true },
      student_id: { type: 'integer', required: true, min: 1 },
      section_id: { type: 'integer', required: true, min: 1 },
      attendance_date: { type: 'date', required: true },
      status: { type: 'string', required: true, enum: ['present', 'absent', 'late', 'excused'] },
      notes: { type: 'string', nullable: true, maxLength: 2000 },
    },
    defaultSort: 'id',
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'edu_materials',
    path: 'materials',
    tag: 'Education · Materials',
    singular: 'material',
    fields: {
      id: { type: 'integer', readOnly: true },
      section_id: { type: 'integer', required: true, min: 1 },
      title: { type: 'string', required: true, maxLength: 200 },
      kind: { type: 'string', required: true, enum: ['pdf', 'video', 'link', 'slides', 'other'] },
      url: { type: 'string', required: true, maxLength: 2000 },
      description: { type: 'string', nullable: true, maxLength: 4000 },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    search: ['title', 'description'],
    updatedAt: false,
    defaults: { created_at: now },
  });

  // ---------- Matriculación por sección ----------
  router.add(
    'POST',
    `${root}/sections/:id/enroll`,
    async (ctx) => {
      const sectionId = Number(ctx.params.id);
      const db = dbOf(ctx);
      const section = db.get<{ id: number; term: string; capacity: number; subject_id: number }>(
        'SELECT id, term, capacity, subject_id FROM edu_sections WHERE id = ?',
        sectionId,
      );
      if (!section) throw notFound('Sección no encontrada');
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['student_id']);
      const studentId = input.integer('student_id', { required: true, min: 1 })!;
      input.done();
      if (!db.get('SELECT 1 AS x FROM edu_students WHERE id = ?', studentId))
        throw notFound('Estudiante no encontrado');
      const subject = db.get<{ course_id: number }>(
        'SELECT course_id FROM edu_subjects WHERE id = ?',
        section.subject_id,
      );
      if (!subject) throw notFound('Asignatura no encontrada');
      const enrolled = Number(
        db.get<{ n: number }>('SELECT COUNT(*) AS n FROM edu_enrollments WHERE section_id = ?', sectionId)?.n ?? 0,
      );
      if (enrolled >= section.capacity)
        throw conflict('La sección está completa', { capacity: section.capacity, enrolled });
      const already = db.get(
        'SELECT 1 AS x FROM edu_enrollments WHERE student_id = ? AND course_id = ? AND term = ?',
        studentId,
        subject.course_id,
        section.term,
      );
      if (already) throw conflict('El estudiante ya está matriculado en este curso y periodo');
      const id = db.insert('edu_enrollments', {
        student_id: studentId,
        course_id: subject.course_id,
        section_id: sectionId,
        term: section.term,
        enrolled_at: now(),
        status: 'enrolled',
      });
      sendJson(
        ctx,
        201,
        { data: db.get('SELECT * FROM edu_enrollments WHERE id = ?', id) },
        { Location: `${root}/enrollments/${id}` },
      );
    },
    { summary: 'Matricula a un estudiante en una sección con control de aforo', tag: 'Education · Enrollment' },
  );

  router.add(
    'GET',
    `${root}/sections/:id/roster`,
    (ctx) => {
      const sectionId = Number(ctx.params.id);
      const db = dbOf(ctx);
      const section = db.get<{ id: number; term: string; subject_id: number; capacity: number }>(
        'SELECT id, term, subject_id, capacity FROM edu_sections WHERE id = ?',
        sectionId,
      );
      if (!section) throw notFound('Sección no encontrada');
      const subject = db.get<{ course_id: number }>(
        'SELECT course_id FROM edu_subjects WHERE id = ?',
        section.subject_id,
      );
      const rows = db.all<Record<string, unknown>>(
        `SELECT e.*, s.full_name, s.email, s.student_code
       FROM edu_enrollments e JOIN edu_students s ON s.id = e.student_id
       WHERE e.course_id = ? AND e.term = ? ORDER BY s.full_name`,
        subject?.course_id ?? 0,
        section.term,
      );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length, capacity: section.capacity } });
    },
    { summary: 'Lista de estudiantes de una sección', tag: 'Education · Sections' },
  );

  router.add(
    'GET',
    `${root}/sections/:id/materials`,
    (ctx) => {
      const sectionId = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM edu_sections WHERE id = ?', sectionId)) throw notFound('Sección no encontrada');
      const rows = db.all('SELECT * FROM edu_materials WHERE section_id = ? ORDER BY id', sectionId);
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Materiales de una sección', tag: 'Education · Materials' },
  );

  // ---------- Notas e historial ----------
  router.add(
    'GET',
    `${root}/students/:id/grades`,
    (ctx) => {
      const studentId = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM edu_students WHERE id = ?', studentId))
        throw notFound('Estudiante no encontrado');
      const term = ctx.query.get('term');
      const query = `SELECT g.*, sec.term, sec.section_code, sub.name AS subject_name, sub.code AS subject_code,
        c.name AS course_name, e.name AS evaluation_name, e.weight
      FROM edu_grades g JOIN edu_sections sec ON sec.id = g.section_id
      JOIN edu_subjects sub ON sub.id = sec.subject_id JOIN edu_courses c ON c.id = sub.course_id
      LEFT JOIN edu_evaluations e ON e.id = g.evaluation_id
      WHERE g.student_id = ?${term ? ' AND sec.term = ?' : ''} ORDER BY g.graded_at DESC, g.id DESC`;
      const rows = term ? db.all(query, studentId, term) : db.all(query, studentId);
      const average = rows.length ? rows.reduce((sum, r) => sum + Number(r.score), 0) / rows.length : null;
      sendJson(ctx, 200, {
        data: rows,
        meta: { total: rows.length, average: average === null ? null : Math.round(average * 100) / 100 },
      });
    },
    { summary: 'Calificaciones de un estudiante', tag: 'Education · Grades' },
  );

  router.add(
    'GET',
    `${root}/students/:id/transcript`,
    (ctx) => {
      const studentId = Number(ctx.params.id);
      const db = dbOf(ctx);
      const student = db.get<Record<string, unknown>>('SELECT * FROM edu_students WHERE id = ?', studentId);
      if (!student) throw notFound('Estudiante no encontrado');
      const enrollments = db.all<Record<string, unknown>>(
        `SELECT e.id, e.term, e.status, c.id AS course_id, c.name AS course_name, c.code AS course_code, c.credits AS course_credits
       FROM edu_enrollments e JOIN edu_courses c ON c.id = e.course_id WHERE e.student_id = ? ORDER BY e.term DESC, c.name`,
        studentId,
      );
      const grades = db.all<Record<string, unknown>>(
        `SELECT g.score, g.letter, g.graded_at, sec.term, sub.name AS subject_name, sub.credits,
              c.name AS course_name, e.weight
       FROM edu_grades g JOIN edu_sections sec ON sec.id = g.section_id
       JOIN edu_subjects sub ON sub.id = sec.subject_id JOIN edu_courses c ON c.id = sub.course_id
       LEFT JOIN edu_evaluations e ON e.id = g.evaluation_id
       WHERE g.student_id = ? ORDER BY sec.term, sub.name`,
        studentId,
      );
      const bySubject = new Map<
        string,
        { subject: string; term: string; weighted: number; weight: number; grades: number }
      >();
      for (const g of grades) {
        const key = `${g.subject_name}|${g.term}`;
        const entry = bySubject.get(key) ?? {
          subject: String(g.subject_name),
          term: String(g.term),
          weighted: 0,
          weight: 0,
          grades: 0,
        };
        const weight = g.weight === null ? 1 : Number(g.weight);
        entry.weighted += Number(g.score) * weight;
        entry.weight += weight;
        entry.grades += 1;
        bySubject.set(key, entry);
      }
      const subjects = [...bySubject.values()].map((s) => ({
        subject: s.subject,
        term: s.term,
        grades: s.grades,
        average: s.weight ? Math.round((s.weighted / s.weight) * 100) / 100 : null,
        letter: s.weight ? letterFor(s.weighted / s.weight) : null,
      }));
      const averages = subjects.filter((s) => s.average !== null).map((s) => s.average as number);
      const overall = averages.length
        ? Math.round((averages.reduce((a, b) => a + b, 0) / averages.length) * 100) / 100
        : null;
      const attendance = db.all(
        `SELECT status, COUNT(*) AS total FROM edu_attendance WHERE student_id = ? GROUP BY status`,
        studentId,
      );
      sendJson(ctx, 200, {
        data: {
          student,
          enrollments,
          subjects,
          academic_average: overall,
          gpa_4: overall === null ? null : Math.round((overall / 100) * 4 * 100) / 100,
          attendance_summary: Object.fromEntries(attendance.map((a) => [a.status, a.total])),
        },
      });
    },
    { summary: 'Historial académico con promedio y asistencia', tag: 'Education · Reports' },
  );

  router.add(
    'GET',
    `${root}/students/:id/attendance`,
    (ctx) => {
      const studentId = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM edu_students WHERE id = ?', studentId))
        throw notFound('Estudiante no encontrado');
      const rows = db.all(
        `SELECT a.*, sec.section_code, sub.name AS subject_name FROM edu_attendance a
       JOIN edu_sections sec ON sec.id = a.section_id JOIN edu_subjects sub ON sub.id = sec.subject_id
       WHERE a.student_id = ? ORDER BY a.attendance_date DESC, a.id DESC`,
        studentId,
      );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Asistencia de un estudiante', tag: 'Education · Attendance' },
  );

  router.add(
    'POST',
    `${root}/attendance/bulk`,
    async (ctx) => {
      const db = dbOf(ctx);
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['records']);
      const records = input.array('records', { required: true })!;
      input.done();
      if (records.length === 0) throw validationError([{ field: 'records', message: 'no puede estar vacío' }]);
      if (records.length > 500) throw validationError([{ field: 'records', message: 'máximo 500 registros' }]);
      const seen = new Set<string>();
      let saved = 0;
      db.transaction(() => {
        for (let i = 0; i < records.length; i++) {
          const itemInput = new Validator(records[i], [
            'student_id',
            'section_id',
            'attendance_date',
            'status',
            'notes',
          ]);
          const studentId = itemInput.integer('student_id', { required: true, min: 1 })!;
          const sectionId = itemInput.integer('section_id', { required: true, min: 1 })!;
          const date = itemInput.date('attendance_date', { required: true })!;
          const status = itemInput.string('status', {
            required: true,
            enum: ['present', 'absent', 'late', 'excused'],
          })!;
          const notes = itemInput.string('notes', { nullable: true, maxLength: 2000 }) ?? null;
          try {
            itemInput.done();
          } catch (error) {
            if (error instanceof Error) error.message = `records[${i}]: ${error.message}`;
            throw error;
          }
          const key = `${studentId}|${sectionId}|${date}`;
          if (seen.has(key))
            throw validationError([{ field: `records[${i}]`, message: 'registro duplicado en la solicitud' }]);
          seen.add(key);
          if (!db.get('SELECT 1 AS x FROM edu_students WHERE id = ?', studentId))
            throw notFound(`Estudiante ${studentId} no encontrado`);
          if (!db.get('SELECT 1 AS x FROM edu_sections WHERE id = ?', sectionId))
            throw notFound(`Sección ${sectionId} no encontrada`);
          db.run(
            `INSERT INTO edu_attendance (student_id, section_id, attendance_date, status, notes)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(student_id, section_id, attendance_date)
           DO UPDATE SET status = excluded.status, notes = excluded.notes`,
            studentId,
            sectionId,
            date,
            status,
            notes,
          );
          saved++;
        }
      });
      sendJson(ctx, 200, { data: { saved } });
    },
    { summary: 'Registra asistencia en lote con upsert', tag: 'Education · Attendance' },
  );

  // ---------- Cursos ----------
  router.add(
    'GET',
    `${root}/courses/:id/students`,
    (ctx) => {
      const courseId = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM edu_courses WHERE id = ?', courseId)) throw notFound('Curso no encontrado');
      const term = ctx.query.get('term');
      const rows = term
        ? db.all(
            `SELECT e.*, s.full_name, s.email, s.student_code FROM edu_enrollments e
         JOIN edu_students s ON s.id = e.student_id WHERE e.course_id = ? AND e.term = ? ORDER BY s.full_name`,
            courseId,
            term,
          )
        : db.all(
            `SELECT e.*, s.full_name, s.email, s.student_code FROM edu_enrollments e
         JOIN edu_students s ON s.id = e.student_id WHERE e.course_id = ? ORDER BY s.full_name`,
            courseId,
          );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Estudiantes matriculados en un curso', tag: 'Education · Courses' },
  );

  router.add(
    'GET',
    `${root}/courses/:id/stats`,
    (ctx) => {
      const courseId = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM edu_courses WHERE id = ?', courseId)) throw notFound('Curso no encontrado');
      const enrollments = db.all(
        'SELECT status, COUNT(*) AS total FROM edu_enrollments WHERE course_id = ? GROUP BY status',
        courseId,
      );
      const grades = db.get(
        `SELECT COUNT(*) AS total, ROUND(AVG(g.score),2) AS average FROM edu_grades g
       JOIN edu_sections sec ON sec.id = g.section_id JOIN edu_subjects sub ON sub.id = sec.subject_id
       WHERE sub.course_id = ?`,
        courseId,
      );
      const sections = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM edu_sections sec JOIN edu_subjects sub ON sub.id = sec.subject_id WHERE sub.course_id = ?`,
        courseId,
      );
      sendJson(ctx, 200, {
        data: { course_id: courseId, enrollments_by_status: enrollments, sections: sections?.n ?? 0, grades },
      });
    },
    { summary: 'Estadísticas de un curso', tag: 'Education · Reports' },
  );

  router.add(
    'GET',
    `${root}/stats`,
    (ctx) => {
      const db = dbOf(ctx);
      sendJson(ctx, 200, {
        data: {
          students: db.count('edu_students'),
          teachers: db.count('edu_teachers'),
          courses: db.count('edu_courses'),
          enrollments: db.count('edu_enrollments'),
          sections: db.count('edu_sections'),
          grades: db.count('edu_grades'),
          average_grade:
            db.get<{ avg: number | null }>('SELECT ROUND(AVG(score),2) AS avg FROM edu_grades')?.avg ?? null,
        },
      });
    },
    { summary: 'Estadísticas educativas', tag: 'Education · Reports' },
  );
}
