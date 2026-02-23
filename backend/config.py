"""
Configuration — override via environment variables in production.
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    jwt_secret: str = "agora-jwt-secret-change-in-production-32chars!"
    ws_secret: str = "agora-ws-secret-change-in-production-32chars!!"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480   # 8 hours
    screen_secret: str = "agora-screen-2025"

    class Config:
        env_file = ".env"


settings = Settings()