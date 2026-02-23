"""
Authentication utilities for AGORA Buzzer System.
JWT for HTTP endpoints, short-lived WS tokens for WebSocket connections.
"""

import jwt
import bcrypt
import time
from typing import Optional
from config import settings


# ─── Password hashing ────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ─── JWT (HTTP) ───────────────────────────────────────────────────────────────
def create_access_token(data: dict, expires_in: int = settings.jwt_expire_minutes * 60) -> str:
    payload = {**data, "exp": int(time.time()) + expires_in, "iat": int(time.time())}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None


# ─── WebSocket tokens (shorter-lived) ────────────────────────────────────────
def create_ws_token(client_id: str, role: str, expires_in: int = 3600) -> str:
    """Short-lived token specifically for WS auth."""
    payload = {
        "sub": client_id,
        "role": role,
        "type": "ws",
        "exp": int(time.time()) + expires_in,
        "iat": int(time.time()),
    }
    return jwt.encode(payload, settings.ws_secret, algorithm=settings.jwt_algorithm)


def verify_ws_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.ws_secret, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "ws":
            return None
        return payload
    except jwt.PyJWTError:
        return None