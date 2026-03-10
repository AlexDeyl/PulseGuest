from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ChecklistTemplateOut(BaseModel):
    id: int
    organization_id: Optional[int] = None
    name: str
    description: str = ""
    scope: str = "organization"
    location_type: Optional[str] = None
    version: int = 1
    is_active: bool = True


class ChecklistQuestionOut(BaseModel):
    id: int
    order: int = 0
    section: str = ""
    text: str
    answer_type: str
    options: Dict[str, Any] = Field(default_factory=dict)
    is_required: bool = False
    allow_comment: bool = True
    allow_photos: bool = True


class ChecklistTemplateDetailOut(ChecklistTemplateOut):
    questions: List[ChecklistQuestionOut] = Field(default_factory=list)


class ChecklistTemplateCreateIn(BaseModel):
    organization_id: Optional[int] = None
    name: str
    description: str = ""
    scope: str = "organization"  # organization|group
    location_type: Optional[str] = None
    version: int = 1
    is_active: bool = True
    questions: List[Dict[str, Any]] = Field(default_factory=list)


class ChecklistRunCreateIn(BaseModel):
    template_id: int
    organization_id: int
    location_id: Optional[int] = None


class ChecklistAnswerUpsertIn(BaseModel):
    value: Dict[str, Any] = Field(default_factory=dict)
    comment: str = ""


class ChecklistAttachmentOut(BaseModel):
    id: int
    file_name: str
    content_type: str
    size_bytes: int
    created_at: datetime


class ChecklistRunOut(BaseModel):
    id: int
    template_id: int
    organization_id: int
    location_id: Optional[int] = None
    auditor_user_id: int
    status: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    updated_at: datetime


class ChecklistRunDetailOut(ChecklistRunOut):
    template: ChecklistTemplateOut
    questions: List[Dict[str, Any]] = Field(default_factory=list)
    answered_count: int = 0
    total_questions: int = 0
