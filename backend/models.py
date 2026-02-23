"""
Data models and connection management for AGORA Buzzer System.
"""

from pydantic import BaseModel, Field
from fastapi import WebSocket
from enum import Enum
from typing import Optional
import time
import logging

logger = logging.getLogger("agora")


# ─── Enums ────────────────────────────────────────────────────────────────────
class BuzzerState(str, Enum):
    DISABLED = "disabled"   # Admin hasn't opened buzzer yet
    ENABLED  = "enabled"    # Buzzer open — first to press wins
    LOCKED   = "locked"     # Someone buzzed — all others locked out


# ─── Pydantic Models ──────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str


class TeamJoinRequest(BaseModel):
    team_id: str = Field(..., min_length=2, max_length=32)


class AdminScoreUpdate(BaseModel):
    team_id: str
    delta: int = Field(..., description="Positive to add, negative to subtract")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    role: str
    ws_token: Optional[str] = None


class TeamInfo(BaseModel):
    team_id: str
    team_name: str
    score: int = 0
    is_connected: bool = False
    joined_at: Optional[float] = None


class SessionState(BaseModel):
    session_id: str
    buzzer_state: BuzzerState = BuzzerState.DISABLED
    buzzer_winner: Optional[str] = None
    buzzer_timestamp: Optional[float] = None
    question_number: int = 0

    class Config:
        use_enum_values = False


# ─── Connection Manager ───────────────────────────────────────────────────────
class ConnectionManager:
    """Manages active WebSocket connections per session."""

    def __init__(self):
        # session_id → { client_id → {"ws": WebSocket, "role": str} }
        self._connections: dict[str, dict[str, dict]] = {}

    async def connect(self, ws: WebSocket, session_id: str, client_id: str, role: str):
        await ws.accept()
        if session_id not in self._connections:
            self._connections[session_id] = {}

        # Disconnect duplicate connections for same team
        if client_id in self._connections[session_id]:
            old_ws = self._connections[session_id][client_id]["ws"]
            try:
                await old_ws.close(code=4009, reason="New connection from same client")
            except Exception:
                pass
            logger.warning(f"⚠️  Duplicate connection replaced: {client_id}")

        self._connections[session_id][client_id] = {"ws": ws, "role": role}
        logger.info(f"🔗 Connected [{role}] '{client_id}' → session '{session_id}' | Total: {self.count(session_id)}")

    def disconnect(self, session_id: str, client_id: str):
        if session_id in self._connections:
            self._connections[session_id].pop(client_id, None)

    async def broadcast(self, session_id: str, message: dict, exclude: Optional[str] = None):
        """Send message to all connected clients in a session."""
        if session_id not in self._connections:
            return

        dead = []
        for client_id, info in self._connections[session_id].items():
            if client_id == exclude:
                continue
            try:
                await info["ws"].send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send to {client_id}: {e}")
                dead.append(client_id)

        for d in dead:
            self._connections[session_id].pop(d, None)

    async def send_to(self, session_id: str, client_id: str, message: dict):
        """Send message to a specific client."""
        conn = self._connections.get(session_id, {}).get(client_id)
        if conn:
            try:
                await conn["ws"].send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send to {client_id}: {e}")

    def get_connected_teams(self, session_id: str) -> list[str]:
        return list(self._connections.get(session_id, {}).keys())

    def count(self, session_id: str) -> int:
        return len(self._connections.get(session_id, {}))


# ─── Rate Limiter ─────────────────────────────────────────────────────────────
class RateLimiter:
    """Simple in-memory rate limiter: max N events per window."""

    def __init__(self, max_events: int = 3, window_seconds: float = 5.0):
        self.max_events = max_events
        self.window = window_seconds
        self._log: dict[str, list[float]] = {}

    def record(self, client_id: str):
        now = time.time()
        if client_id not in self._log:
            self._log[client_id] = []
        self._log[client_id].append(now)

    def is_limited(self, client_id: str) -> bool:
        now = time.time()
        events = self._log.get(client_id, [])
        recent = [t for t in events if now - t < self.window]
        self._log[client_id] = recent
        return len(recent) >= self.max_events