/**
 * @file Domain-to-table registry used by statistics and protected resets.
 * Arrays are parent-first; reset reverses them to satisfy foreign keys.
 */
/** Ordered table groups for every resettable domain. */
export const DOMAIN_TABLES: Record<string, string[]> = {
  identity: [
    'id_users', 'id_profiles', 'id_roles', 'id_permissions', 'id_user_roles',
    'id_role_permissions', 'id_groups', 'id_group_members', 'id_group_roles', 'id_sessions',
    'id_tokens', 'id_api_keys', 'id_addresses', 'id_preferences',
  ],
  projects: [
    'pr_teams', 'pr_team_members', 'pr_projects', 'pr_project_members',
    'pr_statuses', 'pr_tasks', 'pr_comments', 'pr_labels', 'pr_task_labels',
    'pr_attachments', 'pr_activities',
  ],
  shop: [
    'shop_customers', 'shop_customer_stats', 'shop_brands', 'shop_categories',
    'shop_products', 'shop_variants', 'shop_images', 'shop_warehouses',
    'shop_inventory', 'shop_payment_methods', 'shop_coupons', 'shop_addresses',
    'shop_carts', 'shop_cart_items', 'shop_orders', 'shop_order_items',
    'shop_payments', 'shop_refunds', 'shop_carriers', 'shop_shipments', 'shop_reviews',
  ],
  library: [
    'lib_authors', 'lib_publishers', 'lib_genres', 'lib_books', 'lib_book_authors',
    'lib_book_genres', 'lib_copies', 'lib_readers', 'lib_loans', 'lib_reservations',
    'lib_fines',
  ],
  education: [
    'edu_teachers', 'edu_students', 'edu_courses', 'edu_subjects', 'edu_sections',
    'edu_enrollments', 'edu_evaluations', 'edu_grades', 'edu_attendance',
    'edu_materials',
  ],
  hr: [
    'hr_departments', 'hr_positions', 'hr_employees', 'hr_contracts',
    'hr_salaries', 'hr_vacations', 'hr_attendance',
  ],
  finance: [
    'fin_suppliers', 'fin_accounts', 'fin_transactions', 'fin_invoices',
    'fin_invoice_items', 'fin_expenses', 'fin_budgets', 'fin_payments',
  ],
};

/** Known domain identifiers. */
export const DOMAINS = Object.keys(DOMAIN_TABLES);

/** Validates a user-provided domain name before using it in trusted SQL. */
export function assertDomain(domain: string): string {
  if (!DOMAIN_TABLES[domain]) {
    throw new Error(`Dominio desconocido: ${domain}. Válidos: ${DOMAINS.join(', ')}`);
  }
  return domain;
}
