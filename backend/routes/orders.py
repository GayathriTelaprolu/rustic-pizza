import json
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, field_validator, model_validator

from database import get_conn, get_cursor
from printer import print_kitchen_ticket, print_receipt
from websocket import kitchen_manager

router = APIRouter(prefix="/api/orders", tags=["orders"])

DELIVERY_MINIMUM_CENTS = 1500  # $15.00


# ---------- Request models ----------

class HalfConfig(BaseModel):
    preset_id: Optional[int] = None
    toppings: List[int] = []
    sauce: Optional[str] = None
    notes: Optional[str] = None


class WholeConfig(BaseModel):
    preset_id: Optional[int] = None
    toppings: List[int] = []
    sauce: Optional[str] = None
    notes: Optional[str] = None


class OrderItemIn(BaseModel):
    menu_item_id: Optional[int] = None
    custom_name: Optional[str] = None
    custom_price_cents: Optional[int] = None
    size: Optional[Literal["small", "large"]] = None
    quantity: int = 1
    is_half_half: bool = False
    left_config: Optional[HalfConfig] = None
    right_config: Optional[HalfConfig] = None
    whole_config: Optional[WholeConfig] = None
    notes: Optional[str] = None

    @field_validator("quantity")
    @classmethod
    def qty_positive(cls, v):
        if v < 1:
            raise ValueError("quantity must be >= 1")
        return v

    @model_validator(mode='after')
    def check_item_source(self):
        if self.menu_item_id is None:
            if not self.custom_name or not self.custom_price_cents or self.custom_price_cents <= 0:
                raise ValueError("custom_name and positive custom_price_cents required when menu_item_id is absent")
        return self


class CreateOrderIn(BaseModel):
    order_type: Literal["dine_in", "carry_out", "delivery"] = "carry_out"
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_notes: Optional[str] = None
    scheduled_for: Optional[datetime] = None
    items: List[OrderItemIn]


class RefundIn(BaseModel):
    method: str  # 'cash' or 'card'
    ref: Optional[str] = None


# ---------- Helpers ----------

TAX_RATE = 0.0625


def _cents(v) -> int:
    return int(round(v))


def _fetch_item_price(cur, menu_item_id: int, size: Optional[str]) -> tuple[str, int]:
    cur.execute(
        "SELECT name, price_small, price_large FROM menu_items WHERE id = %s AND is_active = TRUE",
        (menu_item_id,),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=400, detail=f"menu_item_id {menu_item_id} not found")

    if size == "small":
        price = row["price_small"]
    elif size == "large":
        price = row["price_large"]
    else:
        price = row["price_large"] or row["price_small"]

    if price is None:
        raise HTTPException(status_code=400, detail=f"No price for size '{size}' on item {menu_item_id}")

    return row["name"], price


async def _broadcast_new_order(order_payload: dict):
    await kitchen_manager.broadcast({"type": "new_order", "order": order_payload})
    try:
        print_kitchen_ticket(order_payload, order_payload.get("items", []))
    except Exception as e:
        print(f"[printer] kitchen ticket error: {e}")


async def _broadcast_status(order_id: int, status: str):
    await kitchen_manager.broadcast({"type": "status_update", "order_id": order_id, "status": status})


def _attach_items(cur, orders: list) -> list:
    result = []
    for o in orders:
        cur.execute(
            """
            SELECT name_snapshot, size, quantity, is_half_half,
                   left_config, right_config, whole_config, item_price, notes
            FROM order_items WHERE order_id = %s
            """,
            (o["id"],),
        )
        o["items"] = [dict(r) for r in cur.fetchall()]
        o["created_at"] = o["created_at"].isoformat()
        if o.get("scheduled_for"):
            o["scheduled_for"] = o["scheduled_for"].isoformat()
        result.append(o)
    return result


# ---------- Routes ----------

@router.post("", status_code=201)
def create_order(body: CreateOrderIn, background_tasks: BackgroundTasks):
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            subtotal = 0
            resolved_items = []

            for item in body.items:
                if item.menu_item_id is not None:
                    name, unit_price = _fetch_item_price(cur, item.menu_item_id, item.size)
                else:
                    name, unit_price = item.custom_name, item.custom_price_cents
                line_total = unit_price * item.quantity
                subtotal += line_total
                resolved_items.append((item, name, unit_price))

            if body.order_type == "delivery" and subtotal < DELIVERY_MINIMUM_CENTS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Delivery minimum is $15.00 (order is ${subtotal/100:.2f})",
                )

            tax   = _cents(subtotal * TAX_RATE)
            total = subtotal + tax

            cur.execute(
                """
                INSERT INTO orders (status, order_type, subtotal, tax, total,
                                    customer_name, customer_phone, customer_notes,
                                    scheduled_for)
                VALUES ('received', %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, created_at
                """,
                (
                    body.order_type, subtotal, tax, total,
                    body.customer_name, body.customer_phone, body.customer_notes,
                    body.scheduled_for,
                ),
            )
            row        = cur.fetchone()
            order_id   = row["id"]
            created_at = row["created_at"].isoformat()

            items_payload = []
            for item, name, unit_price in resolved_items:
                lc = item.left_config.model_dump()  if item.left_config  else None
                rc = item.right_config.model_dump() if item.right_config else None
                wc = item.whole_config.model_dump() if item.whole_config else None
                cur.execute(
                    """
                    INSERT INTO order_items
                        (order_id, menu_item_id, name_snapshot, size, quantity,
                         is_half_half, left_config, right_config, whole_config,
                         item_price, notes)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        order_id, item.menu_item_id, name,
                        item.size, item.quantity, item.is_half_half,
                        json.dumps(lc) if lc else None,
                        json.dumps(rc) if rc else None,
                        json.dumps(wc) if wc else None,
                        unit_price, item.notes,
                    ),
                )
                items_payload.append({
                    "name_snapshot": name,
                    "size":          item.size,
                    "quantity":      item.quantity,
                    "is_half_half":  item.is_half_half,
                    "left_config":   lc,
                    "right_config":  rc,
                    "whole_config":  wc,
                    "item_price":    unit_price,
                    "notes":         item.notes,
                })

    order_payload = {
        "id":             order_id,
        "status":         "received",
        "order_type":     body.order_type,
        "subtotal":       subtotal,
        "tax":            tax,
        "total":          total,
        "customer_name":  body.customer_name,
        "customer_phone": body.customer_phone,
        "customer_notes": body.customer_notes,
        "scheduled_for":  body.scheduled_for.isoformat() if body.scheduled_for else None,
        "created_at":     created_at,
        "items":          items_payload,
    }

    # Only print immediately for non-scheduled orders
    if not body.scheduled_for:
        background_tasks.add_task(_broadcast_new_order, order_payload)

    return {"order_id": order_id, "subtotal": subtotal, "tax": tax, "total": total,
            "scheduled_for": body.scheduled_for.isoformat() if body.scheduled_for else None}


@router.get("/active")
def list_active_orders():
    """Active orders: in-progress and not scheduled in the future."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id, status, order_type, subtotal, tax, total,
                       customer_name, customer_phone, customer_notes,
                       created_at, scheduled_for
                FROM orders
                WHERE status IN ('received', 'prepping', 'baking', 'ready')
                  AND (scheduled_for IS NULL OR scheduled_for <= NOW())
                ORDER BY created_at ASC
                """
            )
            orders = [dict(r) for r in cur.fetchall()]
            result = _attach_items(cur, orders)
    return result


@router.get("/scheduled")
def list_scheduled_orders():
    """Future scheduled orders not yet started."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id, status, order_type, subtotal, tax, total,
                       customer_name, customer_phone, customer_notes,
                       created_at, scheduled_for
                FROM orders
                WHERE scheduled_for > NOW()
                  AND status NOT IN ('paid', 'cancelled')
                ORDER BY scheduled_for ASC
                """
            )
            orders = [dict(r) for r in cur.fetchall()]
            result = _attach_items(cur, orders)
    return result


@router.post("/{order_id}/start")
def start_scheduled_order(order_id: int, background_tasks: BackgroundTasks):
    """Move a scheduled order into the active queue and print its kitchen ticket."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE orders SET scheduled_for = NULL
                WHERE id = %s AND scheduled_for IS NOT NULL
                RETURNING id, status, order_type, subtotal, tax, total,
                          customer_name, customer_phone, customer_notes, created_at
                """,
                (order_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Order not found or not scheduled")
            order = dict(row)
            order["created_at"] = order["created_at"].isoformat()
            order["scheduled_for"] = None

            cur.execute(
                """
                SELECT name_snapshot, size, quantity, is_half_half,
                       left_config, right_config, whole_config, item_price, notes
                FROM order_items WHERE order_id = %s
                """,
                (order_id,),
            )
            order["items"] = [dict(r) for r in cur.fetchall()]

    background_tasks.add_task(_broadcast_new_order, order)
    return {"order_id": order_id, "started": True}


@router.get("/history")
def list_order_history(days: int = 7):
    """Paid / refunded / cancelled orders from the past N days."""
    from datetime import timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id, status, order_type, subtotal, tax, total,
                       customer_name, customer_phone, customer_notes,
                       created_at, scheduled_for
                FROM orders
                WHERE status IN ('paid', 'refunded', 'cancelled')
                  AND created_at >= %s
                ORDER BY created_at DESC
                """,
                (cutoff,),
            )
            orders = [dict(r) for r in cur.fetchall()]
            result = _attach_items(cur, orders)
    return result


@router.post("/{order_id}/reprint")
def reprint_receipt(order_id: int):
    """Reprint the customer receipt for any completed order."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id, status, order_type, subtotal, tax, total,
                       customer_name, customer_phone, customer_notes
                FROM orders WHERE id = %s
                """,
                (order_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Order not found")
            order = dict(row)
            cur.execute(
                """
                SELECT name_snapshot, size, quantity, is_half_half,
                       left_config, right_config, whole_config, item_price, notes
                FROM order_items WHERE order_id = %s
                """,
                (order_id,),
            )
            items = [dict(r) for r in cur.fetchall()]
    try:
        print_receipt(order, items)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Print error: {e}")
    return {"ok": True, "order_id": order_id}


@router.post("/{order_id}/refund")
def process_refund(order_id: int, body: RefundIn):
    """Mark a paid order as refunded and record the refund method."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "UPDATE orders SET status = 'refunded' WHERE id = %s AND status = 'paid' RETURNING id, total",
                (order_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Order not found or not eligible for refund")
            cur.execute(
                """
                INSERT INTO payments (order_id, method, amount, status, paid_at)
                VALUES (%s, %s, %s, 'refunded', NOW())
                """,
                (order_id, f"refund_{body.method}", -row["total"]),
            )
    return {"ok": True, "order_id": order_id}


@router.get("")
def list_orders(status: Optional[str] = None):
    sql = """
        SELECT o.id, o.status, o.order_type, o.subtotal, o.tax, o.total,
               o.customer_name, o.customer_phone, o.customer_notes, o.created_at
        FROM orders o
    """
    params = []
    if status:
        sql += " WHERE o.status = %s"
        params.append(status)
    sql += " ORDER BY o.created_at DESC LIMIT 100"

    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(sql, params)
            orders = [dict(r) for r in cur.fetchall()]
    return orders


@router.get("/{order_id}")
def get_order(order_id: int):
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id, status, order_type, subtotal, tax, total,
                       customer_name, customer_phone, customer_notes, created_at, scheduled_for
                FROM orders WHERE id = %s
                """,
                (order_id,),
            )
            order = cur.fetchone()
            if not order:
                raise HTTPException(status_code=404, detail="Order not found")

            cur.execute(
                """
                SELECT id, menu_item_id, name_snapshot, size, quantity,
                       is_half_half, left_config, right_config, whole_config,
                       item_price, notes
                FROM order_items WHERE order_id = %s
                """,
                (order_id,),
            )
            items = [dict(r) for r in cur.fetchall()]

    result = dict(order)
    result["items"] = items
    result["created_at"] = result["created_at"].isoformat()
    if result.get("scheduled_for"):
        result["scheduled_for"] = result["scheduled_for"].isoformat()
    return result


@router.patch("/{order_id}/status")
def update_order_status(order_id: int, status: str, background_tasks: BackgroundTasks):
    valid = {"received", "prepping", "baking", "ready", "paid"}
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"status must be one of {valid}")

    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "UPDATE orders SET status = %s WHERE id = %s RETURNING id",
                (status, order_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Order not found")

    background_tasks.add_task(_broadcast_status, order_id, status)
    return {"order_id": order_id, "status": status}
