from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Postgres connection string, e.g. postgresql://user:pass@localhost:5432/todaycompliant
    database_url: str = "postgresql://postgres:postgres@localhost:5432/todaycompliant"

    # JWT
    secret_key: str = "change-me-in-.env"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    # CORS
    frontend_origin: str = "http://localhost:3000"

    # Private project-owner uploads. Files are only served through authenticated
    # API routes; this directory must not be mounted as a public static folder.
    upload_directory: str = "uploads/private-documents"
    max_upload_size_mb: int = 10

    class Config:
        env_file = ".env"


settings = Settings()
