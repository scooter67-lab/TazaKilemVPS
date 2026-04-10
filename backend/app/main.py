from datetime import date

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from .auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)
from .crud import (
    active_shifts_dashboard,
    close_shift,
    create_carpet,
    delete_shift_admin,
    create_request,
    create_user,
    find_user_for_login,
    delete_user_admin,
    delete_carpet,
    delete_request,
    list_journals,
    list_requests,
    list_stats_requests,
    open_shift,
    request_to_out,
    stats,
    get_timezone,
    set_timezone,
    update_carpet,
    update_request,
    update_user,
)
from .config import settings
from .database import Base, SessionLocal, engine, get_db, migrate_schema
from .deps import admin_required, get_current_user, reject_monitoring
from .models import AppSetting, Role, Shift, User
from .schemas import (
    ActiveShiftDashboardRow,
    CarpetCreate,
    CarpetOut,
    CarpetUpdate,
    JournalOut,
    LoginInput,
    RefreshInput,
    RequestCreate,
    SettingsOut,
    SettingsPatch,
    RequestOut,
    RequestStatRow,
    RequestUpdate,
    ShiftAdminOut,
    ShiftOut,
    TokenPair,
    UserCreate,
    UserOut,
    UserUpdate,
)


if settings.is_production and settings.secret_key.strip() in ("", "change_me"):
    raise RuntimeError(
        "В production задайте уникальный SECRET_KEY в .env (не используйте значение по умолчанию)."
    )

Base.metadata.create_all(bind=engine)
migrate_schema()

_cors = settings.cors_allow_origins()
_allow_credentials = _cors != ["*"]

app = FastAPI(
    title="Carpet Journal API",
    docs_url="/docs" if not settings.is_production else None,
    redoc_url="/redoc" if not settings.is_production else None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Проверка живости процесса и конфигурации (без БД — для балансировщика)."""
    return {"status": "ok", "environment": settings.environment}


def _ensure_admin_login(db: Session, admin_role: Role) -> None:
    """
    Пользователь с логином admin (без учёта регистра): активность, роль Admin, пароль admin123
    если хеш не совпадает (другой алгоритм / битые данные). В production сброс только при
    RESET_ADMIN_PASSWORD=true.
    """
    u = db.scalars(
        select(User).where(func.lower(User.username) == "admin").order_by(User.id)
    ).first()
    if u is None:
        return
    try:
        password_ok = verify_password("admin123", u.password_hash)
    except (ValueError, TypeError, Exception):
        password_ok = False
    if not password_ok:
        if settings.is_production and not settings.reset_admin_password:
            return
        u.password_hash = get_password_hash("admin123")
    u.role = "Admin"
    u.role_id = admin_role.id
    u.is_active = True
    db.commit()


@app.on_event("startup")
def seed_roles():
    db = SessionLocal()
    try:
        for role_name in ("Admin", "User", "Monitoring"):
            role_exists = db.execute(select(Role).where(Role.name == role_name)).scalar_one_or_none()
            if role_exists is None:
                db.add(Role(name=role_name))
        db.commit()

        admin_role = db.execute(select(Role).where(Role.name == "Admin")).scalar_one()
        admin_by_name = db.execute(select(User).where(User.username == "admin")).scalar_one_or_none()
        if admin_by_name is None:
            db.add(
                User(
                    username="admin",
                    password_hash=get_password_hash("admin123"),
                    role="Admin",
                    role_id=admin_role.id,
                    is_active=True,
                )
            )
            db.commit()

        # Ни одного пользователя с ролью Admin (например удалили единственного) — восстанавливаем вход
        admin_cnt = db.scalar(select(func.count()).select_from(User).where(User.role == "Admin"))
        if (admin_cnt or 0) == 0:
            u = db.execute(select(User).where(User.username == "admin")).scalar_one_or_none()
            if u is not None:
                u.role = "Admin"
                u.role_id = admin_role.id
                u.is_active = True
            else:
                db.add(
                    User(
                        username="admin",
                        password_hash=get_password_hash("admin123"),
                        role="Admin",
                        role_id=admin_role.id,
                        is_active=True,
                    )
                )
            db.commit()

        tz_row = db.execute(select(AppSetting).where(AppSetting.key == "timezone")).scalar_one_or_none()
        if tz_row is None:
            db.add(AppSetting(key="timezone", value="UTC"))
            db.commit()

        _ensure_admin_login(db, admin_role)
    finally:
        db.close()


@app.post("/login", response_model=TokenPair)
def login(payload: LoginInput, db: Session = Depends(get_db)):
    user = find_user_for_login(db, payload.username)
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Учётная запись отключена. Обратитесь к администратору.")
    return TokenPair(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id, user.role),
    )


@app.post("/refresh", response_model=TokenPair)
def refresh(payload: RefreshInput, db: Session = Depends(get_db)):
    try:
        data = decode_token(payload.refresh_token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Refresh-токен недействителен или истёк") from None
    if data.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user_id = int(data["sub"])
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Сессия недействительна (учётная запись отключена)")
    role = user.role
    return TokenPair(
        access_token=create_access_token(user_id, role),
        refresh_token=create_refresh_token(user_id, role),
    )


@app.get("/users", response_model=list[UserOut], dependencies=[Depends(admin_required)])
def users(db: Session = Depends(get_db)):
    rows = db.execute(select(User).order_by(User.id.desc())).scalars().all()
    return [UserOut.model_validate(u) for u in rows]


@app.post("/users", response_model=UserOut, dependencies=[Depends(admin_required)])
def users_create(payload: UserCreate, db: Session = Depends(get_db)):
    return UserOut.model_validate(create_user(db, payload))


@app.patch("/users/{user_id}", response_model=UserOut)
def users_patch(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(admin_required),
):
    return UserOut.model_validate(update_user(db, user_id, payload, acting_admin_id=admin.id))


@app.delete("/users/{user_id}")
def users_delete(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(admin_required),
):
    delete_user_admin(db, user_id, acting_admin_id=admin.id)
    return {"ok": True}


@app.post("/shifts/open", response_model=ShiftOut)
def shifts_open(
    db: Session = Depends(get_db), current_user: User = Depends(reject_monitoring)
):
    return ShiftOut.model_validate(open_shift(db, current_user))


@app.post("/shifts/close", response_model=ShiftOut)
def shifts_close(
    db: Session = Depends(get_db), current_user: User = Depends(reject_monitoring)
):
    return ShiftOut.model_validate(close_shift(db, current_user))


@app.get("/shifts/current", response_model=ShiftOut | None)
def shifts_current(db: Session = Depends(get_db), current_user: User = Depends(reject_monitoring)):
    s = db.scalars(
        select(Shift)
        .options(joinedload(Shift.user))
        .where(Shift.user_id == current_user.id, Shift.status == "active")
    ).first()
    return ShiftOut.model_validate(s) if s else None


@app.get("/shifts/active-dashboard", response_model=list[ActiveShiftDashboardRow])
def shifts_active_dashboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return active_shifts_dashboard(db, current_user)


@app.get("/shifts", response_model=list[ShiftAdminOut], dependencies=[Depends(admin_required)])
def shifts_all(db: Session = Depends(get_db)):
    rows = (
        db.execute(
            select(Shift)
            .options(joinedload(Shift.user), joinedload(Shift.closed_by_user))
            .order_by(Shift.id.desc())
        )
        .unique()
        .scalars()
        .all()
    )
    return [
        ShiftAdminOut(
            id=s.id,
            user_id=s.user_id,
            employee_username=s.user.username,
            opened_at=s.opened_at,
            closed_at=s.closed_at,
            status=s.status,
            closed_by_id=s.closed_by_id,
            closed_by_username=s.closed_by_user.username if s.closed_by_user else None,
        )
        for s in rows
    ]


@app.delete("/shifts/{shift_id}", dependencies=[Depends(admin_required)])
def shifts_delete(shift_id: int, db: Session = Depends(get_db)):
    delete_shift_admin(db, shift_id)
    return {"ok": True}


@app.post("/requests", response_model=RequestOut)
def requests_create(
    payload: RequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(reject_monitoring),
):
    req = create_request(db, current_user, payload)
    return RequestOut(
        id=req.id,
        shift_id=req.shift_id,
        request_number=req.request_number,
        carpets=[],
        total_area=0.0,
    )


@app.get("/requests/{shift_id}", response_model=list[RequestOut])
def requests_list(
    shift_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(reject_monitoring),
):
    shift = db.get(Shift, shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    if shift.user_id != current_user.id and current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="No access to this shift")
    return list_requests(db, shift_id)


@app.delete("/requests/{request_id}")
def requests_delete(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(reject_monitoring),
):
    delete_request(db, current_user, request_id)
    return {"ok": True}


@app.patch("/requests/{request_id}", response_model=RequestOut)
def requests_patch(
    request_id: int,
    payload: RequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(reject_monitoring),
):
    req = update_request(db, current_user, request_id, payload)
    return request_to_out(req)


@app.post("/carpets", response_model=CarpetOut)
def carpets_create(
    payload: CarpetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(reject_monitoring),
):
    return CarpetOut.model_validate(create_carpet(db, current_user, payload))


@app.patch("/carpets/{carpet_id}", response_model=CarpetOut)
def carpets_patch(
    carpet_id: int,
    payload: CarpetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(reject_monitoring),
):
    return CarpetOut.model_validate(update_carpet(db, current_user, carpet_id, payload))


@app.delete("/carpets/{carpet_id}")
def carpets_delete(
    carpet_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(reject_monitoring),
):
    delete_carpet(db, current_user, carpet_id)
    return {"ok": True}


@app.get("/journals", response_model=list[JournalOut])
def journals(db: Session = Depends(get_db), current_user: User = Depends(reject_monitoring)):
    return list_journals(db, current_user)


@app.patch("/journals/{shift_id}", dependencies=[Depends(admin_required)])
def journals_patch(
    shift_id: int,
    payload: dict,
    db: Session = Depends(get_db),
):
    shift = db.get(Shift, shift_id)
    if not shift or shift.status != "closed":
        raise HTTPException(status_code=404, detail="Closed shift not found")
    if "closed_at" in payload:
        shift.closed_at = payload["closed_at"]
    db.commit()
    return {"ok": True}


@app.get("/stats", dependencies=[Depends(admin_required)])
def get_stats(
    db: Session = Depends(get_db),
    user_id: int | None = Query(None, ge=1, description="Фильтр по сотруднику (user id)"),
    date_from: date | None = Query(None, description="Начало периода по UTC, включительно"),
    date_to: date | None = Query(None, description="Конец периода по UTC, включительно"),
):
    return stats(db, user_id=user_id, date_from=date_from, date_to=date_to)


@app.get("/stats/requests", response_model=list[RequestStatRow], dependencies=[Depends(admin_required)])
def get_stats_requests(
    db: Session = Depends(get_db),
    user_id: int | None = Query(None, ge=1, description="Фильтр по сотруднику (user id)"),
    date_from: date | None = Query(None, description="Начало периода по UTC, включительно"),
    date_to: date | None = Query(None, description="Конец периода по UTC, включительно"),
):
    return list_stats_requests(db, user_id=user_id, date_from=date_from, date_to=date_to)


@app.get("/settings", response_model=SettingsOut)
def read_settings(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return SettingsOut(timezone=get_timezone(db))


@app.patch("/settings", response_model=SettingsOut, dependencies=[Depends(admin_required)])
def patch_settings(payload: SettingsPatch, db: Session = Depends(get_db)):
    return SettingsOut(timezone=set_timezone(db, payload.timezone))
