from fastapi import APIRouter, HTTPException
from database import get_conn, get_cursor

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("")
def get_report(date: str):
    """Daily report for a given date (YYYY-MM-DD)."""
    # Validate format
    import re
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")

    with get_conn() as conn:
        with get_cursor(conn) as cur:

            # Orders by type (paid + refunded)
            cur.execute(
                """
                SELECT order_type,
                       COUNT(*)       AS count,
                       SUM(subtotal)  AS subtotal,
                       SUM(tax)       AS tax,
                       SUM(total)     AS total
                FROM orders
                WHERE status IN ('paid', 'refunded')
                  AND created_at::date = %s
                GROUP BY order_type
                """,
                (date,),
            )
            by_type = {r["order_type"]: dict(r) for r in cur.fetchall()}

            # Overall totals
            cur.execute(
                """
                SELECT COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS gross_total
                FROM orders
                WHERE status IN ('paid', 'refunded')
                  AND created_at::date = %s
                """,
                (date,),
            )
            totals = dict(cur.fetchone())

            # Payment totals by method (completed payments)
            cur.execute(
                """
                SELECT method,
                       COUNT(*)      AS count,
                       SUM(amount)   AS total
                FROM payments
                WHERE status = 'completed'
                  AND paid_at::date = %s
                GROUP BY method
                """,
                (date,),
            )
            by_method = {r["method"]: {"count": r["count"], "total": r["total"]} for r in cur.fetchall()}

            # Cash movements (in / out)
            cur.execute(
                """
                SELECT type,
                       COUNT(*)     AS count,
                       SUM(amount)  AS total
                FROM cash_movements
                WHERE type IN ('cash_in', 'cash_out')
                  AND created_at::date = %s
                GROUP BY type
                """,
                (date,),
            )
            cash_movements = {r["type"]: {"count": r["count"], "total": r["total"]} for r in cur.fetchall()}

            # Refunds
            cur.execute(
                """
                SELECT COUNT(*) AS count, COALESCE(SUM(ABS(amount)), 0) AS total
                FROM payments
                WHERE method LIKE 'refund_%%'
                  AND paid_at::date = %s
                """,
                (date,),
            )
            refunds = dict(cur.fetchone())

    return {
        "date":           date,
        "totals":         totals,
        "by_type":        by_type,
        "by_method":      by_method,
        "cash_movements": cash_movements,
        "refunds":        refunds,
    }
