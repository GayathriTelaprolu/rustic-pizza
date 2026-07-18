"""
Test / simulation endpoints — only for development.
These let you verify the full payment + print flow without real hardware.

Endpoints:
  GET /api/test/payment?order_id=X      — simulates Square callback (marks order paid)
  GET /api/test/kitchen-print?order_id=X — re-prints kitchen ticket to test_prints/
  GET /api/test/receipt-print?order_id=X — re-prints receipt to test_prints/
  GET /api/test/prints                   — lists all files in test_prints/
"""

import os

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import PlainTextResponse

from database import get_conn, get_cursor
from printer import TEST_DIR, print_kitchen_ticket, print_receipt
from routes.payments import _after_payment, _mark_paid

router = APIRouter(prefix="/api/test", tags=["test"])


def _get_order_with_items(order_id: int) -> dict:
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """SELECT id, status, order_type, subtotal, tax, total,
                          customer_name, customer_notes
                   FROM orders WHERE id = %s""",
                (order_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"Order {order_id} not found")
            cur.execute(
                """SELECT name_snapshot, size, quantity, is_half_half,
                          left_config, right_config, whole_config, item_price, notes
                   FROM order_items WHERE order_id = %s""",
                (order_id,),
            )
            items = [dict(r) for r in cur.fetchall()]
    result = dict(row)
    result["items"] = items
    return result


# ── Simulate Square card payment ──────────────────────────────

@router.get("/payment")
async def simulate_payment(order_id: int, background_tasks: BackgroundTasks):
    """
    Simulates Square calling back to /api/payment-done.
    Marks the order as paid, prints receipt, broadcasts to kitchen.
    """
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT status, total FROM orders WHERE id = %s", (order_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"Order {order_id} not found")
            if row["status"] == "paid":
                return {"ok": False, "detail": "Order is already paid"}

    _mark_paid(order_id, "card", row["total"], square_ref="TEST-SIM-REF")
    background_tasks.add_task(_after_payment, order_id)

    return {
        "ok": True,
        "order_id": order_id,
        "message": f"Payment simulated. Receipt written to backend/test_prints/receipt_order_{order_id}.txt",
    }


# ── Re-print kitchen ticket ───────────────────────────────────

@router.get("/kitchen-print")
def sim_kitchen_print(order_id: int):
    order = _get_order_with_items(order_id)
    print_kitchen_ticket(order, order["items"])
    return {
        "ok": True,
        "file": f"backend/test_prints/kitchen_order_{order_id}.txt",
    }


# ── Re-print receipt ──────────────────────────────────────────

@router.get("/receipt-print")
def sim_receipt_print(order_id: int):
    order = _get_order_with_items(order_id)
    print_receipt(order, order["items"])
    return {
        "ok": True,
        "file": f"backend/test_prints/receipt_order_{order_id}.txt",
    }


# ── List all test print files ─────────────────────────────────

@router.get("/prints")
def list_test_prints():
    if not os.path.isdir(TEST_DIR):
        return {"files": []}
    files = sorted(os.listdir(TEST_DIR), reverse=True)
    return {"directory": TEST_DIR, "files": files}


# ── Read a specific test print file ──────────────────────────

@router.get("/prints/{filename}", response_class=PlainTextResponse)
def read_test_print(filename: str):
    path = os.path.join(TEST_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    with open(path, encoding="utf-8") as f:
        return f.read()
