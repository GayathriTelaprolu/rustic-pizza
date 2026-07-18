import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel

from database import get_conn, get_cursor

router = APIRouter(prefix="/api/owner", tags=["owner"])

OWNER_PIN = os.environ.get("OWNER_PIN", "1234")

CATEGORIES = [
    "pizza", "gourmet_pizza", "calzone", "sub_wrap",
    "appetizer", "dinner_plate", "salad", "dessert", "beverage",
]


def verify_pin(x_owner_pin: str = Header(...)):
    if x_owner_pin != OWNER_PIN:
        raise HTTPException(status_code=403, detail="Invalid PIN")


# ── Models ────────────────────────────────────────────────────

class MenuItemIn(BaseModel):
    name: str
    category: str
    description: Optional[str] = None
    price_small: Optional[int] = None
    price_large: Optional[int] = None
    is_gourmet_preset: bool = False
    image_url: Optional[str] = None


class ToggleIn(BaseModel):
    is_active: bool


class PriceIn(BaseModel):
    price_small: Optional[int] = None   # cents
    price_large: Optional[int] = None   # cents


class ImageIn(BaseModel):
    image_url: Optional[str] = None


# ── Verify PIN endpoint (no mutation — just returns 200 or 403) ──

@router.post("/verify")
def verify(x_owner_pin: str = Header(...)):
    if x_owner_pin != OWNER_PIN:
        raise HTTPException(status_code=403, detail="Invalid PIN")
    return {"ok": True}


# ── List all menu items ───────────────────────────────────────

@router.get("/items", dependencies=[Depends(verify_pin)])
def list_items():
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """SELECT id, name, category, description,
                          price_small, price_large, is_active,
                          is_gourmet_preset, image_url
                   FROM menu_items
                   ORDER BY category, name"""
            )
            rows = [dict(r) for r in cur.fetchall()]
    return rows


# ── Add item ──────────────────────────────────────────────────

@router.post("/items", status_code=201, dependencies=[Depends(verify_pin)])
def add_menu_item(body: MenuItemIn):
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """INSERT INTO menu_items
                       (name, category, description, price_small, price_large,
                        is_gourmet_preset, image_url)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (body.name, body.category, body.description,
                 body.price_small, body.price_large,
                 body.is_gourmet_preset, body.image_url),
            )
            new_id = cur.fetchone()["id"]
    return {"id": new_id}


# ── Update full item ──────────────────────────────────────────

@router.patch("/items/{item_id}", dependencies=[Depends(verify_pin)])
def update_menu_item(item_id: int, body: MenuItemIn):
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """UPDATE menu_items
                   SET name=%s, category=%s, description=%s,
                       price_small=%s, price_large=%s,
                       is_gourmet_preset=%s, image_url=%s
                   WHERE id=%s RETURNING id""",
                (body.name, body.category, body.description,
                 body.price_small, body.price_large,
                 body.is_gourmet_preset, body.image_url,
                 item_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}


# ── Toggle active / sold-out ──────────────────────────────────

@router.patch("/items/{item_id}/toggle", dependencies=[Depends(verify_pin)])
def toggle_item(item_id: int, body: ToggleIn):
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "UPDATE menu_items SET is_active=%s WHERE id=%s RETURNING id",
                (body.is_active, item_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True, "is_active": body.is_active}


# ── Edit price ────────────────────────────────────────────────

@router.patch("/items/{item_id}/price", dependencies=[Depends(verify_pin)])
def update_price(item_id: int, body: PriceIn):
    fields, values = [], []
    if body.price_small is not None:
        fields.append("price_small=%s"); values.append(body.price_small)
    if body.price_large is not None:
        fields.append("price_large=%s"); values.append(body.price_large)
    if not fields:
        raise HTTPException(status_code=400, detail="No price provided")
    values.append(item_id)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                f"UPDATE menu_items SET {', '.join(fields)} WHERE id=%s RETURNING id",
                values,
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}


# ── Update image URL ──────────────────────────────────────────

@router.patch("/items/{item_id}/image", dependencies=[Depends(verify_pin)])
def update_image(item_id: int, body: ImageIn):
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "UPDATE menu_items SET image_url=%s WHERE id=%s RETURNING id",
                (body.image_url, item_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}
