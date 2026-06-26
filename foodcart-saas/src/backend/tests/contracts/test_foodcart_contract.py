"""Pact provider verification for the Foodcart API."""

from __future__ import annotations

import contextlib
import os
import threading
import time
import uuid
from collections.abc import Generator
from pathlib import Path

import pytest
import uvicorn
from pact import Verifier
from sqlalchemy import create_engine

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("ENV", "development")

from infrastructure.database import Base, SessionLocal, get_db  # noqa: E402
from infrastructure.models import ContentBlock, FoodcartTenant, Site, Tenant, User  # noqa: E402
from main import app  # noqa: E402

CONTRACT_DB_PATH = Path(__file__).parent.parent.parent / "pact_contract.db"
CONTRACT_DATABASE_URL = f"sqlite:///{CONTRACT_DB_PATH}?check_same_thread=false"

PROVIDER_HOST = "127.0.0.1"
PROVIDER_PORT = 8766
PROVIDER_BASE_URL = f"http://{PROVIDER_HOST}:{PROVIDER_PORT}"
PACTS_DIR = (
    Path(__file__).parent.parent.parent.parent.parent / "src" / "frontend" / "pacts" / "foodcart"
)

CONTRACT_USER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
CONTRACT_TENANT_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
CONTRACT_SITE_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")


def _wait_for_server(url: str, timeout: float = 10.0) -> None:
    import urllib.request

    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=1):
                return
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(0.1)
    msg = f"Server did not start within {timeout}s"
    raise RuntimeError(msg) from last_error


@contextlib.contextmanager
def _running_backend() -> Generator[str, None, None]:
    config = uvicorn.Config(
        "main:app",
        host=PROVIDER_HOST,
        port=PROVIDER_PORT,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    try:
        _wait_for_server(PROVIDER_BASE_URL)
        yield PROVIDER_BASE_URL
    finally:
        server.should_exit = True
        thread.join(timeout=5)


@pytest.fixture(scope="module", autouse=True)
def _prepare_database():
    """Bind the app to a dedicated SQLite DB for the duration of this module."""
    original_bind = SessionLocal.kw.get("bind")
    contract_engine = create_engine(CONTRACT_DATABASE_URL)
    SessionLocal.configure(bind=contract_engine)
    CONTRACT_DB_PATH.unlink(missing_ok=True)
    Base.metadata.create_all(bind=contract_engine)

    # The root conftest globally overrides get_db for unit/integration tests.
    # Provider verification must use the real dependency so the state handlers
    # and request handlers share the same contract database.
    original_override = app.dependency_overrides.pop(get_db, None)

    yield

    if original_override is not None:
        app.dependency_overrides[get_db] = original_override
    else:
        app.dependency_overrides.pop(get_db, None)
    SessionLocal.configure(bind=original_bind)
    time.sleep(0.2)
    CONTRACT_DB_PATH.unlink(missing_ok=True)


def _seed_contract_user() -> None:
    with SessionLocal() as db:
        existing_tenant = db.query(Tenant).filter(Tenant.id == CONTRACT_TENANT_ID).first()
        if not existing_tenant:
            tenant = Tenant(
                id=CONTRACT_TENANT_ID,
                name="Contract Tenant",
                default_currency="USD",
            )
            db.add(tenant)
        existing_user = db.query(User).filter(User.id == CONTRACT_USER_ID).first()
        if not existing_user:
            user = User(
                id=CONTRACT_USER_ID,
                tenant_id=CONTRACT_TENANT_ID,
                email="contract@example.com",
                name="Contract User",
                role="owner",
            )
            db.add(user)
        db.commit()


def _seed_contract_site() -> None:
    _seed_contract_user()
    with SessionLocal() as db:
        existing_ft = (
            db.query(FoodcartTenant).filter(FoodcartTenant.id == CONTRACT_TENANT_ID).first()
        )
        if not existing_ft:
            foodcart_tenant = FoodcartTenant(
                id=CONTRACT_TENANT_ID,
                owner_user_id=CONTRACT_USER_ID,
                name="Contract Tenant",
                slug="contract-bites",
                status="active",
                billing_status="trial",
            )
            db.add(foodcart_tenant)
        existing_site = db.query(Site).filter(Site.id == CONTRACT_SITE_ID).first()
        if not existing_site:
            site = Site(
                id=CONTRACT_SITE_ID,
                tenant_id=CONTRACT_TENANT_ID,
                slug="contract-bites",
                template_id="custom",
                publish_state="published",
                seo={"title": "Contract Bites", "description": "Tasty contract food"},
                brand_colors={
                    "primary": "#2563eb",
                    "secondary": "#f5f5f5",
                    "background": "#ffffff",
                },
            )
            db.add(site)
            block = ContentBlock(
                id=uuid.UUID("44444444-4444-4444-4444-444444444444"),
                site_id=CONTRACT_SITE_ID,
                tenant_id=CONTRACT_TENANT_ID,
                block_type="hero",
                schema_version="1.0",
                data={"headline": "Contract Bites"},
                sort_order=0,
            )
            db.add(block)
        db.commit()


def _setup_auth(**_kwargs: object) -> None:
    """Provider state: an authenticated owner exists and onboarding is possible."""
    with SessionLocal() as db:
        db.query(Site).filter(Site.tenant_id == CONTRACT_TENANT_ID).delete()
        db.query(FoodcartTenant).filter(FoodcartTenant.id == CONTRACT_TENANT_ID).delete()
        db.commit()
    _seed_contract_user()


def _setup_site(**_kwargs: object) -> None:
    """Provider state: a tenant and published site exist."""
    _seed_contract_user()
    _seed_contract_site()


@pytest.mark.skipif(not list(PACTS_DIR.glob("*.json")), reason="No foodcart pact contracts found")
def test_foodcart_provider() -> None:
    with _running_backend() as base_url:
        verifier = Verifier(name="elite-backend", host=PROVIDER_HOST)
        for pact in PACTS_DIR.glob("*.json"):
            verifier.add_source(str(pact))
        verifier.add_transport(url=base_url)
        verifier.state_handler(
            {
                "an authenticated owner exists": _setup_auth,
                "a tenant and published site exist": _setup_site,
            }
        )
        try:
            verifier.verify()
        except RuntimeError as exc:
            pytest.fail(f"Foodcart Pact provider verification failed: {exc}")
