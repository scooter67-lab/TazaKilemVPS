from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    users: Mapped[list["User"]] = relationship("User", back_populates="role_rel")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="User", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id"), nullable=True)

    role_rel: Mapped["Role"] = relationship("Role", back_populates="users")
    shifts: Mapped[list["Shift"]] = relationship(
        "Shift", foreign_keys="Shift.user_id", back_populates="user"
    )
    shifts_closed: Mapped[list["Shift"]] = relationship(
        "Shift", foreign_keys="Shift.closed_by_id", back_populates="closed_by_user"
    )


class Shift(Base):
    __tablename__ = "shifts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    closed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)

    user: Mapped["User"] = relationship("User", foreign_keys="Shift.user_id", back_populates="shifts")
    closed_by_user: Mapped["User | None"] = relationship(
        "User", foreign_keys="Shift.closed_by_id", back_populates="shifts_closed"
    )
    requests: Mapped[list["Request"]] = relationship(
        "Request", back_populates="shift", cascade="all, delete-orphan"
    )

    @property
    def employee_username(self) -> str:
        return self.user.username


class Request(Base):
    __tablename__ = "requests"
    __table_args__ = (
        UniqueConstraint("shift_id", "request_number", name="uq_requests_shift_request_number"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    shift_id: Mapped[int] = mapped_column(ForeignKey("shifts.id"), nullable=False)
    request_number: Mapped[str] = mapped_column(String(100), nullable=False)

    shift: Mapped["Shift"] = relationship("Shift", back_populates="requests")
    carpets: Mapped[list["Carpet"]] = relationship(
        "Carpet", back_populates="request", cascade="all, delete-orphan"
    )


class Carpet(Base):
    __tablename__ = "carpets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("requests.id"), nullable=False)
    length: Mapped[float] = mapped_column(Float, nullable=False)
    width: Mapped[float] = mapped_column(Float, nullable=False)
    area: Mapped[float] = mapped_column(Float, nullable=False)

    request: Mapped["Request"] = relationship("Request", back_populates="carpets")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(String(200), nullable=False)
