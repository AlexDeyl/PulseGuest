import enum


class Role(str, enum.Enum):
    # New RBAC roles (2026-02)
    admin = "admin"
    ops_director = "ops_director"
    service_manager = "service_manager"
    auditor = "auditor"

    # Legacy roles (kept for backward compatibility during migration)
    director = "director"
    manager = "manager"
    auditor_global = "auditor_global"
    employee = "employee"
    super_admin = "super_admin"
