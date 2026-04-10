import logging
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

logger = logging.getLogger(__name__)

_connect_args: dict = {}
if settings.database_url.startswith("sqlite"):
    _connect_args["check_same_thread"] = False

engine = create_engine(
    settings.database_url,
    future=True,
    connect_args=_connect_args,
)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)
Base = declarative_base()


def migrate_schema() -> None:
    """Идемпотентные ALTER и индексы для уже существующих БД (без удаления данных)."""
    with engine.connect() as conn:
        insp = inspect(conn)
        dialect = conn.engine.dialect.name
        tables = set(insp.get_table_names())

        if "users" in tables:
            ucols = {c["name"] for c in insp.get_columns("users")}
            if "is_active" not in ucols:
                if dialect == "postgresql":
                    conn.execute(
                        text("ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true")
                    )
                else:
                    conn.execute(
                        text("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
                    )
                conn.commit()

        if "shifts" not in tables:
            logger.info("migrate_schema: таблица shifts нет — пропуск")
            return

        scols = {c["name"] for c in insp.get_columns("shifts")}
        if "closed_by_id" not in scols:
            conn.execute(text("ALTER TABLE shifts ADD COLUMN closed_by_id INTEGER"))
            conn.commit()

        conn.execute(
            text(
                "UPDATE shifts SET closed_by_id = user_id "
                "WHERE status = 'closed' AND closed_by_id IS NULL"
            )
        )
        conn.commit()

        if "requests" in tables:
            conn.execute(text("UPDATE requests SET request_number = TRIM(request_number)"))
            conn.commit()
            try:
                if dialect == "sqlite":
                    conn.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS uq_requests_shift_request_number "
                            "ON requests(shift_id, request_number)"
                        )
                    )
                elif dialect == "postgresql":
                    conn.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS uq_requests_shift_request_number "
                            "ON requests (shift_id, request_number)"
                        )
                    )
                conn.commit()
            except Exception:
                conn.rollback()

        try:
            if dialect == "sqlite":
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_one_active_per_user "
                        "ON shifts(user_id) WHERE status = 'active'"
                    )
                )
            elif dialect == "postgresql":
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_one_active_per_user "
                        "ON shifts (user_id) WHERE (status = 'active')"
                    )
                )
            conn.commit()
        except Exception:
            conn.rollback()

    logger.info("migrate_schema: выполнено")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
