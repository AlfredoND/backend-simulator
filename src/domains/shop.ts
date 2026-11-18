/**
 * @file Shop domain: catalog, carts, orders, payments, shipping and refunds.
 *
 * Checkout is the key transaction: prices, coupon, tax, stock, order, items,
 * payment and shipment commit atomically. Inventory decrements only available
 * quantity (`quantity - reserved`), so a failure leaves every row untouched.
 * Amounts are integer cents to avoid floating-point money errors.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Router } from '../http/router.js';
import type { Ctx } from '../http/router.js';
import type { RequestContext } from '../http/index.js';
import { readJsonBody, sendJson } from '../http/index.js';
import { conflict, notFound, validationError } from '../core/errors.js';
import { registerResource } from '../http/resource.js';
import { Validator } from '../core/validate.js';
import { escapeLike, paginationMeta, parsePagination } from '../http/query.js';

const now = () => new Date().toISOString();
const TAX_RATE = 0.21;
const SHIPPING_CENTS = 599;
const FREE_SHIPPING_FROM = 5000;

function dbOf(ctx: Ctx) {
  return (ctx as RequestContext).app.db;
}
type Db = ReturnType<typeof dbOf>;

function recalcCustomerStats(db: Db, customerId: number): void {
  const exists = db.get('SELECT 1 AS x FROM shop_customer_stats WHERE customer_id = ?', customerId);
  if (!exists) {
    db.insert('shop_customer_stats', {
      customer_id: customerId,
      orders_count: 0,
      lifetime_value_cents: 0,
      last_order_at: null,
      loyalty_points: 0,
    });
  }
  db.run(
    `UPDATE shop_customer_stats SET
      orders_count = (SELECT COUNT(*) FROM shop_orders o WHERE o.customer_id = ? AND o.status <> 'cancelled'),
      lifetime_value_cents = (SELECT COALESCE(SUM(o.total_cents),0) FROM shop_orders o WHERE o.customer_id = ? AND o.status <> 'cancelled'),
      last_order_at = (SELECT MAX(o.created_at) FROM shop_orders o WHERE o.customer_id = ?),
      loyalty_points = (SELECT COUNT(*) * 10 FROM shop_orders o WHERE o.customer_id = ? AND o.status = 'delivered')
     WHERE customer_id = ?`,
    customerId,
    customerId,
    customerId,
    customerId,
    customerId,
  );
}

function recalcProductRating(db: Db, productId: number): void {
  const row = db.get<{ avg: number | null }>(
    'SELECT ROUND(AVG(rating),1) AS avg FROM shop_reviews WHERE product_id = ?',
    productId,
  );
  db.run('UPDATE shop_products SET rating = ?, updated_at = ? WHERE id = ?', row?.avg ?? null, now(), productId);
}

interface CartTotals {
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  coupon: Record<string, unknown> | null;
}

function couponFor(db: Db, code: null | undefined, subtotal: number): { coupon: null; discount: 0 };
function couponFor(db: Db, code: string, subtotal: number): { coupon: Record<string, unknown>; discount: number };
function couponFor(
  db: Db,
  code: string | undefined | null,
  subtotal: number,
): { coupon: Record<string, unknown> | null; discount: number } {
  if (!code) return { coupon: null, discount: 0 };
  const coupon = db.get<Record<string, unknown>>('SELECT * FROM shop_coupons WHERE code = ?', code.toUpperCase());
  if (!coupon) throw validationError([{ field: 'coupon_code', message: 'cupón no encontrado' }]);
  if (!coupon.active) throw conflict('El cupón está inactivo');
  const today = now();
  if (String(coupon.valid_from) > today) throw conflict('El cupón aún no es válido');
  if (String(coupon.valid_until) < today) throw conflict('El cupón ha expirado');
  if (coupon.max_uses !== null && Number(coupon.used_count) >= Number(coupon.max_uses))
    throw conflict('El cupón ha alcanzado su límite de usos');
  if (subtotal < Number(coupon.min_total_cents)) {
    throw conflict(`El cupón requiere un mínimo de ${coupon.min_total_cents} céntimos`);
  }
  const discount =
    coupon.kind === 'percent'
      ? Math.round((subtotal * Number(coupon.value)) / 100)
      : Math.min(Number(coupon.value), subtotal);
  return { coupon, discount };
}

function cartTotals(db: Db, cartId: number): CartTotals & { items: Record<string, unknown>[] } {
  const items = db.all<Record<string, unknown>>(
    `SELECT ci.*, v.sku, v.name AS variant_name, p.id AS product_id, p.name AS product_name,
            COALESCE(v.price_cents, p.price_cents) AS effective_price_cents
     FROM shop_cart_items ci
     JOIN shop_variants v ON v.id = ci.variant_id
     JOIN shop_products p ON p.id = v.product_id
     WHERE ci.cart_id = ? ORDER BY ci.id`,
    cartId,
  );
  const cart = db.get<{ coupon_id: number | null }>('SELECT coupon_id FROM shop_carts WHERE id = ?', cartId);
  let coupon: Record<string, unknown> | null = null;
  if (cart?.coupon_id)
    coupon = db.get<Record<string, unknown>>('SELECT * FROM shop_coupons WHERE id = ?', cart.coupon_id) ?? null;
  const subtotal = items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.effective_price_cents), 0);
  let discount = 0;
  if (coupon) {
    discount =
      coupon.kind === 'percent'
        ? Math.round((subtotal * Number(coupon.value)) / 100)
        : Math.min(Number(coupon.value), subtotal);
  }
  const shipping = subtotal - discount >= FREE_SHIPPING_FROM ? 0 : SHIPPING_CENTS;
  const tax = Math.round((subtotal - discount + shipping) * TAX_RATE);
  return {
    items,
    subtotal_cents: subtotal,
    discount_cents: discount,
    shipping_cents: shipping,
    tax_cents: tax,
    total_cents: subtotal - discount + shipping + tax,
    coupon,
  };
}

function variantAvailability(db: Db, variantId: number): number {
  return Number(
    db.get<{ n: number }>(
      'SELECT COALESCE(SUM(quantity - reserved),0) AS n FROM shop_inventory WHERE variant_id = ?',
      variantId,
    )?.n ?? 0,
  );
}

function decrementStock(db: Db, variantId: number, quantity: number): void {
  const rows = db.all<{ id: number; quantity: number; reserved: number }>(
    'SELECT id, quantity, reserved FROM shop_inventory WHERE variant_id = ? AND quantity > reserved ORDER BY id',
    variantId,
  );
  let remaining = quantity;
  for (const row of rows) {
    if (remaining <= 0) break;
    const available = row.quantity - row.reserved;
    const take = Math.min(available, remaining);
    db.run('UPDATE shop_inventory SET quantity = quantity - ?, updated_at = ? WHERE id = ?', take, now(), row.id);
    remaining -= take;
  }
  if (remaining > 0)
    throw conflict('Stock insuficiente para completar la operación', { variant_id: variantId, missing: remaining });
}

function restoreStock(db: Db, variantId: number, quantity: number): void {
  const row = db.get<{ id: number }>(
    'SELECT id FROM shop_inventory WHERE variant_id = ? ORDER BY id LIMIT 1',
    variantId,
  );
  if (row)
    db.run('UPDATE shop_inventory SET quantity = quantity + ?, updated_at = ? WHERE id = ?', quantity, now(), row.id);
  else
    db.insert('shop_inventory', { variant_id: variantId, warehouse_id: 1, quantity, reserved: 0, updated_at: now() });
}

function orderDetails(ctx: Ctx, id: number) {
  const db = dbOf(ctx);
  const order = db.get<Record<string, unknown>>(
    `SELECT o.*, c.full_name AS customer_name, c.email AS customer_email,
            a.line1 AS address_line1, a.city AS address_city, a.country AS address_country
     FROM shop_orders o
     JOIN shop_customers c ON c.id = o.customer_id
     LEFT JOIN shop_addresses a ON a.id = o.shipping_address_id
     WHERE o.id = ?`,
    id,
  );
  if (!order) throw notFound('Pedido no encontrado');
  const items = db.all('SELECT * FROM shop_order_items WHERE order_id = ? ORDER BY id', id);
  const payments = db.all(
    'SELECT id, order_id, method_id, status, amount_cents, provider_ref, created_at, processed_at FROM shop_payments WHERE order_id = ? ORDER BY id',
    id,
  );
  const shipment = db.get('SELECT * FROM shop_shipments WHERE order_id = ?', id) ?? null;
  const refunds = db.all('SELECT * FROM shop_refunds WHERE order_id = ? ORDER BY id', id);
  return { ...order, items, payments, shipment, refunds };
}

function createShipment(db: Db, orderId: number, carrierId = 1): void {
  if (db.get('SELECT 1 AS x FROM shop_shipments WHERE order_id = ?', orderId)) return;
  db.insert('shop_shipments', {
    order_id: orderId,
    carrier_id: carrierId,
    tracking_number: `TRK-${randomBytes(6).toString('hex').toUpperCase()}`,
    status: 'label_created',
    shipped_at: null,
    delivered_at: null,
    estimated_delivery: new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10),
  });
}

const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ['paid', 'processing', 'cancelled'],
  paid: ['processing', 'shipped', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

/** Registers `/api/v1/shop` catalog, cart, checkout and fulfillment routes. */
export function registerShopRoutes(router: Router, base: string): void {
  const root = `${base}/shop`;

  registerResource(router, root, {
    table: 'shop_customers',
    path: 'customers',
    tag: 'Shop · Customers',
    singular: 'cliente',
    fields: {
      id: { type: 'integer', readOnly: true },
      email: { type: 'email', required: true, maxLength: 254 },
      full_name: { type: 'string', required: true, maxLength: 160 },
      phone: { type: 'string', nullable: true, maxLength: 40 },
      user_id: { type: 'integer', nullable: true, min: 1 },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    search: ['email', 'full_name'],
    updatedAt: false,
    defaults: { created_at: now },
    afterCreate: (ctx, id) =>
      dbOf(ctx).insert('shop_customer_stats', {
        customer_id: id,
        orders_count: 0,
        lifetime_value_cents: 0,
        last_order_at: null,
        loyalty_points: 0,
      }),
  });

  registerResource(router, root, {
    table: 'shop_brands',
    path: 'brands',
    tag: 'Shop · Catalog',
    singular: 'marca',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 120 },
      slug: { type: 'string', required: true, maxLength: 120 },
      description: { type: 'string', nullable: true, maxLength: 4000 },
    },
    defaultSort: 'id',
    search: ['name', 'description'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'shop_categories',
    path: 'categories',
    tag: 'Shop · Catalog',
    singular: 'categoría',
    fields: {
      id: { type: 'integer', readOnly: true },
      parent_id: { type: 'integer', nullable: true, min: 1 },
      name: { type: 'string', required: true, maxLength: 120 },
      slug: { type: 'string', required: true, maxLength: 120 },
      description: { type: 'string', nullable: true, maxLength: 4000 },
    },
    defaultSort: 'id',
    search: ['name', 'description'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'shop_products',
    path: 'products',
    tag: 'Shop · Catalog',
    singular: 'producto',
    fields: {
      id: { type: 'integer', readOnly: true },
      sku: { type: 'string', required: true, maxLength: 80 },
      name: { type: 'string', required: true, maxLength: 200 },
      slug: { type: 'string', required: true, maxLength: 200 },
      brand_id: { type: 'integer', nullable: true, min: 1 },
      category_id: { type: 'integer', required: true, min: 1 },
      description: { type: 'string', nullable: true, maxLength: 20_000 },
      price_cents: { type: 'integer', required: true, min: 0 },
      currency: { type: 'string', maxLength: 3 },
      status: { type: 'string', enum: ['draft', 'active', 'archived'] },
      rating: { type: 'number', nullable: true, min: 0, max: 5 },
      created_at: { type: 'datetime', readOnly: true },
      updated_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    search: ['name', 'sku', 'description'],
    defaults: { created_at: now, updated_at: now },
  });

  registerResource(router, root, {
    table: 'shop_variants',
    path: 'variants',
    tag: 'Shop · Catalog',
    singular: 'variante',
    fields: {
      id: { type: 'integer', readOnly: true },
      product_id: { type: 'integer', required: true, min: 1 },
      sku: { type: 'string', required: true, maxLength: 80 },
      name: { type: 'string', required: true, maxLength: 120 },
      price_cents: { type: 'integer', nullable: true, min: 0 },
      attributes: { type: 'json', nullable: true },
      is_active: { type: 'boolean' },
    },
    defaultSort: 'id',
    search: ['name', 'sku'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'shop_images',
    path: 'images',
    tag: 'Shop · Catalog',
    singular: 'imagen',
    fields: {
      id: { type: 'integer', readOnly: true },
      product_id: { type: 'integer', required: true, min: 1 },
      url: { type: 'string', required: true, maxLength: 2000 },
      alt_text: { type: 'string', nullable: true, maxLength: 500 },
      position: { type: 'integer' },
    },
    defaultSort: 'id',
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'shop_warehouses',
    path: 'warehouses',
    tag: 'Shop · Inventory',
    singular: 'almacén',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 120 },
      code: { type: 'string', required: true, maxLength: 40 },
      city: { type: 'string', required: true, maxLength: 100 },
      country: { type: 'string', maxLength: 2 },
    },
    defaultSort: 'id',
    search: ['name', 'code', 'city'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'shop_inventory',
    path: 'inventory',
    tag: 'Shop · Inventory',
    singular: 'inventario',
    fields: {
      id: { type: 'integer', readOnly: true },
      variant_id: { type: 'integer', required: true, min: 1 },
      warehouse_id: { type: 'integer', required: true, min: 1 },
      quantity: { type: 'integer', min: 0 },
      reserved: { type: 'integer', min: 0 },
      updated_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    updatedAt: false,
    defaults: { updated_at: now },
  });

  registerResource(router, root, {
    table: 'shop_payment_methods',
    path: 'payment-methods',
    tag: 'Shop · Payments',
    singular: 'método de pago',
    fields: {
      id: { type: 'integer', readOnly: true },
      customer_id: { type: 'integer', required: true, min: 1 },
      kind: { type: 'string', required: true, enum: ['card', 'paypal', 'bank_transfer', 'cash'] },
      label: { type: 'string', required: true, maxLength: 120 },
      last4: { type: 'string', nullable: true, maxLength: 4 },
      is_default: { type: 'boolean' },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    updatedAt: false,
    defaults: { created_at: now },
  });

  registerResource(router, root, {
    table: 'shop_coupons',
    path: 'coupons',
    tag: 'Shop · Discounts',
    singular: 'cupón',
    fields: {
      id: { type: 'integer', readOnly: true },
      code: { type: 'string', required: true, maxLength: 40 },
      kind: { type: 'string', required: true, enum: ['percent', 'fixed'] },
      value: { type: 'integer', required: true, min: 1 },
      min_total_cents: { type: 'integer', min: 0 },
      max_uses: { type: 'integer', nullable: true, min: 1 },
      used_count: { type: 'integer', readOnly: true },
      valid_from: { type: 'date', required: true },
      valid_until: { type: 'date', required: true },
      active: { type: 'boolean' },
    },
    defaultSort: 'id',
    search: ['code'],
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'shop_addresses',
    path: 'addresses',
    tag: 'Shop · Customers',
    singular: 'dirección',
    fields: {
      id: { type: 'integer', readOnly: true },
      customer_id: { type: 'integer', required: true, min: 1 },
      label: { type: 'string', required: true, maxLength: 60 },
      line1: { type: 'string', required: true, maxLength: 200 },
      line2: { type: 'string', nullable: true, maxLength: 200 },
      city: { type: 'string', required: true, maxLength: 100 },
      postal_code: { type: 'string', required: true, maxLength: 20 },
      country: { type: 'string', maxLength: 2 },
      is_default: { type: 'boolean' },
    },
    defaultSort: 'id',
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'shop_carriers',
    path: 'carriers',
    tag: 'Shop · Shipping',
    singular: 'transportista',
    fields: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', required: true, maxLength: 120 },
      code: { type: 'string', required: true, maxLength: 40 },
      tracking_url_template: { type: 'string', nullable: true, maxLength: 2000 },
    },
    defaultSort: 'id',
    updatedAt: false,
  });

  registerResource(router, root, {
    table: 'shop_reviews',
    path: 'reviews',
    tag: 'Shop · Reviews',
    singular: 'reseña',
    fields: {
      id: { type: 'integer', readOnly: true },
      product_id: { type: 'integer', required: true, min: 1 },
      customer_id: { type: 'integer', required: true, min: 1 },
      rating: { type: 'integer', required: true, min: 1, max: 5 },
      title: { type: 'string', nullable: true, maxLength: 200 },
      body: { type: 'string', nullable: true, maxLength: 10_000 },
      created_at: { type: 'datetime', readOnly: true },
    },
    defaultSort: 'id',
    search: ['title', 'body'],
    updatedAt: false,
    defaults: { created_at: now },
    afterCreate: (ctx, id) => {
      const row = dbOf(ctx).get<{ product_id: number }>('SELECT product_id FROM shop_reviews WHERE id = ?', id);
      if (row) recalcProductRating(dbOf(ctx), row.product_id);
    },
    afterUpdate: (ctx, id) => {
      const row = dbOf(ctx).get<{ product_id: number }>('SELECT product_id FROM shop_reviews WHERE id = ?', id);
      if (row) recalcProductRating(dbOf(ctx), row.product_id);
    },
  });

  // ---------- Detalle de producto ----------
  router.add(
    'GET',
    `${root}/products/:id/details`,
    (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const product = db.get<Record<string, unknown>>(
        `SELECT p.*, b.name AS brand_name, c.name AS category_name
       FROM shop_products p LEFT JOIN shop_brands b ON b.id = p.brand_id
       JOIN shop_categories c ON c.id = p.category_id WHERE p.id = ?`,
        id,
      );
      if (!product) throw notFound('Producto no encontrado');
      const variants = db.all<Record<string, unknown>>(
        `SELECT v.*, COALESCE((SELECT SUM(i.quantity - i.reserved) FROM shop_inventory i WHERE i.variant_id = v.id),0) AS available
       FROM shop_variants v WHERE v.product_id = ? ORDER BY v.id`,
        id,
      );
      const images = db.all('SELECT * FROM shop_images WHERE product_id = ? ORDER BY position, id', id);
      const reviewStats = db.get(
        'SELECT COUNT(*) AS total, ROUND(AVG(rating),2) AS average FROM shop_reviews WHERE product_id = ?',
        id,
      );
      const reviews = db.all(
        `SELECT r.*, c.full_name AS customer_name FROM shop_reviews r JOIN shop_customers c ON c.id = r.customer_id
       WHERE r.product_id = ? ORDER BY r.created_at DESC LIMIT 10`,
        id,
      );
      sendJson(ctx, 200, { data: { ...product, variants, images, review_stats: reviewStats, reviews } });
    },
    { summary: 'Producto con variantes, stock, imágenes y reseñas', tag: 'Shop · Catalog' },
  );

  router.add(
    'GET',
    `${root}/products/:id/inventory`,
    (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      if (!db.get('SELECT 1 AS x FROM shop_products WHERE id = ?', id)) throw notFound('Producto no encontrado');
      const rows = db.all(
        `SELECT v.id AS variant_id, v.sku, v.name AS variant_name, w.id AS warehouse_id, w.name AS warehouse_name,
              i.quantity, i.reserved, (i.quantity - i.reserved) AS available
       FROM shop_variants v JOIN shop_inventory i ON i.variant_id = v.id JOIN shop_warehouses w ON w.id = i.warehouse_id
       WHERE v.product_id = ? ORDER BY v.id, w.id`,
        id,
      );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Inventario por variante y almacén', tag: 'Shop · Inventory' },
  );

  router.add(
    'GET',
    `${root}/inventory/low-stock`,
    (ctx) => {
      const thresholdRaw = ctx.query.get('threshold') ?? '5';
      const threshold = Number(thresholdRaw);
      if (!Number.isInteger(threshold) || threshold < 0)
        throw validationError([{ field: 'threshold', message: 'entero >= 0' }]);
      const rows = dbOf(ctx).all(
        `SELECT * FROM (
         SELECT v.id AS variant_id, v.sku, v.name AS variant_name, p.id AS product_id, p.name AS product_name,
                COALESCE(SUM(i.quantity - i.reserved),0) AS available
         FROM shop_variants v JOIN shop_products p ON p.id = v.product_id
         LEFT JOIN shop_inventory i ON i.variant_id = v.id GROUP BY v.id
       ) WHERE available <= ? ORDER BY available ASC, variant_id ASC LIMIT 200`,
        threshold,
      );
      sendJson(ctx, 200, { data: rows, meta: { threshold, total: rows.length } });
    },
    { summary: 'Variantes con stock bajo', tag: 'Shop · Inventory' },
  );

  router.add(
    'GET',
    `${root}/customers/:id/details`,
    (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const customer = db.get<Record<string, unknown>>('SELECT * FROM shop_customers WHERE id = ?', id);
      if (!customer) throw notFound('Cliente no encontrado');
      const stats = db.get('SELECT * FROM shop_customer_stats WHERE customer_id = ?', id) ?? null;
      const addresses = db.all('SELECT * FROM shop_addresses WHERE customer_id = ? ORDER BY is_default DESC, id', id);
      const recentOrders = db.all(
        'SELECT id, order_number, status, total_cents, created_at FROM shop_orders WHERE customer_id = ? ORDER BY id DESC LIMIT 10',
        id,
      );
      sendJson(ctx, 200, { data: { ...customer, stats, addresses, recent_orders: recentOrders } });
    },
    { summary: 'Cliente con estadísticas, direcciones y pedidos', tag: 'Shop · Customers' },
  );

  // ---------- Carrito ----------
  router.add(
    'POST',
    `${root}/carts`,
    async (ctx) => {
      const db = dbOf(ctx);
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['customer_id', 'coupon_code']);
      const customerId = input.integer('customer_id', { required: true, min: 1 });
      const couponCode = input.string('coupon_code', { maxLength: 40 });
      input.done();
      if (!db.get('SELECT 1 AS x FROM shop_customers WHERE id = ?', customerId))
        throw notFound('Cliente no encontrado');
      let couponId: number | null = null;
      if (couponCode) {
        const coupon = db.get<{ id: number }>('SELECT id FROM shop_coupons WHERE code = ?', couponCode.toUpperCase());
        if (!coupon) throw validationError([{ field: 'coupon_code', message: 'cupón no encontrado' }]);
        couponId = coupon.id;
      }
      const id = db.insert('shop_carts', {
        customer_id: customerId,
        status: 'open',
        coupon_id: couponId,
        created_at: now(),
        updated_at: now(),
      });
      sendJson(
        ctx,
        201,
        { data: { ...db.get('SELECT * FROM shop_carts WHERE id = ?', id), totals: cartTotals(db, id) } },
        { Location: `${root}/carts/${id}` },
      );
    },
    { summary: 'Crea un carrito', tag: 'Shop · Carts' },
  );

  router.add(
    'GET',
    `${root}/carts/:id`,
    (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const cart = db.get<Record<string, unknown>>('SELECT * FROM shop_carts WHERE id = ?', id);
      if (!cart) throw notFound('Carrito no encontrado');
      sendJson(ctx, 200, { data: { ...cart, totals: cartTotals(db, id) } });
    },
    { summary: 'Carrito con líneas y totales', tag: 'Shop · Carts' },
  );

  router.add(
    'POST',
    `${root}/carts/:id/items`,
    async (ctx) => {
      const cartId = Number(ctx.params.id);
      const db = dbOf(ctx);
      const cart = db.get<{ status: string; customer_id: number }>(
        'SELECT status, customer_id FROM shop_carts WHERE id = ?',
        cartId,
      );
      if (!cart) throw notFound('Carrito no encontrado');
      if (cart.status !== 'open') throw conflict('El carrito no está abierto');
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['variant_id', 'quantity']);
      const variantId = input.integer('variant_id', { required: true, min: 1 });
      const quantity = input.integer('quantity', { required: true, min: 1, max: 1000 });
      input.done();
      const variant = db.get<{ id: number; price_cents: number | null; is_active: number; product_id: number }>(
        'SELECT id, price_cents, is_active, product_id FROM shop_variants WHERE id = ?',
        variantId,
      );
      if (!variant) throw notFound('Variante no encontrada');
      if (!variant.is_active) throw conflict('La variante no está activa');
      const existing = db.get<{ quantity: number }>(
        'SELECT quantity FROM shop_cart_items WHERE cart_id = ? AND variant_id = ?',
        cartId,
        variantId,
      );
      const totalQuantity = (existing?.quantity ?? 0) + quantity;
      const available = variantAvailability(db, variantId);
      if (totalQuantity > available) throw conflict('Stock insuficiente', { available, requested: totalQuantity });
      const product = db.get<{ price_cents: number }>(
        'SELECT price_cents FROM shop_products WHERE id = ?',
        variant.product_id,
      );
      const unitPrice = variant.price_cents ?? product?.price_cents ?? 0;
      db.transaction(() => {
        if (existing) {
          db.run(
            'UPDATE shop_cart_items SET quantity = quantity + ? WHERE cart_id = ? AND variant_id = ?',
            quantity,
            cartId,
            variantId,
          );
        } else {
          db.insert('shop_cart_items', {
            cart_id: cartId,
            variant_id: variantId,
            quantity,
            unit_price_cents: unitPrice,
          });
        }
        db.run('UPDATE shop_carts SET updated_at = ? WHERE id = ?', now(), cartId);
      });
      sendJson(ctx, 201, { data: cartTotals(db, cartId) });
    },
    { summary: 'Añade una variante al carrito', tag: 'Shop · Carts' },
  );

  router.add(
    'PATCH',
    `${root}/carts/:id/items/:itemId`,
    async (ctx) => {
      const cartId = Number(ctx.params.id);
      const itemId = Number(ctx.params.itemId);
      const db = dbOf(ctx);
      const cart = db.get<{ status: string }>('SELECT status FROM shop_carts WHERE id = ?', cartId);
      if (!cart) throw notFound('Carrito no encontrado');
      if (cart.status !== 'open') throw conflict('El carrito no está abierto');
      const item = db.get<{ id: number; variant_id: number; quantity: number }>(
        'SELECT * FROM shop_cart_items WHERE id = ? AND cart_id = ?',
        itemId,
        cartId,
      );
      if (!item) throw notFound('Línea de carrito no encontrada');
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['quantity']);
      const quantity = input.integer('quantity', { required: true, min: 0, max: 1000 });
      input.done();
      if (quantity === 0) {
        db.run('DELETE FROM shop_cart_items WHERE id = ?', itemId);
      } else {
        const available = variantAvailability(db, item.variant_id);
        if (quantity > available) throw conflict('Stock insuficiente', { available, requested: quantity });
        db.run('UPDATE shop_cart_items SET quantity = ? WHERE id = ?', quantity, itemId);
      }
      db.run('UPDATE shop_carts SET updated_at = ? WHERE id = ?', now(), cartId);
      sendJson(ctx, 200, { data: cartTotals(db, cartId) });
    },
    { summary: 'Actualiza la cantidad de una línea', tag: 'Shop · Carts' },
  );

  router.add(
    'DELETE',
    `${root}/carts/:id/items/:itemId`,
    (ctx) => {
      const cartId = Number(ctx.params.id);
      const db = dbOf(ctx);
      const result = db.run(
        'DELETE FROM shop_cart_items WHERE id = ? AND cart_id = ?',
        Number(ctx.params.itemId),
        cartId,
      );
      if (result.changes === 0) throw notFound('Línea de carrito no encontrada');
      db.run('UPDATE shop_carts SET updated_at = ? WHERE id = ?', now(), cartId);
      sendJson(ctx, 200, { data: cartTotals(db, cartId) });
    },
    { summary: 'Elimina una línea del carrito', tag: 'Shop · Carts' },
  );

  router.add(
    'POST',
    `${root}/carts/:id/coupon`,
    async (ctx) => {
      const cartId = Number(ctx.params.id);
      const db = dbOf(ctx);
      const cart = db.get<{ status: string }>('SELECT status FROM shop_carts WHERE id = ?', cartId);
      if (!cart) throw notFound('Carrito no encontrado');
      if (cart.status !== 'open') throw conflict('El carrito no está abierto');
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['code']);
      const code = input.string('code', { required: true, maxLength: 40 });
      input.done();
      const totals = cartTotals(db, cartId);
      const { coupon } = couponFor(db, code, totals.subtotal_cents);
      db.run('UPDATE shop_carts SET coupon_id = ?, updated_at = ? WHERE id = ?', Number(coupon.id), now(), cartId);
      sendJson(ctx, 200, { data: cartTotals(db, cartId) });
    },
    { summary: 'Aplica un cupón al carrito', tag: 'Shop · Carts' },
  );

  router.add(
    'POST',
    `${root}/carts/:id/checkout`,
    async (ctx) => {
      const cartId = Number(ctx.params.id);
      const db = dbOf(ctx);
      const cart = db.get<{ id: number; customer_id: number; status: string; coupon_id: number | null }>(
        'SELECT * FROM shop_carts WHERE id = ?',
        cartId,
      );
      if (!cart) throw notFound('Carrito no encontrado');
      if (cart.status !== 'open') throw conflict('El carrito ya fue procesado o abandonado');
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['shipping_address_id', 'coupon_code', 'payment_method_id', 'carrier_id']);
      const addressId = input.integer('shipping_address_id', { nullable: true, min: 1 }) ?? null;
      const couponCode = input.string('coupon_code', { maxLength: 40 });
      const methodId = input.integer('payment_method_id', { nullable: true, min: 1 }) ?? null;
      const carrierId = input.integer('carrier_id', { min: 1, default: 1 }) ?? 1;
      input.done();
      if (addressId) {
        const address = db.get<{ customer_id: number }>(
          'SELECT customer_id FROM shop_addresses WHERE id = ?',
          addressId,
        );
        if (!address) throw notFound('Dirección no encontrada');
        if (address.customer_id !== cart.customer_id)
          throw validationError([{ field: 'shipping_address_id', message: 'la dirección no pertenece al cliente' }]);
      }
      if (methodId) {
        const method = db.get<{ customer_id: number }>(
          'SELECT customer_id FROM shop_payment_methods WHERE id = ?',
          methodId,
        );
        if (!method) throw notFound('Método de pago no encontrado');
        if (method.customer_id !== cart.customer_id)
          throw validationError([{ field: 'payment_method_id', message: 'el método no pertenece al cliente' }]);
      }
      const totals = cartTotals(db, cartId);
      if (totals.items.length === 0) throw conflict('El carrito está vacío');
      for (const item of totals.items) {
        const available = variantAvailability(db, Number(item.variant_id));
        if (Number(item.quantity) > available)
          throw conflict('Stock insuficiente', {
            variant_id: item.variant_id,
            available,
            requested: item.quantity,
          });
      }
      let discount = totals.discount_cents;
      let couponRow: Record<string, unknown> | null = totals.coupon;
      if (couponCode) {
        const applied = couponFor(db, couponCode, totals.subtotal_cents);
        couponRow = applied.coupon;
        discount = applied.discount;
      }
      if (cart.coupon_id && !couponCode) {
        const coupon = db.get<Record<string, unknown>>('SELECT * FROM shop_coupons WHERE id = ?', cart.coupon_id);
        if (coupon) {
          const applied = couponFor(db, String(coupon.code), totals.subtotal_cents);
          discount = applied.discount;
          couponRow = applied.coupon;
        }
      }
      const shipping = totals.subtotal_cents - discount >= FREE_SHIPPING_FROM ? 0 : SHIPPING_CENTS;
      const tax = Math.round((totals.subtotal_cents - discount + shipping) * TAX_RATE);
      const total = totals.subtotal_cents - discount + shipping + tax;
      const orderNumber = `ORD-${new Date().getUTCFullYear()}-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;

      try {
        const orderId = db.transaction(() => {
          const newOrderId = db.insert('shop_orders', {
            order_number: orderNumber,
            customer_id: cart.customer_id,
            status: 'paid',
            subtotal_cents: totals.subtotal_cents,
            discount_cents: discount,
            shipping_cents: shipping,
            tax_cents: tax,
            total_cents: total,
            currency: 'EUR',
            coupon_id: couponRow ? Number(couponRow.id) : null,
            shipping_address_id: addressId,
            created_at: now(),
            updated_at: now(),
            canceled_at: null,
          });
          for (const item of totals.items) {
            db.insert('shop_order_items', {
              order_id: newOrderId,
              variant_id: Number(item.variant_id),
              product_name: String(item.product_name),
              sku: String(item.sku),
              quantity: Number(item.quantity),
              unit_price_cents: Number(item.effective_price_cents),
              line_total_cents: Number(item.quantity) * Number(item.effective_price_cents),
            });
            decrementStock(db, Number(item.variant_id), Number(item.quantity));
          }
          const resolvedMethod =
            methodId ??
            db.get<{ id: number }>(
              'SELECT id FROM shop_payment_methods WHERE customer_id = ? ORDER BY is_default DESC, id LIMIT 1',
              cart.customer_id,
            )?.id ??
            null;
          db.insert('shop_payments', {
            order_id: newOrderId,
            method_id: resolvedMethod,
            status: 'captured',
            amount_cents: total,
            provider_ref: `PAY-${randomUUID()}`,
            created_at: now(),
            processed_at: now(),
          });
          createShipment(db, newOrderId, carrierId);
          db.run(
            'UPDATE shop_carts SET status = ?, coupon_id = ?, updated_at = ? WHERE id = ?',
            'checked_out',
            couponRow ? Number(couponRow.id) : null,
            now(),
            cartId,
          );
          if (couponRow)
            db.run('UPDATE shop_coupons SET used_count = used_count + 1 WHERE id = ?', Number(couponRow.id));
          recalcCustomerStats(db, cart.customer_id);
          return newOrderId;
        });
        sendJson(ctx, 201, { data: orderDetails(ctx, orderId) }, { Location: `${root}/orders/${orderId}` });
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE'))
          throw conflict('Conflicto al generar el pedido; reintente');
        throw error;
      }
    },
    { summary: 'Checkout atómico: pedido, pago, inventario y envío', tag: 'Shop · Orders' },
  );

  // ---------- Pedidos ----------
  router.add(
    'GET',
    `${root}/orders`,
    (ctx) => {
      const db = dbOf(ctx);
      const app = (ctx as RequestContext).app;
      const allowed = new Set([
        'page',
        'per_page',
        'limit',
        'offset',
        'sort',
        'order',
        'q',
        'customer_id',
        'status',
        'created_after',
        'created_before',
        'total_gte',
        'total_lte',
      ]);
      for (const key of ctx.query.keys())
        if (!allowed.has(key)) throw validationError([{ field: key, message: 'parámetro desconocido' }]);
      const pagination = parsePagination(ctx, app.config.maxPageSize);
      const clauses: string[] = [];
      const params: Array<string | number> = [];
      const customer = ctx.query.get('customer_id');
      if (customer) {
        clauses.push('o.customer_id = ?');
        params.push(Number(customer));
      }
      const status = ctx.query.get('status');
      if (status) {
        if (!['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'].includes(status))
          throw validationError([{ field: 'status', message: 'valor inválido' }]);
        clauses.push('o.status = ?');
        params.push(status);
      }
      const q = ctx.query.get('q');
      if (q) {
        clauses.push(
          "(LOWER(o.order_number) LIKE LOWER(?) ESCAPE '\\' OR LOWER(c.full_name) LIKE LOWER(?) ESCAPE '\\')",
        );
        const like = `%${escapeLike(q)}%`;
        params.push(like, like);
      }
      const after = ctx.query.get('created_after');
      if (after) {
        clauses.push('o.created_at >= ?');
        params.push(after);
      }
      const before = ctx.query.get('created_before');
      if (before) {
        clauses.push('o.created_at <= ?');
        params.push(before);
      }
      const totalGte = ctx.query.get('total_gte');
      if (totalGte) {
        clauses.push('o.total_cents >= ?');
        params.push(Number(totalGte));
      }
      const totalLte = ctx.query.get('total_lte');
      if (totalLte) {
        clauses.push('o.total_cents <= ?');
        params.push(Number(totalLte));
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const sortRaw = ctx.query.get('sort') ?? 'id';
      const sort = sortRaw.startsWith('-') ? sortRaw.slice(1) : sortRaw;
      if (!['id', 'created_at', 'total_cents', 'status'].includes(sort))
        throw validationError([{ field: 'sort', message: 'campo no ordenable' }]);
      const orderRaw = ctx.query.get('order');
      if (orderRaw && !['asc', 'desc'].includes(orderRaw))
        throw validationError([{ field: 'order', message: 'use asc o desc' }]);
      const direction = (orderRaw ?? (sortRaw.startsWith('-') ? 'desc' : 'asc')).toUpperCase();
      const base = `FROM shop_orders o JOIN shop_customers c ON c.id = o.customer_id${where}`;
      const total = Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n ${base}`, ...params)?.n ?? 0);
      const rows = db.all<Record<string, unknown>>(
        `SELECT o.*, c.full_name AS customer_name, c.email AS customer_email ${base}
       ORDER BY o.${sort} ${direction}, o.id ASC LIMIT ? OFFSET ?`,
        ...params,
        pagination.perPage,
        pagination.offset,
      );
      sendJson(ctx, 200, { data: rows, meta: paginationMeta(pagination, total) });
    },
    { summary: 'Lista pedidos con filtros', tag: 'Shop · Orders' },
  );

  router.add(
    'GET',
    `${root}/orders/:id`,
    (ctx) => {
      sendJson(ctx, 200, { data: orderDetails(ctx, Number(ctx.params.id)) });
    },
    { summary: 'Pedido con líneas, pagos, envío y reembolsos', tag: 'Shop · Orders' },
  );

  router.add(
    'PATCH',
    `${root}/orders/:id/status`,
    async (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const order = db.get<{ status: string; customer_id: number }>(
        'SELECT status, customer_id FROM shop_orders WHERE id = ?',
        id,
      );
      if (!order) throw notFound('Pedido no encontrado');
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['status']);
      const status = input.string('status', {
        required: true,
        enum: ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
      });
      input.done();
      if (!(ORDER_TRANSITIONS[order.status] ?? []).includes(status)) {
        throw conflict(`Transición no permitida: ${order.status} -> ${status}`);
      }
      db.transaction(() => {
        db.run('UPDATE shop_orders SET status = ?, updated_at = ? WHERE id = ?', status, now(), id);
        if (status === 'shipped') {
          createShipment(db, id);
          db.run("UPDATE shop_shipments SET status = 'in_transit', shipped_at = ? WHERE order_id = ?", now(), id);
        }
        if (status === 'delivered') {
          db.run("UPDATE shop_shipments SET status = 'delivered', delivered_at = ? WHERE order_id = ?", now(), id);
        }
        recalcCustomerStats(db, order.customer_id);
      });
      sendJson(ctx, 200, { data: orderDetails(ctx, id) });
    },
    { summary: 'Cambia el estado de un pedido con transiciones válidas', tag: 'Shop · Orders' },
  );

  router.add(
    'POST',
    `${root}/orders/:id/cancel`,
    async (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const order = db.get<{ status: string; customer_id: number }>(
        'SELECT status, customer_id FROM shop_orders WHERE id = ?',
        id,
      );
      if (!order) throw notFound('Pedido no encontrado');
      if (!['pending', 'paid', 'processing'].includes(order.status))
        throw conflict(`No se puede cancelar un pedido en estado ${order.status}`);
      db.transaction(() => {
        const items = db.all<{ variant_id: number | null; quantity: number }>(
          'SELECT variant_id, quantity FROM shop_order_items WHERE order_id = ?',
          id,
        );
        for (const item of items) if (item.variant_id) restoreStock(db, item.variant_id, item.quantity);
        const payment = db.get<{ id: number; status: string; amount_cents: number }>(
          `SELECT * FROM shop_payments WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
          id,
        );
        if (payment && ['captured', 'authorized'].includes(payment.status)) {
          db.run("UPDATE shop_payments SET status = 'refunded' WHERE id = ?", payment.id);
          db.insert('shop_refunds', {
            payment_id: payment.id,
            order_id: id,
            amount_cents: payment.amount_cents,
            reason: 'Cancelación del pedido',
            status: 'completed',
            created_at: now(),
            completed_at: now(),
          });
        }
        db.run(
          "UPDATE shop_orders SET status = 'cancelled', canceled_at = ?, updated_at = ? WHERE id = ?",
          now(),
          now(),
          id,
        );
        recalcCustomerStats(db, order.customer_id);
      });
      sendJson(ctx, 200, { data: orderDetails(ctx, id) });
    },
    { summary: 'Cancela un pedido y restaura inventario', tag: 'Shop · Orders' },
  );

  router.add(
    'POST',
    `${root}/orders/:id/refund`,
    async (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const order = db.get<{ status: string; customer_id: number }>(
        'SELECT status, customer_id FROM shop_orders WHERE id = ?',
        id,
      );
      if (!order) throw notFound('Pedido no encontrado');
      if (!['paid', 'shipped', 'delivered', 'processing'].includes(order.status))
        throw conflict(`No se puede reembolsar un pedido en estado ${order.status}`);
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['amount_cents', 'reason']);
      const amount = input.integer('amount_cents', { min: 1 });
      const reason = input.string('reason', { maxLength: 500, default: 'Reembolso solicitado por el cliente' });
      input.done();
      const payment = db.get<{ id: number; status: string; amount_cents: number }>(
        'SELECT * FROM shop_payments WHERE order_id = ? ORDER BY id DESC LIMIT 1',
        id,
      );
      if (!payment) throw conflict('El pedido no tiene pago asociado');
      if (!['captured', 'authorized'].includes(payment.status)) throw conflict('El pago no es reembolsable');
      const refundAmount = amount ?? payment.amount_cents;
      if (refundAmount > payment.amount_cents)
        throw validationError([{ field: 'amount_cents', message: 'supera el importe pagado' }]);
      db.transaction(() => {
        db.insert('shop_refunds', {
          payment_id: payment.id,
          order_id: id,
          amount_cents: refundAmount,
          reason,
          status: 'completed',
          created_at: now(),
          completed_at: now(),
        });
        db.run("UPDATE shop_payments SET status = 'refunded' WHERE id = ?", payment.id);
        db.run("UPDATE shop_orders SET status = 'refunded', updated_at = ? WHERE id = ?", now(), id);
        recalcCustomerStats(db, order.customer_id);
      });
      sendJson(ctx, 201, { data: orderDetails(ctx, id) });
    },
    { summary: 'Reembolsa un pedido', tag: 'Shop · Refunds' },
  );

  router.add(
    'GET',
    `${root}/refunds`,
    (ctx) => {
      const rows = dbOf(ctx).all(
        `SELECT r.*, o.order_number, c.full_name AS customer_name FROM shop_refunds r
       JOIN shop_orders o ON o.id = r.order_id JOIN shop_customers c ON c.id = o.customer_id
       ORDER BY r.id DESC LIMIT 200`,
      );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Lista reembolsos', tag: 'Shop · Refunds' },
  );

  // ---------- Envíos ----------
  router.add(
    'GET',
    `${root}/shipments`,
    (ctx) => {
      const status = ctx.query.get('status');
      const rows = status
        ? dbOf(ctx).all(
            `SELECT s.*, o.order_number, c.name AS carrier_name FROM shop_shipments s
         JOIN shop_orders o ON o.id = s.order_id JOIN shop_carriers c ON c.id = s.carrier_id
         WHERE s.status = ? ORDER BY s.id DESC LIMIT 200`,
            status,
          )
        : dbOf(ctx).all(
            `SELECT s.*, o.order_number, c.name AS carrier_name FROM shop_shipments s
         JOIN shop_orders o ON o.id = s.order_id JOIN shop_carriers c ON c.id = s.carrier_id
         ORDER BY s.id DESC LIMIT 200`,
          );
      sendJson(ctx, 200, { data: rows, meta: { total: rows.length } });
    },
    { summary: 'Lista envíos', tag: 'Shop · Shipping' },
  );

  router.add(
    'GET',
    `${root}/shipments/track/:trackingNumber`,
    (ctx) => {
      const row = dbOf(ctx).get(
        `SELECT s.*, o.order_number, o.status AS order_status, c.name AS carrier_name
       FROM shop_shipments s JOIN shop_orders o ON o.id = s.order_id JOIN shop_carriers c ON c.id = s.carrier_id
       WHERE s.tracking_number = ?`,
        ctx.params.trackingNumber,
      );
      if (!row) throw notFound('Envío no encontrado');
      sendJson(ctx, 200, { data: row });
    },
    { summary: 'Seguimiento por número de envío', tag: 'Shop · Shipping' },
  );

  router.add(
    'PATCH',
    `${root}/shipments/:id/status`,
    async (ctx) => {
      const id = Number(ctx.params.id);
      const db = dbOf(ctx);
      const shipment = db.get<{ order_id: number }>('SELECT order_id FROM shop_shipments WHERE id = ?', id);
      if (!shipment) throw notFound('Envío no encontrado');
      const body = await readJsonBody(ctx);
      const input = new Validator(body, ['status']);
      const status = input.string('status', {
        required: true,
        enum: ['label_created', 'in_transit', 'out_for_delivery', 'delivered', 'returned'],
      });
      input.done();
      db.transaction(() => {
        db.run(
          "UPDATE shop_shipments SET status = ?, shipped_at = COALESCE(shipped_at, ?), delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END WHERE id = ?",
          status,
          now(),
          status,
          now(),
          id,
        );
        if (status === 'in_transit' || status === 'out_for_delivery')
          db.run(
            "UPDATE shop_orders SET status = 'shipped', updated_at = ? WHERE id = ? AND status IN ('paid','processing')",
            now(),
            shipment.order_id,
          );
        if (status === 'delivered')
          db.run("UPDATE shop_orders SET status = 'delivered', updated_at = ? WHERE id = ?", now(), shipment.order_id);
      });
      sendJson(ctx, 200, { data: db.get('SELECT * FROM shop_shipments WHERE id = ?', id) });
    },
    { summary: 'Actualiza el estado de un envío', tag: 'Shop · Shipping' },
  );

  // ---------- Cupones ----------
  router.add(
    'GET',
    `${root}/coupons/validate`,
    (ctx) => {
      const code = ctx.query.get('code');
      const subtotalRaw = ctx.query.get('subtotal_cents');
      if (!code) throw validationError([{ field: 'code', message: 'obligatorio' }]);
      const subtotal = subtotalRaw ? Number(subtotalRaw) : 0;
      if (!Number.isInteger(subtotal) || subtotal < 0)
        throw validationError([{ field: 'subtotal_cents', message: 'entero >= 0' }]);
      const { coupon, discount } = couponFor(dbOf(ctx), code, subtotal);
      sendJson(ctx, 200, {
        data: {
          valid: true,
          code: coupon.code,
          kind: coupon.kind,
          value: coupon.value,
          discount_cents: discount,
          subtotal_cents: subtotal,
          total_after_discount_cents: subtotal - discount,
        },
      });
    },
    { summary: 'Valida un cupón y calcula el descuento', tag: 'Shop · Discounts' },
  );
}
