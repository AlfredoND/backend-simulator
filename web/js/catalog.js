export const catalog = [
  {
    id: 'identity',
    entries: [
      {
        method: 'GET',
        path: '/api/v1/identity/users?per_page=3',
        title: { es: 'Listar usuarios', en: 'List users' },
        description: { es: 'Vista paginada con filtros de identidad.', en: 'Paginated view with identity filters.' },
      },
      {
        method: 'POST',
        path: '/api/v1/identity/auth/login',
        body: '{\n  "email": "admin@simulator.local",\n  "password": "Admin123!"\n}',
        headers: { 'Content-Type': 'application/json' },
        title: { es: 'Iniciar sesión', en: 'Sign in' },
        description: { es: 'Devuelve tokens de acceso y refresh.', en: 'Returns access and refresh tokens.' },
      },
      {
        method: 'GET',
        path: '/api/v1/identity/auth/me',
        title: { es: 'Usuario actual', en: 'Current user' },
        description: { es: 'Requiere el token demo o uno emitido por login.', en: 'Requires the demo token or one issued by login.' },
      },
    ],
  },
  {
    id: 'projects',
    entries: [
      {
        method: 'GET',
        path: '/api/v1/projects/projects?per_page=5',
        title: { es: 'Listar proyectos', en: 'List projects' },
        description: { es: 'Proyectos con owner, equipo y estado.', en: 'Projects with owner, team and status.' },
      },
      {
        method: 'GET',
        path: '/api/v1/projects/projects/1/stats',
        title: { es: 'Estadísticas de proyecto', en: 'Project statistics' },
        description: { es: 'Tareas por estado y prioridad.', en: 'Tasks by status and priority.' },
      },
      {
        method: 'POST',
        path: '/api/v1/projects/projects/1/tasks',
        body: '{\n  "title": "Tarea desde la UI",\n  "priority": "high",\n  "estimate_minutes": 60\n}',
        headers: { 'Content-Type': 'application/json' },
        title: { es: 'Crear tarea', en: 'Create task' },
        description: { es: 'Añade una tarea al proyecto 1.', en: 'Adds a task to project 1.' },
      },
    ],
  },
  {
    id: 'shop',
    entries: [
      {
        method: 'GET',
        path: '/api/v1/shop/products?status=active&per_page=5',
        title: { es: 'Catálogo activo', en: 'Active catalog' },
        description: { es: 'Productos con filtros y paginación.', en: 'Products with filters and pagination.' },
      },
      {
        method: 'POST',
        path: '/api/v1/shop/carts',
        body: '{\n  "customer_id": 1\n}',
        headers: { 'Content-Type': 'application/json' },
        title: { es: 'Crear carrito', en: 'Create cart' },
        description: { es: 'Crea un carrito abierto para customer 1.', en: 'Creates an open cart for customer 1.' },
      },
      {
        method: 'GET',
        path: '/api/v1/shop/coupons/validate?code=SAVE10&subtotal_cents=10000',
        title: { es: 'Validar cupón', en: 'Validate coupon' },
        description: { es: 'Calcula el descuento sobre un subtotal.', en: 'Calculates the discount for a subtotal.' },
      },
    ],
  },
  {
    id: 'library',
    entries: [
      {
        method: 'GET',
        path: '/api/v1/library/books/search?q=Cien&per_page=5',
        title: { es: 'Buscar libros', en: 'Search books' },
        description: { es: 'Búsqueda por texto, autor y disponibilidad.', en: 'Search by text, author and availability.' },
      },
      {
        method: 'POST',
        path: '/api/v1/library/loans',
        body: '{\n  "book_id": 1,\n  "reader_id": 1,\n  "days": 14\n}',
        headers: { 'Content-Type': 'application/json' },
        title: { es: 'Crear préstamo', en: 'Create loan' },
        description: { es: 'Elige un ejemplar disponible y aplica límites.', en: 'Picks an available copy and applies limits.' },
      },
      {
        method: 'GET',
        path: '/api/v1/library/stats',
        title: { es: 'Estadísticas de biblioteca', en: 'Library statistics' },
        description: { es: 'Préstamos activos, reservas y multas.', en: 'Active loans, reservations and fines.' },
      },
    ],
  },
  {
    id: 'education',
    entries: [
      {
        method: 'GET',
        path: '/api/v1/education/students/1/transcript',
        title: { es: 'Expediente académico', en: 'Academic transcript' },
        description: { es: 'Matrículas, notas, promedio y asistencia.', en: 'Enrollments, grades, average and attendance.' },
      },
      {
        method: 'GET',
        path: '/api/v1/education/sections/1/roster',
        title: { es: 'Roster de sección', en: 'Section roster' },
        description: { es: 'Estudiantes y capacidad de la sección 1.', en: 'Students and capacity for section 1.' },
      },
      {
        method: 'POST',
        path: '/api/v1/education/attendance/bulk',
        body: '{\n  "records": [\n    { "student_id": 1, "section_id": 1, "attendance_date": "2026-11-10", "status": "present" }\n  ]\n}',
        headers: { 'Content-Type': 'application/json' },
        title: { es: 'Asistencia en lote', en: 'Bulk attendance' },
        description: { es: 'Upsert de asistencia para una sección.', en: 'Attendance upsert for a section.' },
      },
    ],
  },
  {
    id: 'hr',
    entries: [
      {
        method: 'GET',
        path: '/api/v1/hr/reports/payroll',
        title: { es: 'Reporte de nóminas', en: 'Payroll report' },
        description: { es: 'Totales y desglose por departamento.', en: 'Totals and breakdown by department.' },
      },
      {
        method: 'GET',
        path: '/api/v1/hr/vacations/balance/1?year=2027',
        title: { es: 'Saldo de vacaciones', en: 'Vacation balance' },
        description: { es: 'Días usados, pendientes y restantes.', en: 'Used, pending and remaining days.' },
      },
      {
        method: 'POST',
        path: '/api/v1/hr/vacations/request',
        body: '{\n  "employee_id": 1,\n  "start_date": "2027-04-01",\n  "end_date": "2027-04-02",\n  "days": 2,\n  "reason": "UI demo"\n}',
        headers: { 'Content-Type': 'application/json' },
        title: { es: 'Solicitar vacaciones', en: 'Request vacation' },
        description: { es: 'Valida solapes y saldo anual.', en: 'Validates overlaps and annual balance.' },
      },
    ],
  },
  {
    id: 'finance',
    entries: [
      {
        method: 'GET',
        path: '/api/v1/finance/reports/balance',
        title: { es: 'Balance financiero', en: 'Financial balance' },
        description: { es: 'Activos, pasivos y patrimonio agregados.', en: 'Aggregated assets, liabilities and equity.' },
      },
      {
        method: 'GET',
        path: '/api/v1/finance/budgets/utilization?year=2026',
        title: { es: 'Uso de presupuestos', en: 'Budget utilization' },
        description: { es: 'Planificado frente a ejecutado.', en: 'Planned versus spent.' },
      },
      {
        method: 'POST',
        path: '/api/v1/finance/invoices',
        body: '{\n  "customer_name": "Cliente UI",\n  "items": [\n    { "description": "Servicio demo", "quantity": 2, "unit_price_cents": 5000 }\n  ]\n}',
        headers: { 'Content-Type': 'application/json' },
        title: { es: 'Emitir factura', en: 'Issue invoice' },
        description: { es: 'Calcula subtotal, IVA y total.', en: 'Calculates subtotal, tax and total.' },
      },
    ],
  },
  {
    id: 'lab',
    entries: [
      {
        method: 'GET',
        path: '/test/echo?x=1&x=2',
        title: { es: 'Echo completo', en: 'Full echo' },
        description: { es: 'Refleja método, headers, query y body.', en: 'Reflects method, headers, query and body.' },
      },
      {
        method: 'GET',
        path: '/test/status/418',
        title: { es: 'Código personalizado', en: 'Custom status' },
        description: { es: 'Devuelve el código HTTP solicitado.', en: 'Returns the requested HTTP status.' },
      },
      {
        method: 'GET',
        path: '/test/rate-limit?limit=2&key=ui-demo',
        title: { es: 'Rate limit', en: 'Rate limit' },
        description: { es: 'Repite la petición para alcanzar el 429.', en: 'Repeat the request to reach 429.' },
      },
      {
        method: 'POST',
        path: '/test/idempotency',
        headers: { 'Idempotency-Key': 'ui-demo-key' },
        title: { es: 'Idempotencia', en: 'Idempotency' },
        description: { es: 'La primera petición crea; la repetición devuelve replay.', en: 'First request creates; a replay is returned next.' },
      },
      {
        method: 'GET',
        path: '/test/download?size=1024',
        title: { es: 'Descarga binaria', en: 'Binary download' },
        description: { es: 'Muestra cómo se presenta una respuesta binaria.', en: 'Shows how a binary response is presented.' },
      },
    ],
  },
];

export const presets = [
  { label: { es: 'Health', en: 'Health' }, method: 'GET', path: '/health' },
  { label: { es: 'Echo', en: 'Echo' }, method: 'GET', path: '/test/echo?hello=world' },
  { label: { es: '418', en: '418' }, method: 'GET', path: '/test/status/418' },
  { label: { es: 'Redirect 307', en: 'Redirect 307' }, method: 'GET', path: '/test/redirect/307?to=/test/echo' },
  { label: { es: 'Error 503', en: 'Error 503' }, method: 'GET', path: '/test/error/503' },
  { label: { es: 'Idempotencia', en: 'Idempotency' }, method: 'POST', path: '/test/idempotency', headers: { 'Idempotency-Key': 'ui-demo-key' } },
];
