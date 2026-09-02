from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("", response_model=schemas.ProjectOut, status_code=201)
def create_project(
    payload: schemas.ProjectCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != models.UserRole.client:
        raise HTTPException(status_code=403, detail="Only client accounts can post projects")

    client = db.query(models.Client).filter(models.Client.user_id == current_user.id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client profile not found")

    project = models.Project(
        client_id=client.id,
        title=payload.title,
        description=payload.description,
        budget_min=payload.budget_min,
        budget_max=payload.budget_max,
        city=payload.city,
        state=payload.state,
        job_type=payload.job_type,
        union_status=payload.union_status,
        status=models.ProjectStatus.active,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("", response_model=List[schemas.ProjectOut])
def list_projects(
    job_type: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    union_status: Optional[models.UnionStatus] = None,
    # NOTE — Phase 1/2/3: any logged-in user can browse.
    # Phase 4: swap this dependency for `require_active_contractor_subscription`
    # so the lead board is gated behind a paying contractor subscription,
    # per the client's requirement that project visibility is the paid feature.
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The lead board. Exactly three filters, per spec: job type, city/state, union status.
    Deliberately no other filter params — keep this list short on purpose."""
    query = db.query(models.Project).filter(models.Project.status == models.ProjectStatus.active)

    if job_type:
        query = query.filter(models.Project.job_type == job_type)
    if city:
        query = query.filter(models.Project.city.ilike(city))
    if state:
        query = query.filter(models.Project.state.ilike(state))
    if union_status:
        query = query.filter(models.Project.union_status == union_status)

    return query.order_by(models.Project.date_posted.desc()).all()


@router.get("/{project_id}", response_model=schemas.ProjectOut)
def get_project(
    project_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
