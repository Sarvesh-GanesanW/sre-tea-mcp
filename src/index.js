#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── logging ───────────────────────────────────────────────────────
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level, message, metadata = {}) {
  if (LEVELS[level] >= LEVELS[LOG_LEVEL]) {
    const timestamp = new Date().toISOString();
    const meta = Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : "";
    console.error(`[${timestamp}] [${level.toUpperCase()}] ${message}${meta}`);
  }
}

const API_BASE = process.env.SRE_API_URL || "https://jzwp96mgv2.execute-api.ap-south-1.amazonaws.com/prod/api/v1";
let TOKEN = process.env.SRE_ADMIN_TOKEN || "";
let TOKEN_REFRESH_IN_PROGRESS = false;

// Validate required environment variables
if (!TOKEN && (!process.env.SRE_ADMIN_EMAIL || !process.env.SRE_ADMIN_PASSWORD)) {
  log("error", "Missing required environment variables: SRE_ADMIN_TOKEN or (SRE_ADMIN_EMAIL + SRE_ADMIN_PASSWORD)");
  process.exit(1);
}

async function api(method, path, body = null, retryOnAuth = true) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
    redirect: "follow",
  };
  if (TOKEN) opts.headers["Authorization"] = `Bearer ${TOKEN}`;
  if (body) opts.body = JSON.stringify(body);

  log("debug", "API request", { method, path });

  // Follow 307 redirects with auth headers
  let res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 307) {
    const location = res.headers.get("location");
    if (location) {
      log("debug", "Following redirect", { location });
      res = await fetch(location, opts);
    }
  }

  // Handle 401 Unauthorized - token expired
  if (res.status === 401 && retryOnAuth && path !== "/auth/login") {
    log("warn", "Token expired, refreshing authentication");

    // Prevent concurrent token refreshes
    if (TOKEN_REFRESH_IN_PROGRESS) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return api(method, path, body, false);
    }

    TOKEN_REFRESH_IN_PROGRESS = true;
    TOKEN = "";
    try {
      await ensureToken();
      log("info", "Token refreshed, retrying request");
      return api(method, path, body, false);
    } catch (refreshError) {
      log("error", "Token refresh failed", { error: refreshError.message });
      throw refreshError;
    } finally {
      TOKEN_REFRESH_IN_PROGRESS = false;
    }
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg = data.detail || data.message || JSON.stringify(data);
    log("error", "API error", { status: res.status, path, error: errorMsg });
    throw new Error(`API ${res.status}: ${errorMsg}`);
  }

  log("debug", "API success", { status: res.status, path });
  return data;
}

async function ensureToken() {
  if (TOKEN) return;

  if (!process.env.SRE_ADMIN_EMAIL || !process.env.SRE_ADMIN_PASSWORD) {
    throw new Error("Authentication required: Set SRE_ADMIN_TOKEN or (SRE_ADMIN_EMAIL + SRE_ADMIN_PASSWORD)");
  }

  log("info", "Authenticating with API", { email: process.env.SRE_ADMIN_EMAIL });
  const data = await api("POST", "/auth/login", {
    identifier: process.env.SRE_ADMIN_EMAIL,
    password: process.env.SRE_ADMIN_PASSWORD,
  });
  TOKEN = data.access_token;
  log("info", "Authentication successful");
}

// ── server ────────────────────────────────────────────────────────

const server = new McpServer({
  name: "sre-tea-admin",
  version: "1.0.0",
});

// ── dashboard ─────────────────────────────────────────────────────

server.tool("get_dashboard", "Get business dashboard summary with key metrics.\n\nReturns: Total revenue, order counts (today/this week/this month), active customers, pending orders. Use for morning briefing or quick business health check.", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/dashboard/summary");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_sales_chart", "Get daily sales data for a period.\n\nReturns: Daily revenue breakdown for specified days. Use to visualize sales trends and identify peak days.", {
  days: z.number().default(30).describe("Number of days of history"),
}, async ({ days }) => {
  await ensureToken();
  const data = await api("GET", `/admin/dashboard/sales-chart?days=${days}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// ── orders ────────────────────────────────────────────────────────

server.tool("list_orders", "List orders with optional status filter.\n\nReturns: Array of orders with customer info, totals, and current status. Use to view all orders or filter by status (pending, confirmed, processing, packed, shipped, out_for_delivery, delivered, cancelled).", {
  status: z.string().optional().describe("Filter: pending, confirmed, processing, packed, shipped, out_for_delivery, delivered, cancelled"),
  per_page: z.number().default(20),
}, async ({ status, per_page }) => {
  await ensureToken();
  let path = `/admin/orders?per_page=${per_page}`;
  if (status) path += `&status=${status}`;
  const data = await api("GET", path);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_order", "Get full details of a specific order.\n\nReturns: Complete order info including items, customer, shipping, payment status, and timeline. Use to review order details or troubleshoot issues.", {
  order_id: z.string().describe("Order UUID"),
}, async ({ order_id }) => {
  await ensureToken();
  const data = await api("GET", `/admin/orders/${order_id}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("update_order_status", "Update an order's status (e.g., mark as shipped, delivered).\n\nReturns: Updated order with new status. Use to progress orders through fulfillment pipeline: confirmed → processing → packed → shipped → out_for_delivery → delivered.", {
  order_id: z.string().describe("Order UUID"),
  status: z.string().describe("New status: confirmed, processing, packed, shipped, out_for_delivery, delivered, cancelled"),
  notes: z.string().optional().describe("Optional notes about this status change"),
}, async ({ order_id, status, notes }) => {
  await ensureToken();
  const data = await api("PATCH", `/admin/orders/${order_id}/status`, { status, notes });
  return { content: [{ type: "text", text: `Order ${data.order_number} → ${data.status}` }] };
});

// ── products ──────────────────────────────────────────────────────

server.tool("list_products", "List all products with prices and stock.\n\nReturns: All products with SKU, retail/wholesale prices, and current stock quantities. Use to view catalog or check inventory levels.", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/products?per_page=50");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("create_product", "Create a new product.\n\nReturns: New product with UUID and all details. Use to add new items to catalog.", {
  name: z.string(),
  sku: z.string(),
  retail_price: z.number(),
  weight_grams: z.number(),
  weight_display: z.string(),
  wholesale_price: z.number().optional(),
  stock_quantity: z.number().default(0),
  description: z.string().optional(),
}, async (params) => {
  await ensureToken();
  const data = await api("POST", "/admin/products", params);
  return { content: [{ type: "text", text: `Product created: ${data.name} (${data.sku}) — ₹${data.retail_price}` }] };
});

server.tool("update_product", "Update a product's details — price, name, stock, description, etc.\n\nReturns: Updated product with all fields. Use to modify any product attribute.", {
  product_id: z.string().describe("Product UUID"),
  retail_price: z.number().optional().describe("New retail price"),
  wholesale_price: z.number().optional().describe("New wholesale price"),
  name: z.string().optional(),
  description: z.string().optional(),
  short_description: z.string().optional(),
  stock_quantity: z.number().optional(),
  is_active: z.boolean().optional(),
  is_featured: z.boolean().optional(),
}, async ({ product_id, ...updates }) => {
  await ensureToken();
  const clean = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
  const data = await api("PATCH", `/admin/products/${product_id}`, clean);
  return { content: [{ type: "text", text: `Updated ${data.name}: retail=${data.retail_price}, wholesale=${data.wholesale_price}, stock=${data.stock_quantity}` }] };
});

server.tool("update_stock", "Update a product's stock quantity.\n\nReturns: Product with new stock level. Use to adjust inventory after sales or purchases.", {
  product_id: z.string().describe("Product UUID"),
  quantity: z.number().describe("New stock quantity"),
}, async ({ product_id, quantity }) => {
  await ensureToken();
  const data = await api("PATCH", `/admin/products/${product_id}/stock?quantity=${quantity}`);
  return { content: [{ type: "text", text: `Stock updated to ${data.stock_quantity}` }] };
});

// ── customers ─────────────────────────────────────────────────────

server.tool("list_customers", "List customers with optional search.\n\nReturns: Customer records with contact info, type (retail/wholesale), tier, and credit limits. Use to find customers or filter by type.", {
  search: z.string().optional().describe("Search by name, phone, or business"),
  customer_type: z.string().optional().describe("Filter: retail or wholesale"),
}, async ({ search, customer_type }) => {
  await ensureToken();
  let path = "/admin/customers?per_page=50";
  if (search) path += `&search=${encodeURIComponent(search)}`;
  if (customer_type) path += `&customer_type=${customer_type}`;
  const data = await api("GET", path);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_customer", "Get detailed info about a specific customer.\n\nReturns: Complete customer profile with contact, type, tier, credit limit, and order history. Use to review customer details.", {
  user_id: z.string().describe("Customer UUID"),
}, async ({ user_id }) => {
  await ensureToken();
  const data = await api("GET", `/admin/customers/${user_id}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("update_customer", "Update customer type, credit limit, or tier.\n\nReturns: Updated customer profile. Use to modify customer classification or credit terms.", {
  user_id: z.string().describe("Customer UUID"),
  customer_type: z.string().optional().describe("retail or wholesale"),
  credit_limit: z.number().optional(),
  role: z.string().optional(),
}, async ({ user_id, ...updates }) => {
  await ensureToken();
  const data = await api("PATCH", `/admin/customers/${user_id}`, updates);
  return { content: [{ type: "text", text: `Customer ${data.full_name} updated` }] };
});

// ── invoices ──────────────────────────────────────────────────────

server.tool("list_invoices", "List all invoices.\n\nReturns: All generated GST invoices with amounts, dates, and payment status. Use to review billing history.", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/invoices");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("generate_invoice", "Generate a GST invoice for an order.\n\nReturns: Invoice with CGST, SGST amounts. Use to bill orders and generate tax documentation.", {
  order_id: z.string().describe("Order UUID"),
  due_date: z.string().optional().describe("Due date in YYYY-MM-DD format"),
}, async ({ order_id, due_date }) => {
  await ensureToken();
  const body = { order_id };
  if (due_date) body.due_date = due_date;
  const data = await api("POST", "/admin/invoices/generate", body);
  return { content: [{ type: "text", text: `Invoice ${data.invoice_number} generated — ₹${data.total_amount} (CGST: ₹${data.cgst_amount}, SGST: ₹${data.sgst_amount})` }] };
});

// ── ledger ────────────────────────────────────────────────────────

server.tool("get_outstanding_balances", "Get all customers with outstanding credit balances.\n\nReturns: Customers with credit owed, amounts, and aging. Use to track receivables and collection priorities.", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/ledger/outstanding");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_customer_ledger", "Get ledger entries for a specific customer.\n\nReturns: Transaction history with invoices, payments, and running balance. Use to review customer account activity.", {
  user_id: z.string().describe("Customer UUID"),
}, async ({ user_id }) => {
  await ensureToken();
  const data = await api("GET", `/admin/ledger/customer/${user_id}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("record_payment", "Record a payment received from a customer.\n\nReturns: Payment record with updated balance. Use to log UPI, cheque, or cash payments.", {
  user_id: z.string().describe("Customer UUID"),
  amount: z.number().describe("Payment amount in rupees"),
  reference_number: z.string().optional().describe("UPI UTR, cheque number, etc."),
  description: z.string().optional(),
}, async ({ user_id, amount, reference_number, description }) => {
  await ensureToken();
  const data = await api("POST", "/admin/ledger/payment", { user_id, amount, reference_number, description });
  return { content: [{ type: "text", text: `Payment ₹${data.amount} recorded. New balance: ₹${data.running_balance}` }] };
});

// ── retention ─────────────────────────────────────────────────────

server.tool("get_churn_summary", "Get customer retention summary — tier distribution, churn risks, volume drops.\n\nReturns: Customer tier counts, reorder gap alerts, volume drop alerts. Use to identify at-risk customers and churn trends.", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/retention/churn-summary");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_reorder_gaps", "Get customers who are overdue for their next order (churn risk).\n\nReturns: Customers past expected reorder date with risk levels. Use to prioritize retention outreach.", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/retention/reorder-gaps");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_volume_drops", "Get customers whose order volume dropped 20%+ recently.\n\nReturns: Customers with volume decrease and prior volumes. Use to identify troubled accounts.", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/retention/volume-drops");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("classify_tiers", "Reclassify all customers into A/B/C tiers based on recent behavior.\n\nReturns: Counts of customers in each tier. Use to update customer segmentation monthly.", {}, async () => {
  await ensureToken();
  const data = await api("POST", "/admin/retention/classify-tiers");
  return { content: [{ type: "text", text: `Tiers updated: A=${data.counts.A}, B=${data.counts.B}, C=${data.counts.C}` }] };
});

// ── logistics ─────────────────────────────────────────────────────

server.tool("get_logistics_kpis", "Get delivery logistics KPIs — trips, kg delivered, cost per kg.\n\nReturns: Delivery efficiency metrics for specified period. Use to monitor logistics performance.", {
  days: z.number().default(30),
}, async ({ days }) => {
  await ensureToken();
  const data = await api("GET", `/admin/logistics/kpis?days=${days}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_slab_pricing", "Get current slab pricing for all products.\n\nReturns: Volume-based pricing tiers for products. Use to quote wholesale customers.", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/retention/slab-pricing");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// ── smart stock + product management ─────────────────────────────

server.tool("update_stock_by_name", "Update stock for a product by name (e.g., 'Rajalakshmi Gold - 250g').\n\nReturns: Product with updated stock. Use for quick inventory adjustments without UUID.", {
  product_name: z.string().describe("Product name or partial match like 'Gold 250g' or 'Royal 1kg'"),
  quantity: z.number().describe("New stock quantity"),
}, async ({ product_name, quantity }) => {
  await ensureToken();
  const products = await api("GET", "/products?per_page=50");
  const items = products.items || [];
  const q = product_name.toLowerCase();
  const match = items.find(p => p.name.toLowerCase().includes(q) || `${p.name} ${p.weight_display}`.toLowerCase().includes(q));
  if (!match) return { content: [{ type: "text", text: `No product matching '${product_name}'. Available: ${items.map(p => p.name).join(', ')}` }] };
  const data = await api("PATCH", `/admin/products/${match.id}/stock?quantity=${quantity}`);
  return { content: [{ type: "text", text: `${match.name}: stock updated to ${data.stock_quantity}` }] };
});

server.tool("update_price_by_name", "Update price for a product by name.\n\nReturns: Product with new price. Use for quick pricing updates.", {
  product_name: z.string().describe("Product name or partial match"),
  retail_price: z.number().describe("New retail price"),
}, async ({ product_name, retail_price }) => {
  await ensureToken();
  const products = await api("GET", "/products?per_page=50");
  const items = products.items || [];
  const q = product_name.toLowerCase();
  const match = items.find(p => p.name.toLowerCase().includes(q));
  if (!match) return { content: [{ type: "text", text: `No product matching '${product_name}'` }] };
  const data = await api("PATCH", `/admin/products/${match.id}`, { retail_price });
  return { content: [{ type: "text", text: `${data.name}: price updated to ₹${data.retail_price}` }] };
});

server.tool("get_stock_status", "Get stock levels for all products — shows what needs restocking.\n\nReturns: Products categorized as out, low, or in stock with priorities. Use for inventory planning.", {}, async () => {
  await ensureToken();
  const data = await api("GET", `/admin/analytics/products?days=30`);
  const stock = data.stock || [];
  const out = stock.filter(p => p.status === 'out');
  const low = stock.filter(p => p.status === 'low');
  const ok = stock.filter(p => p.status === 'ok');

  let msg = `Stock Status (${stock.length} products):\n\n`;
  if (out.length) msg += `🔴 OUT OF STOCK:\n${out.map(p => `  ${p.name} (${p.sku}): 0`).join('\n')}\n\n`;
  if (low.length) msg += `🟡 LOW STOCK:\n${low.map(p => `  ${p.name} (${p.sku}): ${p.stock} (threshold: ${p.threshold})`).join('\n')}\n\n`;
  msg += `🟢 IN STOCK: ${ok.length} products\n${ok.map(p => `  ${p.name}: ${p.stock}`).join('\n')}`;
  return { content: [{ type: "text", text: msg }] };
});

server.tool("bulk_update_stock", "Update stock for multiple products at once.\n\nReturns: List of updates with per-product success/failure. Use for batch inventory operations.", {
  updates: z.array(z.object({
    product_name: z.string(),
    quantity: z.number(),
  })).describe("Array of {product_name, quantity} to update"),
}, async ({ updates }) => {
  await ensureToken();
  const products = await api("GET", "/products?per_page=50");
  const items = products.items || [];
  const results = [];

  for (const { product_name, quantity } of updates) {
    const q = product_name.toLowerCase();
    const match = items.find(p => p.name.toLowerCase().includes(q));
    if (!match) { results.push(`${product_name}: NOT FOUND`); continue; }
    try {
      await api("PATCH", `/admin/products/${match.id}/stock?quantity=${quantity}`);
      results.push(`${match.name}: → ${quantity}`);
    } catch (e) { results.push(`${match.name}: FAILED — ${e.message}`); }
  }
  return { content: [{ type: "text", text: `Stock updated:\n${results.join('\n')}` }] };
});

server.tool("delete_customer", "Deactivate a customer account.\n\nReturns: Confirmation message. Use to archive inactive customers.", {
  user_id: z.string().describe("Customer UUID"),
}, async ({ user_id }) => {
  await ensureToken();
  const data = await api("DELETE", `/admin/customers/${user_id}`);
  return { content: [{ type: "text", text: data.message }] };
});

server.tool("create_admin_account", "Create a new admin or staff account for the admin panel.\n\nReturns: New account with credentials. Use to onboard team members.", {
  full_name: z.string(),
  email: z.string(),
  phone: z.string(),
  password: z.string(),
  role: z.string().default("admin").describe("'admin' for full access, 'staff' for limited"),
}, async ({ full_name, email, phone, password, role }) => {
  await ensureToken();
  const data = await api("POST", "/admin/customers/create-admin", { full_name, email, phone, password, role });
  return { content: [{ type: "text", text: `${data.message}: ${data.email} (ID: ${data.id})` }] };
});

server.tool("get_analytics_revenue", "Get revenue analytics — daily trend, by product, growth rate.\n\nReturns: Daily breakdown, product-wise revenue, trend analysis. Use to analyze sales performance.", {
  days: z.number().default(30),
}, async ({ days }) => {
  await ensureToken();
  const data = await api("GET", `/admin/analytics/revenue?days=${days}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_analytics_customers", "Get customer analytics — totals, top 10, by type/tier.\n\nReturns: Customer counts by segment, type/tier distribution. Use to understand customer composition.", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/analytics/customers");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_analytics_financials", "Get financial analytics — GST, invoiced, outstanding, payment methods.\n\nReturns: Tax breakdowns, invoice totals, receivables, payment method distribution. Use for financial reporting.", {
  days: z.number().default(30),
}, async ({ days }) => {
  await ensureToken();
  const data = await api("GET", `/admin/analytics/financials?days=${days}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// ── bulk operations ───────────────────────────────────────────────

server.tool("bulk_update_orders", "Update status of multiple orders at once (e.g., ship all packed orders).\n\nReturns: Count of updated orders and list with success/failure per order. Use to batch-transition orders (e.g., packed → shipped, confirmed → processing).", {
  status_from: z.string().describe("Current status to filter by (e.g., 'packed')"),
  status_to: z.string().describe("New status to set (e.g., 'shipped')"),
  notes: z.string().optional(),
}, async ({ status_from, status_to, notes }) => {
  await ensureToken();
  const orders = await api("GET", `/admin/orders?status=${status_from}&per_page=100`);
  const items = orders.items || [];
  if (items.length === 0) return { content: [{ type: "text", text: `No orders with status '${status_from}'` }] };

  const results = [];
  for (const o of items) {
    try {
      await api("PATCH", `/admin/orders/${o.id}/status`, { status: status_to, notes: notes || `Bulk update: ${status_from} → ${status_to}` });
      results.push(`${o.order_number}: OK`);
    } catch (e) { results.push(`${o.order_number}: FAILED — ${e.message}`); }
  }
  return { content: [{ type: "text", text: `Updated ${results.filter(r => r.includes('OK')).length}/${items.length} orders:\n${results.join('\n')}` }] };
});

// ── reports ───────────────────────────────────────────────────────

server.tool("daily_summary", "Morning briefing — orders, revenue, pending dispatch, churn alerts, stock warnings in one call.\n\nReturns: Aggregated dashboard, delivery pipeline, customer health, and inventory alerts. Use for daily standup or overnight summary. Makes 5 parallel API calls.", {}, async () => {
  await ensureToken();
  const [dashboard, pending, active, churn, products] = await Promise.all([
    api("GET", "/admin/dashboard/summary"),
    api("GET", "/admin/delivery/pending").catch(() => []),
    api("GET", "/admin/delivery").catch(() => []),
    api("GET", "/admin/retention/churn-summary").catch(() => ({})),
    api("GET", "/products?per_page=50"),
  ]);

  const lowStock = (products.items || []).filter(p => p.stock_quantity <= p.low_stock_threshold);

  const summary = {
    revenue: { total: dashboard.total_revenue, this_month: dashboard.orders_this_month + " orders" },
    orders: { today: dashboard.orders_today, this_week: dashboard.orders_this_week, pending: dashboard.pending_orders },
    delivery: { pending_dispatch: Array.isArray(pending) ? pending.length : 0, in_transit: Array.isArray(active) ? active.length : 0 },
    customers: { active: dashboard.active_customers, churn_risks: churn.reorder_gap_alerts || 0, volume_drops: churn.volume_drop_alerts || 0 },
    stock_warnings: lowStock.map(p => ({ name: p.name, stock: p.stock_quantity, threshold: p.low_stock_threshold })),
    tier_distribution: churn.tier_distribution || {},
  };
  return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
});

server.tool("revenue_report", "Revenue breakdown by period — daily, weekly, or monthly totals.\n\nReturns: Total revenue, order count, average order value, and breakdown by product. Use to analyze sales trends and product performance.", {
  days: z.number().default(30).describe("Period in days"),
}, async ({ days }) => {
  await ensureToken();
  const [chart, orders] = await Promise.all([
    api("GET", `/admin/dashboard/sales-chart?days=${days}`),
    api("GET", `/admin/orders?per_page=100`),
  ]);

  const allOrders = orders.items || [];
  const paidOrders = allOrders.filter(o => o.payment_status === "paid");
  const totalRevenue = paidOrders.reduce((s, o) => s + Number(o.total_amount), 0);
  const avgOrderValue = paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0;

  // revenue by product
  const byProduct = {};
  for (const o of paidOrders) {
    for (const item of (o.items || [])) {
      const name = item.product_name;
      byProduct[name] = (byProduct[name] || 0) + Number(item.total_price);
    }
  }

  return { content: [{ type: "text", text: JSON.stringify({
    period_days: days,
    total_revenue: totalRevenue,
    total_orders: paidOrders.length,
    avg_order_value: Math.round(avgOrderValue),
    revenue_by_product: byProduct,
    daily_data: chart,
  }, null, 2) }] };
});

server.tool("customer_report", "Customer insights — top customers, new vs returning, at-risk.\n\nReturns: Total customer count, new customers (30 days), top 10 by revenue, type/tier distribution, churn risks. Use to identify key accounts and growth opportunities.", {}, async () => {
  await ensureToken();
  const [customers, orders, churn] = await Promise.all([
    api("GET", "/admin/customers?per_page=100"),
    api("GET", "/admin/orders?per_page=200"),
    api("GET", "/admin/retention/churn-summary").catch(() => ({})),
  ]);

  const custs = customers.items || [];
  const allOrders = orders.items || [];

  // orders per customer
  const ordersByCustomer = {};
  for (const o of allOrders) {
    if (!o.user_id) continue;
    if (!ordersByCustomer[o.user_id]) ordersByCustomer[o.user_id] = { count: 0, total: 0 };
    ordersByCustomer[o.user_id].count++;
    ordersByCustomer[o.user_id].total += Number(o.total_amount);
  }

  // top customers by revenue
  const topCustomers = custs
    .map(c => ({ name: c.full_name, phone: c.phone, type: c.customer_type, tier: c.tier, orders: ordersByCustomer[c.id]?.count || 0, revenue: ordersByCustomer[c.id]?.total || 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const newCustomers = custs.filter(c => c.created_at > thirtyDaysAgo).length;

  return { content: [{ type: "text", text: JSON.stringify({
    total_customers: custs.length,
    new_last_30_days: newCustomers,
    by_type: { retail: custs.filter(c => c.customer_type === "retail").length, wholesale: custs.filter(c => c.customer_type === "wholesale").length },
    tier_distribution: churn.tier_distribution || {},
    churn_risks: churn.reorder_gap_alerts || 0,
    top_10_customers: topCustomers,
  }, null, 2) }] };
});

server.tool("margin_calculator", "Calculate profit margin given buy and sell prices.\n\nReturns: Profit/loss with margin %, GST amount, per-kg breakdown. Use for pricing decisions.", {
  buy_price_per_kg: z.number().describe("Purchase price per kg"),
  sell_price_per_kg: z.number().describe("Selling price per kg"),
  volume_kg: z.number().default(1).describe("Volume in kg"),
  packaging_cost_per_kg: z.number().default(0).describe("Packaging cost per kg"),
  delivery_cost_per_kg: z.number().default(0).describe("Delivery cost per kg"),
}, async ({ buy_price_per_kg, sell_price_per_kg, volume_kg, packaging_cost_per_kg, delivery_cost_per_kg }) => {
  const totalCost = (buy_price_per_kg + packaging_cost_per_kg + delivery_cost_per_kg) * volume_kg;
  const revenue = sell_price_per_kg * volume_kg;
  const profit = revenue - totalCost;
  const marginPct = revenue > 0 ? (profit / revenue * 100) : 0;
  const gst = revenue * 0.05;

  return { content: [{ type: "text", text: JSON.stringify({
    volume_kg,
    buy_total: totalCost,
    sell_total: revenue,
    gst_5pct: Math.round(gst),
    gross_profit: Math.round(profit),
    margin_percent: Math.round(marginPct * 10) / 10,
    profit_per_kg: Math.round(profit / volume_kg),
  }, null, 2) }] };
});

server.tool("search_orders", "Search orders by customer name, phone, date range, or amount.\n\nReturns: Matching orders with summaries. Use to find specific orders quickly.", {
  query: z.string().optional().describe("Search by order number or customer"),
  status: z.string().optional(),
  days: z.number().default(30).describe("Look back N days"),
}, async ({ query, status, days }) => {
  await ensureToken();
  let path = `/admin/orders?per_page=50`;
  if (status) path += `&status=${status}`;
  const data = await api("GET", path);
  let items = data.items || [];

  // client-side filter by query (name/phone/order number)
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(o =>
      o.order_number?.toLowerCase().includes(q) ||
      o.shipping_address?.full_name?.toLowerCase().includes(q) ||
      o.shipping_address?.phone?.includes(q)
    );
  }

  // filter by date range
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  items = items.filter(o => o.created_at >= cutoff);

  const summary = items.map(o => ({
    order: o.order_number,
    customer: o.shipping_address?.full_name || "—",
    total: o.total_amount,
    status: o.status,
    payment: o.payment_status,
    date: o.created_at?.slice(0, 10),
  }));

  return { content: [{ type: "text", text: JSON.stringify({ count: summary.length, orders: summary }, null, 2) }] };
});

server.tool("restock_alert", "Check which products are low on stock and need restocking.\n\nReturns: Out-of-stock products, low-stock items with thresholds, and healthy inventory. Use for procurement planning.", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/products?per_page=50");
  const products = data.items || [];
  const lowStock = products.filter(p => p.stock_quantity <= p.low_stock_threshold);
  const outOfStock = products.filter(p => p.stock_quantity === 0);

  return { content: [{ type: "text", text: JSON.stringify({
    total_products: products.length,
    out_of_stock: outOfStock.map(p => ({ name: p.name, sku: p.sku })),
    low_stock: lowStock.map(p => ({ name: p.name, sku: p.sku, current: p.stock_quantity, threshold: p.low_stock_threshold })),
    healthy: products.filter(p => p.stock_quantity > p.low_stock_threshold).map(p => ({ name: p.name, stock: p.stock_quantity })),
  }, null, 2) }] };
});

// ── bulk customer management ─────────────────────────────────────

server.tool("bulk_upload_customers", "Upload multiple customers at once from CSV/JSON data.\n\nReturns: Count of created, skipped (duplicates), and errored records. Use for batch customer imports.", {
  customers: z.array(z.object({
    name: z.string(),
    phone: z.string(),
    email: z.string().optional(),
    type: z.string().default("wholesale"),
    business_name: z.string().optional(),
    credit_limit: z.number().default(0),
  })).describe("Array of customer objects to create"),
}, async ({ customers }) => {
  await ensureToken();
  const data = await api("POST", "/admin/customers/bulk-upload", { customers });
  return { content: [{ type: "text", text: `Bulk upload: ${data.created} created, ${data.skipped} skipped (duplicate), ${data.errors?.length || 0} errors` }] };
});

server.tool("get_pending_dispatch", "Get orders ready to be dispatched", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/delivery/pending");
  if (!data?.length) return { content: [{ type: "text", text: "No orders pending dispatch" }] };
  const lines = data.map(o => `${o.order_number} | ₹${o.total_amount} | ${o.shipping_address?.city || '—'} | ${o.status}`);
  return { content: [{ type: "text", text: `${data.length} orders pending dispatch:\n${lines.join('\n')}` }] };
});

server.tool("get_active_deliveries", "Get orders currently out for delivery", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/delivery");
  if (!data?.length) return { content: [{ type: "text", text: "No active deliveries" }] };
  const lines = data.map(o => `${o.order_number} | ₹${o.total_amount} | ${o.shipping_address?.city || '—'} | ${o.status}`);
  return { content: [{ type: "text", text: `${data.length} active deliveries:\n${lines.join('\n')}` }] };
});

// ── raw tea stock (warehouse kg) ─────────────────────────────────

server.tool("get_tea_stock", "Get raw tea stock levels — total kg by tea type in warehouse.\n\nReturns: Tea types with quantities, last purchase info, and purchase prices. Use for raw material planning.", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/analytics/tea-stock");
  if (!data?.length) return { content: [{ type: "text", text: "No tea types in stock tracking yet" }] };
  const lines = data.map(s => `${s.tea_type}: ${s.total_kg} kg (last buy: ${s.last_purchase_kg}kg @ ₹${s.purchase_price_per_kg}/kg)`);
  return { content: [{ type: "text", text: `Raw Tea Stock:\n${lines.join('\n')}` }] };
});

server.tool("create_tea_stock", "Add a new tea type to warehouse stock tracking.\n\nReturns: New tea stock record with UUID. Use to start tracking new tea types.", {
  tea_type: z.string().describe("Name of the tea type (e.g., 'Nilgiri Dust', 'Assam CTC')"),
  total_kg: z.number().default(0).describe("Initial stock in kg"),
  purchase_price_per_kg: z.number().default(0).describe("Purchase price per kg"),
}, async ({ tea_type, total_kg, purchase_price_per_kg }) => {
  await ensureToken();
  const data = await api("POST", "/admin/analytics/tea-stock", { tea_type, total_kg, purchase_price_per_kg });
  return { content: [{ type: "text", text: `Tea type '${data.tea_type}' added with ${data.total_kg} kg` }] };
});

server.tool("update_tea_stock", "Add or reduce raw tea stock for a tea type.\n\nReturns: Updated tea stock with new total kg. Use to log purchases or packing usage.", {
  stock_id: z.string().describe("Tea stock UUID"),
  add_kg: z.number().optional().describe("Kg to ADD (new purchase from supplier)"),
  reduce_kg: z.number().optional().describe("Kg to REDUCE (used for packing)"),
  total_kg: z.number().optional().describe("Set exact total kg (override)"),
  purchase_price_per_kg: z.number().optional().describe("Update purchase price per kg"),
}, async ({ stock_id, add_kg, reduce_kg, total_kg, purchase_price_per_kg }) => {
  await ensureToken();
  const body = {};
  if (add_kg !== undefined) body.add_kg = add_kg;
  else if (reduce_kg !== undefined) body.reduce_kg = reduce_kg;
  else if (total_kg !== undefined) body.total_kg = total_kg;
  if (purchase_price_per_kg !== undefined) body.purchase_price_per_kg = purchase_price_per_kg;
  const data = await api("PATCH", `/admin/analytics/tea-stock/${stock_id}`, body);
  return { content: [{ type: "text", text: `${data.tea_type}: now ${data.total_kg} kg` }] };
});

server.tool("delete_tea_stock", "Remove a tea type from stock tracking.\n\nReturns: Confirmation message. Use to stop tracking discontinued tea types.", {
  stock_id: z.string().describe("Tea stock UUID"),
}, async ({ stock_id }) => {
  await ensureToken();
  const data = await api("DELETE", `/admin/analytics/tea-stock/${stock_id}`);
  return { content: [{ type: "text", text: data.message }] };
});

// ── start ─────────────────────────────────────────────────────────

log("info", "Server starting", { name: "sre-tea-admin", version: "1.0.0" });
const transport = new StdioServerTransport();
await server.connect(transport);
log("info", "Server connected to transport");
