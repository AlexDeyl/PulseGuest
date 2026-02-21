from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.public import router as public_router
from app.api.v1.admin import router as admin_router
from app.api.v1.users_admin import router as admin_users_router
from app.api.v1.stats import router as stats_router


api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(public_router, prefix="/public", tags=["public"])
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_users_router, prefix="/admin", tags=["admin"])
api_router.include_router(stats_router, prefix="/stats", tags=["stats"])
