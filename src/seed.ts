import { createHash, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';
import { Db } from './db.js';
import { DOMAIN_TABLES } from './domain-tables.js';

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 5, 1, 12, 0, 0); // 2026-06-01T12:00:00Z

const iso = (days: number, hour = 12, minute = 0): string =>
  new Date(BASE + days * DAY + hour * 3_600_000 + minute * 60_000).toISOString();
const date = (days: number): string => iso(days).slice(0, 10);

const FIRST = [
  'Lucía', 'Mateo', 'Sofía', 'Diego', 'Valeria', 'Kenji', 'Amara', 'Noor', 'Íñigo', 'Zoë',
  'Hugo', 'Elena', 'Omar', 'Marta', 'Ravi', 'Chloé', 'Sara', 'Bruno', 'Aiko', 'Leandro',
  'Nadia', 'Tomás', 'Fatima', 'Lars', 'Camila', 'Yusuf', 'Ingrid', 'Pablo', 'Mei', 'Andrés',
];
const LAST = [
  'García Núñez', 'Fernández', 'Okafor', 'Tanaka', 'Haddad', 'Petrova', 'López', 'Müller',
  'Rossi', 'Silva', 'Kowalski', 'Kim', 'Dubois', 'Navarro', 'Novak', 'Mensah', 'Ivanova',
  'Santos', 'Andersson', 'Costa', 'Moreau', 'Rahman', 'Vega', 'Johansson', 'Yamamoto',
];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const pick = <T>(arr: readonly T[], n: number): T => arr[Math.abs(n) % arr.length];
const money = (min: number, max: number, n: number): number =>
  Math.round(min + (Math.abs(Math.sin(n * 12.9898)) % 1) * (max - min));

export function hashPassword(password: string, salt = 'mafetch-local-seed'): string {
  const iterations = 20_000;
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const expected = Buffer.from(parts[3], 'hex');
  const actual = pbkdf2Sync(password, parts[2], iterations, expected.length, 'sha256');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export const newOpaqueToken = (prefix: string): string =>
  `${prefix}_${createHash('sha256').update(`${Date.now()}:${Math.random()}:${process.hrtime.bigint()}`).digest('base64url').slice(0, 32)}`;

function seedIdentity(db: Db, config: Config): void {
  const total = Math.max(20, Math.round(60 * config.seedScale));
  const normalHash = hashPassword(config.seedPassword);
  const adminHash = hashPassword(config.adminPassword, 'admin-salt');
  const viewerHash = hashPassword('Viewer123!', 'viewer-salt');

  for (let i = 1; i <= total; i++) {
    const isAdmin = i === 1;
    const email = isAdmin ? config.adminEmail : i === 2 ? 'viewer@mafetch.local' : `user${i}@example.com`;
    const name = isAdmin
      ? 'Admin Mafetch'
      : i === 2
        ? 'Vera Observadora'
        : `${pick(FIRST, i * 7)} ${pick(LAST, i * 3)}`;
    const hash = isAdmin ? adminHash : i === 2 ? viewerHash : normalHash;
    const status = i % 13 === 0 ? 'suspended' : i % 11 === 0 ? 'pending' : i % 7 === 0 ? 'inactive' : 'active';
    db.insert('id_users', {
      id: i,
      email,
      password_hash: hash,
      display_name: name,
      status,
      is_admin: isAdmin ? 1 : 0,
      created_at: iso(-500 + i * 3),
      updated_at: iso(-20 + i),
    });
    const first = isAdmin ? 'Admin' : i === 2 ? 'Vera' : pick(FIRST, i * 7);
    const last = isAdmin ? 'Mafetch' : i === 2 ? 'Observadora' : pick(LAST, i * 3);
    db.insert('id_profiles', {
      id: i,
      user_id: i,
      first_name: first,
      last_name: last,
      phone: i % 4 === 0 ? null : `+34 6${String(10_000_000 + i * 137).slice(0, 8)}`,
      bio: i % 10 === 0
        ? `Perfil de prueba ${i}. Trabaja en proyectos internacionales, habla varios idiomas (日本語, العربية, español) y mantiene notas largas para verificar campos de texto extensos.`
        : i % 3 === 0 ? null : `Miembro del equipo de simulación número ${i}.`,
      avatar_url: i % 3 === 0 ? null : `https://cdn.example.test/avatars/${i}.png`,
      birth_date: i % 6 === 0 ? null : date(-12_000 + i * 31),
      locale: i % 5 === 0 ? 'en-GB' : 'es-ES',
      timezone: i % 4 === 0 ? 'UTC' : 'Europe/Madrid',
      updated_at: iso(-10 + i),
    });
    db.insert('id_preferences', {
      id: i,
      user_id: i,
      theme: pick(['light', 'dark', 'system'] as const, i),
      language: i % 5 === 0 ? 'en' : 'es',
      notifications: i % 7 === 0 ? 0 : 1,
      newsletter: i % 3 === 0 ? 1 : 0,
      timezone: i % 4 === 0 ? 'UTC' : 'Europe/Madrid',
      updated_at: iso(-5 + i),
    });
  }

  const roles = [
    ['admin', 'Acceso total'],
    ['manager', 'Gestión de equipos y dominios'],
    ['developer', 'Contribuidor de proyectos'],
    ['viewer', 'Solo lectura'],
    ['auditor', 'Lectura de finanzas y RRHH'],
    ['support', 'Atención a usuarios'],
  ] as const;
  roles.forEach(([name, description], idx) => {
    db.insert('id_roles', { id: idx + 1, name, description, created_at: iso(-600) });
  });

  const perms = [
    'identity:read', 'identity:write', 'projects:read', 'projects:write',
    'shop:read', 'shop:write', 'library:read', 'library:write',
    'education:read', 'education:write', 'hr:read', 'hr:write',
    'finance:read', 'finance:write', 'control:admin',
  ];
  perms.forEach((code, idx) => {
    const [resource, action] = code.split(':');
    db.insert('id_permissions', {
      id: idx + 1,
      code,
      description: `Permiso ${code}`,
      resource,
      action,
    });
  });
  const allPerms = perms.map((_, i) => i + 1);
  const readPerms = [1, 3, 5, 7, 9, 11, 13];
  const rolePerms: Record<number, number[]> = {
    1: allPerms,
    2: [...readPerms, 2, 4, 6, 8, 10, 12],
    3: [1, 3, 4],
    4: readPerms,
    5: [1, 3, 11, 13, 12],
    6: [1, 2, 3, 5, 7],
  };
  let rpId = 0;
  for (const [roleId, permIds] of Object.entries(rolePerms)) {
    for (const permId of permIds) {
      db.insert('id_role_permissions', { id: ++rpId, role_id: Number(roleId), permission_id: permId });
    }
  }

  let urId = 0;
  for (let i = 1; i <= total; i++) {
    db.insert('id_user_roles', {
      id: ++urId,
      user_id: i,
      role_id: i === 1 ? 1 : i === 2 ? 4 : ((i - 3) % 4) + 3,
      assigned_at: iso(-400 + i),
    });
    if (i % 9 === 0 && i !== 3 && !db.get('SELECT 1 AS x FROM id_user_roles WHERE user_id = ? AND role_id = 3', i)) {
      db.insert('id_user_roles', { id: ++urId, user_id: i, role_id: 3, assigned_at: iso(-100 + i) });
    }
  }

  const groups = [
    'Ingeniería', 'Diseño de producto', 'Operaciones', 'Atención al cliente',
    'Dirección', 'Calidad', 'Investigación', 'Seguridad',
  ];
  groups.forEach((name, idx) => {
    db.insert('id_groups', {
      id: idx + 1,
      name,
      description: `Grupo interno ${name}`,
      created_at: iso(-550 + idx * 10),
    });
    for (let k = 0; k < 5; k++) {
      const user = ((idx * 7 + k) % total) + 1;
      db.insert('id_group_members', {
        id: idx * 5 + k + 1,
        group_id: idx + 1,
        user_id: user,
        member_role: k === 0 ? 'owner' : 'member',
        joined_at: iso(-400 + idx * 5 + k),
      });
    }
  });

  let addrId = 0;
  for (let i = 1; i <= total; i++) {
    const count = i % 4 === 0 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      db.insert('id_addresses', {
        id: ++addrId,
        user_id: i,
        label: k === 0 ? 'Casa' : 'Trabajo',
        line1: `Calle ${pick(['Mayor', 'Nueva', 'del Sol', 'de la Estación'] as const, i + k)} ${i * 3 + k}`,
        line2: i % 5 === 0 ? null : `Piso ${1 + (i % 8)}`,
        city: pick(['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Bilbao', 'Lisboa'] as const, i + k),
        region: k === 0 ? 'Comunidad de Madrid' : null,
        postal_code: String(10_000 + i * 7 + k),
        country: i % 9 === 0 ? 'PT' : 'ES',
        is_default: k === 0 ? 1 : 0,
        created_at: iso(-300 + i),
      });
    }
  }

  for (let i = 1; i <= 10; i++) {
    const expired = i % 4 === 0;
    db.insert('id_sessions', {
      id: i,
      user_id: i + 2,
      token_hash: hashToken(`seed-session-${i}`),
      refresh_hash: hashToken(`seed-refresh-${i}`),
      user_agent: i % 2 === 0 ? 'Mafetch-Sim/1.0' : 'curl/8.5.0',
      ip: `127.0.0.${i}`,
      created_at: iso(-30 + i),
      expires_at: iso(expired ? -1 : 60 + i),
      revoked_at: i % 5 === 0 ? iso(-2) : null,
    });
  }

  const seedTokens = [
    { token: config.adminToken, user: 1, kind: 'api', label: 'admin-api' },
    { token: config.viewerToken, user: 2, kind: 'api', label: 'viewer-api' },
    { token: 'expired-sim-token', user: 1, kind: 'api', label: 'expired-demo' },
  ];
  seedTokens.forEach((t, idx) => {
    db.insert('id_tokens', {
      id: idx + 1,
      user_id: t.user,
      kind: t.kind,
      token_hash: hashToken(t.token),
      label: t.label,
      scopes: t.user === 1 ? '["*"]' : '["read"]',
      created_at: iso(-100),
      expires_at: t.token === 'expired-sim-token' ? iso(-5) : iso(365),
      revoked_at: null,
      last_used_at: null,
    });
  });
  for (let i = 4; i <= 14; i++) {
    db.insert('id_tokens', {
      id: i,
      user_id: ((i * 3) % total) + 1,
      kind: i % 3 === 0 ? 'refresh' : i % 3 === 1 ? 'reset' : 'api',
      token_hash: hashToken(`seed-token-${i}`),
      label: `seed-${i}`,
      scopes: '["read"]',
      created_at: iso(-90 + i),
      expires_at: iso(i % 4 === 0 ? -1 : 90 + i),
      revoked_at: null,
      last_used_at: i % 5 === 0 ? iso(-1) : null,
    });
  }

  db.insert('id_api_keys', {
    id: 1,
    user_id: 1,
    name: 'seed-known-key',
    prefix: 'local-te',
    key_hash: hashToken(config.testApiKey),
    scopes: '["*"]',
    created_at: iso(-200),
    expires_at: iso(365),
    last_used_at: null,
    revoked_at: null,
  });
  for (let i = 2; i <= 10; i++) {
    db.insert('id_api_keys', {
      id: i,
      user_id: ((i * 4) % total) + 1,
      name: `seed-key-${i}`,
      prefix: `sim_${String(i).padStart(4, '0')}`,
      key_hash: hashToken(`seed-api-key-${i}`),
      scopes: '["read"]',
      created_at: iso(-150 + i),
      expires_at: i % 5 === 0 ? iso(-1) : iso(200),
      last_used_at: null,
      revoked_at: null,
    });
  }
}

function seedProjects(db: Db, config: Config): void {
  const teamCount = Math.max(4, Math.round(8 * config.seedScale));
  const projectCount = Math.max(12, Math.round(30 * config.seedScale));
  const taskCount = Math.max(40, Math.round(120 * config.seedScale));
  const userCount = db.count('id_users');
  const teamNames = ['Núcleo', 'Atlas', 'Horizonte', 'Faro', 'Orbital', 'Delta', 'Prisma', 'Cauce'];

  for (let i = 1; i <= teamCount; i++) {
    db.insert('pr_teams', {
      id: i,
      name: `${teamNames[(i - 1) % teamNames.length]} ${i}`,
      description: i % 3 === 0 ? 'Equipo multidisciplinar con miembros en varias zonas horarias.' : `Equipo de trabajo ${i}`,
      created_at: iso(-600 + i * 5),
    });
    for (let k = 0; k < 4; k++) {
      const user = ((i * 3 + k * 7) % userCount) + 1;
      db.insert('pr_team_members', {
        id: (i - 1) * 4 + k + 1,
        team_id: i,
        user_id: user,
        member_role: k === 0 ? 'lead' : 'member',
        joined_at: iso(-500 + i * 5 + k),
      });
    }
  }

  const projectNames = [
    'Portal de clientes', 'Migración de datos', 'App móvil', 'Panel analítico',
    'Automatización de facturas', 'Catálogo editorial', 'Integración de pagos',
    'Rediseño de marca', 'API pública', 'Observabilidad', 'Marketplace', 'Onboarding',
    'Búsqueda semántica', 'Programa de fidelización', 'Gestión documental',
  ];
  for (let i = 1; i <= projectCount; i++) {
    const status = pick(['planning', 'active', 'active', 'on_hold', 'completed', 'archived'] as const, i);
    db.insert('pr_projects', {
      id: i,
      name: `${pick(projectNames, i)} ${i}`,
      project_key: `PRJ-${String(i).padStart(3, '0')}`,
      description: i % 7 === 0
        ? 'Proyecto con alcance amplio que incluye investigación, diseño, implementación, despliegue y soporte. Texto extenso para probar campos largos y búsquedas.'
        : i % 4 === 0 ? null : `Iniciativa interna número ${i}.`,
      status,
      owner_id: ((i * 5) % userCount) + 1,
      team_id: ((i - 1) % teamCount) + 1,
      start_date: i % 9 === 0 ? null : date(-300 + i * 7),
      due_date: i % 8 === 0 ? null : date(-60 + i * 9),
      budget_cents: money(1_000_000, 50_000_000, i),
      created_at: iso(-350 + i * 4),
      updated_at: iso(-5 + i),
    });
    const owner = ((i * 5) % userCount) + 1;
    const memberUsers = new Set<number>([owner]);
    db.insert('pr_project_members', {
      id: i,
      project_id: i,
      user_id: owner,
      member_role: 'owner',
      added_at: iso(-350 + i * 4),
    });
    for (let k = 1; k <= 2; k++) {
      const user = ((i * 7 + k * 11) % userCount) + 1;
      if (!memberUsers.has(user)) {
        memberUsers.add(user);
        db.insert('pr_project_members', {
          id: projectCount + (i - 1) * 2 + k,
          project_id: i,
          user_id: user,
          member_role: k === 1 ? 'manager' : 'member',
          added_at: iso(-300 + i * 3 + k),
        });
      }
    }
  }

  const statuses = [
    ['Backlog', 'todo', 1], ['Por hacer', 'todo', 2], ['En progreso', 'in_progress', 3],
    ['En revisión', 'in_progress', 4], ['Bloqueada', 'blocked', 5], ['Hecha', 'done', 6],
  ] as const;
  statuses.forEach(([name, category, order], idx) => {
    db.insert('pr_statuses', { id: idx + 1, name, category, sort_order: order });
  });

  for (let i = 1; i <= taskCount; i++) {
    const projectId = (Math.floor((i - 1) / 4) % projectCount) + 1;
    const done = i % 4 === 0;
    db.insert('pr_tasks', {
      id: i,
      project_id: projectId,
      parent_id: i > 4 && i % 4 === 0 ? i - 1 : null,
      title: `${pick(['Implementar', 'Revisar', 'Diseñar', 'Documentar', 'Probar', 'Optimizar'] as const, i)} ${pick(['formulario', 'endpoint', 'panel', 'flujo', 'componente', 'informe', 'migración'] as const, i + 3)} ${i}`,
      description: i % 11 === 0
        ? `Descripción larga de la tarea ${i}. Incluye criterios de aceptación, dependencias, riesgos y notas de implementación con caracteres Unicode: ñ, ü, 漢字, العربية.`
        : i % 5 === 0 ? null : `Detalle de la tarea ${i}.`,
      status_id: done ? 6 : pick([1, 2, 3, 3, 4, 5] as const, i),
      assignee_id: i % 9 === 0 ? null : ((i * 3) % userCount) + 1,
      priority: pick(['low', 'medium', 'medium', 'high', 'critical'] as const, i),
      due_date: i % 8 === 0 ? null : date(-45 + i * 2),
      estimate_minutes: i % 7 === 0 ? null : pick([30, 60, 120, 240, 480] as const, i),
      position: i,
      created_at: iso(-200 + i),
      updated_at: iso(-20 + i),
      completed_at: done ? iso(-10 + i) : null,
    });
  }

  const commentBodies = [
    'Avanzando según lo previsto. Probando los casos límite.',
    'Necesitamos aclarar el contrato antes de continuar.',
    'He subido una propuesta con ejemplos y capturas. ¿Podemos revisarla mañana?',
    'Bloqueado por dependencia externa; documento el problema en el adjunto.',
    'Listo para revisión. Comprobé los escenarios de error y la documentación.',
  ];
  const commentCount = Math.round(taskCount * 1.4);
  for (let i = 1; i <= commentCount; i++) {
    db.insert('pr_comments', {
      id: i,
      task_id: ((i * 7) % taskCount) + 1,
      author_id: ((i * 5) % userCount) + 1,
      body: pick(commentBodies, i),
      created_at: iso(-150 + i),
    });
  }

  const labels = [
    ['bug', '#dc2626'], ['mejora', '#2563eb'], ['diseño', '#7c3aed'], ['backend', '#0f766e'],
    ['frontend', '#ea580c'], ['infra', '#475569'], ['documentación', '#ca8a04'],
    ['prioridad-alta', '#b91c1c'], ['buena-primera-tarea', '#16a34a'], ['investigación', '#0891b2'],
    ['accesibilidad', '#9333ea'], ['rendimiento', '#c2410c'],
  ];
  labels.forEach(([name, color], idx) => {
    db.insert('pr_labels', { id: idx + 1, name, color });
  });
  let tl = 0;
  for (let task = 1; task <= taskCount; task++) {
    const a = (task % 12) + 1;
    db.insert('pr_task_labels', { id: ++tl, task_id: task, label_id: a });
    if (task % 2 === 0) {
      const b = ((task + 5) % 12) + 1;
      if (b !== a) db.insert('pr_task_labels', { id: ++tl, task_id: task, label_id: b });
    }
  }

  for (let i = 1; i <= Math.round(50 * config.seedScale); i++) {
    db.insert('pr_attachments', {
      id: i,
      task_id: ((i * 3) % taskCount) + 1,
      filename: i % 4 === 0 ? `informe-diseño-${i}.pdf` : `captura_${i}.png`,
      mime_type: i % 4 === 0 ? 'application/pdf' : 'image/png',
      size_bytes: 1024 * (i + 3),
      storage_path: `/uploads/projects/${i}`,
      uploaded_by: ((i * 2) % userCount) + 1,
      created_at: iso(-120 + i),
    });
  }

  for (let i = 1; i <= Math.round(180 * config.seedScale); i++) {
    const action = pick(['created', 'updated', 'commented', 'status_changed', 'assigned', 'archived'] as const, i);
    db.insert('pr_activities', {
      id: i,
      project_id: ((i - 1) % projectCount) + 1,
      task_id: i % 3 === 0 ? ((i * 5) % taskCount) + 1 : null,
      actor_id: ((i * 4) % userCount) + 1,
      action,
      detail: action === 'status_changed' ? 'Estado cambiado de "En progreso" a "Hecha"' : `Actividad ${i}: ${action}`,
      created_at: iso(-100 + (i % 200)),
    });
  }
}

function seedShop(db: Db, config: Config): void {
  const customerCount = Math.max(20, Math.round(60 * config.seedScale));
  const productCount = Math.max(20, Math.round(60 * config.seedScale));
  const userCount = db.count('id_users');
  const rnd = rng(7001);

  for (let i = 1; i <= customerCount; i++) {
    db.insert('shop_customers', {
      id: i,
      email: `customer${i}@example.test`,
      full_name: `${pick(FIRST, i * 11)} ${pick(LAST, i * 5)}`,
      phone: i % 5 === 0 ? null : `+34 6${String(20_000_000 + i * 211).slice(0, 8)}`,
      user_id: i <= Math.min(userCount, 45) ? i : null,
      created_at: iso(-400 + i * 4),
    });
    db.insert('shop_customer_stats', {
      id: i,
      customer_id: i,
      orders_count: 0,
      lifetime_value_cents: 0,
      last_order_at: null,
      loyalty_points: 0,
    });
  }

  const brands = [
    ['Nova', 'nova'], ['Lumen', 'lumen'], ['Aurora', 'aurora'], ['Kanso', 'kanso'],
    ['Terra', 'terra'], ['Pixelia', 'pixelia'], ['Verde', 'verde'], ['Sable', 'sable'],
    ['Marea', 'marea'], ['Origen', 'origen'],
  ];
  brands.forEach(([name, slug], idx) => {
    db.insert('shop_brands', {
      id: idx + 1,
      name,
      slug,
      description: idx % 3 === 0 ? null : `Marca ${name} con catálogo de productos sostenibles.`,
    });
  });

  const categories = [
    ['Informática', 'informatica'], ['Audio', 'audio'], ['Hogar', 'hogar'], ['Libros', 'libros'],
    ['Deporte', 'deporte'], ['Moda', 'moda'], ['Jardín', 'jardin'], ['Juguetes', 'juguetes'],
    ['Oficina', 'oficina'], ['Cocina', 'cocina'], ['Móviles', 'moviles'], ['Accesorios', 'accesorios'],
  ];
  categories.forEach(([name, slug], idx) => {
    db.insert('shop_categories', {
      id: idx + 1,
      parent_id: idx >= 6 ? idx - 5 : null,
      name,
      slug,
      description: `Categoría ${name}`,
    });
  });

  const productNames = [
    'Portátil Atlas 14', 'Auriculares Studio', 'Lámpara Nórdica', 'Cafetera Moka',
    'Zapatillas Ruta', 'Mochila Urbana', 'Teclado Mecánico', 'Monitor 27"',
    'Altavoz Mini', 'Silla Ergonómica', 'Reloj Deportivo', 'Robot Aspirador',
    'Cuaderno A5', 'Botella Térmica', 'Cámara Compacta', 'Set de Plumas',
    'Mancuernas 5 kg', 'Juego de Mesa', 'Sartén Antiadherente', 'Cargador USB-C',
  ];
  for (let i = 1; i <= productCount; i++) {
    db.insert('shop_products', {
      id: i,
      sku: `SKU-${1000 + i}`,
      name: `${pick(productNames, i - 1)} ${i > 20 ? `v${Math.ceil(i / 20)}` : ''}`.trim(),
      slug: `producto-${i}`,
      brand_id: i % 6 === 0 ? null : ((i - 1) % 10) + 1,
      category_id: ((i - 1) % 12) + 1,
      description: i % 9 === 0
        ? 'Descripción extensa del producto con especificaciones técnicas, materiales, garantía y recomendaciones de uso. Compatible con accesorios de la misma familia.'
        : i % 4 === 0 ? null : `Producto de prueba ${i} con garantía de dos años.`,
      price_cents: money(499, 149_999, i),
      currency: 'EUR',
      status: i % 13 === 0 ? 'archived' : i % 10 === 0 ? 'draft' : 'active',
      rating: i % 5 === 0 ? null : Math.round((3.2 + (i % 18) / 10) * 10) / 10,
      created_at: iso(-300 + i * 3),
      updated_at: iso(-30 + i),
    });
    for (let k = 1; k <= 2; k++) {
      db.insert('shop_variants', {
        id: (i - 1) * 2 + k,
        product_id: i,
        sku: `SKU-${1000 + i}-V${k}`,
        name: k === 1 ? 'Estándar' : 'Edición Plus',
        price_cents: money(499, 149_999, i) + k * 500,
        attributes: JSON.stringify({ color: pick(['negro', 'blanco', 'azul', 'verde'] as const, i + k), talla: k === 1 ? 'M' : 'L' }),
        is_active: i % 17 === 0 && k === 2 ? 0 : 1,
      });
    }
    for (let k = 1; k <= (i % 2 === 0 ? 2 : 1); k++) {
      db.insert('shop_images', {
        id: (i - 1) * 2 + k,
        product_id: i,
        url: `https://cdn.example.test/products/${i}-${k}.jpg`,
        alt_text: k === 1 ? `Vista frontal del producto ${i}` : null,
        position: k,
      });
    }
  }

  const warehouses = [
    ['Madrid Central', 'MAD-01', 'Madrid'], ['Barcelona Norte', 'BCN-01', 'Barcelona'],
    ['Lisboa', 'LIS-01', 'Lisboa'], ['Valencia', 'VLC-01', 'Valencia'],
  ];
  warehouses.forEach(([name, code, city], idx) => {
    db.insert('shop_warehouses', { id: idx + 1, name, code, city, country: city === 'Lisboa' ? 'PT' : 'ES' });
  });
  let invId = 0;
  for (let v = 1; v <= productCount * 2; v++) {
    const w1 = ((v - 1) % 4) + 1;
    const w2 = (w1 % 4) + 1;
    for (const w of [w1, w2]) {
      const quantity = Math.floor(rnd() * 30);
      db.insert('shop_inventory', {
        id: ++invId,
        variant_id: v,
        warehouse_id: w,
        quantity,
        reserved: quantity > 2 && w === w2 ? 1 : 0,
        updated_at: iso(-10 + (v % 20)),
      });
    }
  }

  for (let i = 1; i <= customerCount; i++) {
    db.insert('shop_payment_methods', {
      id: i,
      customer_id: i,
      kind: pick(['card', 'card', 'paypal', 'bank_transfer', 'cash'] as const, i),
      label: i % 2 === 0 ? 'Tarjeta personal' : 'Método principal',
      last4: i % 4 === 0 ? null : String(1000 + (i * 7) % 9000),
      is_default: 1,
      created_at: iso(-300 + i),
    });
  }

  const couponDefs = [
    ['SAVE10', 'percent', 10], ['WELCOME5', 'fixed', 500], ['VERANO20', 'percent', 20],
    ['VIP50', 'fixed', 5000], ['ENVIO0', 'fixed', 300], ['BOOKS15', 'percent', 15],
    ['TECH25', 'percent', 25], ['FIXED1000', 'fixed', 1000], ['OLD5', 'percent', 5],
    ['EXPIRED10', 'percent', 10],
  ] as const;
  couponDefs.forEach(([code, kind, value], idx) => {
    db.insert('shop_coupons', {
      id: idx + 1,
      code,
      kind,
      value,
      min_total_cents: idx % 3 === 0 ? 5000 : 0,
      max_uses: idx % 4 === 0 ? 100 : null,
      used_count: idx,
      valid_from: iso(-120),
      valid_until: iso(idx === 9 ? -10 : 200),
      active: idx === 9 ? 0 : 1,
    });
  });

  let addrId = 0;
  const addressByCustomer = new Map<number, number>();
  for (let i = 1; i <= customerCount; i++) {
    const defaultAddressId = ++addrId;
    addressByCustomer.set(i, defaultAddressId);
    db.insert('shop_addresses', {
      id: defaultAddressId,
      customer_id: i,
      label: 'Casa',
      line1: `Avenida ${pick(['Constitución', 'Diagonal', 'del Puerto', 'Libertad'] as const, i)} ${i}`,
      line2: i % 4 === 0 ? null : `Puerta ${i % 9}`,
      city: pick(['Madrid', 'Barcelona', 'Lisboa', 'Valencia'] as const, i),
      postal_code: String(20_000 + i * 13),
      country: i % 8 === 0 ? 'PT' : 'ES',
      is_default: 1,
    });
    if (i % 3 === 0) {
      db.insert('shop_addresses', {
        id: ++addrId,
        customer_id: i,
        label: 'Trabajo',
        line1: `Calle Oficinas ${i}`,
        line2: null,
        city: 'Madrid',
        postal_code: String(28_000 + i),
        country: 'ES',
        is_default: 0,
      });
    }
  }

  const variantPrices = new Map<number, number>();
  for (const row of db.all<{ id: number; price_cents: number }>('SELECT id, price_cents FROM shop_variants')) {
    variantPrices.set(row.id, row.price_cents);
  }
  const variantProduct = new Map<number, number>();
  for (const row of db.all<{ id: number; product_id: number }>('SELECT id, product_id FROM shop_variants')) {
    variantProduct.set(row.id, row.product_id);
  }
  const productNamesById = new Map<number, string>();
  const productSku = new Map<number, string>();
  for (const row of db.all<{ id: number; name: string; sku: string }>('SELECT id, name, sku FROM shop_products')) {
    productNamesById.set(row.id, row.name);
    productSku.set(row.id, row.sku);
  }

  const cartCount = Math.round(30 * config.seedScale);
  for (let i = 1; i <= cartCount; i++) {
    const isOpen = i <= Math.floor(cartCount * 0.6);
    db.insert('shop_carts', {
      id: i,
      customer_id: ((i * 3) % customerCount) + 1,
      status: isOpen ? 'open' : i % 2 === 0 ? 'abandoned' : 'checked_out',
      coupon_id: i % 5 === 0 ? ((i % 5) + 1) : null,
      created_at: iso(-80 + i),
      updated_at: iso(-3 + i),
    });
    if (isOpen) {
      const items = (i % 3) + 1;
      for (let k = 0; k < items; k++) {
        const variant = ((i * 9 + k * 17) % (productCount * 2)) + 1;
        if (db.get('SELECT 1 AS x FROM shop_cart_items WHERE cart_id = ? AND variant_id = ?', i, variant)) continue;
        db.insert('shop_cart_items', {
          cart_id: i,
          variant_id: variant,
          quantity: (k % 2) + 1,
          unit_price_cents: variantPrices.get(variant) ?? 1000,
        });
      }
    }
  }

  const carriers = [
    ['Correos Express', 'CORREOS', 'https://tracking.example.test/correos/{tracking}'],
    ['DHL', 'DHL', 'https://tracking.example.test/dhl/{tracking}'],
    ['SEUR', 'SEUR', 'https://tracking.example.test/seur/{tracking}'],
    ['MRW', 'MRW', null],
    ['GLS', 'GLS', 'https://tracking.example.test/gls/{tracking}'],
  ];
  carriers.forEach(([name, code, template], idx) => {
    db.insert('shop_carriers', { id: idx + 1, name, code, tracking_url_template: template });
  });

  const orderStatuses = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'delivered', 'cancelled', 'refunded'];
  const orderCount = Math.max(20, Math.round(80 * config.seedScale));
  let paymentId = 0;
  let refundId = 0;
  let shipmentId = 0;
  const paidOrders: number[] = [];

  for (let i = 1; i <= orderCount; i++) {
    const status = pick(orderStatuses as never[], i);
    const customerId = ((i * 7) % customerCount) + 1;
    const itemCount = (i % 3) + 1;
    const items: Array<{ variantId: number; productId: number; quantity: number; unit: number }> = [];
    let subtotal = 0;
    for (let k = 0; k < itemCount; k++) {
      const variantId = ((i * 11 + k * 13) % (productCount * 2)) + 1;
      if (items.some((it) => it.variantId === variantId)) continue;
      const quantity = (k % 2) + 1;
      const unit = variantPrices.get(variantId) ?? 999;
      items.push({ variantId, productId: variantProduct.get(variantId) ?? 1, quantity, unit });
      subtotal += quantity * unit;
    }
    const discount = i % 6 === 0 ? Math.min(Math.round(subtotal * 0.1), 2000) : 0;
    const shipping = subtotal >= 5000 ? 0 : 599;
    const tax = Math.round((subtotal - discount + shipping) * 0.21);
    const total = subtotal - discount + shipping + tax;
    const orderDate = iso(-200 + i * 2);
    db.insert('shop_orders', {
      id: i,
      order_number: `ORD-2026-${String(1000 + i)}`,
      customer_id: customerId,
      status,
      subtotal_cents: subtotal,
      discount_cents: discount,
      shipping_cents: shipping,
      tax_cents: tax,
      total_cents: total,
      currency: 'EUR',
      coupon_id: discount > 0 ? 1 : null,
      shipping_address_id: addressByCustomer.get(customerId) ?? null,
      created_at: orderDate,
      updated_at: iso(-150 + i * 2),
      canceled_at: status === 'cancelled' ? iso(-100 + i) : null,
    });
    let orderItemId = (i - 1) * 4;
    for (const item of items) {
      db.insert('shop_order_items', {
        id: ++orderItemId,
        order_id: i,
        variant_id: item.variantId,
        product_name: productNamesById.get(item.productId) ?? `Producto ${item.productId}`,
        sku: productSku.get(item.productId) ?? `SKU-${item.productId}`,
        quantity: item.quantity,
        unit_price_cents: item.unit,
        line_total_cents: item.quantity * item.unit,
      });
    }
    if (!['pending', 'cancelled'].includes(status)) {
      db.insert('shop_payments', {
        id: ++paymentId,
        order_id: i,
        method_id: customerId,
        status: status === 'refunded' ? 'refunded' : 'captured',
        amount_cents: total,
        provider_ref: `PAY-${i}-${rnd().toString(36).slice(2, 10)}`,
        created_at: orderDate,
        processed_at: orderDate,
      });
      paidOrders.push(i);
      if (status === 'refunded' || (status === 'delivered' && i % 7 === 0)) {
        db.insert('shop_refunds', {
          id: ++refundId,
          payment_id: paymentId,
          order_id: i,
          amount_cents: status === 'refunded' ? total : Math.min(1500, total),
          reason: status === 'refunded' ? 'Devolución completa solicitada por el cliente' : 'Ajuste parcial acordado',
          status: 'completed',
          created_at: iso(-50 + i),
          completed_at: iso(-45 + i),
        });
      }
    }
    if (['shipped', 'delivered'].includes(status)) {
      const shipmentStatus = status === 'delivered' ? 'delivered' : pick(['in_transit', 'out_for_delivery'] as const, i);
      db.insert('shop_shipments', {
        id: ++shipmentId,
        order_id: i,
        carrier_id: (i % 5) + 1,
        tracking_number: `TRK-${String(70_000 + i)}`,
        status: shipmentStatus,
        shipped_at: iso(-60 + i),
        delivered_at: shipmentStatus === 'delivered' ? iso(-50 + i) : null,
        estimated_delivery: date(-40 + i),
      });
    }
  }

  db.exec(`
    UPDATE shop_customer_stats SET
      orders_count = (SELECT COUNT(*) FROM shop_orders o WHERE o.customer_id = shop_customer_stats.customer_id AND o.status NOT IN ('cancelled')),
      lifetime_value_cents = (SELECT COALESCE(SUM(o.total_cents),0) FROM shop_orders o WHERE o.customer_id = shop_customer_stats.customer_id AND o.status NOT IN ('cancelled')),
      last_order_at = (SELECT MAX(o.created_at) FROM shop_orders o WHERE o.customer_id = shop_customer_stats.customer_id),
      loyalty_points = (SELECT COUNT(*) * 10 FROM shop_orders o WHERE o.customer_id = shop_customer_stats.customer_id AND o.status = 'delivered')
  `);

  const reviewCount = Math.min(Math.round(100 * config.seedScale), productCount * customerCount);
  for (let i = 1; i <= reviewCount; i++) {
    const productId = ((i - 1) % productCount) + 1;
    const customerId = (Math.floor((i - 1) / productCount) % customerCount) + 1;
    db.insert('shop_reviews', {
      id: i,
      product_id: productId,
      customer_id: customerId,
      rating: 1 + (i % 5),
      title: i % 4 === 0 ? null : pick(['Muy bueno', 'Cumple lo esperado', 'Mejor de lo que pensaba', 'Puede mejorar'] as const, i),
      body: i % 3 === 0
        ? 'El producto llegó bien embalado. La calidad es buena y el envío fue rápido. Repetiré la compra sin duda.'
        : i % 7 === 0 ? null : `Reseña de prueba número ${i}.`,
      created_at: iso(-100 + i),
    });
  }
}

function seedLibrary(db: Db, config: Config): void {
  const bookCount = Math.max(20, Math.round(60 * config.seedScale));
  const authorCount = Math.max(10, Math.round(25 * config.seedScale));
  const readerCount = Math.max(15, Math.round(50 * config.seedScale));
  const userCount = db.count('id_users');

  const authorNames = [
    'Gabriel García Márquez', 'Isabel Allende', 'Haruki Murakami', 'Ursula K. Le Guin',
    'Jorge Luis Borges', 'Chimamanda Ngozi Adichie', 'Elena Ferrante', 'Liu Cixin',
    'Svetlana Alexiévich', 'Han Kang', 'Julio Cortázar', 'Clarice Lispector',
    'Yukio Mishima', 'Octavia Butler', 'Fiódor Dostoievski', 'Virginia Woolf',
    'Italo Calvino', 'Nnedi Okorafor', 'Roberto Bolaño', 'Sara Mesa',
    'N. K. Jemisin', 'Mohsin Hamid', 'Olga Tokarczuk', 'Ted Chiang', 'Arundhati Roy',
  ];
  for (let i = 1; i <= authorCount; i++) {
    db.insert('lib_authors', {
      id: i,
      name: `${pick(authorNames, i - 1)}${i > authorNames.length ? ` (${i})` : ''}`,
      bio: i % 3 === 0 ? null : `Autor/a número ${i}, conocido por obras traducidas a varios idiomas.`,
      birth_date: i % 4 === 0 ? null : date(-20_000 + i * 200),
      nationality: pick(['Colombia', 'Chile', 'Japón', 'EE. UU.', 'Argentina', 'Nigeria', 'Italia', 'China', 'Bielorrusia', 'Corea del Sur'] as const, i),
    });
  }
  const publisherNames = ['Alfaguara', 'Anagrama', 'Tusquets', 'Planeta', 'Salamandra', 'Minotauro', 'Debolsillo', 'Cátedra', 'Acantilado', 'Impedimenta'];
  publisherNames.forEach((name, idx) => {
    db.insert('lib_publishers', {
      id: idx + 1,
      name,
      country: pick(['España', 'México', 'Argentina', 'Colombia'] as const, idx),
      website: `https://publisher${idx + 1}.example.test`,
    });
  });
  const genres = ['Novela', 'Ensayo', 'Ciencia ficción', 'Fantasía', 'Poesía', 'Historia', 'Misterio', 'Biografía', 'Tecnología', 'Infantil'];
  genres.forEach((name, idx) => {
    db.insert('lib_genres', { id: idx + 1, name, description: `Género ${name} de la biblioteca` });
  });

  const titles = [
    'Cien años de soledad', 'La casa de los espíritus', 'Tokio blues', 'La mano izquierda de la oscuridad',
    'Ficciones', 'Americanah', 'La amiga estupenda', 'El problema de los tres cuerpos',
    'Voces de Chernóbil', 'La vegetariana', 'Rayuela', 'La hora de la estrella',
    'El marino que perdió la gracia del mar', 'Kindred', 'Crimen y castigo', 'La señora Dalloway',
    'Las ciudades invisibles', 'La muerte de Vivek Oji', '2666', 'Cara de pan',
  ];
  for (let i = 1; i <= bookCount; i++) {
    db.insert('lib_books', {
      id: i,
      isbn: `978-84-${String(1000 + i)}-${i % 10}`,
      title: `${pick(titles, i - 1)}${i > titles.length ? ` ${Math.ceil(i / titles.length)}` : ''}`,
      subtitle: i % 4 === 0 ? null : `Edición conmemorativa ${i}`,
      publisher_id: i % 11 === 0 ? null : ((i - 1) % 10) + 1,
      published_year: i % 7 === 0 ? null : 1950 + (i % 75),
      language: pick(['es', 'en', 'fr', 'ja'] as const, i),
      pages: i % 6 === 0 ? null : 120 + i * 7,
      description: i % 5 === 0
        ? 'Una obra extensa que explora la memoria, la identidad y el paso del tiempo a través de personajes inolvidables. Esta descripción larga sirve para probar búsquedas y campos de texto amplios.'
        : `Novela de prueba número ${i}.`,
      cover_url: i % 3 === 0 ? null : `https://cdn.example.test/books/${i}.jpg`,
      created_at: iso(-400 + i * 3),
    });
    db.insert('lib_book_authors', { id: i, book_id: i, author_id: ((i - 1) % authorCount) + 1, author_role: 'author' });
    if (i % 3 === 0) {
      db.insert('lib_book_authors', {
        id: bookCount + i,
        book_id: i,
        author_id: ((i + 3) % authorCount) + 1,
        author_role: 'translator',
      });
    }
    db.insert('lib_book_genres', { id: i, book_id: i, genre_id: ((i - 1) % 10) + 1 });
    if (i % 2 === 0) {
      db.insert('lib_book_genres', { id: bookCount + i, book_id: i, genre_id: ((i + 4) % 10) + 1 });
    }
  }

  for (let i = 1; i <= Math.round(120 * config.seedScale); i++) {
    db.insert('lib_copies', {
      id: i,
      book_id: ((i - 1) % bookCount) + 1,
      barcode: `LIB-${String(10_000 + i)}`,
      status: i % 31 === 0 ? 'maintenance' : i % 47 === 0 ? 'lost' : 'available',
      acquired_at: iso(-800 + i * 2),
      shelf: `E${(i % 12) + 1}-${(i % 6) + 1}`,
    });
  }

  for (let i = 1; i <= readerCount; i++) {
    db.insert('lib_readers', {
      id: i,
      user_id: i <= Math.min(userCount, 40) ? i : null,
      card_number: `RDR-${String(5000 + i)}`,
      full_name: `${pick(FIRST, i * 13)} ${pick(LAST, i * 9)}`,
      email: `reader${i}@example.test`,
      phone: i % 5 === 0 ? null : `+34 9${String(30_000_000 + i * 173).slice(0, 8)}`,
      joined_at: iso(-700 + i * 8),
      status: i % 17 === 0 ? 'suspended' : i % 23 === 0 ? 'expired' : 'active',
    });
  }

  let fineSeq = 0;
  for (let i = 1; i <= Math.round(90 * config.seedScale); i++) {
    const active = i % 4 === 0;
    const overdue = !active && i % 9 === 0;
    const loanedDays = -240 + i * 2;
    const dueDays = loanedDays + 14;
    const returned = !active;
    const lateDays = overdue ? 8 : 0;
    const fine = overdue ? 25 * lateDays : 0;
    db.insert('lib_loans', {
      id: i,
      copy_id: ((i - 1) % Math.round(120 * config.seedScale)) + 1,
      reader_id: ((i * 3) % readerCount) + 1,
      loaned_at: date(loanedDays),
      due_at: date(dueDays),
      returned_at: returned ? iso(dueDays + lateDays) : null,
      status: overdue ? 'overdue' : active ? 'active' : 'returned',
      fine_cents: fine,
    });
    if (active) {
      db.run('UPDATE lib_copies SET status = ? WHERE id = ?', 'on_loan', ((i - 1) % Math.round(120 * config.seedScale)) + 1);
    }
    if (fine > 0) {
      db.insert('lib_fines', {
        id: ++fineSeq,
        loan_id: i,
        reader_id: ((i * 3) % readerCount) + 1,
        amount_cents: fine,
        reason: `Retraso de ${lateDays} días en la devolución`,
        status: i % 2 === 0 ? 'paid' : 'unpaid',
        issued_at: iso(dueDays + lateDays),
        paid_at: i % 2 === 0 ? iso(dueDays + lateDays + 1) : null,
      });
    }
  }

  for (let i = 1; i <= Math.round(30 * config.seedScale); i++) {
    const active = i <= 15;
    const book = ((i * 2 - 1) % bookCount) + 1;
    db.insert('lib_reservations', {
      id: i,
      book_id: book,
      reader_id: ((i * 5) % readerCount) + 1,
      status: active ? (i % 3 === 0 ? 'ready' : 'pending') : pick(['fulfilled', 'cancelled', 'expired'] as const, i),
      reserved_at: iso(-70 + i * 2),
      expires_at: active ? iso(7 + i) : null,
    });
  }
}

function seedEducation(db: Db, config: Config): void {
  const studentCount = Math.max(25, Math.round(60 * config.seedScale));
  const teacherCount = Math.max(8, Math.round(16 * config.seedScale));

  for (let i = 1; i <= teacherCount; i++) {
    db.insert('edu_teachers', {
      id: i,
      employee_code: `TCH-${String(100 + i)}`,
      full_name: `${pick(FIRST, i * 17)} ${pick(LAST, i * 7)}`,
      email: `teacher${i}@education.test`,
      department: pick(['Ciencias', 'Humanidades', 'Tecnología', 'Artes'] as const, i),
      hired_at: date(-2000 + i * 40),
    });
  }
  for (let i = 1; i <= studentCount; i++) {
    db.insert('edu_students', {
      id: i,
      student_code: `STU-${String(10_000 + i)}`,
      full_name: `${pick(FIRST, i * 19)} ${pick(LAST, i * 11)}`,
      email: `student${i}@education.test`,
      birth_date: i % 8 === 0 ? null : date(-8_000 + i * 21),
      status: i % 15 === 0 ? 'suspended' : i % 11 === 0 ? 'graduated' : 'active',
      enrolled_at: iso(-700 + i * 8),
    });
  }

  const courseDefs = [
    ['Grado en Informática', 'INF', 240], ['Grado en Diseño', 'DIS', 240], ['Máster en Datos', 'DAT', 120],
    ['Grado en Matemáticas', 'MAT', 240], ['Grado en Historia', 'HIS', 240], ['Máster en Educación', 'EDU', 120],
    ['Grado en Bellas Artes', 'ART', 240], ['Grado en Física', 'FIS', 240], ['Máster en IA', 'IA', 120],
    ['Grado en Economía', 'ECO', 240], ['Grado en Filosofía', 'FIL', 240], ['Curso de Acceso', 'ACC', 60],
  ];
  courseDefs.forEach(([name, code, credits], idx) => {
    db.insert('edu_courses', {
      id: idx + 1,
      code,
      name,
      description: `Programa académico ${name} con prácticas y evaluación continua.`,
      credits,
      department: pick(['Tecnología', 'Artes', 'Ciencias', 'Humanidades'] as const, idx),
      active: idx === 11 ? 0 : 1,
    });
  });

  const subjectDefs = [
    'Programación I', 'Bases de Datos', 'Álgebra Lineal', 'Fundamentos de Diseño',
    'Estadística', 'Redes', 'Inteligencia Artificial', 'Historia Contemporánea',
    'Didáctica', 'Pintura', 'Física I', 'Microeconomía', 'Ética', 'Cálculo',
    'Sistemas Operativos', 'Interacción Persona-Ordenador', 'Aprendizaje Automático',
    'Literatura', 'Música', 'Química', 'Metodología', 'Proyectos', 'Seguridad', 'Animación',
  ];
  subjectDefs.forEach((name, idx) => {
    db.insert('edu_subjects', {
      id: idx + 1,
      code: `SUB-${String(200 + idx)}`,
      name,
      course_id: (idx % 12) + 1,
      credits: 3 + (idx % 6),
      area: pick(['Ciencias', 'Tecnología', 'Artes', 'Humanidades'] as const, idx),
      description: idx % 4 === 0 ? null : `Asignatura ${name} perteneciente al programa correspondiente.`,
    });
  });

  const sectionCount = Math.round(36 * config.seedScale);
  for (let i = 1; i <= sectionCount; i++) {
    const subjectId = ((i - 1) % subjectDefs.length) + 1;
    const term = i % 2 === 0 ? '2026-2' : '2026-1';
    db.insert('edu_sections', {
      id: i,
      subject_id: subjectId,
      term,
      section_code: `SEC-${term}-${String(i).padStart(3, '0')}`,
      teacher_id: ((i - 1) % teacherCount) + 1,
      capacity: 20 + (i % 20),
      room: `Aula ${1 + (i % 15)}`,
      schedule: i % 3 === 0 ? 'Lun/Mié 10:00-12:00' : 'Mar/Jue 16:00-18:00',
    });
  }

  let enrollmentId = 0;
  for (let student = 1; student <= studentCount; student++) {
    const course = (student % 12) + 1;
    db.insert('edu_enrollments', {
      id: ++enrollmentId,
      student_id: student,
      course_id: course,
      section_id: null,
      term: '2026-1',
      enrolled_at: iso(-300 + student),
      status: student % 15 === 0 ? 'withdrawn' : student % 11 === 0 ? 'completed' : 'enrolled',
    });
    if (student <= Math.max(10, Math.floor(studentCount * 0.8))) {
      const course2 = ((student + 3) % 12) + 1;
      db.insert('edu_enrollments', {
        id: ++enrollmentId,
        student_id: student,
        course_id: course2,
        section_id: null,
        term: '2026-2',
        enrolled_at: iso(-200 + student),
        status: 'enrolled',
      });
    }
  }

  for (let i = 1; i <= sectionCount * 2; i++) {
    const sectionId = Math.floor((i - 1) / 2) + 1;
    db.insert('edu_evaluations', {
      id: i,
      section_id: sectionId,
      name: i % 2 === 0 ? 'Examen final' : 'Evaluación continua',
      kind: i % 2 === 0 ? 'exam' : 'assignment',
      max_score: 100,
      weight: i % 2 === 0 ? 0.6 : 0.4,
      due_date: date(-20 + i * 3),
    });
  }

  let gradeId = 0;
  for (let section = 1; section <= sectionCount; section++) {
    for (let k = 0; k < 3; k++) {
      const student = ((section * 3 + k) % studentCount) + 1;
      const evalId = (section - 1) * 2 + 1;
      const score = Math.round((55 + ((section * 7 + k * 13) % 45)) * 10) / 10;
      db.insert('edu_grades', {
        id: ++gradeId,
        student_id: student,
        section_id: section,
        evaluation_id: evalId,
        score,
        letter: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F',
        comments: k === 0 && section % 5 === 0 ? 'Buen progreso; mejorar la entrega final.' : null,
        graded_at: iso(-30 + section),
      });
      if (section % 2 === 0) {
        const score2 = Math.round((50 + ((section * 11 + k * 7) % 50)) * 10) / 10;
        db.insert('edu_grades', {
          id: ++gradeId,
          student_id: student,
          section_id: section,
          evaluation_id: evalId + 1,
          score: score2,
          letter: score2 >= 90 ? 'A' : score2 >= 80 ? 'B' : score2 >= 70 ? 'C' : score2 >= 60 ? 'D' : 'F',
          comments: null,
          graded_at: iso(-15 + section),
        });
      }
    }
  }

  const attendanceCount = Math.round(150 * config.seedScale);
  for (let i = 1; i <= attendanceCount; i++) {
    const section = ((i - 1) % sectionCount) + 1;
    const student = ((i * 7) % studentCount) + 1;
    const day = -60 + Math.floor((i - 1) / sectionCount) * 3 + (i % 3);
    db.insert('edu_attendance', {
      id: i,
      student_id: student,
      section_id: section,
      attendance_date: date(day),
      status: pick(['present', 'present', 'present', 'late', 'absent', 'excused'] as const, i),
      notes: i % 9 === 0 ? 'Justificante médico presentado.' : null,
    });
  }

  for (let i = 1; i <= Math.round(50 * config.seedScale); i++) {
    db.insert('edu_materials', {
      id: i,
      section_id: ((i - 1) % sectionCount) + 1,
      title: `Material ${i}: ${pick(['Guía de estudio', 'Presentación', 'Ejercicios', 'Lectura complementaria', 'Vídeo de clase'] as const, i)}`,
      kind: pick(['pdf', 'video', 'link', 'slides', 'other'] as const, i),
      url: `https://materials.example.test/${i}`,
      description: i % 4 === 0 ? null : `Recurso educativo número ${i}.`,
      created_at: iso(-90 + i),
    });
  }
}

function seedHr(db: Db, config: Config): void {
  const employeeCount = Math.max(20, Math.round(50 * config.seedScale));
  const deptDefs = [
    ['Ingeniería', 'ENG', 90_000_000], ['Producto', 'PRD', 60_000_000], ['Ventas', 'SAL', 50_000_000],
    ['Marketing', 'MKT', 40_000_000], ['Finanzas', 'FIN', 45_000_000], ['Personas', 'HR', 35_000_000],
  ];
  deptDefs.forEach(([name, code, budget], idx) => {
    db.insert('hr_departments', {
      id: idx + 1,
      name,
      code,
      manager_id: null,
      budget_cents: budget,
      created_at: iso(-900 + idx * 30),
    });
  });

  const positionDefs = [
    'Ingeniero/a de software', 'Arquitecto/a de datos', 'Diseñador/a de producto',
    'Jefe/a de ventas', 'Especialista de marketing', 'Analista financiero/a',
  ];
  for (let i = 1; i <= 12; i++) {
    const dept = ((i - 1) % 6) + 1;
    const level = i <= 6 ? (i % 2 === 0 ? 'senior' : 'mid') : (i % 3 === 0 ? 'lead' : 'junior');
    const min = 2_400_000 + dept * 150_000 + (level === 'senior' ? 800_000 : level === 'lead' ? 1_200_000 : 0);
    db.insert('hr_positions', {
      id: i,
      title: `${pick(positionDefs, dept - 1)} ${i > 6 ? 'II' : 'I'}`,
      department_id: dept,
      level,
      min_salary_cents: min,
      max_salary_cents: min + 2_500_000,
    });
  }

  for (let i = 1; i <= employeeCount; i++) {
    const dept = ((i - 1) % 6) + 1;
    const position = dept + (i % 2) * 6;
    const terminated = i % 19 === 0;
    const hireDays = -2500 + (i % 40) * 35;
    const terminationDays = hireDays + 365 + (i % 3) * 30;
    db.insert('hr_employees', {
      id: i,
      employee_code: `EMP-${String(1000 + i)}`,
      full_name: `${pick(FIRST, i * 23)} ${pick(LAST, i * 13)}`,
      email: `employee${i}@corp.example.test`,
      department_id: dept,
      position_id: position,
      manager_id: i <= 6 ? null : ((i - 7) % 6) + 1,
      hire_date: date(hireDays),
      termination_date: terminated ? date(terminationDays) : null,
      status: terminated ? 'terminated' : i % 14 === 0 ? 'on_leave' : 'active',
    });
  }
  for (let d = 1; d <= 6; d++) {
    db.run('UPDATE hr_departments SET manager_id = ? WHERE id = ?', d, d);
  }

  for (let i = 1; i <= employeeCount; i++) {
    const base = 2_800_000 + (i % 20) * 100_000;
    const hireDays = -2500 + (i % 40) * 35;
    db.insert('hr_contracts', {
      id: i,
      employee_id: i,
      kind: pick(['permanent', 'permanent', 'temporary', 'internship', 'contractor'] as const, i),
      start_date: date(hireDays),
      end_date: i % 5 === 0 ? date(hireDays + 730) : null,
      weekly_hours: pick([20, 30, 35, 40, 40] as const, i),
      gross_annual_cents: base * 12,
      signed_at: iso(hireDays - 5),
      status: i % 19 === 0 ? 'ended' : 'active',
    });
  }

  let salaryId = 0;
  const periods = ['2026-04-01', '2026-05-01', '2026-06-01'];
  for (let p = 0; p < periods.length; p++) {
    const employeeLimit = p === 2 ? Math.min(20, employeeCount) : employeeCount;
    for (let i = 1; i <= employeeLimit; i++) {
      const base = 2_800_000 + (i % 20) * 100_000;
      const bonus = p === 1 ? 150_000 : 0;
      const deductions = Math.round(base * 0.18);
      db.insert('hr_salaries', {
        id: ++salaryId,
        employee_id: i,
        period_start: periods[p],
        period_end: date(-25 + p * 30),
        base_cents: base,
        bonus_cents: bonus,
        deductions_cents: deductions,
        net_cents: base + bonus - deductions,
        paid_at: iso(-30 + p * 30),
      });
    }
  }

  for (let i = 1; i <= Math.round(60 * config.seedScale); i++) {
    const start = -120 + i * 3;
    const days = 1 + (i % 10);
    db.insert('hr_vacations', {
      id: i,
      employee_id: ((i * 3) % employeeCount) + 1,
      start_date: date(start),
      end_date: date(start + days),
      days,
      status: pick(['pending', 'approved', 'approved', 'rejected', 'cancelled'] as const, i),
      reason: i % 5 === 0 ? null : pick(['Vacaciones familiares', 'Viaje personal', 'Asuntos propios', 'Descanso'] as const, i),
      requested_at: iso(start - 20),
      decided_at: i % 4 === 0 ? iso(start - 10) : null,
    });
  }

  for (let i = 1; i <= Math.round(140 * config.seedScale); i++) {
    const employee = ((i - 1) % employeeCount) + 1;
    const day = -10 - Math.floor((i - 1) / employeeCount);
    db.insert('hr_attendance', {
      id: i,
      employee_id: employee,
      work_date: date(day),
      check_in: i % 11 === 0 ? null : '09:00',
      check_out: i % 11 === 0 ? null : '17:30',
      hours_worked: i % 11 === 0 ? 0 : 8 + (i % 2) * 0.5,
      status: i % 11 === 0 ? 'absent' : pick(['present', 'remote', 'late', 'present'] as const, i),
    });
  }
}

function seedFinance(db: Db, config: Config): void {
  const supplierNames = [
    'Tecnologías Aplicadas S.L.', 'Suministros Norte', 'Cloud & Data', 'Papelería Central',
    'Energía Verde', 'Transportes Rápidos', 'Consultores Asociados', 'Mobiliario Oficina',
    'Seguros Delta', 'Formación Continua', 'Marketing Digital', 'Laboratorio Beta',
    'Servicios Integrales', 'Limpiezas Norte', 'Cafés Selectos', 'Editorial Técnica',
    'Redes y Comunicaciones', 'Auditoría Externa', 'Mensajería Urgente', 'Material Médico',
  ];
  const supplierCount = Math.max(10, Math.round(20 * config.seedScale));
  for (let i = 1; i <= supplierCount; i++) {
    db.insert('fin_suppliers', {
      id: i,
      name: `${pick(supplierNames, i - 1)}${i > supplierNames.length ? ` ${i}` : ''}`,
      email: `billing${i}@supplier.test`,
      tax_id: `ESB${String(10_000_000 + i * 37)}`,
      iban: i % 5 === 0 ? null : `ES91 2100 0418 45${String(100_000 + i)}`,
      status: i % 13 === 0 ? 'blocked' : i % 9 === 0 ? 'inactive' : 'active',
    });
  }

  const accountDefs = [
    ['1000', 'Caja', 'asset'], ['1100', 'Banco principal', 'asset'], ['1200', 'Banco secundario', 'asset'],
    ['2000', 'Proveedores', 'liability'], ['2100', 'Nóminas pendientes', 'liability'],
    ['3000', 'Capital social', 'equity'], ['4000', 'Ingresos por ventas', 'income'],
    ['4100', 'Ingresos por servicios', 'income'], ['6000', 'Gastos de personal', 'expense'],
    ['6100', 'Gastos operativos', 'expense'],
  ] as const;
  accountDefs.forEach(([code, name, kind], idx) => {
    db.insert('fin_accounts', {
      id: idx + 1,
      code,
      name,
      kind,
      currency: 'EUR',
      balance_cents: money(1_000_00, 500_000_00, idx + 1) * (kind === 'expense' || kind === 'liability' ? -1 : 1),
      opened_at: date(-1200 + idx * 20),
      active: 1,
    });
  });

  const categories = ['software', 'viajes', 'oficina', 'formación', 'marketing', 'servicios', 'personal', 'energía'];
  const txCount = Math.round(120 * config.seedScale);
  for (let i = 1; i <= txCount; i++) {
    db.insert('fin_transactions', {
      id: i,
      account_id: ((i - 1) % 10) + 1,
      kind: i % 3 === 0 ? 'debit' : 'credit',
      amount_cents: money(5_000, 500_000, i),
      description: `${i % 3 === 0 ? 'Pago' : 'Cobro'} de ${pick(categories, i)} número ${i}`,
      category: pick(categories, i),
      reference: `TX-2026-${String(10_000 + i)}`,
      occurred_at: iso(-250 + i * 2),
      created_at: iso(-250 + i * 2),
    });
  }

  const invoiceStatuses = ['draft', 'issued', 'issued', 'paid', 'paid', 'overdue', 'void'];
  const invoiceCount = Math.max(20, Math.round(60 * config.seedScale));
  for (let i = 1; i <= invoiceCount; i++) {
    const issue = date(-180 + i * 2);
    const itemCount = 2;
    let subtotal = 0;
    const items = Array.from({ length: itemCount }, (_, k) => {
      const quantity = 1 + ((i + k) % 4);
      const unit = money(10_000, 250_000, i * 3 + k);
      const total = quantity * unit;
      subtotal += total;
      return { quantity, unit, total, description: `Servicio ${pick(['consultoría', 'licencia', 'mantenimiento', 'formación'] as const, i + k)} ${i}-${k + 1}` };
    });
    const tax = Math.round(subtotal * 0.21);
    const total = subtotal + tax;
    db.insert('fin_invoices', {
      id: i,
      invoice_number: `INV-2026-${String(1000 + i)}`,
      supplier_id: i % 7 === 0 ? null : ((i - 1) % supplierCount) + 1,
      customer_name: i % 2 === 0 ? 'Mafetch Labs S.L.' : `Cliente Corporativo ${i}`,
      status: pick(invoiceStatuses as never[], i),
      issue_date: issue,
      due_date: date(-180 + i * 2 + 30),
      subtotal_cents: subtotal,
      tax_cents: tax,
      total_cents: total,
      currency: 'EUR',
      notes: i % 6 === 0 ? 'Pago a 30 días. Referencia obligatoria en la transferencia.' : null,
    });
    items.forEach((it, k) => {
      db.insert('fin_invoice_items', {
        id: (i - 1) * itemCount + k + 1,
        invoice_id: i,
        description: it.description,
        quantity: it.quantity,
        unit_price_cents: it.unit,
        tax_rate: 0.21,
        total_cents: it.total,
      });
    });
  }

  const expenseCount = Math.max(20, Math.round(70 * config.seedScale));
  for (let i = 1; i <= expenseCount; i++) {
    db.insert('fin_expenses', {
      id: i,
      employee_id: i % 9 === 0 ? null : ((i - 1) % Math.max(1, db.count('hr_employees'))) + 1,
      supplier_id: i % 6 === 0 ? null : ((i - 1) % supplierCount) + 1,
      category: pick(categories, i),
      description: `Gasto ${i}: ${pick(['billete de tren', 'licencia anual', 'material de oficina', 'curso online', 'campaña de anuncios', 'reparación'] as const, i)}`,
      amount_cents: money(2_000, 300_000, i),
      status: pick(['draft', 'submitted', 'approved', 'rejected', 'reimbursed'] as const, i),
      incurred_on: date(-160 + i * 2),
      approved_by: i % 3 === 0 ? 1 : null,
      created_at: iso(-150 + i * 2),
    });
  }

  const budgetCategories = ['personal', 'software', 'viajes', 'marketing', 'formación'];
  let budgetId = 0;
  for (let dept = 1; dept <= 6; dept++) {
    for (let c = 0; c < 3; c++) {
      const category = budgetCategories[(dept + c) % budgetCategories.length];
      if (db.get('SELECT 1 AS x FROM fin_budgets WHERE department_id = ? AND year = ? AND category = ?', dept, 2026, category)) continue;
      db.insert('fin_budgets', {
        id: ++budgetId,
        department_id: dept,
        year: 2026,
        category,
        planned_cents: money(500_000, 20_000_000, dept * 10 + c),
        spent_cents: money(100_000, 12_000_000, dept * 7 + c),
      });
    }
  }

  let paymentId = 0;
  const paidInvoices = db.all<{ id: number; total_cents: number }>(
    "SELECT id, total_cents FROM fin_invoices WHERE status = 'paid' ORDER BY id LIMIT 35",
  );
  for (const inv of paidInvoices) {
    db.insert('fin_payments', {
      id: ++paymentId,
      invoice_id: inv.id,
      expense_id: null,
      account_id: 2,
      amount_cents: inv.total_cents,
      method: 'transfer',
      status: 'completed',
      paid_at: iso(-80 + inv.id),
      reference: `FPAY-INV-${inv.id}`,
    });
  }
  const approvedExpenses = db.all<{ id: number; amount_cents: number }>(
    "SELECT id, amount_cents FROM fin_expenses WHERE status IN ('approved','reimbursed') ORDER BY id LIMIT 20",
  );
  for (const exp of approvedExpenses) {
    db.insert('fin_payments', {
      id: ++paymentId,
      invoice_id: null,
      expense_id: exp.id,
      account_id: 2,
      amount_cents: exp.amount_cents,
      method: 'transfer',
      status: 'completed',
      paid_at: iso(-50 + exp.id),
      reference: `FPAY-EXP-${exp.id}`,
    });
  }
}

const SEEDERS: Record<string, (db: Db, config: Config) => void> = {
  identity: seedIdentity,
  projects: seedProjects,
  shop: seedShop,
  library: seedLibrary,
  education: seedEducation,
  hr: seedHr,
  finance: seedFinance,
};

export function seedAll(db: Db, config: Config): void {
  db.transaction(() => {
    for (const domain of Object.keys(SEEDERS)) {
      SEEDERS[domain](db, config);
      db.run(
        "INSERT INTO _meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        `seeded:${domain}`,
        new Date().toISOString(),
      );
    }
    db.run(
      "INSERT INTO _meta(key,value) VALUES ('seeded','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    );
  });
}

export function seedDomain(db: Db, domain: string, config: Config): void {
  const seeder = SEEDERS[domain];
  if (!seeder) throw new Error(`No existe seeder para el dominio ${domain}`);
  db.transaction(() => {
    seeder(db, config);
    db.run(
      "INSERT INTO _meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      `seeded:${domain}`,
      new Date().toISOString(),
    );
  });
}

export function resetDomain(db: Db, domain: string, config: Config): void {
  const tables = DOMAIN_TABLES[domain];
  if (!tables) throw new Error(`Dominio desconocido: ${domain}`);
  db.transaction(() => {
    for (const table of [...tables].reverse()) db.run(`DELETE FROM ${table}`);
    SEEDERS[domain](db, config);
    db.run(
      "INSERT INTO _meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      `seeded:${domain}`,
      new Date().toISOString(),
    );
  });
}

export function resetAll(db: Db, config: Config): void {
  const domains = Object.keys(DOMAIN_TABLES).reverse();
  db.transaction(() => {
    for (const domain of domains) {
      for (const table of [...DOMAIN_TABLES[domain]].reverse()) db.run(`DELETE FROM ${table}`);
    }
    db.run("DELETE FROM _meta");
    for (const domain of Object.keys(SEEDERS)) {
      SEEDERS[domain](db, config);
      db.run(
        "INSERT INTO _meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        `seeded:${domain}`,
        new Date().toISOString(),
      );
    }
    db.run("INSERT INTO _meta(key,value) VALUES ('seeded','1')");
  });
}

export function ensureSeeded(db: Db, config: Config): boolean {
  const seeded = db.get<{ value: string }>("SELECT value FROM _meta WHERE key = 'seeded'");
  if (seeded) return false;
  seedAll(db, config);
  return true;
}
