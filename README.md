# 🍕 Rustic Pizza POS

A custom, web-based **point-of-sale system** built for a real pizzeria — Rustic Pizza in Sherborn, MA. It handles the full counter workflow: building orders (including half-and-half pizzas), taking card payments through Square, printing kitchen tickets and receipts on network thermal printers, tracking the order queue, managing the cash drawer, clocking staff in and out, and giving the owner a PIN-protected panel for menu changes and daily reports.

The backend is **FastAPI + PostgreSQL (Supabase)**; the frontend is plain **HTML, CSS and vanilla JavaScript**, served by the same app, so the whole thing ships as a single Docker container.

---

## ✨ Features

### Order taking
- Full menu by category — pizzas, gourmet pizzas, calzones, subs & wraps, appetizers, dinner plates, salads, desserts and beverages
- Small / large sizing with per-size pricing
- **Half-and-half pizzas** — different presets, toppings and sauce on each side
- Modifiers (toppings, sauces, fillings, dressings) with optional extra charges
- Order types: **dine-in, carry-out and delivery**, with customer name, phone and notes
- **Scheduled orders** — place an order for a future time; it waits in a separate queue and is sent to the kitchen when started
- Automatic subtotal, 6.25% MA sales tax and total (all money stored in **cents** to avoid rounding errors)

### Payments
- **Card via Square POS** — the app deep-links into the Square app (`square-commerce-v1://`) and receives the result on the `/api/payment-done` callback
- Cash, card-over-phone, cash-on-delivery and card-on-delivery
- Refunds (cash or card) with refund receipts

### Kitchen & printing
- Kitchen ticket printed automatically when an order is placed; customer receipt printed when it's paid
- ESC/POS network printers via `python-escpos` (separate receipt and kitchen printer IPs)
- **Printer test mode** — writes tickets to `backend/test_prints/*.txt` instead of real hardware, for development
- Real-time **WebSocket** feed (`/ws/kitchen`) broadcasting new orders and status changes
- Order status flow: `received → prepping → baking → ready → paid`

### Orders panel
- Active, scheduled and history tabs
- Advance order status, take payment, reprint tickets and issue refunds

### Cash drawer & till
- Open the till for the day and assign it to an employee (and reassign it mid-day)
- Cash in / cash out with reasons, and till counts against the **expected** balance (cash sales − cash refunds ± movements since the last count)
- **End-of-day close-out** — counts the drawer, keeps the $100 opening float, records takings and closes the till session
- Printed slips for every cash movement

### Staff
- Employee clock-in / clock-out by employee ID
- Today's shifts view and shift history by date range

### Owner panel (PIN-protected)
- Add menu items, edit prices and images, and activate/deactivate items
- Daily sales report broken down by order type
- Staff shift history

---

## 🏗️ Architecture

```
┌──────────────────────────┐        ┌────────────────────────────┐
│  Browser / tablet (POS)  │  HTTP  │  FastAPI backend (uvicorn) │
│  index.html · app.js     │◀──────▶│  /api/* REST routes        │
│  orders.js · owner.js    │   WS   │  /ws/kitchen WebSocket     │
└───────────┬──────────────┘◀──────▶│  serves /frontend statics  │
            │                       └──────┬───────────┬─────────┘
            │ deep link                    │           │ ESC/POS (TCP)
            ▼                              ▼           ▼
   ┌─────────────────┐          ┌──────────────────┐  ┌────────────────────┐
   │  Square POS app │──callback▶│ PostgreSQL       │  │ Receipt & kitchen  │
   │  (card payment) │  /api/   │ (Supabase)       │  │ thermal printers   │
   └─────────────────┘  payment-└──────────────────┘  └────────────────────┘
                        done
```

---

## 🧰 Tech Stack

| Layer      | Technology |
|------------|------------|
| Backend    | Python 3.11, FastAPI, Uvicorn, Pydantic v2 |
| Database   | PostgreSQL (Supabase) via `psycopg2` connection pool |
| Real-time  | WebSockets (FastAPI) |
| Printing   | `python-escpos` (network ESC/POS printers) |
| Payments   | Square POS API (mobile deep link + callback) |
| Frontend   | HTML5, CSS3, vanilla JavaScript (no build step) |
| Deployment | Docker (Cloud Run–style, port 8080) or Procfile (Heroku/Railway-style) |

---

## 📁 Project Structure

```
rustic-pizza/
├── Dockerfile              # Root image: backend + frontend in one container
├── backend/
│   ├── main.py             # FastAPI app, routers, WebSocket, static file mount
│   ├── database.py         # Pooled PostgreSQL connections with health checks
│   ├── models.py           # Core table schema (reference SQL)
│   ├── seed.py             # Creates core tables and loads the full menu
│   ├── printer.py          # Kitchen ticket / receipt / cash slip formatting & output
│   ├── websocket.py        # Kitchen WebSocket connection manager
│   ├── requirements.txt
│   ├── Procfile
│   ├── Dockerfile          # Backend-only image
│   └── routes/
│       ├── menu.py         # Menu items & modifiers
│       ├── orders.py       # Create, list, schedule, status, reprint, refund
│       ├── payments.py     # Square callback & cash/other payments
│       ├── cash.py         # Cash in/out, till counts, end of day
│       ├── till.py         # Daily till open / reassign
│       ├── shifts.py       # Employee clock in/out
│       ├── reports.py      # Daily sales report
│       ├── owner.py        # PIN-protected menu management
│       └── test.py         # Dev-only simulation endpoints
└── frontend/
    ├── index.html          # Main POS screen (+ orders, till, clock, owner panels)
    ├── app.js · style.css
    ├── orders.js · orders.css
    └── owner.html · owner.js · owner.css   # Standalone owner panel
```

---

## 🚀 Getting Started

### Prerequisites
- Python 3.11+
- A PostgreSQL database (a free [Supabase](https://supabase.com) project works)

### 1. Clone and install

```bash
git clone https://github.com/GayathriTelaprolu/rustic-pizza.git
cd rustic-pizza/backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment

Create `backend/.env`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres
OWNER_PIN=change-me
PRINTER_TEST_MODE=true            # false to send to real printers
PRINTER_IP=192.168.1.100          # receipt printer
KITCHEN_PRINTER_IP=192.168.1.101  # kitchen printer
```

| Variable             | Required | Default         | Description |
|----------------------|----------|-----------------|-------------|
| `DATABASE_URL`       | ✅       | —               | PostgreSQL connection string |
| `OWNER_PIN`          |          | `1234`          | PIN for the owner panel — **change this** |
| `PRINTER_TEST_MODE`  |          | `true`          | Write prints to `backend/test_prints/` instead of printers |
| `PRINTER_IP`         |          | `192.168.1.100` | Receipt printer IP |
| `KITCHEN_PRINTER_IP` |          | `192.168.1.101` | Kitchen printer IP |

### 3. Set up the database

Create the core tables and load the menu:

```bash
python seed.py
```

`seed.py` creates `menu_items`, `modifiers`, `orders`, `order_items` and `payments`. The staff, till and cash features use a few more tables plus a `scheduled_for` column on `orders`. Run this once in the Supabase SQL editor (or `psql`):

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS employees (
    employee_id   TEXT PRIMARY KEY,
    employee_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employee_shifts (
    id            SERIAL PRIMARY KEY,
    employee_id   TEXT NOT NULL REFERENCES employees(employee_id),
    employee_name TEXT,
    clock_in      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    clock_out     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS till_sessions (
    id          SERIAL PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(employee_id),
    opened_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at   TIMESTAMPTZ,
    closed_by   TEXT
);

CREATE TABLE IF NOT EXISTS cash_movements (
    id         SERIAL PRIMARY KEY,
    type       TEXT NOT NULL,          -- cash_in | cash_out | count
    amount     INTEGER NOT NULL,       -- cents
    expected   INTEGER,                -- cents (for counts)
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add your staff
INSERT INTO employees (employee_id, employee_name) VALUES ('1001', 'Jane Doe');
```

> Tip: run the `seed.py` inserts only once — re-running it can duplicate menu items.

### 4. Run

```bash
uvicorn main:app --reload --port 8080
```

Open:
- POS: **http://localhost:8080**
- Owner panel: **http://localhost:8080/owner.html**
- Interactive API docs: **http://localhost:8080/docs**

### Run with Docker

From the repo root:

```bash
docker build -t rustic-pizza-pos .
docker run -p 8080:8080 --env-file backend/.env rustic-pizza-pos
```

---

## 🔌 API Overview

Full, interactive documentation is generated at `/docs` (Swagger UI).

| Area     | Method & Path | Purpose |
|----------|---------------|---------|
| Health   | `GET /health` | Health check |
| Menu     | `GET /api/menu`, `GET /api/menu/modifiers`, `GET /api/menu/{id}` | Menu and modifiers |
| Orders   | `POST /api/orders` | Create an order (optionally scheduled) |
|          | `GET /api/orders/active` · `/scheduled` · `/history` | Order queues |
|          | `GET /api/orders/{id}` | Order with items |
|          | `PATCH /api/orders/{id}/status` | Advance status |
|          | `POST /api/orders/{id}/start` | Send a scheduled order to the kitchen |
|          | `POST /api/orders/{id}/reprint` · `/refund` | Reprint / refund |
| Payments | `GET\|POST /api/payment-done` | Square POS callback |
|          | `POST /api/payment/cash` | Cash and other payment methods |
| Cash     | `GET /api/cash/summary` | Drawer summary & expected balance |
|          | `POST /api/cash/in` · `/out` · `/count` · `/end-of-day` | Drawer movements & close-out |
| Till     | `GET /api/till/today`, `POST /api/till/open` · `/reassign` | Daily till ownership |
| Shifts   | `POST /api/shifts/clockin` · `/clockout`, `GET /api/shifts/today`, `GET /api/shifts` | Staff time |
| Reports  | `GET /api/reports?date=YYYY-MM-DD` | Daily sales report |
| Owner    | `POST /api/owner/verify`, `/api/owner/items/...` | Menu management (requires `X-Owner-Pin` header) |
| Kitchen  | `WS /ws/kitchen` | Live order & status events |

### Development helpers

With `PRINTER_TEST_MODE=true`, you can exercise the payment and print flow without hardware:

| Endpoint | What it does |
|----------|--------------|
| `GET /api/test/payment?order_id=X` | Simulates a successful Square card payment |
| `GET /api/test/kitchen-print?order_id=X` | Re-generates the kitchen ticket |
| `GET /api/test/receipt-print?order_id=X` | Re-generates the receipt |
| `GET /api/test/prints` · `/api/test/prints/{file}` | Lists / views generated test prints |

---

## 💳 Square Card Payments

Card payments use Square's **Point of Sale API** on a mobile device:

1. The POS opens `square-commerce-v1://payment/create?...` with the order total and order ID.
2. The Square POS app takes the card payment.
3. Square calls back to `/api/payment-done` with the transaction ID and order ID.
4. The order is marked paid, the receipt prints and the kitchen screen is notified.

You'll need a Square developer application with your deployed `/api/payment-done` URL registered as the callback.

---

## 🔒 Production Notes

- Change `OWNER_PIN` from the default and keep `.env` out of version control (it's already in `.gitignore`).
- Disable or remove the `/api/test/*` routes in production.
- CORS is currently open (`*`) — restrict it to your domain when deployed.
- Run a single worker (as the Dockerfile does) so all kitchen screens share one WebSocket connection list.

---

## 🗺️ Roadmap Ideas

- Proper staff authentication and roles
- Online ordering integration
- Weekly / monthly sales analytics
- Database migrations (e.g. Alembic) instead of manual SQL

---

## 👩‍💻 Author

**Gayathri Telaprolu** — [GitHub](https://github.com/GayathriTelaprolu)
