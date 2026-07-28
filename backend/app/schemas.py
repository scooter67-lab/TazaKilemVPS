from datetime import datetime

from pydantic import BaseModel, Field


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginInput(BaseModel):
    username: str
    password: str


class RefreshInput(BaseModel):
    refresh_token: str


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "User"


class UserUpdate(BaseModel):
    role: str | None = None
    password: str | None = None
    is_active: bool | None = None


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool

    class Config:
        from_attributes = True


class SettingsOut(BaseModel):
    timezone: str


class SettingsPatch(BaseModel):
    timezone: str


class ShiftOut(BaseModel):
    id: int
    user_id: int
    employee_username: str
    opened_at: datetime
    closed_at: datetime | None
    status: str
    closed_by_id: int | None = None

    class Config:
        from_attributes = True


class ShiftAdminOut(BaseModel):
    id: int
    user_id: int
    employee_username: str
    opened_at: datetime
    closed_at: datetime | None
    status: str
    closed_by_id: int | None = None
    closed_by_username: str | None = None


class ActiveShiftDashboardRow(BaseModel):
    """Активная смена для дашборда (площадь пересчитывается на сервере)."""

    id: int
    employee_username: str
    opened_at: datetime
    requests_count: int
    carpets_count: int
    total_area: float


class CarpetCreate(BaseModel):
    request_id: int
    length: float = Field(gt=0)
    width: float = Field(gt=0)


class CarpetUpdate(BaseModel):
    length: float | None = Field(default=None, gt=0)
    width: float | None = Field(default=None, gt=0)


class CarpetOut(BaseModel):
    id: int
    request_id: int
    length: float
    width: float
    area: float

    class Config:
        from_attributes = True


class RequestCreate(BaseModel):
    shift_id: int
    request_number: str


class RequestUpdate(BaseModel):
    request_number: str


class RequestOut(BaseModel):
    id: int
    shift_id: int
    request_number: str
    carpets: list[CarpetOut] = []
    total_area: float = 0

    class Config:
        from_attributes = True


class RequestStatRow(BaseModel):
    """Заявка в разрезе статистики (админ)."""

    id: int
    request_number: str
    shift_id: int
    employee_username: str
    shift_opened_at: datetime
    shift_closed_at: datetime | None
    shift_status: str
    carpets_count: int
    total_area: float


class JournalPatch(BaseModel):
    """Админская правка закрытой смены."""

    closed_at: datetime


class JournalOut(BaseModel):
    shift_id: int
    user: str
    date: datetime
    requests: list[RequestOut]
    total_area: float
