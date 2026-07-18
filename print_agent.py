"""
Rustic Pizza — Local Kitchen Print Agent

Run this script on the restaurant PC that has the kitchen printer connected.
It polls Railway every 5 seconds for new orders and prints kitchen tickets locally.

Usage:
    python print_agent.py

Requirements:
    pip install requests python-escpos

Configuration: edit the three variables below.
"""

import time
import requests
from escpos.printer import Network

# ── Configure these ───────────────────────────────────────────
RAILWAY_URL  = "https://your-app-name.railway.app"   # your Railway public URL
PRINTER_IP   = "192.168.1.100"                        # kitchen printer IP on local network
POLL_SECONDS = 5
# ─────────────────────────────────────────────────────────────


def format_config(cfg):
    if not cfg:
        return []
    lines = []
    if cfg.get("sauce"):
        lines.append(f"  Sauce: {cfg['sauce']}")
    if cfg.get("toppings"):
        lines.append(f"  Toppings: {', '.join(cfg['toppings'])}")
    if cfg.get("cheese") and cfg["cheese"] != "regular":
        lines.append(f"  Cheese: {cfg['cheese']}")
    return lines


def print_ticket(order):
    p = Network(PRINTER_IP)

    p.set(align="center", bold=True, double_height=True, double_width=True)
    p.text(f"ORDER #{order['id']}\n")

    type_label = {"dine_in": "DINE IN", "carry_out": "CARRY OUT", "delivery": "DELIVERY"}.get(
        order["order_type"], order["order_type"].upper()
    )
    p.set(align="center", bold=True, double_height=False, double_width=False)
    p.text(f"{type_label}\n")
    p.text("--------------------------------\n")

    p.set(align="left", bold=False)
    for item in order["items"]:
        size = f" ({item['size'].upper()})" if item.get("size") else ""
        p.set(bold=True)
        p.text(f"  {item['quantity']}x {item['name_snapshot']}{size}\n")
        p.set(bold=False)

        if item.get("is_half_half"):
            left  = item.get("left_config")  or {}
            right = item.get("right_config") or {}
            p.text("  LEFT HALF:\n")
            for l in format_config(left):
                p.text(f"{l}\n")
            p.text("  RIGHT HALF:\n")
            for l in format_config(right):
                p.text(f"{l}\n")
        else:
            for l in format_config(item.get("whole_config")):
                p.text(f"{l}\n")

        if item.get("notes"):
            p.text(f"  ** {item['notes']} **\n")

    p.text("--------------------------------\n")
    p.set(align="center")
    p.text(f"{order['created_at'][11:16]}\n")  # HH:MM
    p.cut()
    p.close()


def main():
    print(f"Print agent started. Polling {RAILWAY_URL} every {POLL_SECONDS}s")
    print(f"Printer: {PRINTER_IP}")
    print("Press Ctrl+C to stop.\n")

    while True:
        try:
            res = requests.get(f"{RAILWAY_URL}/api/orders/print-queue", timeout=10)
            res.raise_for_status()
            orders = res.json().get("orders", [])

            for order in orders:
                try:
                    print_ticket(order)
                    requests.post(
                        f"{RAILWAY_URL}/api/orders/{order['id']}/mark-printed",
                        timeout=10,
                    )
                    print(f"  Printed order #{order['id']}")
                except Exception as e:
                    print(f"  Printer error on order #{order['id']}: {e}")

        except Exception as e:
            print(f"Poll error: {e}")

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
