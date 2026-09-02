import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Text, Boolean, DateTime, ForeignKey, Enum, Numeric, Integer
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class UserRole(str, enum.Enum):
    client = "client"
    contractor = "contractor"
    admin = "admin"


class ProjectStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    filled = "filled"
    expired = "expired"


class UnionStatus(str, enum.Enum):
    union = "union"
    non_union = "non_union"
    na = "na"


class ComplianceStatus(str, enum.Enum):
    active = "active"
    hold = "hold"
    pending = "pending"


class BidStatus(str, enum.Enum):
    submitted = "submitted"
    accepted = "accepted"
    rejected = "rejected"
    withdrawn = "withdrawn"


class OwnerDocumentCategory(str, enum.Enum):
    documentation = "documentation"
    insurance = "insurance"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(Enum(UserRole), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    client = relationship("Client", back_populates="user", uselist=False)
    contractor = relationship("Contractor", back_populates="user", uselist=False)


class Client(Base):
    __tablename__ = "clients"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), unique=True, nullable=False)
    company_name = Column(String, nullable=True)
    contact_phone = Column(String, nullable=True)
    contact_email = Column(String, nullable=True)

    user = relationship("User", back_populates="client")
    projects = relationship("Project", back_populates="client")
    documents = relationship(
        "OwnerDocument", back_populates="client", cascade="all, delete-orphan"
    )


class Contractor(Base):
    __tablename__ = "contractors"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), unique=True, nullable=False)

    company_name = Column(String, nullable=True)
    dba_name = Column(String, nullable=True)
    primary_contact = Column(String, nullable=True)
    contact_phone = Column(String, nullable=True)
    contact_email = Column(String, nullable=True)
    website = Column(String, nullable=True)
    county = Column(String, nullable=True)
    address = Column(String, nullable=True)
    city = Column(String, nullable=True)
    state = Column(String, nullable=True)
    zip_code = Column(String, nullable=True)
    years_in_business = Column(Integer, nullable=True)
    employee_count = Column(Integer, nullable=True)

    trade_category_l1 = Column(String, nullable=True)
    trade_category_l2 = Column(String, nullable=True)
    trade_category_l3 = Column(String, nullable=True)

    public_bio = Column(Text, nullable=True)
    company_logo_url = Column(String, nullable=True)

    compliance_status = Column(Enum(ComplianceStatus), default=ComplianceStatus.pending)
    subscription_active = Column(Boolean, default=False)

    # Certificate of Insurance (COI) contact — used by the "Request COI" mailto button
    insurance_company_name = Column(String, nullable=True)
    insurance_rep_name = Column(String, nullable=True)
    insurance_rep_email = Column(String, nullable=True)
    insurance_rep_phone = Column(String, nullable=True)

    user = relationship("User", back_populates="contractor")
    bids = relationship("Bid", back_populates="contractor")
    documents = relationship(
        "ContractorDocument", back_populates="contractor", cascade="all, delete-orphan"
    )
    equipment_photos = relationship(
        "ContractorEquipmentPhoto", back_populates="contractor", cascade="all, delete-orphan"
    )
    contractor_types = relationship(
        "ContractorType", back_populates="contractor", cascade="all, delete-orphan"
    )


class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    client_id = Column(UUID(as_uuid=False), ForeignKey("clients.id"), nullable=False)

    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)

    budget_min = Column(Numeric(10, 2), nullable=True)
    budget_max = Column(Numeric(10, 2), nullable=True)

    # City/state only — never store or expose an exact street address (client requirement)
    city = Column(String, nullable=False)
    state = Column(String, nullable=False)
    lat = Column(Numeric(9, 6), nullable=True)
    lng = Column(Numeric(9, 6), nullable=True)

    job_type = Column(String, nullable=False)
    union_status = Column(Enum(UnionStatus), default=UnionStatus.na)

    status = Column(Enum(ProjectStatus), default=ProjectStatus.draft)
    date_posted = Column(DateTime, default=datetime.utcnow)
    date_expires = Column(DateTime, nullable=True)

    client = relationship("Client", back_populates="projects")
    photos = relationship("ProjectPhoto", back_populates="project")
    bids = relationship("Bid", back_populates="project")


class ProjectPhoto(Base):
    __tablename__ = "project_photos"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    project_id = Column(UUID(as_uuid=False), ForeignKey("projects.id"), nullable=False)
    url = Column(String, nullable=False)
    sort_order = Column(Integer, default=0)

    project = relationship("Project", back_populates="photos")


class Bid(Base):
    __tablename__ = "bids"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    project_id = Column(UUID(as_uuid=False), ForeignKey("projects.id"), nullable=False)
    contractor_id = Column(UUID(as_uuid=False), ForeignKey("contractors.id"), nullable=False)
    status = Column(Enum(BidStatus), default=BidStatus.submitted)
    message = Column(Text, nullable=True)
    submitted_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="bids")
    contractor = relationship("Contractor", back_populates="bids")


class Favorite(Base):
    __tablename__ = "favorites"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    client_id = Column(UUID(as_uuid=False), ForeignKey("clients.id"), nullable=False)
    contractor_id = Column(UUID(as_uuid=False), ForeignKey("contractors.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class OwnerDocument(Base):
    __tablename__ = "owner_documents"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    client_id = Column(UUID(as_uuid=False), ForeignKey("clients.id"), nullable=False, index=True)
    category = Column(Enum(OwnerDocumentCategory), nullable=False)
    document_type = Column(String, nullable=False)
    title = Column(String, nullable=False)

    # Insurance-only metadata. Keeping it nullable allows one private library
    # to hold both insurance policies and general project documentation.
    provider_name = Column(String, nullable=True)
    policy_number = Column(String, nullable=True)
    coverage_amount = Column(Numeric(12, 2), nullable=True)
    effective_date = Column(DateTime, nullable=True)
    expiration_date = Column(DateTime, nullable=True)
    document_date = Column(DateTime, nullable=True)

    original_filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False, unique=True)
    content_type = Column(String, nullable=False)
    file_size = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    client = relationship("Client", back_populates="documents")


class ContractorDocument(Base):
    __tablename__ = "contractor_documents"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    contractor_id = Column(
        UUID(as_uuid=False), ForeignKey("contractors.id"), nullable=False, index=True
    )
    category = Column(Enum(OwnerDocumentCategory), nullable=False)
    document_type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    provider_name = Column(String, nullable=True)
    policy_number = Column(String, nullable=True)
    coverage_amount = Column(Numeric(12, 2), nullable=True)
    effective_date = Column(DateTime, nullable=True)
    expiration_date = Column(DateTime, nullable=True)
    document_date = Column(DateTime, nullable=True)
    original_filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False, unique=True)
    content_type = Column(String, nullable=False)
    file_size = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    contractor = relationship("Contractor", back_populates="documents")


class ContractorEquipmentPhoto(Base):
    __tablename__ = "contractor_equipment_photos"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    contractor_id = Column(
        UUID(as_uuid=False), ForeignKey("contractors.id"), nullable=False, index=True
    )
    caption = Column(String, nullable=True)
    original_filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False, unique=True)
    content_type = Column(String, nullable=False)
    file_size = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    contractor = relationship("Contractor", back_populates="equipment_photos")


class ContractorType(Base):
    __tablename__ = "contractor_types"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    contractor_id = Column(
        UUID(as_uuid=False), ForeignKey("contractors.id"), nullable=False, index=True
    )
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    contractor = relationship("Contractor", back_populates="contractor_types")
