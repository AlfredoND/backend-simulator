-- Esquema relacional del simulador. Dinero en céntimos, fechas ISO-8601 (TEXT).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ============================ IDENTIDAD ============================
CREATE TABLE IF NOT EXISTS id_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE CHECK (email LIKE '%@%'),
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended','pending')),
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_users_status ON id_users(status);

CREATE TABLE IF NOT EXISTS id_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES id_users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  bio TEXT,
  avatar_url TEXT,
  birth_date TEXT,
  locale TEXT NOT NULL DEFAULT 'es-ES',
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS id_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS id_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  resource TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read','write','delete','admin'))
);

CREATE TABLE IF NOT EXISTS id_user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES id_roles(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  UNIQUE (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON id_user_roles(user_id);

CREATE TABLE IF NOT EXISTS id_role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES id_roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES id_permissions(id) ON DELETE CASCADE,
  UNIQUE (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS id_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS id_group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES id_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  member_role TEXT NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner','member')),
  joined_at TEXT NOT NULL,
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS id_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  refresh_hash TEXT UNIQUE,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON id_sessions(user_id);

CREATE TABLE IF NOT EXISTS id_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('api','refresh','reset')),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  scopes TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON id_tokens(user_id);

CREATE TABLE IF NOT EXISTS id_api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS id_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  region TEXT,
  postal_code TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'ES',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_default_address ON id_addresses(user_id) WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS idx_addresses_user ON id_addresses(user_id);

CREATE TABLE IF NOT EXISTS id_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES id_users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  language TEXT NOT NULL DEFAULT 'es',
  notifications INTEGER NOT NULL DEFAULT 1 CHECK (notifications IN (0,1)),
  newsletter INTEGER NOT NULL DEFAULT 0 CHECK (newsletter IN (0,1)),
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  updated_at TEXT NOT NULL
);

-- ============================ PROYECTOS ============================
CREATE TABLE IF NOT EXISTS pr_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pr_team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES pr_teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  member_role TEXT NOT NULL DEFAULT 'member' CHECK (member_role IN ('lead','member')),
  joined_at TEXT NOT NULL,
  UNIQUE (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS pr_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  project_key TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','on_hold','completed','archived')),
  owner_id INTEGER REFERENCES id_users(id) ON DELETE SET NULL,
  team_id INTEGER REFERENCES pr_teams(id) ON DELETE SET NULL,
  start_date TEXT,
  due_date TEXT,
  budget_cents INTEGER NOT NULL DEFAULT 0 CHECK (budget_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_date IS NULL OR due_date IS NULL OR due_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON pr_projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_team ON pr_projects(team_id);

CREATE TABLE IF NOT EXISTS pr_project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES pr_projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  member_role TEXT NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner','manager','member','viewer')),
  added_at TEXT NOT NULL,
  UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS pr_statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('todo','in_progress','done','blocked')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pr_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES pr_projects(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES pr_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status_id INTEGER NOT NULL REFERENCES pr_statuses(id) ON DELETE RESTRICT,
  assignee_id INTEGER REFERENCES id_users(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  due_date TEXT,
  estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR estimate_minutes >= 0),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON pr_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON pr_tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON pr_tasks(status_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON pr_tasks(due_date);

CREATE TABLE IF NOT EXISTS pr_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES pr_tasks(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON pr_comments(task_id);

CREATE TABLE IF NOT EXISTS pr_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#64748b' CHECK (color LIKE '#%')
);

CREATE TABLE IF NOT EXISTS pr_task_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES pr_tasks(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES pr_labels(id) ON DELETE CASCADE,
  UNIQUE (task_id, label_id)
);

CREATE TABLE IF NOT EXISTS pr_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES pr_tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  storage_path TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES id_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pr_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES pr_projects(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES pr_tasks(id) ON DELETE SET NULL,
  actor_id INTEGER REFERENCES id_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_project ON pr_activities(project_id, created_at);

-- ============================ E-COMMERCE ============================
CREATE TABLE IF NOT EXISTS shop_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE CHECK (email LIKE '%@%'),
  full_name TEXT NOT NULL,
  phone TEXT,
  user_id INTEGER UNIQUE REFERENCES id_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_customer_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL UNIQUE REFERENCES shop_customers(id) ON DELETE CASCADE,
  orders_count INTEGER NOT NULL DEFAULT 0 CHECK (orders_count >= 0),
  lifetime_value_cents INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_value_cents >= 0),
  last_order_at TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0)
);

CREATE TABLE IF NOT EXISTS shop_brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS shop_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES shop_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS shop_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  brand_id INTEGER REFERENCES shop_brands(id) ON DELETE SET NULL,
  category_id INTEGER NOT NULL REFERENCES shop_categories(id) ON DELETE RESTRICT,
  description TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (length(currency) = 3),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  rating REAL CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON shop_products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON shop_products(status);

CREATE TABLE IF NOT EXISTS shop_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  attributes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON shop_variants(product_id);

CREATE TABLE IF NOT EXISTS shop_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt_text TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shop_warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'ES'
);

CREATE TABLE IF NOT EXISTS shop_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES shop_variants(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES shop_warehouses(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at TEXT NOT NULL,
  UNIQUE (variant_id, warehouse_id),
  CHECK (reserved <= quantity)
);

CREATE TABLE IF NOT EXISTS shop_payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES shop_customers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('card','paypal','bank_transfer','cash')),
  label TEXT NOT NULL,
  last4 TEXT CHECK (last4 IS NULL OR length(last4) = 4),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value INTEGER NOT NULL CHECK (value > 0),
  min_total_cents INTEGER NOT NULL DEFAULT 0 CHECK (min_total_cents >= 0),
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  CHECK (kind <> 'percent' OR value <= 100),
  CHECK (valid_until >= valid_from)
);

CREATE TABLE IF NOT EXISTS shop_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES shop_customers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'ES',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  UNIQUE (customer_id, label)
);

CREATE TABLE IF NOT EXISTS shop_carts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES shop_customers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','checked_out','abandoned')),
  coupon_id INTEGER REFERENCES shop_coupons(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_carts_customer ON shop_carts(customer_id);

CREATE TABLE IF NOT EXISTS shop_cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id INTEGER NOT NULL REFERENCES shop_carts(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES shop_variants(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  UNIQUE (cart_id, variant_id)
);

CREATE TABLE IF NOT EXISTS shop_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES shop_customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','processing','shipped','delivered','cancelled','refunded')),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  coupon_id INTEGER REFERENCES shop_coupons(id) ON DELETE SET NULL,
  shipping_address_id INTEGER REFERENCES shop_addresses(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  canceled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON shop_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON shop_orders(status);

CREATE TABLE IF NOT EXISTS shop_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES shop_variants(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
);

CREATE TABLE IF NOT EXISTS shop_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  method_id INTEGER REFERENCES shop_payment_methods(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','authorized','captured','failed','refunded')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  provider_ref TEXT UNIQUE,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS shop_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES shop_payments(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','rejected')),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS shop_carriers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  tracking_url_template TEXT
);

CREATE TABLE IF NOT EXISTS shop_shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES shop_orders(id) ON DELETE CASCADE,
  carrier_id INTEGER NOT NULL REFERENCES shop_carriers(id) ON DELETE RESTRICT,
  tracking_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'label_created' CHECK (status IN ('label_created','in_transit','out_for_delivery','delivered','returned')),
  shipped_at TEXT,
  delivered_at TEXT,
  estimated_delivery TEXT
);

CREATE TABLE IF NOT EXISTS shop_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES shop_customers(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (product_id, customer_id)
);

-- ============================ BIBLIOTECA ============================
CREATE TABLE IF NOT EXISTS lib_authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  bio TEXT,
  birth_date TEXT,
  nationality TEXT
);

CREATE TABLE IF NOT EXISTS lib_publishers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  country TEXT,
  website TEXT
);

CREATE TABLE IF NOT EXISTS lib_genres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS lib_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isbn TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  publisher_id INTEGER REFERENCES lib_publishers(id) ON DELETE SET NULL,
  published_year INTEGER CHECK (published_year IS NULL OR (published_year BETWEEN 1450 AND 2100)),
  language TEXT NOT NULL DEFAULT 'es',
  pages INTEGER CHECK (pages IS NULL OR pages > 0),
  description TEXT,
  cover_url TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_title ON lib_books(title);

CREATE TABLE IF NOT EXISTS lib_book_authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES lib_books(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES lib_authors(id) ON DELETE CASCADE,
  author_role TEXT NOT NULL DEFAULT 'author' CHECK (author_role IN ('author','translator','editor')),
  UNIQUE (book_id, author_id, author_role)
);

CREATE TABLE IF NOT EXISTS lib_book_genres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES lib_books(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES lib_genres(id) ON DELETE CASCADE,
  UNIQUE (book_id, genre_id)
);

CREATE TABLE IF NOT EXISTS lib_copies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES lib_books(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_loan','reserved','maintenance','lost')),
  acquired_at TEXT NOT NULL,
  shelf TEXT
);
CREATE INDEX IF NOT EXISTS idx_copies_book ON lib_copies(book_id);

CREATE TABLE IF NOT EXISTS lib_readers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE REFERENCES id_users(id) ON DELETE SET NULL,
  card_number TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  joined_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','expired'))
);

CREATE TABLE IF NOT EXISTS lib_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  copy_id INTEGER NOT NULL REFERENCES lib_copies(id) ON DELETE RESTRICT,
  reader_id INTEGER NOT NULL REFERENCES lib_readers(id) ON DELETE RESTRICT,
  loaned_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  returned_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','returned','overdue','lost')),
  fine_cents INTEGER NOT NULL DEFAULT 0 CHECK (fine_cents >= 0),
  CHECK (due_at > loaned_at),
  CHECK (returned_at IS NULL OR returned_at >= loaned_at)
);
CREATE INDEX IF NOT EXISTS idx_loans_reader ON lib_loans(reader_id);
CREATE INDEX IF NOT EXISTS idx_loans_copy ON lib_loans(copy_id);

CREATE TABLE IF NOT EXISTS lib_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES lib_books(id) ON DELETE CASCADE,
  reader_id INTEGER NOT NULL REFERENCES lib_readers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','fulfilled','cancelled','expired')),
  reserved_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_reservation ON lib_reservations(book_id, reader_id)
  WHERE status IN ('pending','ready');

CREATE TABLE IF NOT EXISTS lib_fines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL REFERENCES lib_loans(id) ON DELETE CASCADE,
  reader_id INTEGER NOT NULL REFERENCES lib_readers(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','waived')),
  issued_at TEXT NOT NULL,
  paid_at TEXT
);

-- ============================ EDUCACIÓN ============================
CREATE TABLE IF NOT EXISTS edu_teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  department TEXT,
  hired_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edu_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  birth_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','graduated','suspended','withdrawn')),
  enrolled_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edu_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  credits INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 300),
  department TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE IF NOT EXISTS edu_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  course_id INTEGER NOT NULL REFERENCES edu_courses(id) ON DELETE CASCADE,
  credits INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 30),
  area TEXT,
  description TEXT
);
CREATE INDEX IF NOT EXISTS idx_subjects_course ON edu_subjects(course_id);

CREATE TABLE IF NOT EXISTS edu_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES edu_subjects(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  section_code TEXT NOT NULL,
  teacher_id INTEGER REFERENCES edu_teachers(id) ON DELETE SET NULL,
  capacity INTEGER NOT NULL DEFAULT 30 CHECK (capacity > 0),
  room TEXT,
  schedule TEXT,
  UNIQUE (term, section_code)
);
CREATE INDEX IF NOT EXISTS idx_sections_subject ON edu_sections(subject_id);

CREATE TABLE IF NOT EXISTS edu_enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES edu_students(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES edu_courses(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES edu_sections(id) ON DELETE SET NULL,
  term TEXT NOT NULL,
  enrolled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','completed','dropped','withdrawn')),
  UNIQUE (student_id, course_id, term)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON edu_enrollments(student_id);

CREATE TABLE IF NOT EXISTS edu_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES edu_sections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('exam','quiz','assignment','project')),
  max_score REAL NOT NULL CHECK (max_score > 0),
  weight REAL NOT NULL CHECK (weight > 0 AND weight <= 1),
  due_date TEXT
);

CREATE TABLE IF NOT EXISTS edu_grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES edu_students(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES edu_sections(id) ON DELETE CASCADE,
  evaluation_id INTEGER REFERENCES edu_evaluations(id) ON DELETE SET NULL,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  letter TEXT CHECK (letter IS NULL OR letter IN ('A','B','C','D','F')),
  comments TEXT,
  graded_at TEXT NOT NULL,
  UNIQUE (student_id, section_id, evaluation_id)
);
CREATE INDEX IF NOT EXISTS idx_grades_student ON edu_grades(student_id);

CREATE TABLE IF NOT EXISTS edu_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES edu_students(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES edu_sections(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present','absent','late','excused')),
  notes TEXT,
  UNIQUE (student_id, section_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS edu_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES edu_sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pdf','video','link','slides','other')),
  url TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

-- ============================ RRHH ============================
CREATE TABLE IF NOT EXISTS hr_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  manager_id INTEGER REFERENCES hr_employees(id) ON DELETE SET NULL,
  budget_cents INTEGER NOT NULL DEFAULT 0 CHECK (budget_cents >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES hr_departments(id) ON DELETE RESTRICT,
  level TEXT NOT NULL CHECK (level IN ('junior','mid','senior','lead','director')),
  min_salary_cents INTEGER NOT NULL CHECK (min_salary_cents >= 0),
  max_salary_cents INTEGER NOT NULL CHECK (max_salary_cents >= min_salary_cents),
  UNIQUE (title, department_id)
);

CREATE TABLE IF NOT EXISTS hr_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  department_id INTEGER NOT NULL REFERENCES hr_departments(id) ON DELETE RESTRICT,
  position_id INTEGER NOT NULL REFERENCES hr_positions(id) ON DELETE RESTRICT,
  manager_id INTEGER REFERENCES hr_employees(id) ON DELETE SET NULL,
  hire_date TEXT NOT NULL,
  termination_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave','terminated')),
  CHECK (termination_date IS NULL OR termination_date >= hire_date)
);
CREATE INDEX IF NOT EXISTS idx_employees_department ON hr_employees(department_id);

CREATE TABLE IF NOT EXISTS hr_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('permanent','temporary','internship','contractor')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  weekly_hours INTEGER NOT NULL CHECK (weekly_hours > 0 AND weekly_hours <= 60),
  gross_annual_cents INTEGER NOT NULL CHECK (gross_annual_cents >= 0),
  signed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','draft')),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS hr_salaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  base_cents INTEGER NOT NULL CHECK (base_cents >= 0),
  bonus_cents INTEGER NOT NULL DEFAULT 0 CHECK (bonus_cents >= 0),
  deductions_cents INTEGER NOT NULL DEFAULT 0 CHECK (deductions_cents >= 0),
  net_cents INTEGER NOT NULL CHECK (net_cents >= 0),
  paid_at TEXT,
  UNIQUE (employee_id, period_start),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS hr_vacations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days INTEGER NOT NULL CHECK (days > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reason TEXT,
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_vacations_employee ON hr_vacations(employee_id);

CREATE TABLE IF NOT EXISTS hr_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  hours_worked REAL NOT NULL DEFAULT 0 CHECK (hours_worked >= 0 AND hours_worked <= 24),
  status TEXT NOT NULL CHECK (status IN ('present','remote','late','absent','holiday')),
  UNIQUE (employee_id, work_date)
);

-- ============================ FINANZAS ============================
CREATE TABLE IF NOT EXISTS fin_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  email TEXT,
  tax_id TEXT UNIQUE,
  iban TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','blocked'))
);

CREATE TABLE IF NOT EXISTS fin_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('asset','liability','equity','income','expense')),
  currency TEXT NOT NULL DEFAULT 'EUR',
  balance_cents INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE IF NOT EXISTS fin_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES fin_accounts(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('debit','credit')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  description TEXT NOT NULL,
  category TEXT,
  reference TEXT UNIQUE,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_tx_account ON fin_transactions(account_id, occurred_at);

CREATE TABLE IF NOT EXISTS fin_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES fin_suppliers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','paid','overdue','void')),
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  notes TEXT,
  CHECK (due_date >= issue_date)
);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON fin_invoices(status);

CREATE TABLE IF NOT EXISTS fin_invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES fin_invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  tax_rate REAL NOT NULL DEFAULT 0.21 CHECK (tax_rate >= 0 AND tax_rate <= 1),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0)
);

CREATE TABLE IF NOT EXISTS fin_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER REFERENCES hr_employees(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES fin_suppliers(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft','submitted','approved','rejected','reimbursed')),
  incurred_on TEXT NOT NULL,
  approved_by INTEGER REFERENCES hr_employees(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON fin_expenses(status);

CREATE TABLE IF NOT EXISTS fin_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES hr_departments(id) ON DELETE CASCADE,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  category TEXT NOT NULL,
  planned_cents INTEGER NOT NULL CHECK (planned_cents >= 0),
  spent_cents INTEGER NOT NULL DEFAULT 0 CHECK (spent_cents >= 0),
  UNIQUE (department_id, year, category)
);

CREATE TABLE IF NOT EXISTS fin_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER REFERENCES fin_invoices(id) ON DELETE CASCADE,
  expense_id INTEGER REFERENCES fin_expenses(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES fin_accounts(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('transfer','card','cash','direct_debit')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','refunded')),
  paid_at TEXT,
  reference TEXT UNIQUE,
  CHECK (invoice_id IS NOT NULL OR expense_id IS NOT NULL)
);
