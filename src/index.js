#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.SRE_API_URL || "https://jzwp96mgv2.execute-api.ap-south-1.amazonaws.com/prod/api/v1";
let TOKEN = process.env.SRE_ADMIN_TOKEN || "";

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (TOKEN) opts.headers["Authorization"] = `Bearer ${TOKEN}`;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
  return data;
}

async function ensureToken() {
  if (TOKEN) return;
  const data = await api("POST", "/auth/login", {
    identifier: process.env.SRE_ADMIN_EMAIL || "admin@sre.local",
    password: process.env.SRE_ADMIN_PASSWORD || "SreAdmin2026",
  });
  TOKEN = data.access_token;
}

// ── server ────────────────────────────────────────────────────────

const server = new McpServer({
  name: "sre-tea-admin",
  version: "1.0.0",
});

// ── dashboard ─────────────────────────────────────────────────────

server.tool("get_dashboard", "Get business dashboard summary — revenue, orders, customers, pending orders", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/dashboard/summary");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_sales_chart", "Get daily sales data for a period", {
  days: z.number().default(30).describe("Number of days of history"),
}, async ({ days }) => {
  await ensureToken();
  const data = await api("GET", `/admin/dashboard/sales-chart?days=${days}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// ── orders ────────────────────────────────────────────────────────

server.tool("list_orders", "List orders with optional status filter", {
  status: z.string().optional().describe("Filter: pending, confirmed, processing, packed, shipped, out_for_delivery, delivered, cancelled"),
  per_page: z.number().default(20),
}, async ({ status, per_page }) => {
  await ensureToken();
  let path = `/admin/orders?per_page=${per_page}`;
  if (status) path += `&status=${status}`;
  const data = await api("GET", path);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_order", "Get full details of a specific order", {
  order_id: z.string().describe("Order UUID"),
}, async ({ order_id }) => {
  await ensureToken();
  const data = await api("GET", `/admin/orders/${order_id}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("update_order_status", "Update an order's status (e.g., mark as shipped, delivered)", {
  order_id: z.string().describe("Order UUID"),
  status: z.string().describe("New status: confirmed, processing, packed, shipped, out_for_delivery, delivered, cancelled"),
  notes: z.string().optional().describe("Optional notes about this status change"),
}, async ({ order_id, status, notes }) => {
  await ensureToken();
  const data = await api("PATCH", `/admin/orders/${order_id}/status`, { status, notes });
  return { content: [{ type: "text", text: `Order ${data.order_number} → ${data.status}` }] };
});

// ── products ──────────────────────────────────────────────────────

server.tool("list_products", "List all products with prices and stock", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/products/?per_page=50");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("create_product", "Create a new product", {
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

server.tool("update_stock", "Update a product's stock quantity", {
  product_id: z.string().describe("Product UUID"),
  quantity: z.number().describe("New stock quantity"),
}, async ({ product_id, quantity }) => {
  await ensureToken();
  const data = await api("PATCH", `/admin/products/${product_id}/stock?quantity=${quantity}`);
  return { content: [{ type: "text", text: `Stock updated to ${data.stock_quantity}` }] };
});

// ── customers ─────────────────────────────────────────────────────

server.tool("list_customers", "List customers with optional search", {
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

server.tool("get_customer", "Get detailed info about a specific customer", {
  user_id: z.string().describe("Customer UUID"),
}, async ({ user_id }) => {
  await ensureToken();
  const data = await api("GET", `/admin/customers/${user_id}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("update_customer", "Update customer type, credit limit, or tier", {
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

server.tool("list_invoices", "List all invoices", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/invoices");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("generate_invoice", "Generate a GST invoice for an order", {
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

server.tool("get_outstanding_balances", "Get all customers with outstanding credit balances", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/ledger/outstanding");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_customer_ledger", "Get ledger entries for a specific customer", {
  user_id: z.string().describe("Customer UUID"),
}, async ({ user_id }) => {
  await ensureToken();
  const data = await api("GET", `/admin/ledger/customer/${user_id}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("record_payment", "Record a payment received from a customer", {
  user_id: z.string().describe("Customer UUID"),
  amount: z.number().describe("Payment amount in rupees"),
  reference_number: z.string().optional().describe("UPI UTR, cheque number, etc."),
  description: z.string().optional(),
}, async ({ user_id, amount, reference_number, description }) => {
  await ensureToken();
  const data = await api("POST", "/admin/ledger/payment", { user_id, amount, reference_number, description });
  return { content: [{ type: "text", text: `Payment ₹${data.amount} recorded. New balance: ₹${data.running_balance}` }] };
});

// ── delivery ──────────────────────────────────────────────────────

server.tool("get_pending_dispatch", "Get orders ready for dispatch", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/delivery/pending");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_active_deliveries", "Get orders currently being delivered", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/delivery");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// ── retention ─────────────────────────────────────────────────────

server.tool("get_churn_summary", "Get customer retention summary — tier distribution, churn risks, volume drops", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/retention/churn-summary");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_reorder_gaps", "Get customers who are overdue for their next order (churn risk)", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/retention/reorder-gaps");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_volume_drops", "Get customers whose order volume dropped 20%+ recently", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/retention/volume-drops");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("classify_tiers", "Reclassify all customers into A/B/C tiers based on recent behavior", {}, async () => {
  await ensureToken();
  const data = await api("POST", "/admin/retention/classify-tiers");
  return { content: [{ type: "text", text: `Tiers updated: A=${data.counts.A}, B=${data.counts.B}, C=${data.counts.C}` }] };
});

// ── logistics ─────────────────────────────────────────────────────

server.tool("get_logistics_kpis", "Get delivery logistics KPIs — trips, kg delivered, cost per kg", {
  days: z.number().default(30),
}, async ({ days }) => {
  await ensureToken();
  const data = await api("GET", `/admin/logistics/kpis?days=${days}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_slab_pricing", "Get current slab pricing for all products", {}, async () => {
  await ensureToken();
  const data = await api("GET", "/admin/retention/slab-pricing");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// ── start ─────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
