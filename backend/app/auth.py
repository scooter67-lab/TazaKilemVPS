from datetime import datetime, timedelta, timezone

import bcrypt as bcrypt_lib
from jose import ExpiredSignatureError, JWTError, jwt
from passlib.context import CryptContext

from .config import settings


pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not plain_password or not hashed_password:
        return False
    h = hashed_password.strip()
    # Старые записи (bcrypt): passlib на части связок Python 3.12+/bcrypt 4+ падает — проверяем напрямую
    if h.startswith(("$2a$", "$2b$", "$2y$")):
        try:
            return bcrypt_lib.checkpw(
                plain_password.encode("utf-8"),
                h.encode("ascii"),
            )
        except (ValueError, TypeError, Exception):
            return False
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except (ValueError, TypeError, Exception):
        return False


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_token(data: dict, expires_delta: timedelta) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + expires_delta
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def create_access_token(user_id: int, role: str) -> str:
    return create_token(
        {"sub": str(user_id), "role": role, "type": "access"},
        timedelta(minutes=settings.access_token_expire_minutes),
    )


def create_refresh_token(user_id: int, role: str) -> str:
    return create_token(
        {"sub": str(user_id), "role": role, "type": "refresh"},
        timedelta(days=settings.refresh_token_expire_days),
    )


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except ExpiredSignatureError as exc:
        raise ValueError("Token expired") from exc
    except JWTError as exc:
        raise ValueError("Invalid token") from exc
