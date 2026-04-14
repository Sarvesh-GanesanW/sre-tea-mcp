# SRE Tea MCP Server

An administrative Model Context Protocol (MCP) server for Sree Rajalakshmi Enterprises (SRE) tea e-commerce platform. Exposes 46 business tools covering orders, products, customers, inventory, financials, and logistics — enabling Claude AI to perform complex administrative tasks.

## Features

### 46 Administrative Tools
- **Dashboard & Analytics** (6 tools) - Business metrics, sales charts, revenue trends
- **Order Management** (4 tools) - List, retrieve, update status, bulk operations
- **Product Management** (5 tools) - CRUD operations, stock management, pricing
- **Customer Management** (4 tools) - List, retrieve, update, delete customers
- **Financial Operations** (5 tools) - Invoices, ledger, payments, analytics
- **Delivery & Logistics** (5 tools) - Dispatch tracking, delivery status, logistics KPIs
- **Customer Retention** (5 tools) - Churn alerts, reorder gaps, tier classification
- **Raw Tea Warehouse** (4 tools) - Stock tracking by tea type
- **Reporting** (7 tools) - Daily summaries, revenue reports, customer insights
- **Utilities** (3 tools) - Margin calculator, restock alerts, search

### Production-Ready Architecture
- **STDIO Transport** - Works with Claude Desktop, Claude Code, and custom MCP clients
- **Secure Authentication** - Environment-based credentials, automatic token refresh on expiry
- **Comprehensive Logging** - Stderr-based logging with configurable levels (debug/info/warn/error)
- **Error Recovery** - Automatic token refresh on 401 errors, detailed error context
- **Optimized API Access** - Parallel requests, efficient aggregation

## Installation

### Prerequisites
- Node.js 16+
- npm or yarn

### Setup

1. **Clone and install dependencies:**
```bash
cd E:\Code\sre-tea-mcp
npm install
```

2. **Configure environment variables** (see Configuration section below)

3. **Start the server:**
```bash
npm start
```

You should see:
```
[2026-04-14T10:30:45.123Z] [INFO] Server starting {"name":"sre-tea-admin","version":"1.0.0"}
[2026-04-14T10:30:45.456Z] [INFO] Server connected to transport
```

## Configuration

### Environment Variables

**Authentication (Required - Choose One)**

Method 1: Pre-authenticated token (recommended for production)
```bash
export SRE_ADMIN_TOKEN=your-bearer-token-here
```

Method 2: Email + password (recommended for development)
```bash
export SRE_ADMIN_EMAIL=admin@sre.local
export SRE_ADMIN_PASSWORD=your-password-here
```

**API Configuration (Optional)**
```bash
# API Base URL (defaults to production)
export SRE_API_URL=https://jzwp96mgv2.execute-api.ap-south-1.amazonaws.com/prod/api/v1

# Logging level: debug, info, warn, error (defaults to info)
export LOG_LEVEL=info
```

### Using .env File

Copy `.env.example` to `.env` and customize:
```bash
cp .env.example .env
# Edit .env with your credentials
```

Then run:
```bash
npm start
```

**Important:** Never commit `.env` to version control. Add it to `.gitignore` (already done).

## Usage

### With Claude Desktop

Add to `%AppData%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "sre-tea-admin": {
      "command": "node",
      "args": ["E:\\Code\\sre-tea-mcp\\src\\index.js"],
      "env": {
        "SRE_ADMIN_EMAIL": "admin@sre.local",
        "SRE_ADMIN_PASSWORD": "your-password",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

Restart Claude Desktop. Tools will appear under "Tools" section.

### Direct Invocation

```bash
SRE_ADMIN_EMAIL=admin@sre.local SRE_ADMIN_PASSWORD=password npm start
```

### With Custom MCP Client

```javascript
const { createClient } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { spawn } = require("child_process");

const process = spawn("npm", ["start"], {
  cwd: "E:\\Code\\sre-tea-mcp",
  env: {
    ...process.env,
    SRE_ADMIN_EMAIL: "admin@sre.local",
    SRE_ADMIN_PASSWORD: "password"
  }
});

const client = createClient(process);
```

## Available Tools

### Dashboard & Analytics

- **`get_dashboard`** - Business dashboard with revenue, orders, active customers, pending orders
- **`get_sales_chart`** - Daily sales data for specified period (default: 30 days)
- **`get_analytics_revenue`** - Revenue trends by product and daily breakdown
- **`get_analytics_customers`** - Customer statistics by type and tier
- **`get_analytics_financials`** - GST, invoiced, outstanding, payment method breakdowns
- **`get_logistics_kpis`** - Delivery metrics (trips, kg, cost per kg)

### Order Management

- **`list_orders`** - View all orders (filterable by status, paginated)
- **`get_order`** - Full order details including items, customer, shipping
- **`update_order_status`** - Transition order through pipeline (confirmed → delivered)
- **`bulk_update_orders`** - Batch status updates (e.g., all packed → shipped)

### Product Management

- **`list_products`** - All products with SKU, prices, stock levels
- **`create_product`** - Add new product to catalog
- **`update_product`** - Modify price, name, stock, description
- **`update_stock`** - Adjust inventory by product UUID
- **`update_stock_by_name`** - Adjust inventory by product name (fuzzy matching)

### Customer Management

- **`list_customers`** - Search customers by name, phone, or business name
- **`get_customer`** - Detailed customer profile and history
- **`update_customer`** - Modify customer type, credit limit, tier
- **`delete_customer`** - Deactivate customer account
- **`bulk_upload_customers`** - Batch import customers from CSV/JSON

### Financial Operations

- **`list_invoices`** - All generated invoices
- **`generate_invoice`** - Create GST invoice for order
- **`get_outstanding_balances`** - Customers with credit balances
- **`get_customer_ledger`** - Transaction history for specific customer
- **`record_payment`** - Log payment received from customer

### Delivery & Logistics

- **`get_pending_dispatch`** - Orders ready to ship (with formatted output)
- **`get_active_deliveries`** - Orders currently in transit (with formatted output)
- **`get_slab_pricing`** - Volume-based slab pricing for products
- **`margin_calculator`** - Calculate profit margin given costs and selling price
- **`get_logistics_kpis`** - Delivery KPIs over specified period

### Customer Retention

- **`get_churn_summary`** - Tier distribution, churn risks, volume drops
- **`get_reorder_gaps`** - Customers overdue for next order (churn risk)
- **`get_volume_drops`** - Customers with 20%+ volume decrease recently
- **`classify_tiers`** - Reclassify all customers into A/B/C tiers
- **`search_orders`** - Search orders by customer, order number, date range

### Tea Warehouse Management

- **`get_tea_stock`** - Raw tea stock levels by type (kg)
- **`create_tea_stock`** - Add new tea type to tracking
- **`update_tea_stock`** - Adjust stock (add/reduce/set total kg)
- **`delete_tea_stock`** - Remove tea type from tracking

### Reporting & Insights

- **`daily_summary`** - Morning briefing (dashboard, dispatch, churn, stock in one call)
- **`revenue_report`** - Revenue breakdown by period and product
- **`customer_report`** - Top customers, new vs returning, at-risk customers
- **`restock_alert`** - Products below low stock threshold
- **`get_stock_status`** - All products with restock prioritization
- **`bulk_update_stock`** - Batch stock updates

### Admin Management

- **`create_admin_account`** - Create admin or staff accounts

## Logging

### How Logging Works

All logs are written to stderr (required for STDIO transport compliance). Logs include:
- Timestamp in ISO 8601 format
- Log level (DEBUG, INFO, WARN, ERROR)
- Message
- Optional metadata (JSON)

### Example Log Output

```
[2026-04-14T10:30:45.123Z] [INFO] Server starting {"name":"sre-tea-admin","version":"1.0.0"}
[2026-04-14T10:30:45.234Z] [DEBUG] API request {"method":"GET","path":"/admin/dashboard/summary"}
[2026-04-14T10:30:45.567Z] [INFO] Authentication successful
[2026-04-14T10:30:45.890Z] [DEBUG] API success {"status":200,"path":"/admin/dashboard/summary"}
```

### Log Levels

Set via `LOG_LEVEL` environment variable:

| Level | Shows | Use Case |
|-------|-------|----------|
| `debug` | All messages | Development, troubleshooting |
| `info` | Info, warn, error | Production (default) |
| `warn` | Warn, error only | Minimal logging |
| `error` | Error only | Silent mode |

Example:
```bash
LOG_LEVEL=debug npm start
```

### Interpreting Logs

**Debug logs** show every API request and response:
```
[WARN] Token expired, refreshing authentication
[INFO] Authenticating with API {"email":"admin@sre.local"}
[DEBUG] API request {"method":"POST","path":"/auth/login"}
[INFO] Token refreshed, retrying request
```

**Error logs** show issues requiring investigation:
```
[ERROR] API error {"status":401,"path":"/admin/orders","error":"Invalid token"}
[ERROR] Token refresh failed {"error":"Invalid credentials"}
```

## Error Handling

### Common Errors

**Missing Credentials**
```
Missing required environment variables: SRE_ADMIN_TOKEN or (SRE_ADMIN_EMAIL + SRE_ADMIN_PASSWORD)
```
Solution: Set either `SRE_ADMIN_TOKEN` or both `SRE_ADMIN_EMAIL` + `SRE_ADMIN_PASSWORD`.

**Authentication Failed**
```
API 401: Invalid token
```
Solution: Check credentials are correct. Server will automatically refresh token on next request.

**API Unreachable**
```
API error {"status":0,"path":"/admin/orders","error":"fetch failed"}
```
Solution: Verify `SRE_API_URL` is correct and accessible. Check network connectivity.

**Invalid Product ID**
```
API 404: Product not found
```
Solution: Use `list_products` to find valid product IDs.

### Error Recovery

The server automatically:
- **Refreshes tokens** on 401 errors (transparent retry)
- **Follows 307 redirects** with authentication preserved
- **Aggregates partial failures** in bulk operations (shows per-item results)

### Debugging

Enable debug logging to see all API calls:
```bash
LOG_LEVEL=debug npm start 2>debug.log
```

Then examine `debug.log` for detailed request/response traces.

## Development

### Adding New Tools

Add tool definitions before `server.connect(transport)`:

```javascript
server.tool("my_new_tool", "Description of what this tool does.", {
  param1: z.string().describe("First parameter"),
  param2: z.number().optional(),
}, async ({ param1, param2 }) => {
  await ensureToken();
  const data = await api("GET", `/admin/endpoint?param=${param1}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});
```

### Running Tests

Call tools from Claude Desktop and verify stderr logs show:
- `[DEBUG] API request`
- `[DEBUG] API success`
- Proper tool output

### Performance Tips

- Use specific endpoints (`/admin/orders/{id}`) instead of listing all
- Filter results client-side when possible (e.g., `search_orders`)
- Leverage bulk operations for batch updates
- Enable caching by calling same tool within 30 seconds

## Security

### Credentials Best Practices

1. **Never hardcode credentials** in code or config files
2. **Use environment variables** for all secrets
3. **Rotate tokens regularly** in production
4. **Use pre-authenticated tokens** (SRE_ADMIN_TOKEN) for production
5. **Use email+password** only for development

### Environment Variable Security

```bash
# ❌ Bad
npm start SRE_ADMIN_PASSWORD=password123

# ❌ Bad
export SRE_ADMIN_PASSWORD=password123
npm start

# ✅ Good
export SRE_ADMIN_PASSWORD=password123
npm start
unset SRE_ADMIN_PASSWORD

# ✅ Better (using .env)
SRE_ADMIN_PASSWORD=password123 npm start
```

### API Security

- All requests use HTTPS (enforced by API_BASE URL)
- Bearer token authentication on every request
- Tokens are never logged in output
- Errors don't leak sensitive information

## Troubleshooting

### Server Won't Start

**Check 1: Node.js version**
```bash
node --version
# Should be 16+
```

**Check 2: Dependencies installed**
```bash
npm install
```

**Check 3: Credentials set**
```bash
echo $SRE_ADMIN_EMAIL
# Should show email address
```

**Check 4: Port conflicts** (if using HTTP)
```bash
# STDIO server doesn't use ports, but verify network connectivity
ping api.example.com
```

### Tokens Expiring Too Quickly

The server automatically refreshes tokens on 401 errors. If tokens expire frequently:
1. Check if token lifetime is short (contact API maintainer)
2. Use credential-based auth (SRE_ADMIN_EMAIL + SRE_ADMIN_PASSWORD) for automatic refresh
3. Monitor logs: `[WARN] Token expired, refreshing authentication`

### Tools Not Appearing in Claude Desktop

1. Restart Claude Desktop (not just refresh)
2. Check `claude_desktop_config.json` syntax (valid JSON)
3. Verify server starts: `npm start` should show startup logs
4. Check logs for errors: `LOG_LEVEL=debug npm start`

### API Requests Failing

1. Check internet connectivity: `ping jzwp96mgv2.execute-api.ap-south-1.amazonaws.com`
2. Check credentials: `LOG_LEVEL=debug npm start`
3. Verify API endpoint: `echo $SRE_API_URL`
4. Check logs for specific error messages

### Performance Issues

1. Check log level: Change to `warn` to reduce I/O overhead
2. Cache results: Reuse tool outputs within 30 seconds
3. Use bulk operations: `bulk_update_orders` is more efficient than individual updates
4. Monitor stderr: Excessive API calls may indicate inefficient queries

## Support & Contributions

For issues or feature requests:
1. Check logs first: `LOG_LEVEL=debug npm start`
2. Document the error (full error message from logs)
3. Include reproduction steps
4. Submit to project maintainer

## License

Internal use only (Sree Rajalakshmi Enterprises).

## Version

- Version: 1.0.0
- Last Updated: 2026-04-14
- MCP SDK: 1.0.0+
- Node.js: 16+
