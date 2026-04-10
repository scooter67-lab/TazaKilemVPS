from datetime import date, datetime, time, timedelta, timezone as dt_timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from .auth import get_password_hash
from .models import AppSetting, Carpet, Request, Role, Shift, User
from .schemas import (
    CarpetCreate,
    CarpetOut,
    CarpetUpdate,
    JournalOut,
    RequestCreate,
    RequestOut,
    RequestUpdate,
    UserCreate,
    UserUpdate,
)


def ensure_shift_editable(shift: Shift, user: User):
    if shift.status == "closed" and user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Closed shift cannot be edited by regular user",
        )


def _validate_stats_period(date_from: date | None, date_to: date | None) -> None:
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(status_code=400, detail="Дата «с» не может быть позже даты «по»")


def _stats_shift_filters(
    user_id: int | None,
    date_from: date | None,
    date_to: date | None,
) -> list:
    """Условия отбора смен для статистики (как в stats())."""
    shift_filters: list = []
    if user_id is not None:
        shift_filters.append(Shift.user_id == user_id)
    if date_from is not None or date_to is not None:
        from_start = (
            datetime.combine(date_from, time.min, tzinfo=dt_timezone.utc) if date_from is not None else None
        )
        to_exclusive = (
            datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=dt_timezone.utc)
            if date_to is not None
            else None
        )
        closed_in_period = Shift.closed_at.is_not(None)
        if from_start is not None:
            closed_in_period = closed_in_period & (Shift.closed_at >= from_start)
        if to_exclusive is not None:
            closed_in_period = closed_in_period & (Shift.closed_at < to_exclusive)
        open_in_period = Shift.closed_at.is_(None)
        if from_start is not None:
            open_in_period = open_in_period & (Shift.opened_at >= from_start)
        if to_exclusive is not None:
            open_in_period = open_in_period & (Shift.opened_at < to_exclusive)
        shift_filters.append(or_(closed_in_period, open_in_period))
    return shift_filters


def normalize_request_number(value: str) -> str:
    return value.strip()


def request_number_taken(
    db: Session, shift_id: int, request_number: str, exclude_request_id: int | None = None
) -> bool:
    q = select(Request.id).where(Request.shift_id == shift_id, Request.request_number == request_number)
    if exclude_request_id is not None:
        q = q.where(Request.id != exclude_request_id)
    return db.execute(q).scalar_one_or_none() is not None


def find_user_for_login(db: Session, username: str) -> User | None:
    """
    Поиск по логину без учёта регистра.
    В SQLite func.lower() работает только для ASCII; для кириллицы «Илья» и «илья»
    в SQL не совпадут, хотя в Python .lower() совпадают — поэтому сравниваем в Python.
    """
    uname = username.strip()
    if not uname:
        return None
    user = db.scalars(select(User).where(User.username == uname)).first()
    if user is not None:
        return user
    key = uname.casefold()
    for candidate in db.scalars(select(User)).all():
        if candidate.username.strip().casefold() == key:
            return candidate
    return None


def create_user(db: Session, payload: UserCreate) -> User:
    uname = payload.username.strip()
    if not uname:
        raise HTTPException(status_code=400, detail="Логин не может быть пустым")
    pw = payload.password.strip()
    if not pw:
        raise HTTPException(status_code=400, detail="Пароль не может быть пустым")

    for row in db.scalars(select(User)).all():
        if row.username.strip().casefold() == uname.casefold():
            raise HTTPException(status_code=400, detail="Username already exists")

    role = db.execute(select(Role).where(Role.name == payload.role)).scalar_one_or_none()
    if not role:
        role = Role(name=payload.role)
        db.add(role)
        db.flush()

    user = User(
        username=uname,
        password_hash=get_password_hash(pw),
        role=payload.role,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, user_id: int, payload: UserUpdate, acting_admin_id: int | None = None) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.is_active is not None:
        if acting_admin_id is not None and user_id == acting_admin_id and payload.is_active is False:
            raise HTTPException(status_code=400, detail="Нельзя уволить самого себя")
        user.is_active = payload.is_active
    if payload.role:
        role = db.execute(select(Role).where(Role.name == payload.role)).scalar_one_or_none()
        if not role:
            role = Role(name=payload.role)
            db.add(role)
            db.flush()
        user.role = payload.role
        user.role_id = role.id
    if payload.password is not None:
        pw = payload.password.strip()
        if not pw:
            raise HTTPException(status_code=400, detail="Пароль не может быть пустым")
        user.password_hash = get_password_hash(pw)
    db.commit()
    db.refresh(user)
    return user


def delete_user_admin(db: Session, user_id: int, acting_admin_id: int) -> None:
    """Удалить пользователя: снимаем ссылки closed_by, удаляем все его смены с заявками и коврами."""
    if user_id == acting_admin_id:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")
    victim = db.get(User, user_id)
    if victim is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if victim.role == "Admin":
        admin_n = db.scalar(select(func.count()).select_from(User).where(User.role == "Admin"))
        if (admin_n or 0) <= 1:
            raise HTTPException(
                status_code=400,
                detail="Нельзя удалить последнего администратора. Сначала назначьте роль Admin другому пользователю.",
            )
    try:
        db.execute(update(Shift).where(Shift.closed_by_id == user_id).values(closed_by_id=None))
        owned_ids = db.execute(select(Shift.id).where(Shift.user_id == user_id)).scalars().all()
        for sid in owned_ids:
            req_subq = select(Request.id).where(Request.shift_id == sid)
            db.execute(delete(Carpet).where(Carpet.request_id.in_(req_subq)))
            db.execute(delete(Request).where(Request.shift_id == sid))
            db.execute(delete(Shift).where(Shift.id == sid))
        # Только Core DELETE — без db.delete(ORM), чтобы не смешивать bulk и каскады сессии
        db.execute(delete(User).where(User.id == user_id))
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Не удалось удалить пользователя: остались связанные данные в БД. Обновите страницу и попробуйте снова.",
        ) from e
    except SQLAlchemyError as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Ошибка базы данных при удалении пользователя.",
        ) from e


def _shift_with_user(db: Session, shift_id: int) -> Shift | None:
    """Смена с eager-loaded user — нужна до закрытия сессии для ShiftOut.employee_username."""
    return db.scalars(
        select(Shift).options(joinedload(Shift.user)).where(Shift.id == shift_id)
    ).first()


def open_shift(db: Session, user: User) -> Shift:
    active = db.scalars(
        select(Shift)
        .options(joinedload(Shift.user))
        .where(Shift.user_id == user.id, Shift.status == "active")
    ).first()
    if active:
        return active
    shift = Shift(user_id=user.id, status="active")
    db.add(shift)
    try:
        db.commit()
        db.refresh(shift)
    except IntegrityError:
        db.rollback()
        active = db.scalars(
            select(Shift)
            .options(joinedload(Shift.user))
            .where(Shift.user_id == user.id, Shift.status == "active")
        ).first()
        if active:
            return active
        raise
    loaded = _shift_with_user(db, shift.id)
    if loaded is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Смена не найдена после сохранения",
        )
    return loaded


def close_shift(db: Session, user: User) -> Shift:
    shift = db.scalars(
        select(Shift)
        .options(joinedload(Shift.user))
        .where(Shift.user_id == user.id, Shift.status == "active")
    ).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Active shift not found")
    shift.status = "closed"
    shift.closed_at = datetime.utcnow()
    shift.closed_by_id = user.id
    db.commit()
    loaded = _shift_with_user(db, shift.id)
    if loaded is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Смена не найдена после закрытия",
        )
    return loaded


def delete_shift_admin(db: Session, shift_id: int) -> None:
    """Удалить смену и все заявки и ковры в ней (вызов только из админ-API)."""
    shift = db.get(Shift, shift_id)
    if shift is None:
        raise HTTPException(status_code=404, detail="Смена не найдена")
    req_subq = select(Request.id).where(Request.shift_id == shift_id)
    db.execute(delete(Carpet).where(Carpet.request_id.in_(req_subq)))
    db.execute(delete(Request).where(Request.shift_id == shift_id))
    db.execute(delete(Shift).where(Shift.id == shift_id))
    db.commit()


def create_request(db: Session, user: User, payload: RequestCreate) -> Request:
    shift = db.get(Shift, payload.shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    if shift.user_id != user.id and user.role != "Admin":
        raise HTTPException(status_code=403, detail="No access to this shift")
    ensure_shift_editable(shift, user)
    num = normalize_request_number(payload.request_number)
    if not num:
        raise HTTPException(status_code=400, detail="Номер заявки не может быть пустым")
    if request_number_taken(db, payload.shift_id, num):
        raise HTTPException(
            status_code=400,
            detail="Такая заявка уже есть. Введите новый номер заявки.",
        )
    req = Request(shift_id=payload.shift_id, request_number=num)
    db.add(req)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Такая заявка уже есть. Введите новый номер заявки.",
        ) from None
    db.refresh(req)
    return req


def update_request(db: Session, user: User, request_id: int, payload: RequestUpdate) -> Request:
    req = db.get(Request, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    shift = db.get(Shift, req.shift_id)
    if shift.user_id != user.id and user.role != "Admin":
        raise HTTPException(status_code=403, detail="No access to this shift")
    ensure_shift_editable(shift, user)
    num = normalize_request_number(payload.request_number)
    if not num:
        raise HTTPException(status_code=400, detail="Номер заявки не может быть пустым")
    if request_number_taken(db, req.shift_id, num, exclude_request_id=req.id):
        raise HTTPException(
            status_code=400,
            detail="Такая заявка уже есть. Введите новый номер заявки.",
        )
    req.request_number = num
    db.commit()
    req = (
        db.execute(select(Request).where(Request.id == req.id).options(joinedload(Request.carpets)))
        .unique()
        .scalar_one()
    )
    return req


def delete_request(db: Session, user: User, request_id: int) -> None:
    req = db.get(Request, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    shift = db.get(Shift, req.shift_id)
    if shift.user_id != user.id and user.role != "Admin":
        raise HTTPException(status_code=403, detail="No access to this shift")
    ensure_shift_editable(shift, user)
    db.delete(req)
    db.commit()


def create_carpet(db: Session, user: User, payload: CarpetCreate) -> Carpet:
    req = db.get(Request, payload.request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    shift = db.get(Shift, req.shift_id)
    if shift.user_id != user.id and user.role != "Admin":
        raise HTTPException(status_code=403, detail="No access to this shift")
    ensure_shift_editable(shift, user)
    carpet = Carpet(
        request_id=payload.request_id,
        length=payload.length,
        width=payload.width,
        area=payload.length * payload.width,
    )
    db.add(carpet)
    db.commit()
    db.refresh(carpet)
    return carpet


def update_carpet(db: Session, user: User, carpet_id: int, payload: CarpetUpdate) -> Carpet:
    carpet = db.get(Carpet, carpet_id)
    if not carpet:
        raise HTTPException(status_code=404, detail="Carpet not found")
    req = db.get(Request, carpet.request_id)
    shift = db.get(Shift, req.shift_id)
    if shift.user_id != user.id and user.role != "Admin":
        raise HTTPException(status_code=403, detail="No access to this shift")
    ensure_shift_editable(shift, user)
    if payload.length is not None:
        carpet.length = payload.length
    if payload.width is not None:
        carpet.width = payload.width
    carpet.area = carpet.length * carpet.width
    db.commit()
    db.refresh(carpet)
    return carpet


def delete_carpet(db: Session, user: User, carpet_id: int):
    carpet = db.get(Carpet, carpet_id)
    if not carpet:
        raise HTTPException(status_code=404, detail="Carpet not found")
    req = db.get(Request, carpet.request_id)
    shift = db.get(Shift, req.shift_id)
    if shift.user_id != user.id and user.role != "Admin":
        raise HTTPException(status_code=403, detail="No access to this shift")
    ensure_shift_editable(shift, user)
    db.delete(carpet)
    db.commit()


def request_to_out(req: Request) -> RequestOut:
    """Pydantic-снимок заявки (без ORM) — нужен до выхода из sync-эндпоинта / другого потока."""
    carpets = [CarpetOut.model_validate(c) for c in req.carpets]
    total = float(sum(c.area for c in carpets))
    return RequestOut(
        id=req.id,
        shift_id=req.shift_id,
        request_number=req.request_number,
        carpets=carpets,
        total_area=total,
    )


def list_requests(db: Session, shift_id: int) -> list[RequestOut]:
    rows = (
        db.execute(
            select(Request)
            .where(Request.shift_id == shift_id)
            .options(joinedload(Request.carpets))
            .order_by(Request.id.desc())
        )
        .unique()
        .scalars()
        .all()
    )
    return [request_to_out(r) for r in rows]


def active_shifts_dashboard(db: Session, user: User) -> list[dict]:
    """Активные смены с площадью ковров: админ и мониторинг — все; сотрудник — только свою."""
    q = select(Shift).where(Shift.status == "active")
    if user.role not in ("Admin", "Monitoring"):
        q = q.where(Shift.user_id == user.id)
    q = q.options(
        joinedload(Shift.user),
        joinedload(Shift.requests).joinedload(Request.carpets),
    ).order_by(Shift.opened_at.desc())
    shifts = db.execute(q).unique().scalars().all()
    rows: list[dict] = []
    for s in shifts:
        reqs = s.requests
        carpets_n = sum(len(r.carpets) for r in reqs)
        total_area = sum(c.area for r in reqs for c in r.carpets)
        rows.append(
            {
                "id": s.id,
                "employee_username": s.user.username,
                "opened_at": s.opened_at,
                "requests_count": len(reqs),
                "carpets_count": carpets_n,
                "total_area": float(total_area),
            }
        )
    return rows


def list_journals(db: Session, user: User) -> list[JournalOut]:
    """Журнал закрытых смен: сотрудник видит только свои; админ — все."""
    q = (
        select(Shift)
        .where(Shift.status == "closed")
        .options(joinedload(Shift.user), joinedload(Shift.requests).joinedload(Request.carpets))
        .order_by(Shift.closed_at.desc())
    )
    if user.role != "Admin":
        q = q.where(Shift.user_id == user.id)
    shifts = db.execute(q).unique().scalars().all()
    result: list[JournalOut] = []
    for shift in shifts:
        ordered_reqs = sorted(shift.requests, key=lambda r: r.id, reverse=True)
        request_rows = [request_to_out(r) for r in ordered_reqs]
        total_area = sum(item.total_area for item in request_rows)
        result.append(
            JournalOut(
                shift_id=shift.id,
                user=shift.user.username,
                date=shift.closed_at or shift.opened_at,
                requests=request_rows,
                total_area=total_area,
            )
        )
    return result


def list_stats_requests(
    db: Session,
    user_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    """Список заявок в рамках тех же фильтров, что и агрегированная статистика."""
    _validate_stats_period(date_from, date_to)
    if user_id is not None and db.get(User, user_id) is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    shift_filters = _stats_shift_filters(user_id, date_from, date_to)
    shift_ids_stmt = select(Shift.id)
    if shift_filters:
        shift_ids_stmt = shift_ids_stmt.where(and_(*shift_filters))
    shift_ids = db.scalars(shift_ids_stmt).all()
    if not shift_ids:
        return []

    reqs = (
        db.scalars(
            select(Request)
            .where(Request.shift_id.in_(shift_ids))
            .options(joinedload(Request.shift).joinedload(Shift.user))
            .order_by(Request.id.desc())
        )
        .unique()
        .all()
    )
    req_ids = [r.id for r in reqs]
    agg: dict[int, tuple[int, float]] = {rid: (0, 0.0) for rid in req_ids}
    if req_ids:
        for rid, cnt, area in db.execute(
            select(
                Carpet.request_id,
                func.count(Carpet.id),
                func.coalesce(func.sum(Carpet.area), 0.0),
            )
            .where(Carpet.request_id.in_(req_ids))
            .group_by(Carpet.request_id)
        ).all():
            agg[int(rid)] = (int(cnt or 0), float(area or 0))

    out: list[dict] = []
    for r in reqs:
        cnt, area = agg[r.id]
        sh = r.shift
        out.append(
            {
                "id": r.id,
                "request_number": r.request_number,
                "shift_id": r.shift_id,
                "employee_username": sh.user.username,
                "shift_opened_at": sh.opened_at,
                "shift_closed_at": sh.closed_at,
                "shift_status": sh.status,
                "carpets_count": cnt,
                "total_area": area,
            }
        )
    return out


def stats(
    db: Session,
    user_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    """
    Статистика по сменам / заявкам / коврам.
    Период (опционально): границы календарных дней в UTC.
    Учитываются закрытые смены с closed_at в интервале и открытые с opened_at в интервале.
    """
    _validate_stats_period(date_from, date_to)

    filter_username: str | None = None
    if user_id is not None:
        fu = db.get(User, user_id)
        if not fu:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        filter_username = fu.username

    shift_filters = _stats_shift_filters(user_id, date_from, date_to)

    join_shift = and_(Shift.user_id == User.id, *shift_filters) if shift_filters else (Shift.user_id == User.id)

    by_user = db.execute(
        select(
            User.username,
            func.count(func.distinct(Shift.id)),
            func.coalesce(func.sum(Carpet.area), 0.0),
        )
        .select_from(User)
        .outerjoin(Shift, join_shift)
        .outerjoin(Request, Request.shift_id == Shift.id)
        .outerjoin(Carpet, Carpet.request_id == Request.id)
        .group_by(User.username)
        .order_by(User.username)
    ).all()

    shift_ids_stmt = select(Shift.id)
    if shift_filters:
        shift_ids_stmt = shift_ids_stmt.where(and_(*shift_filters))

    total_requests = db.execute(
        select(func.count(Request.id)).where(Request.shift_id.in_(shift_ids_stmt))
    ).scalar_one()

    total_area = db.execute(
        select(func.coalesce(func.sum(Carpet.area), 0.0))
        .select_from(Carpet)
        .join(Request, Carpet.request_id == Request.id)
        .where(Request.shift_id.in_(shift_ids_stmt))
    ).scalar_one()

    employees = [
        {"username": row[0], "shifts": int(row[1] or 0), "area": float(row[2] or 0)} for row in by_user
    ]
    if filter_username is not None:
        employees = [e for e in employees if e["username"] == filter_username]

    return {
        "employees": employees,
        "total_requests": int(total_requests or 0),
        "total_area": float(total_area or 0),
    }


TIMEZONE_KEY = "timezone"


def get_timezone(db: Session) -> str:
    row = db.execute(select(AppSetting).where(AppSetting.key == TIMEZONE_KEY)).scalar_one_or_none()
    return row.value if row else "UTC"


def set_timezone(db: Session, tz: str) -> str:
    from zoneinfo import ZoneInfo

    try:
        ZoneInfo(tz)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Некорректный часовой пояс (IANA, например UTC или Etc/GMT-3)",
        )
    row = db.execute(select(AppSetting).where(AppSetting.key == TIMEZONE_KEY)).scalar_one_or_none()
    if row:
        row.value = tz
    else:
        db.add(AppSetting(key=TIMEZONE_KEY, value=tz))
    db.commit()
    return tz
