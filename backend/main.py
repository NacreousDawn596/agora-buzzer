"""
Agora A&M Buzzer System — FastAPI Backend (1v1 Edition)
Two-team duel. Server controls everything. No trust in clients.
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import json
import time
import logging
from typing import Optional
from contextlib import asynccontextmanager

from auth import (
    create_access_token, verify_token, hash_password, verify_password,
    create_ws_token, verify_ws_token,
)
from models import (
    LoginRequest, TeamJoinRequest, AdminScoreUpdate,
    BuzzerState, SessionState, TeamInfo, TokenResponse,
    ConnectionManager, RateLimiter,
)
from config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agora")

# ─── Global State ─────────────────────────────────────────────────────────────
manager      = ConnectionManager()
rate_limiter = RateLimiter()

sessions:  dict[str, SessionState] = {}
teams_db:  dict[str, TeamInfo]     = {}   # exactly 2 entries (insertion-ordered)
admins_db: dict[str, str]          = {}

security = HTTPBearer()

# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🏛  Agora A&M 1v1 Duel starting...")
    await seed_initial_data()
    yield

app = FastAPI(title="Agora A&M 1v1 Buzzer", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# ─── Seeding ──────────────────────────────────────────────────────────────────
async def seed_initial_data():
    admins_db["admin"] = hash_password("agora2025!")

    # Edit these for your event — exactly 2 teams
    duel_teams = [
        ("gadzit",  "GadzIT"),
        ("phoenix", "Phoenix"),
    ]
    for team_id, team_name in duel_teams:
        teams_db[team_id] = TeamInfo(
            team_id=team_id, team_name=team_name,
            score=0, is_connected=False, joined_at=None,
        )

    sessions["main"] = SessionState(
        session_id="main",
        buzzer_state=BuzzerState.DISABLED,
        buzzer_winner=None,
        buzzer_timestamp=None,
        question_number=0,
    )
    ids = list(teams_db.keys())
    logger.info(f"✅ Duel ready: '{ids[0]}' vs '{ids[1]}'")

# ─── Helpers ──────────────────────────────────────────────────────────────────
def get_session(session_id: str = "main") -> SessionState:
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    return sessions[session_id]

def get_duel_payload() -> dict:
    """Returns both teams as a stable a/b pair (insertion order)."""
    pair = list(teams_db.values())
    if len(pair) < 2:
        return {}
    ta, tb = pair[0], pair[1]
    return {
        "team_a": {
            "id": ta.team_id, "name": ta.team_name,
            "score": ta.score, "is_connected": ta.is_connected,
        },
        "team_b": {
            "id": tb.team_id, "name": tb.team_name,
            "score": tb.score, "is_connected": tb.is_connected,
        },
    }

async def broadcast_state(session_id: str):
    session = sessions[session_id]
    winner_name = None
    if session.buzzer_winner and session.buzzer_winner in teams_db:
        winner_name = teams_db[session.buzzer_winner].team_name
    await manager.broadcast(session_id, {
        "type":              "state_sync",
        "buzzer_state":      session.buzzer_state.value,
        "buzzer_winner":     session.buzzer_winner,
        "buzzer_winner_name": winner_name,
        "buzzer_timestamp":  session.buzzer_timestamp,
        "question_number":   session.question_number,
        **get_duel_payload(),
    })

# ─── Auth ─────────────────────────────────────────────────────────────────────
@app.post("/login", response_model=TokenResponse, tags=["Auth"])
async def admin_login(req: LoginRequest):
    if req.username not in admins_db:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(req.password, admins_db[req.username]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token({"sub": req.username, "role": "admin"})
    ws_token = create_ws_token(req.username, "admin")
    return TokenResponse(access_token=token, token_type="bearer", role="admin", ws_token=ws_token)


@app.post("/join", tags=["Participant"])
async def team_join(req: TeamJoinRequest):
    team_id = req.team_id.strip().lower()
    logger.info(f"📥 JOIN ATTEMPT: '{team_id}' | Registered: {list(teams_db.keys())}")
    if team_id not in teams_db:
        logger.warning(f"❌ JOIN REJECTED: '{team_id}' not found")
        raise HTTPException(
            status_code=403,
            detail=f"'{team_id}' is not registered for this duel.",
        )
    team         = teams_db[team_id]
    access_token = create_access_token({"sub": team_id, "role": "participant", "team_name": team.team_name})
    ws_token     = create_ws_token(team_id, "participant")

    duel = get_duel_payload()
    opponent = None
    if duel.get("team_a") and duel["team_a"]["id"] != team_id:
        opponent = duel["team_a"]
    elif duel.get("team_b") and duel["team_b"]["id"] != team_id:
        opponent = duel["team_b"]

    logger.info(f"🟢 '{team_id}' ({team.team_name}) joined")
    return {
        "access_token": access_token,
        "ws_token":     ws_token,
        "team_id":      team_id,
        "team_name":    team.team_name,
        "session_id":   "main",
        "token_type":   "bearer",
        "opponent":     opponent,
        **duel,
    }


@app.post("/screen-token", tags=["Screen"])
async def get_screen_token(secret: str):
    if secret != settings.screen_secret:
        raise HTTPException(status_code=403, detail="Wrong screen secret")
    return {
        "access_token": create_access_token({"sub": "screen", "role": "screen"}),
        "ws_token":     create_ws_token("screen", "screen"),
    }


@app.get("/session/{session_id}", tags=["Session"])
async def get_session_info(session_id: str):
    session = get_session(session_id)
    return {
        "session_id":      session_id,
        "buzzer_state":    session.buzzer_state.value,
        "buzzer_winner":   session.buzzer_winner,
        "question_number": session.question_number,
        **get_duel_payload(),
    }

# ─── Admin ────────────────────────────────────────────────────────────────────
def require_admin(credentials: HTTPAuthorizationCredentials = Depends(security)):
    payload = verify_token(credentials.credentials)
    if not payload or payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


@app.post("/admin/enable-buzzer", tags=["Admin"])
async def enable_buzzer(session_id: str = "main", admin=Depends(require_admin)):
    session = get_session(session_id)
    if session.buzzer_state == BuzzerState.LOCKED:
        raise HTTPException(status_code=400, detail="Reset buzzer first")
    session.buzzer_state     = BuzzerState.ENABLED
    session.buzzer_winner    = None
    session.buzzer_timestamp = None
    session.question_number += 1
    logger.info(f"🟢 Buzzer ENABLED — Q{session.question_number}")
    await broadcast_state(session_id)
    return {"status": "enabled", "question_number": session.question_number}


@app.post("/admin/disable-buzzer", tags=["Admin"])
async def disable_buzzer(session_id: str = "main", admin=Depends(require_admin)):
    sessions[session_id].buzzer_state = BuzzerState.DISABLED
    await broadcast_state(session_id)
    return {"status": "disabled"}


@app.post("/admin/reset-buzzer", tags=["Admin"])
async def reset_buzzer(session_id: str = "main", admin=Depends(require_admin)):
    session = sessions[session_id]
    session.buzzer_state     = BuzzerState.DISABLED
    session.buzzer_winner    = None
    session.buzzer_timestamp = None
    await broadcast_state(session_id)
    return {"status": "reset"}


@app.post("/admin/update-score", tags=["Admin"])
async def update_score(req: AdminScoreUpdate, admin=Depends(require_admin)):
    if req.team_id not in teams_db:
        raise HTTPException(status_code=404, detail="Team not found")
    team       = teams_db[req.team_id]
    team.score = max(0, team.score + req.delta)
    logger.info(f"💰 {req.team_id} → {team.score} (Δ{req.delta:+})")
    await broadcast_state("main")
    return {"team_id": req.team_id, "new_score": team.score}


@app.post("/admin/reset-scores", tags=["Admin"])
async def reset_scores(admin=Depends(require_admin)):
    for team in teams_db.values():
        team.score = 0
    session = sessions.get("main")
    if session:
        session.question_number  = 0
        session.buzzer_state     = BuzzerState.DISABLED
        session.buzzer_winner    = None
    await broadcast_state("main")
    return {"status": "reset"}


@app.post("/admin/set-teams", tags=["Admin"])
async def set_teams(
    team_a_id: str, team_a_name: str,
    team_b_id: str, team_b_name: str,
    admin=Depends(require_admin),
):
    """Reconfigure both teams (new match)."""
    teams_db.clear()
    teams_db[team_a_id.lower()] = TeamInfo(team_id=team_a_id.lower(), team_name=team_a_name, score=0, is_connected=False, joined_at=None)
    teams_db[team_b_id.lower()] = TeamInfo(team_id=team_b_id.lower(), team_name=team_b_name, score=0, is_connected=False, joined_at=None)
    session = sessions.get("main")
    if session:
        session.buzzer_state    = BuzzerState.DISABLED
        session.buzzer_winner   = None
        session.question_number = 0
    await broadcast_state("main")
    logger.info(f"🔄 TEAMS RECONFIGURED: '{team_a_id}' vs '{team_b_id}'")
    return {"status": "teams_set", **get_duel_payload()}


@app.get("/admin/debug-state", tags=["Admin"])
async def debug_state(admin=Depends(require_admin)):
    return {
        "teams_db": teams_db,
        "sessions": sessions,
        "manager_counts": {s: manager.count(s) for s in sessions},
    }


@app.post("/admin/panic", tags=["Admin"])
async def panic_button(admin=Depends(require_admin)):
    session = sessions.get("main")
    if session:
        session.buzzer_state     = BuzzerState.DISABLED
        session.buzzer_winner    = None
        session.buzzer_timestamp = None
    logger.warning("🚨 PANIC")
    await broadcast_state("main")
    return {"status": "panic_executed"}

# ─── WebSocket ────────────────────────────────────────────────────────────────
@app.websocket("/ws/session/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing token"); return
    payload = verify_ws_token(token)
    if not payload:
        await websocket.close(code=4003, reason="Invalid token"); return

    client_id = payload["sub"]
    role      = payload["role"]

    if session_id not in sessions:
        await websocket.close(code=4004, reason="Session not found"); return

    await manager.connect(websocket, session_id, client_id, role)

    if role == "participant" and client_id in teams_db:
        teams_db[client_id].is_connected = True
        teams_db[client_id].joined_at    = time.time()

    session = sessions[session_id]
    winner_name = teams_db[session.buzzer_winner].team_name if session.buzzer_winner and session.buzzer_winner in teams_db else None

    await websocket.send_json({
        "type":              "connected",
        "client_id":         client_id,
        "role":              role,
        "buzzer_state":      session.buzzer_state.value,
        "buzzer_winner":     session.buzzer_winner,
        "buzzer_winner_name": winner_name,
        "question_number":   session.question_number,
        **get_duel_payload(),
    })

    if role == "participant":
        await manager.broadcast(session_id, {
            "type":    "opponent_connected",
            "team_id": client_id,
            **get_duel_payload(),
        }, exclude=client_id)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Bad JSON"})
                continue

            msg_type = data.get("type")

            if msg_type == "buzz" and role == "participant":
                if rate_limiter.is_limited(client_id):
                    await websocket.send_json({"type": "error", "message": "Rate limited"})
                    continue
                rate_limiter.record(client_id)
                session = sessions[session_id]

                if session.buzzer_state != BuzzerState.ENABLED:
                    await websocket.send_json({"type": "buzz_rejected", "reason": "not_enabled"})
                    continue

                ts                       = time.time()
                session.buzzer_state     = BuzzerState.LOCKED
                session.buzzer_winner    = client_id
                session.buzzer_timestamp = ts
                team_name                = teams_db[client_id].team_name
                loser = next((t for t in teams_db.values() if t.team_id != client_id), None)

                logger.info(f"🔔 BUZZ! {client_id} ({team_name}) @ {ts:.4f}")
                await manager.broadcast(session_id, {
                    "type":        "buzzer_locked",
                    "winner_id":   client_id,
                    "winner_name": team_name,
                    "loser_id":    loser.team_id if loser else None,
                    "loser_name":  loser.team_name if loser else None,
                    "timestamp":   ts,
                    "buzzer_state": BuzzerState.LOCKED.value,
                    **get_duel_payload(),
                })

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong", "ts": time.time()})

    except WebSocketDisconnect:
        manager.disconnect(session_id, client_id)
        if role == "participant" and client_id in teams_db:
            teams_db[client_id].is_connected = False
        logger.info(f"🔌 '{client_id}' disconnected")
        await manager.broadcast(session_id, {
            "type":    "opponent_disconnected",
            "team_id": client_id,
            **get_duel_payload(),
        })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)