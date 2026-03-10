from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.public import router as public_router
from app.api.v1.password_reset import router as password_reset_router
from app.api.v1.admin import router as admin_router
from app.api.v1.users_admin import router as admin_users_router
from app.api.v1.stats import router as stats_router
from app.api.v1.audit import router as audit_router
from app.api.v1.audit_import import router as audit_import_router
from app.api.v1.audit_runs import router as audit_runs_router


api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(public_router, prefix="/public", tags=["public"])
api_router.include_router(password_reset_router, prefix="/admin")
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_users_router, prefix="/admin", tags=["admin"])
api_router.include_router(stats_router, prefix="/stats", tags=["stats"])
api_router.include_router(audit_router, prefix="/audit", tags=["audit"])
api_router.include_router(audit_import_router, prefix="/audit", tags=["audit"])
api_router.include_router(audit_runs_router, prefix="/audit", tags=["audit"])
