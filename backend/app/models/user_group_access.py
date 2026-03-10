from sqlalchemy import ForeignKey, Boolean, UniqueConstraint, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class UserGroupAccess(Base):
    __tablename__ = "user_group_access"
    __table_args__ = (
        UniqueConstraint("user_id", "organization_id", "group_key", name="uq_user_org_group"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    group_key: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    user = relationship("User", back_populates="groups_access")
    organization = relationship("Organization")
