from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import get_conn, get_cursor

router = APIRouter(prefix="/api/till", tags=["till"])


class TillOpenBody(BaseModel):
    employee_id: str


class TillReassignBody(BaseModel):
    to_employee_id: str


@router.get("/today")
def get_till_today():
    """Check if the till is assigned and open for today."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT ts.id, ts.employee_id, ts.opened_at, ts.closed_at, ts.closed_by,
                       e.employee_name,
                       (SELECT employee_name FROM employees WHERE employee_id = ts.closed_by) AS closed_by_name
                FROM till_sessions ts
                JOIN employees e ON e.employee_id = ts.employee_id
                WHERE ts.opened_at::date = CURRENT_DATE
                ORDER BY ts.opened_at DESC LIMIT 1
                """
            )
            row = cur.fetchone()

    if not row:
        return {"assigned": False}

    result = {
        "assigned":      True,
        "employee_id":   row["employee_id"],
        "employee_name": row["employee_name"],
        "opened_at":     row["opened_at"].isoformat(),
        "closed":        row["closed_at"] is not None,
    }
    if row["closed_at"]:
        result["closed_at"]       = row["closed_at"].isoformat()
        result["closed_by"]       = row["closed_by"]
        result["closed_by_name"]  = row["closed_by_name"] or row["closed_by"]
    return result


@router.post("/open", status_code=201)
def open_till(body: TillOpenBody):
    """Open the till for today. Allowed if no session exists or previous session is closed."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            # Block only if there's an OPEN (not yet closed) session today
            cur.execute(
                "SELECT id FROM till_sessions WHERE opened_at::date = CURRENT_DATE AND closed_at IS NULL"
            )
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="Till is already open for today")

            cur.execute(
                "SELECT employee_name FROM employees WHERE employee_id = %s",
                (body.employee_id,),
            )
            emp = cur.fetchone()
            if not emp:
                raise HTTPException(status_code=404, detail="Employee ID not found")

            # Enforce: employee must be clocked in before opening the till
            cur.execute(
                """
                SELECT id FROM employee_shifts
                WHERE employee_id = %s AND clock_in::date = CURRENT_DATE AND clock_out IS NULL
                """,
                (body.employee_id,),
            )
            if not cur.fetchone():
                raise HTTPException(
                    status_code=400,
                    detail=f"{emp['employee_name']} has not clocked in — please clock in first before opening the till",
                )

            cur.execute(
                "INSERT INTO till_sessions (employee_id, opened_at) VALUES (%s, NOW()) RETURNING id, opened_at",
                (body.employee_id,),
            )
            row = cur.fetchone()

    return {
        "ok":            True,
        "employee_name": emp["employee_name"],
        "opened_at":     row["opened_at"].isoformat(),
    }


@router.post("/reassign")
def reassign_till(body: TillReassignBody):
    """Transfer the open till to another employee who is clocked in."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            # Must have an open session today
            cur.execute(
                "SELECT id FROM till_sessions WHERE opened_at::date = CURRENT_DATE AND closed_at IS NULL"
            )
            session = cur.fetchone()
            if not session:
                raise HTTPException(status_code=400, detail="No open till session to reassign")

            # New employee must exist
            cur.execute(
                "SELECT employee_name FROM employees WHERE employee_id = %s",
                (body.to_employee_id,),
            )
            emp = cur.fetchone()
            if not emp:
                raise HTTPException(status_code=404, detail="Employee ID not found")

            # New employee must be clocked in
            cur.execute(
                """
                SELECT id FROM employee_shifts
                WHERE employee_id = %s AND clock_in::date = CURRENT_DATE AND clock_out IS NULL
                """,
                (body.to_employee_id,),
            )
            if not cur.fetchone():
                raise HTTPException(
                    status_code=400,
                    detail=f"{emp['employee_name']} is not clocked in — they must clock in before the till can be reassigned to them",
                )

            cur.execute(
                "UPDATE till_sessions SET employee_id = %s WHERE id = %s",
                (body.to_employee_id, session["id"]),
            )

    return {"ok": True, "employee_name": emp["employee_name"]}
