"""
Printer logic for customer receipt and kitchen ticket.

Set PRINTER_TEST_MODE=true in .env to write output to
backend/test_prints/ as .txt files instead of the real printer.
"""

import os
from datetime import datetime

from dotenv import load_dotenv

load_dotenv()

PRINTER_IP         = os.environ.get("PRINTER_IP", "192.168.1.100")
KITCHEN_PRINTER_IP = os.environ.get("KITCHEN_PRINTER_IP", "192.168.1.101")
TEST_MODE          = os.environ.get("PRINTER_TEST_MODE", "true").lower() == "true"
TEST_DIR           = os.path.join(os.path.dirname(__file__), "test_prints")


# ── Public API ────────────────────────────────────────────────

def print_kitchen_ticket(order: dict, items: list):
    lines = _kitchen_lines(order, items)
    _output(lines, f"kitchen_order_{order['id']}.txt", KITCHEN_PRINTER_IP)


def print_receipt(order: dict, items: list):
    lines = _receipt_lines(order, items)
    _output(lines, f"receipt_order_{order['id']}.txt", PRINTER_IP)


def print_cash_receipt(movement: dict):
    lines = _cash_receipt_lines(movement)
    _output(lines, f"cash_{movement.get('type','mv')}_{movement['id']}.txt", PRINTER_IP)


# ── Output router ─────────────────────────────────────────────

def _output(lines: list, filename: str, ip: str):
    if TEST_MODE:
        _write_test_file(filename, lines)
    else:
        _send_to_printer(ip, lines)


def _write_test_file(filename: str, lines: list):
    os.makedirs(TEST_DIR, exist_ok=True)
    path = os.path.join(TEST_DIR, filename)
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"[TEST PRINT — {timestamp}]\n")
        f.write("\n".join(lines))
        f.write("\n")

    print(f"\n{'='*40}")
    print(f"[PRINTER TEST]  {filename}  ({timestamp})")
    print('='*40)
    for line in lines:
        print(line)
    print('='*40 + "\n")


def _send_to_printer(ip: str, lines: list):
    try:
        from escpos.printer import Network
        p = Network(ip)
        for line in lines:
            p.text(line + "\n")
        p.cut()
    except Exception as e:
        print(f"[printer] error ({ip}): {e}")


# ── Cash movement receipt lines ───────────────────────────────

def _cash_receipt_lines(movement: dict) -> list:
    w = "================================"
    mtype = movement.get("type", "")
    titles = {"cash_in": "CASH IN", "cash_out": "CASH OUT", "count": "TILL COUNT"}
    title  = titles.get(mtype, mtype.upper())
    amount = movement.get("amount", 0)
    now_str = datetime.now().strftime("%b %d, %Y  %I:%M %p")

    lines = [w, "         Rustic Pizza", "  21 South Main St, Sherborn MA", "         508-655-6900", w, "", f"       {title}", ""]

    if mtype == "count":
        expected   = movement.get("expected") or 0
        difference = amount - expected
        diff_str   = f"+${difference/100:.2f}" if difference >= 0 else f"-${abs(difference)/100:.2f}"
        lines += [
            f"Counted:        ${amount/100:.2f}",
            f"Expected:       ${expected/100:.2f}",
            f"Difference:     {diff_str}",
        ]
    else:
        sign = "+" if mtype == "cash_in" else "-"
        lines += [f"Amount:         {sign}${amount/100:.2f}"]
        if movement.get("notes"):
            lines += [f"Reason:         {movement['notes']}"]

    lines += ["", f"Time: {now_str}", "", w]
    return lines


# ── Receipt lines ─────────────────────────────────────────────

def _receipt_lines(order: dict, items: list) -> list:
    w = "================================"
    is_refund = order.get("status") == "refunded"
    lines = [
        w,
        "         Rustic Pizza",
        "  21 South Main St, Sherborn MA",
        "         508-655-6900",
        w,
    ]
    if is_refund:
        lines += ["", "      ** REFUND RECEIPT **", ""]
    lines += [
        f"Order #{order['id']}   {_type_label(order)}",
        "",
    ]
    for item in items:
        sz = f" ({item['size']})" if item.get("size") else ""
        lines.append(f"{item.get('quantity', 1)}x {item['name_snapshot']}{sz}")
        if item.get("is_half_half"):
            lines.append(f"   LEFT:  {_cfg(item.get('left_config'))}")
            lines.append(f"   RIGHT: {_cfg(item.get('right_config'))}")
        else:
            c = _cfg(item.get("whole_config"))
            if c:
                lines.append(f"   {c}")
        if item.get("notes"):
            lines.append(f"   ** {item['notes']}")
        price = item.get("item_price", 0) * item.get("quantity", 1)
        lines.append(f"                         ${price/100:.2f}")

    total_line = (
        f"REFUNDED:            -${order.get('total', 0)/100:.2f}"
        if is_refund else
        f"TOTAL:                ${order.get('total', 0)/100:.2f}"
    )
    lines += [
        "--------------------------------",
        f"Subtotal:             ${order.get('subtotal', 0)/100:.2f}",
        f"Tax (6.25%):          ${order.get('tax', 0)/100:.2f}",
        total_line,
        "--------------------------------",
        "",
        "        Thank you!",
        "    rusticpizzaus.com",
        "",
        w,
    ]
    return lines


# ── Kitchen ticket lines ──────────────────────────────────────

def _kitchen_lines(order: dict, items: list) -> list:
    w = "================================"
    lines = [
        w,
        f"  ORDER #{order['id']}",
        f"  {_type_label(order).upper()}",
        w,
        "",
    ]
    for item in items:
        sz = f" ({item['size'].upper()})" if item.get("size") else ""
        qty = item.get("quantity", 1)
        lines.append(f">>> {qty}x {item['name_snapshot']}{sz}")
        if item.get("is_half_half"):
            lines.append(f"    LEFT:  {_cfg(item.get('left_config'))}")
            lines.append(f"    RIGHT: {_cfg(item.get('right_config'))}")
        else:
            c = _cfg(item.get("whole_config"))
            if c:
                lines.append(f"    {c}")
        if item.get("notes"):
            lines.append(f"    ** SPECIAL: {item['notes']}")
        lines.append("")

    lines.append(w)
    if order.get("customer_notes"):
        lines.append(f"NOTE: {order['customer_notes']}")
        lines.append(w)
    return lines


# ── Helpers ───────────────────────────────────────────────────

def _type_label(order: dict) -> str:
    return {"carry_out": "Carry Out", "dine_in": "Dine In", "delivery": "Delivery"}.get(
        order.get("order_type", ""), order.get("order_type", "")
    )


# Simple in-process caches — populated on first print, valid for the server lifetime.
_modifier_names: dict[int, str] = {}   # modifier id -> name
_preset_names:   dict[int, str] = {}   # menu_item id -> name (gourmet presets only)


def _ensure_caches():
    if _modifier_names and _preset_names:
        return
    from database import get_conn, get_cursor
    with get_conn() as conn:
        with get_cursor(conn) as cur:
            if not _modifier_names:
                cur.execute("SELECT id, name FROM modifiers WHERE is_active = TRUE")
                for row in cur.fetchall():
                    _modifier_names[row["id"]] = row["name"]
            if not _preset_names:
                cur.execute(
                    "SELECT id, name FROM menu_items WHERE is_gourmet_preset = TRUE AND is_active = TRUE"
                )
                for row in cur.fetchall():
                    _preset_names[row["id"]] = row["name"]


def _cfg(cfg) -> str:
    if not cfg:
        return ""
    _ensure_caches()
    parts = []
    if cfg.get("preset_id"):
        name = _preset_names.get(cfg["preset_id"], f"Preset #{cfg['preset_id']}")
        parts.append(name)
    if cfg.get("toppings"):
        names = [_modifier_names.get(t, f"#{t}") for t in cfg["toppings"]]
        parts.append(", ".join(names))
    if cfg.get("sauce"):
        parts.append(cfg["sauce"])
    return ", ".join(parts) or "Plain"
