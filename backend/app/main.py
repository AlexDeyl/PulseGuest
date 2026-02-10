from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.router import api_router
from app.admin import init_admin, init_demo_admin_login


app = FastAPI(
    title="PulseGuest API",
    version="0.1.0",
    description="Backend for PulseGuest (survey widget + analytics + admin).",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.ENV}


# --- Admin UI ---
init_admin(app)
init_demo_admin_login(app)


# --- API ---
app.include_router(api_router, prefix="/api")
