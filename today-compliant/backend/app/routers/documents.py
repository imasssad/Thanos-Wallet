from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import get_current_user
from app.database import get_db
from app.uploads import save_upload, upload_root

router = APIRouter(prefix="/api/owner/documents", tags=["owner documents"])

def _owner_client(current_user: models.User, db: Session) -> models.Client:
    if current_user.role != models.UserRole.client:
        raise HTTPException(status_code=403, detail="Project owner account required")
    client = db.query(models.Client).filter(models.Client.user_id == current_user.id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Project owner profile not found")
    return client


def _parse_date(value: Optional[str], label: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{label} must be a valid date") from exc


def _clean_required(value: str, label: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(status_code=422, detail=f"{label} is required")
    return cleaned


@router.get("", response_model=List[schemas.OwnerDocumentOut])
def list_documents(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client = _owner_client(current_user, db)
    return (
        db.query(models.OwnerDocument)
        .filter(models.OwnerDocument.client_id == client.id)
        .order_by(models.OwnerDocument.created_at.desc())
        .all()
    )


@router.post("/documentation", response_model=schemas.OwnerDocumentOut, status_code=201)
async def add_documentation(
    document_type: str = Form(...),
    title: str = Form(...),
    document_date: Optional[str] = Form(None),
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client = _owner_client(current_user, db)
    clean_type = _clean_required(document_type, "Document type")
    clean_title = _clean_required(title, "Document title")
    parsed_document_date = _parse_date(document_date, "Document date")
    original_name, stored_name, size, content_type = await save_upload(file)
    record = models.OwnerDocument(
        client_id=client.id,
        category=models.OwnerDocumentCategory.documentation,
        document_type=clean_type,
        title=clean_title,
        document_date=parsed_document_date,
        original_filename=original_name,
        stored_filename=stored_name,
        content_type=content_type,
        file_size=size,
    )
    try:
        db.add(record)
        db.commit()
        db.refresh(record)
    except Exception:
        (upload_root() / stored_name).unlink(missing_ok=True)
        db.rollback()
        raise
    return record


@router.post("/insurance", response_model=schemas.OwnerDocumentOut, status_code=201)
async def add_insurance_policy(
    policy_type: str = Form(...),
    provider_name: str = Form(...),
    policy_number: str = Form(...),
    coverage_amount: Optional[str] = Form(None),
    effective_date: str = Form(...),
    expiration_date: str = Form(...),
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client = _owner_client(current_user, db)
    clean_policy_type = _clean_required(policy_type, "Policy type")
    clean_provider = _clean_required(provider_name, "Insurance provider")
    clean_policy_number = _clean_required(policy_number, "Policy number")
    effective = _parse_date(_clean_required(effective_date, "Effective date"), "Effective date")
    expiration = _parse_date(_clean_required(expiration_date, "Expiration date"), "Expiration date")
    if effective and expiration and expiration < effective:
        raise HTTPException(status_code=422, detail="Expiration date must be after the effective date")

    coverage = None
    if coverage_amount:
        try:
            coverage = Decimal(coverage_amount)
            if not coverage.is_finite() or coverage < 0:
                raise InvalidOperation
        except InvalidOperation as exc:
            raise HTTPException(status_code=422, detail="Coverage amount must be a positive number") from exc

    original_name, stored_name, size, content_type = await save_upload(file)
    record = models.OwnerDocument(
        client_id=client.id,
        category=models.OwnerDocumentCategory.insurance,
        document_type=clean_policy_type,
        title=f"{clean_policy_type} policy",
        provider_name=clean_provider,
        policy_number=clean_policy_number,
        coverage_amount=coverage,
        effective_date=effective,
        expiration_date=expiration,
        original_filename=original_name,
        stored_filename=stored_name,
        content_type=content_type,
        file_size=size,
    )
    try:
        db.add(record)
        db.commit()
        db.refresh(record)
    except Exception:
        (upload_root() / stored_name).unlink(missing_ok=True)
        db.rollback()
        raise
    return record


@router.get("/{document_id}/file")
def read_document(
    document_id: str,
    download: bool = False,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client = _owner_client(current_user, db)
    record = (
        db.query(models.OwnerDocument)
        .filter(
            models.OwnerDocument.id == document_id,
            models.OwnerDocument.client_id == client.id,
        )
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Document not found")

    path = upload_root() / record.stored_filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Document file is missing")

    headers = {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
    }
    return FileResponse(
        path,
        media_type=record.content_type,
        filename=record.original_filename,
        content_disposition_type="attachment" if download else "inline",
        headers=headers,
    )
