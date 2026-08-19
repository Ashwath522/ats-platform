import os
import sys

import pytest
from sqlmodel import Session, SQLModel, create_engine

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.api.recruiter import _require_owned_company
from app.db import Company


def test_require_owned_company_rejects_other_recruiter():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        company = Company(name="Acme", owner_username="alice")
        session.add(company)
        session.commit()
        session.refresh(company)

        with pytest.raises(Exception) as exc_info:
            _require_owned_company(session, company.id, "bob")

        assert exc_info.value.status_code == 403


def test_require_owned_company_allows_owner():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        company = Company(name="Acme", owner_username="alice")
        session.add(company)
        session.commit()
        session.refresh(company)

        assert _require_owned_company(session, company.id, "alice").id == company.id
