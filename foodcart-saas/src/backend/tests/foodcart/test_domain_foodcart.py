"""Unit tests for Foodcart domain services."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from domain.entities import ContentBlockType
from domain.services.foodcart import (
    URLNotAllowedError,
    apply_patch_operations,
    build_onboarding_result,
    compute_location_status,
    default_blocks_for_template,
    generate_change_preview,
    is_valid_slug,
    merge_ingestion_into_blocks,
    normalize_slug,
    run_ingestion_job,
    sign_preview_token,
    suggest_slugs,
    validate_block_data,
    validate_patch_path,
    validate_public_url,
    verify_preview_token,
)


class TestSlugUtilities:
    def test_normalize_slug(self):
        assert normalize_slug("Taco Fiesta!") == "taco-fiesta"
        assert normalize_slug("--double--hyphens--") == "double-hyphens"

    def test_reserved_slug(self):
        assert is_valid_slug("admin") is False
        assert is_valid_slug("my-tacos") is True

    def test_suggest_slugs(self):
        assert suggest_slugs("tacos", {"tacos"}, 2) == ["tacos-1", "tacos-2"]


class TestURLValidation:
    def test_allows_public_url(self):
        assert validate_public_url("https://example.com/path") == "https://example.com/path"

    def test_rejects_non_http_scheme(self):
        with pytest.raises(URLNotAllowedError):
            validate_public_url("ftp://example.com")

    def test_rejects_localhost(self):
        with pytest.raises(URLNotAllowedError):
            validate_public_url("http://localhost:8000")

    def test_rejects_private_ip(self):
        with pytest.raises(URLNotAllowedError):
            validate_public_url("http://192.168.1.1")
        with pytest.raises(URLNotAllowedError):
            validate_public_url("http://10.0.0.1")


class TestHours:
    def test_open_during_hours(self):
        hours = {"monday": "09:00-17:00"}
        ref = datetime(2026, 6, 22, 14, 0, 0, tzinfo=UTC)  # Monday 10am ET
        status = compute_location_status(hours, "America/New_York", ref)
        assert status.status.value == "open"

    def test_closed_today(self):
        hours = {"monday": "09:00-17:00"}
        ref = datetime(2026, 6, 22, 22, 0, 0, tzinfo=UTC)  # Monday 6pm ET
        status = compute_location_status(hours, "America/New_York", ref)
        assert status.status.value == "closed"

    def test_closed_day_missing(self):
        hours = {"monday": "09:00-17:00"}
        ref = datetime(2026, 6, 23, 14, 0, 0, tzinfo=UTC)  # Tuesday
        status = compute_location_status(hours, "America/New_York", ref)
        assert status.status.value == "closed"


class TestBlockValidation:
    def test_hero_block(self):
        data = validate_block_data("hero", {"headline": "Hi", "cta_text": "Order"})
        assert data["headline"] == "Hi"

    def test_menu_block(self):
        data = validate_block_data(
            "menu",
            {
                "categories": [
                    {
                        "title": "Tacos",
                        "items": [{"name": "Al Pastor", "price": "$9"}],
                    }
                ]
            },
        )
        assert data["categories"][0]["title"] == "Tacos"

    def test_locations_block(self):
        data = validate_block_data(
            "locations",
            {
                "locations": [
                    {
                        "name": "Truck",
                        "timezone": "America/Los_Angeles",
                        "hours": {"monday": "11:00-21:00"},
                    }
                ]
            },
        )
        assert data["locations"][0]["timezone"] == "America/Los_Angeles"

    def test_default_blocks(self):
        blocks = default_blocks_for_template(
            "banhmi", "Test Biz", uuid.uuid4(), uuid.uuid4()
        )
        assert len(blocks) == 8
        types = {b.block_type.value for b in blocks}
        assert "hero" in types
        assert "footer" in types

    def test_unknown_block_type(self):
        with pytest.raises(ValueError):
            validate_block_data("unknown", {})


class TestAIProposals:
    def _make_blocks(self):
        return default_blocks_for_template("banhmi", "Biz", uuid.uuid4(), uuid.uuid4())

    def test_hero_headline_proposal(self):
        blocks = self._make_blocks()
        preview = generate_change_preview(
            "Change hero headline to Summer Specials", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert preview.in_scope is True
        assert preview.operations[0].path == "/blocks/hero/data/headline"
        assert preview.operations[0].value == "Summer Specials"

    def test_hero_image_proposal(self):
        blocks = self._make_blocks()
        preview = generate_change_preview(
            "Change hero image", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert any("image_url" in op.path for op in preview.operations)

    def test_add_vegan_section(self):
        blocks = self._make_blocks()
        preview = generate_change_preview(
            "Add a vegan section to the menu", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert preview.in_scope is True
        assert any("/blocks/menu/data/categories" in op.path for op in preview.operations)

    def test_add_menu_item(self):
        blocks = self._make_blocks()
        preview = generate_change_preview(
            "Add falafel wrap $9", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert preview.in_scope is True
        assert any("items" in op.path for op in preview.operations)

    def test_update_hours(self):
        blocks = self._make_blocks()
        preview = generate_change_preview(
            "Update Friday hours to 11pm", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert preview.in_scope is True
        assert any("friday" in op.path for op in preview.operations)

    def test_update_story(self):
        blocks = self._make_blocks()
        preview = generate_change_preview(
            "Make the story shorter", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert preview.in_scope is True
        assert any("story" in op.path for op in preview.operations)

    def test_update_catering(self):
        blocks = self._make_blocks()
        preview = generate_change_preview(
            "Mention wedding catering", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert preview.in_scope is True
        assert any("catering" in op.path for op in preview.operations)

    def test_add_social_link(self):
        blocks = self._make_blocks()
        preview = generate_change_preview(
            "Link our Instagram", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert preview.in_scope is True
        assert any("social_links" in op.path for op in preview.operations)

    def test_add_order_link(self):
        blocks = self._make_blocks()
        preview = generate_change_preview(
            "Link doordash ordering", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert preview.in_scope is True
        assert any("social_links" in op.path for op in preview.operations)

    def test_unrecognized_link_no_operations(self):
        blocks = self._make_blocks()
        preview = generate_change_preview(
            "Link our social page", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert preview.in_scope is True
        assert preview.operations == []

    def test_billing_out_of_scope(self):
        blocks = self._make_blocks()
        preview = generate_change_preview(
            "Change my subscription plan", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert preview.in_scope is False

    def test_slug_out_of_scope(self):
        blocks = self._make_blocks()
        preview = generate_change_preview(
            "Change my slug to better", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert preview.in_scope is False

    def test_prompt_too_long(self):
        blocks = self._make_blocks()
        preview = generate_change_preview("x" * 2001, blocks, uuid.uuid4(), uuid.uuid4())
        assert preview.in_scope is False


class TestPatchApplication:
    def _make_blocks(self):
        return default_blocks_for_template("banhmi", "Biz", uuid.uuid4(), uuid.uuid4())

    def test_replace_hero_headline(self):
        blocks = self._make_blocks()
        ops = [{"op": "replace", "path": "/blocks/hero/data/headline", "value": "New"}]
        apply_patch_operations(blocks, ops)
        hero = next(b for b in blocks if b.block_type == ContentBlockType.HERO)
        assert hero.data["headline"] == "New"

    def test_add_menu_category(self):
        blocks = self._make_blocks()
        ops = [
            {
                "op": "add",
                "path": "/blocks/menu/data/categories",
                "value": {"title": "Vegan", "items": []},
            }
        ]
        apply_patch_operations(blocks, ops)
        menu = next(b for b in blocks if b.block_type == ContentBlockType.MENU)
        assert any(c["title"] == "Vegan" for c in menu.data["categories"])

    def test_replace_menu_category_title(self):
        blocks = self._make_blocks()
        ops = [
            {
                "op": "replace",
                "path": "/blocks/menu/data/categories/0/title",
                "value": "Updated",
            }
        ]
        apply_patch_operations(blocks, ops)
        menu = next(b for b in blocks if b.block_type == ContentBlockType.MENU)
        assert menu.data["categories"][0]["title"] == "Updated"

    def test_add_menu_item(self):
        blocks = self._make_blocks()
        ops = [
            {
                "op": "add",
                "path": "/blocks/menu/data/categories/0/items/-",
                "value": {"name": "Falafel", "price": "$9"},
            }
        ]
        apply_patch_operations(blocks, ops)
        menu = next(b for b in blocks if b.block_type == ContentBlockType.MENU)
        assert any(i["name"] == "Falafel" for i in menu.data["categories"][0]["items"])

    def test_replace_menu_item(self):
        blocks = self._make_blocks()
        ops = [
            {
                "op": "replace",
                "path": "/blocks/menu/data/categories/0/items/0",
                "value": {"name": "New Item", "price": "$10"},
            }
        ]
        apply_patch_operations(blocks, ops)
        menu = next(b for b in blocks if b.block_type == ContentBlockType.MENU)
        assert menu.data["categories"][0]["items"][0]["name"] == "New Item"

    def test_remove_menu_item(self):
        blocks = self._make_blocks()
        ops = [{"op": "remove", "path": "/blocks/menu/data/categories/0/items/0"}]
        apply_patch_operations(blocks, ops)
        menu = next(b for b in blocks if b.block_type == ContentBlockType.MENU)
        assert len(menu.data["categories"][0]["items"]) == 0

    def test_replace_location_hours(self):
        blocks = self._make_blocks()
        ops = [
            {
                "op": "replace",
                "path": "/blocks/locations/data/locations/0/hours/friday",
                "value": "11:00-23:00",
            }
        ]
        apply_patch_operations(blocks, ops)
        locs = next(b for b in blocks if b.block_type == ContentBlockType.LOCATIONS)
        assert locs.data["locations"][0]["hours"]["friday"] == "11:00-23:00"

    def test_replace_location_name(self):
        blocks = self._make_blocks()
        ops = [
            {
                "op": "replace",
                "path": "/blocks/locations/data/locations/0/name",
                "value": "New Truck",
            }
        ]
        apply_patch_operations(blocks, ops)
        locs = next(b for b in blocks if b.block_type == ContentBlockType.LOCATIONS)
        assert locs.data["locations"][0]["name"] == "New Truck"

    def test_replace_contact_email(self):
        blocks = self._make_blocks()
        ops = [
            {
                "op": "replace",
                "path": "/blocks/contact/data/email",
                "value": "a@example.com",
            }
        ]
        apply_patch_operations(blocks, ops)
        contact = next(b for b in blocks if b.block_type == ContentBlockType.CONTACT)
        assert contact.data["email"] == "a@example.com"

    def test_replace_order_links(self):
        blocks = self._make_blocks()
        ops = [
            {
                "op": "replace",
                "path": "/blocks/order_links/data/links",
                "value": [{"platform": "doordash", "url": "https://dd.com"}],
            }
        ]
        apply_patch_operations(blocks, ops)
        ol = next(b for b in blocks if b.block_type == ContentBlockType.ORDER_LINKS)
        assert ol.data["links"][0]["platform"] == "doordash"

    def test_replace_footer_copyright(self):
        blocks = self._make_blocks()
        ops = [
            {
                "op": "replace",
                "path": "/blocks/footer/data/copyright",
                "value": "© 2027",
            }
        ]
        apply_patch_operations(blocks, ops)
        footer = next(b for b in blocks if b.block_type == ContentBlockType.FOOTER)
        assert footer.data["copyright"] == "© 2027"

    def test_invalid_path_rejected(self):
        blocks = self._make_blocks()
        with pytest.raises(ValueError):
            apply_patch_operations(
                blocks, [{"op": "replace", "path": "/blocks/hero/data/unknown", "value": "x"}]
            )

    def test_invalid_block_type_rejected(self):
        with pytest.raises(ValueError):
            validate_patch_path("/blocks/bad/data/field")

    def test_invalid_order_links_path(self):
        blocks = self._make_blocks()
        with pytest.raises(ValueError):
            apply_patch_operations(
                blocks,
                [{"op": "replace", "path": "/blocks/order_links/data/bad", "value": "x"}],
            )


class TestPreviewTokens:
    def test_sign_and_verify(self):
        site_id = uuid.uuid4()
        token = sign_preview_token(site_id, "secret")
        assert verify_preview_token(token, site_id, "secret") is True

    def test_wrong_site_rejected(self):
        token = sign_preview_token(uuid.uuid4(), "secret")
        assert verify_preview_token(token, uuid.uuid4(), "secret") is False

    def test_expired_token_rejected(self):
        site_id = uuid.uuid4()
        token = sign_preview_token(site_id, "secret", ttl_seconds=-1)
        assert verify_preview_token(token, site_id, "secret") is False

    def test_malformed_token_rejected(self):
        assert verify_preview_token("not-a-token", uuid.uuid4(), "secret") is False


class TestIngestionRunner:
    def test_google_business_job(self):
        from domain.entities import IngestionJob, IngestionJobStatus, IngestionSourceType

        job = IngestionJob(
            id=uuid.uuid4(),
            site_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            source_type=IngestionSourceType.GOOGLE_BUSINESS,
            source_url="https://example.com",
            status=IngestionJobStatus.PENDING,
        )
        run_ingestion_job(job)
        assert job.status == IngestionJobStatus.COMPLETED

    def test_yelp_job(self):
        from domain.entities import IngestionJob, IngestionJobStatus, IngestionSourceType

        job = IngestionJob(
            id=uuid.uuid4(),
            site_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            source_type=IngestionSourceType.YELP,
            source_url="https://example.com",
            status=IngestionJobStatus.PENDING,
        )
        run_ingestion_job(job)
        assert job.status == IngestionJobStatus.COMPLETED

    def test_menu_url_job(self):
        from domain.entities import IngestionJob, IngestionJobStatus, IngestionSourceType

        job = IngestionJob(
            id=uuid.uuid4(),
            site_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            source_type=IngestionSourceType.MENU_URL,
            source_url="https://example.com",
            status=IngestionJobStatus.PENDING,
        )
        run_ingestion_job(job)
        assert job.status == IngestionJobStatus.COMPLETED

    def test_website_job(self):
        from domain.entities import IngestionJob, IngestionJobStatus, IngestionSourceType

        job = IngestionJob(
            id=uuid.uuid4(),
            site_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            source_type=IngestionSourceType.WEBSITE,
            source_url="https://example.com",
            status=IngestionJobStatus.PENDING,
        )
        run_ingestion_job(job)
        assert job.status == IngestionJobStatus.COMPLETED

    def test_social_links_job(self):
        from domain.entities import IngestionJob, IngestionJobStatus, IngestionSourceType

        job = IngestionJob(
            id=uuid.uuid4(),
            site_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            source_type=IngestionSourceType.SOCIAL_LINKS,
            source_url="manual-links",
            status=IngestionJobStatus.PENDING,
            raw_payload={"links": [{"platform": "instagram", "url": "https://ig.com"}]},
        )
        run_ingestion_job(job)
        assert job.status == IngestionJobStatus.COMPLETED
        assert job.normalized_data["social_links"][0]["platform"] == "instagram"

    def test_localhost_job_fails(self):
        from domain.entities import IngestionJob, IngestionJobStatus, IngestionSourceType

        job = IngestionJob(
            id=uuid.uuid4(),
            site_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            source_type=IngestionSourceType.WEBSITE,
            source_url="http://localhost",
            status=IngestionJobStatus.PENDING,
        )
        run_ingestion_job(job)
        assert job.status == IngestionJobStatus.FAILED

    def test_private_url_job_fails(self):
        from domain.entities import IngestionJob, IngestionJobStatus, IngestionSourceType

        job = IngestionJob(
            id=uuid.uuid4(),
            site_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            source_type=IngestionSourceType.WEBSITE,
            source_url="http://localhost/admin",
            status=IngestionJobStatus.PENDING,
        )
        run_ingestion_job(job)
        assert job.status == IngestionJobStatus.FAILED
        assert job.errors


class TestMergeIngestion:
    def test_merge_updates_blocks(self):
        blocks = default_blocks_for_template("banhmi", "Biz", uuid.uuid4(), uuid.uuid4())
        normalized = {
            "name": "Merged Name",
            "phone": "555-1234",
            "hours": {"monday": "10:00-22:00"},
            "order_links": [{"platform": "doordash", "url": "https://dd.com"}],
        }
        blocks = merge_ingestion_into_blocks(blocks, normalized)
        hero = next(b for b in blocks if b.block_type == ContentBlockType.HERO)
        contact = next(b for b in blocks if b.block_type == ContentBlockType.CONTACT)
        locs = next(b for b in blocks if b.block_type == ContentBlockType.LOCATIONS)
        ol = next(b for b in blocks if b.block_type == ContentBlockType.ORDER_LINKS)
        assert hero.data["headline"] == "Merged Name"
        assert contact.data["phone"] == "555-1234"
        assert locs.data["locations"][0]["hours"]["monday"] == "10:00-22:00"
        assert ol.data["links"][0]["platform"] == "doordash"


class TestOnboardingBuilder:
    def test_build_result(self):
        tenant_id = uuid.uuid4()
        user_id = uuid.uuid4()
        brand_colors = {"primary": "#2563eb", "secondary": "#f5f5f5", "background": "#ffffff"}
        tenant, site = build_onboarding_result(
            user_id, tenant_id, "Tacos", "tacos", "custom", brand_colors
        )
        assert tenant.slug == "tacos"
        assert site.tenant_id == tenant_id
        assert site.slug == "tacos"
        assert site.brand_colors == brand_colors
