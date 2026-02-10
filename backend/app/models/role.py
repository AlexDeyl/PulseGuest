import enum


class Role(str, enum.Enum):
    employee = "employee"
    manager = "manager"
    service_manager = "service_manager"
    director = "director"
    auditor_global = "auditor_global"
    auditor = "auditor"
