from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import get_current_user
from app.database import get_db
from app.uploads import IMAGE_CONTENT_TYPES, save_upload, upload_root

router = APIRouter(prefix="/api/contractor", tags=["contractor compliance"])


def _contractor(current_user: models.User, db: Session) -> models.Contractor:
    if current_user.role != models.UserRole.contractor:
        raise HTTPException(status_code=403, detail="Contractor account required")
    contractor = (
        db.query(models.Contractor)
        .filter(models.Contractor.user_id == current_user.id)
        .first()
    )
    if not contractor:
        raise HTTPException(status_code=404, detail="Contractor profile not found")
    return contractor


def _required(value: str, label: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(status_code=422, detail=f"{label} is required")
    return cleaned


def _parse_date(value: Optional[str], label: str, required: bool = False) -> Optional[datetime]:
    if not value:
        if required:
            raise HTTPException(status_code=422, detail=f"{label} is required")
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{label} must be a valid date") from exc


def _file_response(record, download: bool = False) -> FileResponse:
    path = upload_root() / record.stored_filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File is missing")
    return FileResponse(
        path,
        media_type=record.content_type,
        filename=record.original_filename,
        content_disposition_type="attachment" if download else "inline",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )


@router.get("/profile", response_model=schemas.ContractorProfileOut)
def get_profile(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    return {
        "id": contractor.id,
        "username": current_user.email,
        "company_name": contractor.company_name,
        "dba_name": contractor.dba_name,
        "primary_contact": contractor.primary_contact,
        "contact_phone": contractor.contact_phone,
        "contact_email": contractor.contact_email,
        "website": contractor.website,
        "county": contractor.county,
        "address": contractor.address,
        "city": contractor.city,
        "state": contractor.state,
        "zip_code": contractor.zip_code,
        "years_in_business": contractor.years_in_business,
        "employee_count": contractor.employee_count,
        "trade_category_l1": contractor.trade_category_l1,
        "public_bio": contractor.public_bio,
        "compliance_status": contractor.compliance_status.value,
    }


@router.patch("/profile", response_model=schemas.ContractorProfileOut)
def update_profile(
    payload: schemas.ContractorProfileUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    changes = payload.model_dump(exclude_unset=True)
    for numeric_field in ("years_in_business", "employee_count"):
        if changes.get(numeric_field) is not None and changes[numeric_field] < 0:
            raise HTTPException(status_code=422, detail=f"{numeric_field.replace('_', ' ').title()} cannot be negative")
    for key, value in changes.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(contractor, key, value)
    db.commit()
    return get_profile(current_user, db)


@router.get("/projects", response_model=List[schemas.ContractorProjectOut])
def list_contractor_projects(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    bids = (
        db.query(models.Bid)
        .filter(models.Bid.contractor_id == contractor.id)
        .order_by(models.Bid.submitted_at.desc())
        .all()
    )
    return [
        {
            "project": bid.project,
            "bid_status": bid.status,
            "message": bid.message,
            "submitted_at": bid.submitted_at,
        }
        for bid in bids
    ]


@router.get("/documents", response_model=List[schemas.ContractorDocumentOut])
def list_documents(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    return (
        db.query(models.ContractorDocument)
        .filter(models.ContractorDocument.contractor_id == contractor.id)
        .order_by(models.ContractorDocument.created_at.desc())
        .all()
    )


@router.post("/documents/documentation", response_model=schemas.ContractorDocumentOut, status_code=201)
async def add_documentation(
    document_type: str = Form(...),
    title: str = Form(...),
    document_date: Optional[str] = Form(None),
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    clean_type = _required(document_type, "Document type")
    clean_title = _required(title, "Document title")
    parsed_date = _parse_date(document_date, "Document date")
    original_name, stored_name, size, content_type = await save_upload(file)
    record = models.ContractorDocument(
        contractor_id=contractor.id,
        category=models.OwnerDocumentCategory.documentation,
        document_type=clean_type,
        title=clean_title,
        document_date=parsed_date,
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


@router.post("/documents/insurance", response_model=schemas.ContractorDocumentOut, status_code=201)
async def add_insurance(
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
    contractor = _contractor(current_user, db)
    clean_type = _required(policy_type, "Policy type")
    clean_provider = _required(provider_name, "Insurance provider")
    clean_policy_number = _required(policy_number, "Policy number")
    effective = _parse_date(effective_date, "Effective date", required=True)
    expiration = _parse_date(expiration_date, "Expiration date", required=True)
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
    record = models.ContractorDocument(
        contractor_id=contractor.id,
        category=models.OwnerDocumentCategory.insurance,
        document_type=clean_type,
        title=f"{clean_type} policy",
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


@router.get("/documents/{document_id}/file")
def read_document(
    document_id: str,
    download: bool = False,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    record = (
        db.query(models.ContractorDocument)
        .filter(
            models.ContractorDocument.id == document_id,
            models.ContractorDocument.contractor_id == contractor.id,
        )
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Document not found")
    return _file_response(record, download)


@router.get("/tasks", response_model=List[schemas.ComplianceTaskOut])
def compliance_tasks(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    documents = contractor.documents
    required_profile = [
        contractor.company_name,
        contractor.primary_contact,
        contractor.contact_phone,
        contractor.contact_email,
        contractor.address,
        contractor.city,
        contractor.state,
        contractor.zip_code,
    ]
    has_current_insurance = any(
        document.category == models.OwnerDocumentCategory.insurance
        and document.expiration_date
        and document.expiration_date >= datetime.utcnow()
        for document in documents
    )
    checks = [
        ("profile", "Complete company profile", "Add contact, business, and location details.", all(required_profile)),
        ("documents", "Upload compliance documentation", "Add a license, W-9, permit, or safety certificate.", any(d.category == models.OwnerDocumentCategory.documentation for d in documents)),
        ("insurance", "Provide current insurance", "Add an insurance policy that has not expired.", has_current_insurance),
        ("photos", "Add branded equipment photos", "Upload at least one clear photo of branded equipment.", bool(contractor.equipment_photos)),
        ("types", "Select contractor types", "Identify at least one service or contractor classification.", bool(contractor.contractor_types)),
    ]
    return [
        {"id": task_id, "title": title, "description": description, "status": "complete" if complete else "pending"}
        for task_id, title, description, complete in checks
    ]


@router.get("/photos", response_model=List[schemas.ContractorEquipmentPhotoOut])
def list_photos(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    return (
        db.query(models.ContractorEquipmentPhoto)
        .filter(models.ContractorEquipmentPhoto.contractor_id == contractor.id)
        .order_by(models.ContractorEquipmentPhoto.created_at.desc())
        .all()
    )


@router.post("/photos", response_model=schemas.ContractorEquipmentPhotoOut, status_code=201)
async def add_photo(
    caption: Optional[str] = Form(None),
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    original_name, stored_name, size, content_type = await save_upload(file, IMAGE_CONTENT_TYPES)
    record = models.ContractorEquipmentPhoto(
        contractor_id=contractor.id,
        caption=caption.strip() if caption and caption.strip() else None,
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


@router.get("/photos/{photo_id}/file")
def read_photo(
    photo_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    record = (
        db.query(models.ContractorEquipmentPhoto)
        .filter(
            models.ContractorEquipmentPhoto.id == photo_id,
            models.ContractorEquipmentPhoto.contractor_id == contractor.id,
        )
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Photo not found")
    return _file_response(record)


@router.get("/types", response_model=List[schemas.ContractorTypeOut])
def list_types(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    return (
        db.query(models.ContractorType)
        .filter(models.ContractorType.contractor_id == contractor.id)
        .order_by(models.ContractorType.name.asc())
        .all()
    )


@router.post("/types", response_model=schemas.ContractorTypeOut, status_code=201)
def add_type(
    payload: schemas.ContractorTypeCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    name = _required(payload.name, "Contractor type")
    existing = (
        db.query(models.ContractorType)
        .filter(
            models.ContractorType.contractor_id == contractor.id,
            models.ContractorType.name.ilike(name),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Contractor type already added")
    record = models.ContractorType(contractor_id=contractor.id, name=name)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.delete("/types/{type_id}", status_code=204)
def delete_type(
    type_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contractor = _contractor(current_user, db)
    record = (
        db.query(models.ContractorType)
        .filter(
            models.ContractorType.id == type_id,
            models.ContractorType.contractor_id == contractor.id,
        )
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Contractor type not found")
    db.delete(record)
    db.commit()
