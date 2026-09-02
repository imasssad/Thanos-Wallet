from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app import models

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# Using bcrypt directly rather than passlib — passlib's bcrypt backend is
# incompatible with recent bcrypt package releases (unmaintained project,
# known upstream issue). bcrypt truncates at 72 bytes internally regardless,
# so we enforce that explicitly to fail loudly instead of silently truncating.


def hash_password(password: str) -> str:
    if len(password.encode("utf-8")) > 72:
        raise ValueError("Password must be 72 bytes or fewer")
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise credentials_exception
    return user


def require_active_contractor_subscription(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> models.User:
    """Dependency for endpoints that should only be visible to paying, compliant contractors.
    Use this on the projects-list endpoint once Stripe subscriptions are wired up (Phase 4)."""
    if current_user.role != models.UserRole.contractor:
        raise HTTPException(status_code=403, detail="Contractor account required")

    contractor = db.query(models.Contractor).filter(
        models.Contractor.user_id == current_user.id
    ).first()

    if not contractor or not contractor.subscription_active:
        raise HTTPException(status_code=402, detail="Active subscription required to view projects")

    if contractor.compliance_status != models.ComplianceStatus.active:
        raise HTTPException(status_code=403, detail="Account is on hold pending compliance review")

    return current_user
