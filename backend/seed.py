"""
Seed the Rustic Pizza database with the full menu.
Run once:  python seed.py

Prices are in CENTS (e.g., $11.25 → 1125).
"""

import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()

# ── Create tables ────────────────────────────────────────────────────────────
cur.execute("""
CREATE TABLE IF NOT EXISTS menu_items (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    description     TEXT,
    price_small     INTEGER,
    price_large     INTEGER,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    is_gourmet_preset BOOLEAN NOT NULL DEFAULT FALSE,
    image_url       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS modifiers (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    extra_price INTEGER NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'received',
    order_type      TEXT NOT NULL DEFAULT 'carry_out',
    subtotal        INTEGER NOT NULL DEFAULT 0,
    tax             INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL DEFAULT 0,
    customer_name   TEXT,
    customer_phone  TEXT,
    customer_notes  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
    id              SERIAL PRIMARY KEY,
    order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id    INTEGER REFERENCES menu_items(id),
    name_snapshot   TEXT NOT NULL,
    size            TEXT,
    quantity        INTEGER NOT NULL DEFAULT 1,
    is_half_half    BOOLEAN NOT NULL DEFAULT FALSE,
    left_config     JSONB,
    right_config    JSONB,
    whole_config    JSONB,
    item_price      INTEGER NOT NULL,
    notes           TEXT
);

CREATE TABLE IF NOT EXISTS payments (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders(id),
    method      TEXT NOT NULL,
    amount      INTEGER NOT NULL,
    square_ref  TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    paid_at     TIMESTAMPTZ
);
""")

# ── Menu items ───────────────────────────────────────────────────────────────
# (name, category, description, price_small, price_large, is_gourmet_preset)

MENU_ITEMS = [
    # ── PIZZA YOUR WAY ──────────────────────────────────────────────────────
    ("Cheese Pizza",          "pizza", "Classic cheese pizza", 1125, 1950, False),
    ("Pepperoni Pizza",       "pizza", "Pepperoni pizza", 1125, 1950, False),
    ("Pan Pizza",             "pizza", "Deep pan pizza", None, 2150, False),
    ("Stuffed Pizza",         "pizza", "Stuffed crust pizza", None, 2450, False),
    # Each Extra Topping: small +$1.50 / large +$2.50 — handled via modifiers

    # ── GOURMET PIZZA ────────────────────────────────────────────────────────
    ("Margarita",             "gourmet_pizza", "Fresh tomatoes, basil, mozzarella", 1750, 2400, True),
    ("Buffalo Chicken",       "gourmet_pizza", "Hot sauce, grilled chicken, mozzarella, ranch", 1750, 2400, True),
    ("BBQ Chicken",           "gourmet_pizza", "BBQ sauce, grilled chicken, onions, mozzarella", 1750, 2400, True),
    ("Hawaiian",              "gourmet_pizza", "Ham, pineapple, mozzarella", 1750, 2400, True),
    ("Chicken Broccoli Alfredo", "gourmet_pizza", "Alfredo sauce, chicken, broccoli, mozzarella", 1750, 2400, True),
    ("Abruzzi",               "gourmet_pizza", "Sausage, peppers, onions, mushrooms", 1750, 2400, True),
    ("Meat Lover",            "gourmet_pizza", "Pepperoni, sausage, meatball, ham", 1750, 2400, True),
    ("Veggie",                "gourmet_pizza", "Roasted peppers, onions, mushrooms, olives, spinach", 1750, 2400, True),
    ("Napoli White",          "gourmet_pizza", "Ricotta, mozzarella, garlic, olive oil", 1750, 2400, True),
    ("Mediterranean",         "gourmet_pizza", "Feta, olives, roasted peppers, spinach, tomatoes", 1750, 2400, True),
    ("Moda",                  "gourmet_pizza", "Prosciutto, arugula, mozzarella, cherry tomatoes", 1750, 2400, True),

    # ── CALZONES ─────────────────────────────────────────────────────────────
    ("Cheese Calzone",        "calzone", "Ricotta and mozzarella", 1750, 2400, False),
    ("Buffalo Calzone",       "calzone", "Buffalo chicken, mozzarella", 1750, 2400, False),
    ("Steak Calzone",         "calzone", "Steak, peppers, onions, mozzarella", 1750, 2400, False),
    ("Chicken Parm Calzone",  "calzone", "Chicken, marinara, mozzarella", 1750, 2400, False),
    ("Add a Filling",         "calzone", "Extra filling add-on", 150,  250,  False),
    # Extra steak/chicken add-on: small +$2.50, large +$3.75 — via modifier

    # ── CHICKEN W/ CATUPIRI ───────────────────────────────────────────────────
    ("Chicken w/ Catupiri",   "dinner_plate", "Brazilian cream cheese stuffed chicken", 1750, 2450, False),
    ("Capricciosa",           "dinner_plate", "Italian-style mixed toppings plate", 1750, 2450, False),

    # ── PASTA / DINNER PLATES ────────────────────────────────────────────────
    ("Ravioli",               "dinner_plate", "Cheese ravioli with marinara or meat sauce", 1450, None, False),
    ("Linguine",              "dinner_plate", "Linguine with choice of sauce", 1450, None, False),
    ("Chicken Lover Marinara","dinner_plate", "Grilled chicken over linguine with marinara", 1699, None, False),
    ("Chicken Broccoli (Pasta)","dinner_plate","Chicken and broccoli over pasta", 1699, None, False),
    ("Chicken Lasagna",       "dinner_plate", "Layered chicken lasagna", 1799, None, False),
    ("Chicken Lasagna Alfredo","dinner_plate","Chicken lasagna with Alfredo sauce", 1799, None, False),
    ("Baked Ziti",            "dinner_plate", "Baked ziti with marinara and mozzarella", 1699, None, False),
    ("Chicken Broccoli Dinner","dinner_plate","Chicken and broccoli with choice of rice, pasta, or fries, side salad", 1800, None, False),

    # ── BRAZILIAN FOOD ───────────────────────────────────────────────────────
    ("Brazilian Food",        "dinner_plate", "Choice of beef, pork, or chicken with rice and beans", 1899, None, False),

    # ── SUBS & WRAPS ─────────────────────────────────────────────────────────
    ("Italian",               "sub_wrap", "Ham, salami, capicola, provolone, lettuce, tomato, onion, peppers", 1099, 1350, False),
    ("Rustic's Club",         "sub_wrap", "Turkey, bacon, ham, lettuce, tomato, mayo", 1099, 1350, False),
    ("Pilgrim",               "sub_wrap", "Turkey, stuffing, cranberry, provolone", 1099, 1350, False),
    ("Chicken Parmesan",      "sub_wrap", "Breaded chicken, marinara, mozzarella", 1099, 1350, False),
    ("Chicken Avocado Sandwich","sub_wrap","Grilled chicken, avocado, lettuce, tomato, mayo", 1099, 1350, False),
    ("Vegetarian",            "sub_wrap", "Roasted veggies, provolone, pesto", 1099, 1350, False),
    ("BLT with Mozzarella",   "sub_wrap", "Bacon, lettuce, tomato, fresh mozzarella", 1099, 1350, False),
    ("Meatball",              "sub_wrap", "Meatballs, marinara, mozzarella", 1099, 1350, False),
    ("Steak & Cheese",        "sub_wrap", "Steak, peppers, onions, American cheese", 1099, 1350, False),
    ("Chicken Parm Sub",      "sub_wrap", "Chicken cutlet, marinara, provolone", 1099, 1350, False),
    ("Tuna Melt",             "sub_wrap", "Tuna salad, tomato, American cheese, grilled", 1099, 1350, False),
    ("Steak Bomb",            "sub_wrap", "Steak, sautéed mushrooms, peppers, onions, cheese", 1099, 1350, False),
    ("Cheeseburger",          "sub_wrap", "Beef patty, lettuce, tomato, pickles, ketchup, American cheese", 1099, 1350, False),
    ("BBQ Chicken Sub",       "sub_wrap", "BBQ chicken, onions, cheddar", 1099, 1350, False),
    ("BBO Chicken (Wrap)",    "sub_wrap", "BBQ chicken wrap with veggies and cheese", 1099, 1350, False),
    ("Hot Pastry",            "sub_wrap", "Grilled chicken, broccoli, cheddar in pastry dough", 1099, 1350, False),
    ("Veggie-Melt",           "sub_wrap", "Grilled veggies, pesto, mozzarella, grilled", 1099, 1350, False),
    ("Caprese",               "sub_wrap", "Fresh mozzarella, tomato, basil, balsamic, olive oil", 1099, 1350, False),

    # Chicken Fajita Wrap
    ("Chicken Fajita",        "sub_wrap", "Grilled chicken, peppers, onions, white fajita sauce, lettuce, tomato, cheese", 1099, 1350, False),
    ("Caesar Roll Up",        "sub_wrap", "Grilled chicken, romaine, parmesan, Caesar dressing", 1150, 1350, False),
    ("Grilled Chicken Caesar Roll Up", "sub_wrap", "Marinated grilled chicken Caesar roll up, feta cheese, Greek dressing", 1300, 1550, False),
    ("Burritos Wrap (Beef or Chicken)", "sub_wrap", "Marinated beef or chicken, rice, beans, cheese, salsa, sour cream", 1350, 1550, False),
    ("Burritos Bowl (Beef or Chicken)", "sub_wrap", "Bowl version of burrito with rice, beans, toppings", 1350, 1550, False),
    ("Chicken Wrap (Caesar Roll Up)", "sub_wrap", "Grilled chicken, Caesar, parmesan, romaine in wrap", 1300, 1550, False),

    # ── APPETIZERS ───────────────────────────────────────────────────────────
    ("Garlic Bread",          "appetizer", "Toasted garlic bread", 450,  600,  False),
    ("Garlic Bread w/ Cheese","appetizer", "Garlic bread topped with mozzarella", 500,  650,  False),
    ("French Fries",          "appetizer", "Classic crispy fries", 450,  600,  False),
    ("Mozzarella Sticks",     "appetizer", "6 mozzarella sticks with marinara", 750,  1025, False),
    ("Wings",                 "appetizer", "Chicken wings — choice of sauce", 1099, 1625, False),
    ("Chicken Tenders",       "appetizer", "Crispy chicken tenders", 1025, 1399, False),
    ("Jalapeño Poppers",      "appetizer", "Cream cheese stuffed jalapeños", 750,  1025, False),
    ("Pastel",                "appetizer", "Brazilian pastry — meat, cheese, or chicken", 500,  None, False),
    ("Empada / Empaninha",    "appetizer", "Brazilian savory pie — choice of filling", 499,  None, False),
    ("Fried Pastry",          "appetizer", "Fried chicken, provolone, cheese, lettuce, tomato and sauce", 499,  None, False),
    ("Mini Calzone",          "appetizer", "Small calzone — choice of filling", 499,  None, False),
    ("Esfirra (Esfiha)",      "appetizer", "Brazilian open-faced meat pie", 499,  None, False),

    # ── SALADS ───────────────────────────────────────────────────────────────
    ("Garden Salad",          "salad", "Mixed greens, tomato, cucumber, red onion, green and red peppers", 1050, None, False),
    ("Caesar Salad",          "salad", "Romaine, parmesan, croutons, Caesar dressing", 1125, None, False),
    ("Greek Salad",           "salad", "Romaine, feta, olives, cucumber, tomato, red onion, Greek dressing", 1125, None, False),
    ("Wiferas Chicken Salad", "salad", "Chicken with house salad", 1350, None, False),
    ("Antipasto Salad",       "salad", "Italian meats, olives, pepperoncini, mozzarella, Italian dressing", 1350, None, False),
    ("Steak Tips Salad",      "salad", "Grilled steak tips over mixed greens", 1399, None, False),
    ("Grilled Chicken Salad", "salad", "Grilled chicken over mixed greens with veggies", 1399, None, False),
    ("Tops to Add",           "salad", "Additional toppings for salad", 100,  None, False),

    # ── DESSERTS ─────────────────────────────────────────────────────────────
    ("Cheesecake",            "dessert", "NY-style cheesecake slice", 480,  None, False),
    ("Chocolate Cake",        "dessert", "Rich chocolate cake slice", 480,  None, False),
    ("Tiramisu",              "dessert", "Classic Italian tiramisu", 480,  None, False),
    ("Corn Cake",             "dessert", "Sweet Brazilian corn cake", 480,  None, False),
    ("Sweet Italian Casserole","dessert","Traditional Italian sweet casserole", 490, None, False),

    # ── BEVERAGES ────────────────────────────────────────────────────────────
    ("Soda",                  "beverage", "Can or bottle soda", 200,  None, False),
    ("Juice",                 "beverage", "Fruit juice", 200,  None, False),
    ("Energy Drinks",         "beverage", "Energy drink", 300,  None, False),
    ("Water",                 "beverage", "Bottled water", 150,  None, False),
]

# ── Modifiers ────────────────────────────────────────────────────────────────
# (name, category, extra_price_cents)

MODIFIERS = [
    # Toppings — free on gourmet presets, extra on pizza-your-way
    ("Pepperoni",       "topping", 0),
    ("Sausage",         "topping", 0),
    ("Mushrooms",       "topping", 0),
    ("Onions",          "topping", 0),
    ("Green Peppers",   "topping", 0),
    ("Black Olives",    "topping", 0),
    ("Jalapeños",       "topping", 0),
    ("Spinach",         "topping", 0),
    ("Broccoli",        "topping", 0),
    ("Tomatoes",        "topping", 0),
    ("Roasted Peppers", "topping", 0),
    ("Anchovies",       "topping", 0),
    ("Ham",             "topping", 0),
    ("Bacon",           "topping", 0),
    ("Chicken",         "topping", 0),
    ("Steak",           "topping", 0),
    ("Meatball",        "topping", 0),
    ("Extra Cheese",    "topping", 0),

    # Sauces
    ("Marinara",        "sauce", 0),
    ("Alfredo",         "sauce", 0),
    ("BBQ",             "sauce", 0),
    ("Buffalo",         "sauce", 0),
    ("Olive Oil & Garlic", "sauce", 0),
    ("Pesto",           "sauce", 0),
    ("No Sauce",        "sauce", 0),

    # Calzone fillings
    ("Ricotta",         "filling", 0),
    ("Mozzarella",      "filling", 0),
    ("Pepperoni",       "filling", 0),
    ("Sausage",         "filling", 0),
    ("Spinach",         "filling", 0),
    ("Chicken",         "filling", 0),
    ("Steak",           "filling", 250),   # extra charge

    # Sub / Wrap veggies
    ("Lettuce",         "veggie", 0),
    ("Tomato",          "veggie", 0),
    ("Onion",           "veggie", 0),
    ("Peppers",         "veggie", 0),
    ("Pickles",         "veggie", 0),
    ("Avocado",         "veggie", 150),
    ("Jalapeños (sub)", "veggie", 0),

    # Sub / Wrap cheese
    ("American Cheese", "cheese", 0),
    ("Provolone",       "cheese", 0),
    ("Mozzarella (sub)","cheese", 0),
    ("Cheddar",         "cheese", 0),
    ("Feta",            "cheese", 0),

    # Salad dressings
    ("Caesar",          "dressing", 0),
    ("Ranch",           "dressing", 0),
    ("Italian",         "dressing", 0),
    ("Greek",           "dressing", 0),
    ("Balsamic",        "dressing", 0),
    ("Honey Mustard",   "dressing", 0),
    ("Olive Oil & Vinegar", "dressing", 0),

    # Brazilian / dinner plate meat choices
    ("Beef",            "meat", 0),
    ("Pork",            "meat", 0),
    ("Chicken",         "meat", 0),
]

# ── Insert ───────────────────────────────────────────────────────────────────

print("Inserting menu items...")
for (name, category, description, price_small, price_large, is_gourmet) in MENU_ITEMS:
    cur.execute(
        """
        INSERT INTO menu_items (name, category, description, price_small, price_large, is_gourmet_preset)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT DO NOTHING
        """,
        (name, category, description, price_small, price_large, is_gourmet),
    )

print("Inserting modifiers...")
for (name, category, extra_price) in MODIFIERS:
    cur.execute(
        """
        INSERT INTO modifiers (name, category, extra_price)
        VALUES (%s, %s, %s)
        ON CONFLICT DO NOTHING
        """,
        (name, category, extra_price),
    )

conn.commit()
cur.close()
conn.close()
print("✓ Seed complete.")
