from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import get_conn, get_cursor

router = APIRouter(prefix="/api/cash", tags=["cash"])


class CashMovementIn(BaseModel):
    amount_cents: int
    notes: Optional[str] = None


class TillCountIn(BaseModel):
    amount_cents: int


def _compute_expected(cur) -> tuple[int, Optional[dict]]:
    """Return (expected_cents, last_count_dict_or_None)."""
    cur.execute(
        "SELECT id, amount, expected, created_at FROM cash_movements WHERE type = 'count' ORDER BY created_at DESC LIMIT 1"
    )
    last_count = cur.fetchone()

    if last_count:
        since = last_count["created_at"]
        base  = last_count["amount"]
    else:
        since = datetime(1970, 1, 1, tzinfo=timezone.utc)
        base  = 0

    cur.execute(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE method = 'cash' AND status = 'completed' AND paid_at > %s",
        (since,),
    )
    cash_sales = cur.fetchone()["total"]

    cur.execute(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE method = 'refund_cash' AND paid_at > %s",
        (since,),
    )
    cash_refunds = cur.fetchone()["total"]

    cur.execute(
        """
        SELECT COALESCE(SUM(
            CASE WHEN type = 'cash_in'  THEN  amount
                 WHEN type = 'cash_out' THEN -amount
                 ELSE 0 END
        ), 0) AS total
        FROM cash_movements
        WHERE type IN ('cash_in', 'cash_out') AND created_at > %s
        """,
        (since,),
    )
    movements = cur.fetchone()["total"]

    expected = base + cash_sales + cash_refunds + movements

    last_count_dict = None
    if last_count:
        exp_at_count = last_count["expected"] if last_count["expected"] is not None else 0
        last_count_dict = {
            "id":         last_count["id"],
            "amount":     last_count["amount"],
            "expected":   exp_at_count,
            "difference": last_count["amount"] - exp_at_count,
            "created_at": last_count["created_at"].isoformat(),
        }

    return expected, last_count_dict


@router.get("/summary")
def get_cash_summary():
    """Expected drawer balance, last till count, and today's movements."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            expected, last_count = _compute_expected(cur)

            since_24h = datetime.now(timezone.utc) - timedelta(hours=24)
            cur.execute(
                """
                SELECT id, type, amount, expected, notes, created_at
                FROM cash_movements
                WHERE created_at >= %s
                ORDER BY created_at DESC
                """,
                (since_24h,),
            )
            movements_today = [
                {
                    "id":         r["id"],
                    "type":       r["type"],
                    "amount":     r["amount"],
                    "expected":   r["expected"],
                    "notes":      r["notes"],
                    "created_at": r["created_at"].isoformat(),
                }
                for r in cur.fetchall()
            ]

    return {"expected": expected, "last_count": last_count, "movements_today": movements_today}


@router.post("/in", status_code=201)
def cash_in(body: CashMovementIn):
    if body.amount_cents <= 0:
        raise HTTPException(status_code=400, detail="amount_cents must be positive")
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "INSERT INTO cash_movements (type, amount, notes) VALUES ('cash_in', %s, %s) RETURNING id",
                (body.amount_cents, body.notes),
            )
            row = cur.fetchone()
    return {"ok": True, "id": row["id"]}


@router.post("/out", status_code=201)
def cash_out(body: CashMovementIn):
    if body.amount_cents <= 0:
        raise HTTPException(status_code=400, detail="amount_cents must be positive")
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "INSERT INTO cash_movements (type, amount, notes) VALUES ('cash_out', %s, %s) RETURNING id",
                (body.amount_cents, body.notes),
            )
            row = cur.fetchone()
    return {"ok": True, "id": row["id"]}


@router.post("/count", status_code=201)
def till_count(body: TillCountIn):
    if body.amount_cents < 0:
        raise HTTPException(status_code=400, detail="amount_cents cannot be negative")
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            expected, _ = _compute_expected(cur)
            cur.execute(
                "INSERT INTO cash_movements (type, amount, expected) VALUES ('count', %s, %s) RETURNING id",
                (body.amount_cents, expected),
            )
            row = cur.fetchone()
    return {"ok": True, "id": row["id"], "difference": body.amount_cents - expected, "expected": expected}


@router.post("/{movement_id}/print")
def print_movement(movement_id: int):
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT id, type, amount, expected, notes FROM cash_movements WHERE id = %s",
                (movement_id,),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Movement not found")
    from printer import print_cash_receipt
    print_cash_receipt(dict(row))
    return {"ok": True}
