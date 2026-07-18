import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routes import menu, orders, payments, owner, test, cash
from websocket import kitchen_manager

app = FastAPI(title="Rustic Pizza POS", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(menu.router)
app.include_router(orders.router)
app.include_router(payments.router)
app.include_router(owner.router)
app.include_router(test.router)
app.include_router(cash.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.websocket("/ws/kitchen")
async def kitchen_ws(ws: WebSocket):
    await kitchen_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keep connection alive; kitchen screen is read-only
    except WebSocketDisconnect:
        kitchen_manager.disconnect(ws)


# Serve frontend static files — must be last so API routes take priority
_frontend_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend')
if os.path.isdir(_frontend_dir):
    app.mount('/', StaticFiles(directory=_frontend_dir, html=True), name='frontend')
