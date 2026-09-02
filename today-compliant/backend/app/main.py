from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.routers import auth, contractor_dashboard, documents, projects

# Creates tables if they don't exist yet. Fine for early development;
# switch to Alembic migrations before this goes anywhere near production data.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="TODAY Compliant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(documents.router)
app.include_router(contractor_dashboard.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}
