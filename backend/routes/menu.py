from fastapi import APIRouter, HTTPException
from database import get_conn, get_cursor

router = APIRouter(prefix="/api/menu", tags=["menu"])


@router.get("")
def get_menu():
    """Return all active menu items grouped by category."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT id, name, category, description,
                       price_small, price_large,
                       is_gourmet_preset, image_url
                FROM menu_items
                WHERE is_active = TRUE
                ORDER BY category, name
            """)
            rows = cur.fetchall()

    grouped = {}
    for row in rows:
        cat = row["category"]
        grouped.setdefault(cat, []).append(dict(row))
    return grouped


@router.get("/modifiers")
def get_modifiers():
    """Return all active modifiers grouped by category."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT id, name, category, extra_price
                FROM modifiers
                WHERE is_active = TRUE
                ORDER BY category, name
            """)
            rows = cur.fetchall()

    grouped = {}
    for row in rows:
        cat = row["category"]
        grouped.setdefault(cat, []).append(dict(row))
    return grouped


@router.get("/{item_id}")
def get_menu_item(item_id: int):
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT * FROM menu_items WHERE id = %s AND is_active = TRUE",
                (item_id,),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Item not found")
    return dict(row)
