from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from database import get_conn, get_cursor
from printer import print_receipt
from websocket import kitchen_manager

router = APIRouter(prefix="/api", tags=["payments"])


# ── Helpers ───────────────────────────────────────────────────

def _fetch_order_with_items(order_id: int) -> dict:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """SELECT id, status, order_type, subtotal, tax, total,
                          customer_name, customer_notes
                   FROM orders WHERE id = %s""",
                (order_id,),
            )
            order = cur.fetchone()
            if not order:
                return None
            cur.execute(
                """SELECT name_snapshot, size, quantity, is_half_half,
                          left_config, right_config, whole_config, item_price, notes
                   FROM order_items WHERE order_id = %s""",
                (order_id,),
            )
            items = [dict(r) for r in cur.fetchall()]
    result = dict(order)
    result["items"] = items
    return result


def _mark_paid(order_id: int, method: str, amount: int, square_ref: str = None):
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT total FROM orders WHERE id = %s", (order_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Order not found")
            cur.execute(
                """INSERT INTO payments (order_id, method, amount, square_ref, status, paid_at)
                   VALUES (%s, %s, %s, %s, 'completed', %s)""",
                (order_id, method, amount, square_ref, datetime.now(timezone.utc)),
            )
            cur.execute(
                "UPDATE orders SET status = 'paid' WHERE id = %s",
                (order_id,),
            )


async def _after_payment(order_id: int):
    """Print receipt and broadcast paid status to kitchen."""
    order = _fetch_order_with_items(order_id)
    if order:
        print_receipt(order, order["items"])
    await kitchen_manager.broadcast({"type": "status_update", "order_id": order_id, "status": "paid"})


# ── Square deep-link callback ─────────────────────────────────

@router.get("/payment-done")
@router.post("/payment-done")
async def square_callback(request: Request, background_tasks: BackgroundTasks):
    """
    Square POS sends this callback after a card payment.
    Square sends: status=ok, transaction_id=xxx, data_parameter=ORDER_ID
    """
    params = dict(request.query_params)
    # Also accept POST form body (some Square versions POST)
    try:
        form = await request.form()
        params.update(dict(form))
    except Exception:
        pass

    status      = params.get("status", "").lower()
    square_ref  = params.get("transaction_id") or params.get("referenceId") or params.get("reference_id")
    order_id_str = params.get("data_parameter") or params.get("metadata") or params.get("order_id")

    if status != "ok":
        return {"ok": False, "detail": f"Square status: {status}"}

    if not order_id_str:
        raise HTTPException(status_code=400, detail="Missing order_id in callback")

    try:
        order_id = int(order_id_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid order_id")

    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT total FROM orders WHERE id = %s", (order_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Order not found")
            amount = row["total"]

    _mark_paid(order_id, "card", amount, square_ref)
    background_tasks.add_task(_after_payment, order_id)

    return {"ok": True, "order_id": order_id}


# ── Cash payment ──────────────────────────────────────────────

class CashPaymentIn(BaseModel):
    order_id: int
    amount: int  # cents tendered
    method: str = "cash"  # cash | card_phone | cash_on_delivery | card_on_delivery
    ref: str = None  # e.g. last 4 digits for card_phone


@router.post("/payment/cash")
async def record_cash_payment(body: CashPaymentIn, background_tasks: BackgroundTasks):
    _mark_paid(body.order_id, body.method, body.amount, square_ref=body.ref)
    background_tasks.add_task(_after_payment, body.order_id)
    return {"ok": True, "order_id": body.order_id}
