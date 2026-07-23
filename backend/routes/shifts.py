from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import get_conn, get_cursor

router = APIRouter(prefix="/api/shifts", tags=["shifts"])


class ClockInBody(BaseModel):
    employee_id: str


class ClockOutBody(BaseModel):
    employee_id: str


@router.post("/clockin", status_code=201)
def clock_in(body: ClockInBody):
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT employee_name FROM employees WHERE employee_id = %s",
                (body.employee_id,),
            )
            emp = cur.fetchone()
            if not emp:
                raise HTTPException(status_code=404, detail="Employee ID not found")

            cur.execute(
                """
                SELECT id FROM employee_shifts
                WHERE employee_id = %s AND clock_out IS NULL
                  AND clock_in::date = CURRENT_DATE
                """,
                (body.employee_id,),
            )
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="Already clocked in today")

            cur.execute(
                """
                INSERT INTO employee_shifts (employee_id, employee_name, clock_in)
                VALUES (%s, %s, NOW()) RETURNING id, clock_in
                """,
                (body.employee_id, emp["employee_name"]),
            )
            row = cur.fetchone()

    return {
        "ok": True,
        "id": row["id"],
        "employee_name": emp["employee_name"],
        "clock_in": row["clock_in"].isoformat(),
    }


@router.post("/clockout")
def clock_out(body: ClockOutBody):
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id, employee_name, clock_in FROM employee_shifts
                WHERE employee_id = %s AND clock_out IS NULL
                ORDER BY clock_in DESC LIMIT 1
                """,
                (body.employee_id,),
            )
            shift = cur.fetchone()
            if not shift:
                raise HTTPException(status_code=404, detail="No open shift found for this employee")

            cur.execute(
                "UPDATE employee_shifts SET clock_out = NOW() WHERE id = %s RETURNING clock_out",
                (shift["id"],),
            )
            row         = cur.fetchone()
            clock_out   = row["clock_out"]
            hours       = (clock_out - shift["clock_in"]).total_seconds() / 3600

    return {
        "ok": True,
        "employee_name": shift["employee_name"],
        "hours_worked": round(hours, 2),
        "clock_out": clock_out.isoformat(),
    }


@router.get("/today")
def get_shifts_today():
    """All shifts for today — includes who is currently clocked in."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id, employee_id, employee_name, clock_in, clock_out
                FROM employee_shifts
                WHERE clock_in::date = CURRENT_DATE
                ORDER BY clock_in DESC
                """
            )
            rows = cur.fetchall()
    result = []
    for r in rows:
        d          = dict(r)
        ci         = d["clock_in"]
        co         = d["clock_out"]
        d["hours_worked"]  = round((co - ci).total_seconds() / 3600, 2) if co else None
        d["clock_in"]      = ci.isoformat()
        d["clock_out"]     = co.isoformat() if co else None
        d["is_clocked_in"] = co is None
        result.append(d)
    return result


@router.get("")
def get_shifts(start: str, end: str):
    """Shifts between start and end (YYYY-MM-DD inclusive)."""
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id, employee_id, employee_name, clock_in, clock_out
                FROM employee_shifts
                WHERE clock_in::date >= %s AND clock_in::date <= %s
                ORDER BY clock_in DESC
                """,
                (start, end),
            )
            rows = cur.fetchall()

    result = []
    for r in rows:
        d = dict(r)
        ci = d["clock_in"]
        co = d["clock_out"]
        d["hours_worked"] = round((co - ci).total_seconds() / 3600, 2) if co else None
        d["clock_in"]  = ci.isoformat()
        d["clock_out"] = co.isoformat() if co else None
        result.append(d)
    return result
