"""
SQL CREATE statements for all tables.
Run once against your Supabase PostgreSQL database.
Supabase already creates the database — just run these statements in
the Supabase SQL editor or via psql.
"""

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS menu_items (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,        -- pizza | gourmet_pizza | calzone | sub_wrap | appetizer | dinner_plate | salad | dessert | beverage
    description     TEXT,
    price_small     INTEGER,              -- cents; NULL for items with no small size
    price_large     INTEGER,              -- cents; NULL for items with no large/single size
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    is_gourmet_preset BOOLEAN NOT NULL DEFAULT FALSE,
    image_url       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS modifiers (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,   -- topping | sauce | filling | dressing | meat | veggie | cheese
    extra_price INTEGER NOT NULL DEFAULT 0,  -- cents; 0 = included
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'received',  -- received | prepping | baking | ready | paid
    order_type      TEXT NOT NULL DEFAULT 'carry_out', -- dine_in | carry_out | delivery
    subtotal        INTEGER NOT NULL DEFAULT 0,        -- cents
    tax             INTEGER NOT NULL DEFAULT 0,        -- cents
    total           INTEGER NOT NULL DEFAULT 0,        -- cents
    customer_name   TEXT,
    customer_phone  TEXT,
    customer_notes  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
    id              SERIAL PRIMARY KEY,
    order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id    INTEGER REFERENCES menu_items(id),
    name_snapshot   TEXT NOT NULL,   -- name at time of order (in case menu changes)
    size            TEXT,            -- small | large | NULL for fixed-size items
    quantity        INTEGER NOT NULL DEFAULT 1,
    is_half_half    BOOLEAN NOT NULL DEFAULT FALSE,
    left_config     JSONB,           -- { preset_id, toppings[], sauce, notes }
    right_config    JSONB,
    whole_config    JSONB,           -- used when is_half_half = false
    item_price      INTEGER NOT NULL, -- cents, per unit
    notes           TEXT
);

CREATE TABLE IF NOT EXISTS payments (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders(id),
    method      TEXT NOT NULL,              -- card | cash
    amount      INTEGER NOT NULL,           -- cents
    square_ref  TEXT,                       -- Square transaction ID
    status      TEXT NOT NULL DEFAULT 'pending', -- pending | completed | refunded
    paid_at     TIMESTAMPTZ
);
"""
