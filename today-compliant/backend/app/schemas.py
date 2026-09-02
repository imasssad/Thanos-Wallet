from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, EmailStr

from app.models import BidStatus, OwnerDocumentCategory, UserRole, ProjectStatus, UnionStatus


# ---- Auth ----

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    role: UserRole
    company_name: Optional[str] = None
    contact_phone: Optional[str] = None


class UserOut(BaseModel):
    id: str
    email: EmailStr
    role: UserRole

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---- Projects ----

class ProjectCreate(BaseModel):
    title: str
    description: Optional[str] = None
    budget_min: Optional[Decimal] = None
    budget_max: Optional[Decimal] = None
    city: str
    state: str
    job_type: str
    union_status: UnionStatus = UnionStatus.na


class ProjectOut(BaseModel):
    id: str
    title: str
    description: Optional[str]
    budget_min: Optional[Decimal]
    budget_max: Optional[Decimal]
    city: str
    state: str
    job_type: str
    union_status: UnionStatus
    status: ProjectStatus
    date_posted: datetime

    class Config:
        from_attributes = True


# ---- Contractors ----

class ContractorProfileUpdate(BaseModel):
    company_name: Optional[str] = None
    dba_name: Optional[str] = None
    primary_contact: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    website: Optional[str] = None
    county: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    years_in_business: Optional[int] = None
    employee_count: Optional[int] = None
    trade_category_l1: Optional[str] = None
    public_bio: Optional[str] = None
    insurance_company_name: Optional[str] = None
    insurance_rep_name: Optional[str] = None
    insurance_rep_email: Optional[EmailStr] = None
    insurance_rep_phone: Optional[str] = None


class ContractorOut(BaseModel):
    id: str
    company_name: Optional[str]
    city: Optional[str]
    state: Optional[str]
    trade_category_l1: Optional[str]
    public_bio: Optional[str]
    compliance_status: str

    class Config:
        from_attributes = True


# ---- Project owner documents ----

class OwnerDocumentOut(BaseModel):
    id: str
    category: OwnerDocumentCategory
    document_type: str
    title: str
    provider_name: Optional[str]
    policy_number: Optional[str]
    coverage_amount: Optional[Decimal]
    effective_date: Optional[datetime]
    expiration_date: Optional[datetime]
    document_date: Optional[datetime]
    original_filename: str
    content_type: str
    file_size: int
    created_at: datetime

    class Config:
        from_attributes = True


class ContractorProfileOut(BaseModel):
    id: str
    username: EmailStr
    company_name: Optional[str]
    dba_name: Optional[str]
    primary_contact: Optional[str]
    contact_phone: Optional[str]
    contact_email: Optional[EmailStr]
    website: Optional[str]
    county: Optional[str]
    address: Optional[str]
    city: Optional[str]
    state: Optional[str]
    zip_code: Optional[str]
    years_in_business: Optional[int]
    employee_count: Optional[int]
    trade_category_l1: Optional[str]
    public_bio: Optional[str]
    compliance_status: str


class ContractorDocumentOut(OwnerDocumentOut):
    pass


class ContractorEquipmentPhotoOut(BaseModel):
    id: str
    caption: Optional[str]
    original_filename: str
    content_type: str
    file_size: int
    created_at: datetime

    class Config:
        from_attributes = True


class ContractorTypeCreate(BaseModel):
    name: str


class ContractorTypeOut(BaseModel):
    id: str
    name: str
    created_at: datetime

    class Config:
        from_attributes = True


class ComplianceTaskOut(BaseModel):
    id: str
    title: str
    description: str
    status: str


class ContractorProjectOut(BaseModel):
    project: ProjectOut
    bid_status: BidStatus
    message: Optional[str]
    submitted_at: datetime
