"""Extended tenant isolation and RBAC regression tests."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.dependencies import create_access_token
from infrastructure.models import Tenant, User


def _user_in_tenant(db: Session, tenant: Tenant, email: str, role: str = "owner") -> dict:
    user = User(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=email,
        name=email.split("@")[0].title(),
        role=role,
    )
    db.add(user)
    db.commit()
    token = create_access_token(
        user_id=user.id,
        email=user.email,
        name=user.name,
        tenant_id=user.tenant_id,
    )
    return {
        "user": user,
        "tenant": tenant,
        "token": token,
        "headers": {"Authorization": f"Bearer {token}"},
    }


def _other_user(db: Session):
    tenant = Tenant(name="Other Tenant")
    db.add(tenant)
    db.flush()
    return _user_in_tenant(db, tenant, "other@example.com", "owner")


class TestCrossTenantMutations:
    def test_cannot_update_other_tenant_site(self, client: TestClient, onboarded, db: Session):
        other = _other_user(db)
        response = client.patch(
            f"/api/v1/sites/{onboarded['site']['id']}",
            json={"publish_state": "published"},
            headers=other["headers"],
        )
        assert response.status_code == 404

    def test_cannot_delete_other_tenant_site(self, client: TestClient, onboarded, db: Session):
        other = _other_user(db)
        response = client.delete(
            f"/api/v1/sites/{onboarded['site']['id']}",
            headers=other["headers"],
        )
        assert response.status_code == 404

    def test_cannot_add_block_to_other_tenant_site(
        self, client: TestClient, onboarded, db: Session
    ):
        other = _other_user(db)
        response = client.post(
            f"/api/v1/sites/{onboarded['site']['id']}/content/blocks",
            json={
                "block_type": "hero",
                "schema_version": "1.0",
                "data": {"headline": "Hacked"},
                "sort_order": 0,
            },
            headers=other["headers"],
        )
        assert response.status_code == 404

    def test_cannot_update_other_tenant_block(self, client: TestClient, onboarded, db: Session):
        other = _other_user(db)
        blocks = client.get(
            f"/api/v1/sites/{onboarded['site']['id']}/content",
            headers=onboarded["user"]["headers"],
        ).json()["blocks"]
        hero = next(b for b in blocks if b["block_type"] == "hero")
        response = client.put(
            f"/api/v1/sites/{onboarded['site']['id']}/content/blocks/{hero['id']}",
            json={
                "block_type": "hero",
                "schema_version": "1.0",
                "data": {"headline": "Hacked"},
                "sort_order": 0,
            },
            headers=other["headers"],
        )
        assert response.status_code == 404

    def test_cannot_trigger_ingestion_for_other_tenant(
        self, client: TestClient, onboarded, db: Session
    ):
        other = _other_user(db)
        response = client.post(
            f"/api/v1/sites/{onboarded['site']['id']}/ingest",
            json={"website_url": "https://example.com"},
            headers=other["headers"],
        )
        assert response.status_code == 404

    def test_cannot_list_other_tenant_ingestion_jobs(
        self, client: TestClient, onboarded, db: Session
    ):
        other = _other_user(db)
        response = client.get(
            f"/api/v1/sites/{onboarded['site']['id']}/ingest/jobs",
            headers=other["headers"],
        )
        assert response.status_code == 404

    def test_cannot_revert_other_tenant_revision(self, client: TestClient, onboarded, db: Session):
        # Create a revision for the owner.
        propose = client.post(
            f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
            json={"prompt": "Change hero headline to Revert Test"},
            headers=onboarded["user"]["headers"],
        ).json()
        apply_resp = client.post(
            f"/api/v1/sites/{onboarded['site']['id']}/ai/apply",
            json={"proposal_id": propose["proposal_id"], "confirmed": True},
            headers=onboarded["user"]["headers"],
        ).json()

        other = _other_user(db)
        response = client.post(
            f"/api/v1/sites/{onboarded['site']['id']}/revisions/{apply_resp['id']}/revert",
            headers=other["headers"],
        )
        assert response.status_code == 404

    def test_cannot_apply_ai_for_other_tenant(self, client: TestClient, onboarded, db: Session):
        propose = client.post(
            f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
            json={"prompt": "Change hero headline to Other"},
            headers=onboarded["user"]["headers"],
        ).json()

        other = _other_user(db)
        response = client.post(
            f"/api/v1/sites/{onboarded['site']['id']}/ai/apply",
            json={"proposal_id": propose["proposal_id"], "confirmed": True},
            headers=other["headers"],
        )
        assert response.status_code == 404

    def test_cannot_create_site_in_other_tenant(self, client: TestClient, onboarded, db: Session):
        # There is no endpoint to create a site in a different tenant; this verifies
        # the token-bound tenant scope by checking a user from another tenant cannot
        # infer/create resources via the site create endpoint.
        other = _other_user(db)
        response = client.post(
            "/api/v1/sites",
            json={"slug": "owner-copy", "template_id": "banhmi"},
            headers=other["headers"],
        )
        assert response.status_code == 201  # creates site in OTHER tenant
        # Verify the owner tenant does not have this slug.
        owner_sites = client.get("/api/v1/sites", headers=onboarded["user"]["headers"]).json()
        assert not any(s["slug"] == "owner-copy" for s in owner_sites)


class TestRbacWithinTenant:
    def test_member_cannot_onboard(self, client: TestClient, seeded_user, db: Session):
        # Downgrade user to member in the same tenant.
        seeded_user["user"].role = "member"
        db.commit()
        response = client.post(
            "/api/v1/tenants/onboard",
            json={"business_name": "Member Biz", "slug": "member-biz", "template_id": "banhmi"},
            headers=seeded_user["headers"],
        )
        assert response.status_code == 403

    def test_member_cannot_create_site(self, client: TestClient, seeded_user, db: Session):
        seeded_user["user"].role = "member"
        db.commit()
        response = client.post(
            "/api/v1/sites",
            json={"slug": "member-site", "template_id": "banhmi"},
            headers=seeded_user["headers"],
        )
        assert response.status_code == 403

    def test_member_can_read_content(self, client: TestClient, onboarded, db: Session):
        member = _user_in_tenant(
            db, onboarded["user"]["tenant"], "member-read@example.com", "member"
        )
        response = client.get(
            f"/api/v1/sites/{onboarded['site']['id']}/content",
            headers=member["headers"],
        )
        assert response.status_code == 200

    def test_editor_can_propose_ai_change(self, client: TestClient, onboarded, db: Session):
        editor = _user_in_tenant(db, onboarded["user"]["tenant"], "editor@example.com", "editor")
        response = client.post(
            f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
            json={"prompt": "Change hero headline to Editor"},
            headers=editor["headers"],
        )
        assert response.status_code == 200

    def test_member_cannot_propose_ai_change(self, client: TestClient, onboarded, db: Session):
        member = _user_in_tenant(db, onboarded["user"]["tenant"], "member@example.com", "member")
        response = client.post(
            f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
            json={"prompt": "Change hero headline to Member"},
            headers=member["headers"],
        )
        assert response.status_code == 403
