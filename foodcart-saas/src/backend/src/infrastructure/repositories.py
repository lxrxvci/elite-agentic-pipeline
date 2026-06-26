"""SQLAlchemy repositories with tenant isolation."""

from __future__ import annotations

import builtins
import uuid
from typing import TypeVar

from sqlalchemy.orm import Session

from domain.entities import (
    AIRequest,
    AIRequestStatus,
    Client,
    ContentBlock,
    ContentBlockType,
    FoodcartBillingStatus,
    FoodcartTenant,
    FoodcartTenantStatus,
    IngestionJob,
    IngestionJobStatus,
    IngestionSourceType,
    Invoice,
    InvoiceLineItem,
    InvoiceStatus,
    Project,
    Revision,
    RevisionSource,
    Site,
    SitePublishState,
    Tenant,
    TimeEntry,
    TimeEntryStatus,
    User,
)
from domain.value_objects import Money
from infrastructure import models

T = TypeVar("T")


class BaseRepository[T]:
    def __init__(self, session: Session, tenant_id: uuid.UUID) -> None:
        self.session = session
        self.tenant_id = tenant_id


class TenantRepository(BaseRepository[Tenant]):
    def get(self) -> Tenant | None:
        orm = self.session.query(models.Tenant).filter(models.Tenant.id == self.tenant_id).first()
        if not orm:
            return None
        return Tenant(
            id=orm.id,
            name=orm.name,
            default_currency=orm.default_currency,
            default_hourly_rate=orm.default_hourly_rate,
        )

    def create(self, tenant: Tenant) -> Tenant:
        orm = models.Tenant(
            id=tenant.id,
            name=tenant.name,
            default_currency=tenant.default_currency,
            default_hourly_rate=tenant.default_hourly_rate,
        )
        self.session.add(orm)
        self.session.flush()
        return tenant


class UserRepository(BaseRepository[User]):
    def get_by_email(self, email: str) -> User | None:
        orm = (
            self.session.query(models.User)
            .filter(models.User.tenant_id == self.tenant_id)
            .filter(models.User.email == email)
            .first()
        )
        if not orm:
            return None
        return User(
            id=orm.id,
            tenant_id=orm.tenant_id,
            email=orm.email,
            name=orm.name,
        )

    def create(self, user: User) -> User:
        orm = models.User(
            id=user.id,
            tenant_id=user.tenant_id,
            email=user.email,
            name=user.name,
        )
        self.session.add(orm)
        self.session.flush()
        return user


class ClientRepository(BaseRepository[Client]):
    def list(self, limit: int = 20, offset: int = 0) -> builtins.list[Client]:
        orms = (
            self.session.query(models.Client)
            .filter(models.Client.tenant_id == self.tenant_id)
            .offset(offset)
            .limit(limit)
            .all()
        )
        return [
            Client(
                id=orm.id,
                tenant_id=orm.tenant_id,
                name=orm.name,
                email=orm.email,
                currency=orm.currency,
                default_hourly_rate=orm.default_hourly_rate,
            )
            for orm in orms
        ]

    def get(self, client_id: uuid.UUID) -> Client | None:
        orm = (
            self.session.query(models.Client)
            .filter(models.Client.tenant_id == self.tenant_id)
            .filter(models.Client.id == client_id)
            .first()
        )
        if not orm:
            return None
        return Client(
            id=orm.id,
            tenant_id=orm.tenant_id,
            name=orm.name,
            email=orm.email,
            currency=orm.currency,
            default_hourly_rate=orm.default_hourly_rate,
        )

    def create(self, client: Client) -> Client:
        orm = models.Client(
            id=client.id,
            tenant_id=client.tenant_id,
            created_by=client.created_by,
            name=client.name,
            email=client.email,
            currency=client.currency,
            default_hourly_rate=client.default_hourly_rate,
        )
        self.session.add(orm)
        self.session.flush()
        return client


class ProjectRepository(BaseRepository[Project]):
    def list(
        self, client_id: uuid.UUID | None = None, limit: int = 20, offset: int = 0
    ) -> builtins.list[Project]:
        query = self.session.query(models.Project).filter(
            models.Project.tenant_id == self.tenant_id
        )
        if client_id:
            query = query.filter(models.Project.client_id == client_id)
        orms = query.offset(offset).limit(limit).all()
        return [
            Project(
                id=orm.id,
                tenant_id=orm.tenant_id,
                client_id=orm.client_id,
                name=orm.name,
                rounding_minutes=orm.rounding_minutes,
            )
            for orm in orms
        ]

    def get(self, project_id: uuid.UUID) -> Project | None:
        orm = (
            self.session.query(models.Project)
            .filter(models.Project.tenant_id == self.tenant_id)
            .filter(models.Project.id == project_id)
            .first()
        )
        if not orm:
            return None
        return Project(
            id=orm.id,
            tenant_id=orm.tenant_id,
            client_id=orm.client_id,
            name=orm.name,
            rounding_minutes=orm.rounding_minutes,
        )

    def create(self, project: Project) -> Project:
        orm = models.Project(
            id=project.id,
            tenant_id=project.tenant_id,
            created_by=project.created_by,
            client_id=project.client_id,
            name=project.name,
            rounding_minutes=project.rounding_minutes,
        )
        self.session.add(orm)
        self.session.flush()
        return project


class TimeEntryRepository(BaseRepository[TimeEntry]):
    def list(
        self,
        client_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> builtins.list[TimeEntry]:
        query = self.session.query(models.TimeEntry).filter(
            models.TimeEntry.tenant_id == self.tenant_id
        )
        if client_id:
            query = query.filter(models.TimeEntry.client_id == client_id)
        if project_id:
            query = query.filter(models.TimeEntry.project_id == project_id)
        if status:
            query = query.filter(models.TimeEntry.status == status)
        orms = query.order_by(models.TimeEntry.created_at.desc()).offset(offset).limit(limit).all()
        return [self._to_domain(orm) for orm in orms]

    def get(self, time_entry_id: uuid.UUID) -> TimeEntry | None:
        orm = (
            self.session.query(models.TimeEntry)
            .filter(models.TimeEntry.tenant_id == self.tenant_id)
            .filter(models.TimeEntry.id == time_entry_id)
            .first()
        )
        if not orm:
            return None
        return self._to_domain(orm)

    def get_many(self, ids: builtins.list[uuid.UUID]) -> builtins.list[TimeEntry]:
        orms = (
            self.session.query(models.TimeEntry)
            .filter(models.TimeEntry.tenant_id == self.tenant_id)
            .filter(models.TimeEntry.id.in_(ids))
            .all()
        )
        return [self._to_domain(orm) for orm in orms]

    def create(self, time_entry: TimeEntry) -> TimeEntry:
        orm = models.TimeEntry(
            id=time_entry.id,
            tenant_id=time_entry.tenant_id,
            created_by=time_entry.created_by,
            client_id=time_entry.client_id,
            project_id=time_entry.project_id,
            invoice_id=time_entry.invoice_id,
            description=time_entry.description,
            duration_minutes=time_entry.duration_minutes,
            rounded_minutes=time_entry.rounded_minutes,
            status=time_entry.status.value,
            started_at=time_entry.started_at,
            ended_at=time_entry.ended_at,
        )
        self.session.add(orm)
        self.session.flush()
        return time_entry

    def update(self, time_entry: TimeEntry) -> TimeEntry:
        orm = (
            self.session.query(models.TimeEntry)
            .filter(models.TimeEntry.tenant_id == self.tenant_id)
            .filter(models.TimeEntry.id == time_entry.id)
            .first()
        )
        if not orm:
            raise ValueError("Time entry not found")
        orm.description = time_entry.description
        orm.duration_minutes = time_entry.duration_minutes
        orm.rounded_minutes = time_entry.rounded_minutes
        orm.status = time_entry.status.value
        orm.invoice_id = time_entry.invoice_id
        orm.started_at = time_entry.started_at
        orm.ended_at = time_entry.ended_at
        self.session.flush()
        return time_entry

    def _to_domain(self, orm: models.TimeEntry) -> TimeEntry:
        return TimeEntry(
            id=orm.id,
            tenant_id=orm.tenant_id,
            created_by=orm.created_by,
            client_id=orm.client_id,
            project_id=orm.project_id,
            description=orm.description,
            duration_minutes=orm.duration_minutes,
            rounded_minutes=orm.rounded_minutes,
            status=TimeEntryStatus(orm.status),
            invoice_id=orm.invoice_id,
            started_at=orm.started_at,
            ended_at=orm.ended_at,
            created_at=orm.created_at,
            updated_at=orm.updated_at,
        )


class InvoiceRepository(BaseRepository[Invoice]):
    def list(
        self,
        client_id: uuid.UUID | None = None,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> builtins.list[Invoice]:
        query = self.session.query(models.Invoice).filter(
            models.Invoice.tenant_id == self.tenant_id
        )
        if client_id:
            query = query.filter(models.Invoice.client_id == client_id)
        if status:
            query = query.filter(models.Invoice.status == status)
        orms = query.order_by(models.Invoice.created_at.desc()).offset(offset).limit(limit).all()
        return [self._to_domain(orm) for orm in orms]

    def get(self, invoice_id: uuid.UUID) -> Invoice | None:
        orm = (
            self.session.query(models.Invoice)
            .filter(models.Invoice.tenant_id == self.tenant_id)
            .filter(models.Invoice.id == invoice_id)
            .first()
        )
        if not orm:
            return None
        return self._to_domain(orm)

    def get_by_idempotency_key(self, key: str) -> Invoice | None:
        orm = (
            self.session.query(models.Invoice)
            .filter(models.Invoice.tenant_id == self.tenant_id)
            .filter(models.Invoice.idempotency_key == key)
            .first()
        )
        if not orm:
            return None
        return self._to_domain(orm)

    def create(self, invoice: Invoice) -> Invoice:
        orm = models.Invoice(
            id=invoice.id,
            tenant_id=invoice.tenant_id,
            created_by=invoice.created_by,
            client_id=invoice.client_id,
            status=invoice.status.value,
            issue_date=invoice.issue_date,
            due_date=invoice.due_date,
            subtotal_amount=invoice.subtotal.amount,
            subtotal_currency=invoice.subtotal.currency,
            tax_amount=invoice.tax.amount,
            tax_currency=invoice.tax.currency,
            total_amount=invoice.total.amount,
            total_currency=invoice.total.currency,
            notes=invoice.notes,
            idempotency_key=invoice.idempotency_key,
            payment_method=invoice.payment_method,
            paid_at=invoice.paid_at,
        )
        self.session.add(orm)
        self.session.flush()

        for line_item in invoice.line_items:
            line_orm = models.InvoiceLineItem(
                id=line_item.id,
                invoice_id=invoice.id,
                description=line_item.description,
                quantity=line_item.quantity,
                rate=line_item.rate,
                amount_amount=line_item.amount.amount,
                amount_currency=line_item.amount.currency,
                time_entry_ids=[str(te_id) for te_id in line_item.time_entry_ids],
            )
            self.session.add(line_orm)

        self.session.flush()
        return invoice

    def update(self, invoice: Invoice) -> Invoice:
        orm = (
            self.session.query(models.Invoice)
            .filter(models.Invoice.tenant_id == self.tenant_id)
            .filter(models.Invoice.id == invoice.id)
            .first()
        )
        if not orm:
            raise ValueError("Invoice not found")
        orm.status = invoice.status.value
        orm.payment_method = invoice.payment_method
        orm.paid_at = invoice.paid_at
        self.session.flush()
        return invoice

    def _to_domain(self, orm: models.Invoice) -> Invoice:
        return Invoice(
            id=orm.id,
            tenant_id=orm.tenant_id,
            created_by=orm.created_by,
            client_id=orm.client_id,
            status=InvoiceStatus(orm.status),
            issue_date=orm.issue_date,
            due_date=orm.due_date,
            subtotal=Money(amount=orm.subtotal_amount, currency=orm.subtotal_currency),
            tax=Money(amount=orm.tax_amount, currency=orm.tax_currency),
            total=Money(amount=orm.total_amount, currency=orm.total_currency),
            line_items=[
                InvoiceLineItem(
                    id=li.id,
                    description=li.description,
                    quantity=li.quantity,
                    rate=li.rate,
                    amount=Money(amount=li.amount_amount, currency=li.amount_currency),
                    time_entry_ids=[
                        uuid.UUID(te_id) if isinstance(te_id, str) else te_id
                        for te_id in li.time_entry_ids
                    ],
                )
                for li in orm.line_items
            ],
            notes=orm.notes,
            idempotency_key=orm.idempotency_key,
            payment_method=orm.payment_method,
            paid_at=orm.paid_at,
            created_at=orm.created_at,
            updated_at=orm.updated_at,
        )

# ---------------------------------------------------------------------------
# Foodcart SaaS repositories
# ---------------------------------------------------------------------------


class FoodcartTenantRepository(BaseRepository[FoodcartTenant]):
    def get(self) -> FoodcartTenant | None:
        orm = (
            self.session.query(models.FoodcartTenant)
            .filter(models.FoodcartTenant.id == self.tenant_id)
            .first()
        )
        if not orm:
            return None
        return self._to_domain(orm)

    def get_by_slug(self, slug: str) -> FoodcartTenant | None:
        orm = (
            self.session.query(models.FoodcartTenant)
            .filter(models.FoodcartTenant.slug == slug)
            .first()
        )
        if not orm:
            return None
        return self._to_domain(orm)

    def create(self, tenant: FoodcartTenant) -> FoodcartTenant:
        orm = models.FoodcartTenant(
            id=tenant.id,
            owner_user_id=tenant.owner_user_id,
            name=tenant.name,
            slug=tenant.slug,
            status=tenant.status.value,
            billing_status=tenant.billing_status.value
            if isinstance(tenant.billing_status, FoodcartBillingStatus)
            else tenant.billing_status,
            paddle_customer_id=tenant.paddle_customer_id,
            paddle_subscription_id=tenant.paddle_subscription_id,
            plan=tenant.plan,
            billing_interval=tenant.billing_interval,
            subscription_status=tenant.subscription_status,
            subscription_current_period_start=tenant.subscription_current_period_start,
            subscription_current_period_end=tenant.subscription_current_period_end,
            trial_ends_at=tenant.trial_ends_at,
            canceled_at=tenant.canceled_at,
        )
        self.session.add(orm)
        self.session.flush()
        return tenant

    def _to_domain(self, orm: models.FoodcartTenant) -> FoodcartTenant:
        return FoodcartTenant(
            id=orm.id,
            owner_user_id=orm.owner_user_id,
            name=orm.name,
            slug=orm.slug,
            status=FoodcartTenantStatus(orm.status),
            billing_status=FoodcartBillingStatus(orm.billing_status),
            paddle_customer_id=orm.paddle_customer_id,
            paddle_subscription_id=orm.paddle_subscription_id,
            plan=orm.plan,
            billing_interval=orm.billing_interval,
            subscription_status=orm.subscription_status,
            subscription_current_period_start=orm.subscription_current_period_start,
            subscription_current_period_end=orm.subscription_current_period_end,
            trial_ends_at=orm.trial_ends_at,
            canceled_at=orm.canceled_at,
            created_at=orm.created_at,
            updated_at=orm.updated_at,
        )

    def update(self, tenant: FoodcartTenant) -> FoodcartTenant:
        orm = (
            self.session.query(models.FoodcartTenant)
            .filter(models.FoodcartTenant.id == self.tenant_id)
            .first()
        )
        if not orm:
            raise ValueError("Tenant not found")
        orm.name = tenant.name
        orm.slug = tenant.slug
        orm.status = tenant.status.value
        orm.billing_status = tenant.billing_status.value
        orm.paddle_customer_id = tenant.paddle_customer_id
        orm.paddle_subscription_id = tenant.paddle_subscription_id
        orm.plan = tenant.plan
        orm.billing_interval = tenant.billing_interval
        orm.subscription_status = tenant.subscription_status
        orm.subscription_current_period_start = tenant.subscription_current_period_start
        orm.subscription_current_period_end = tenant.subscription_current_period_end
        orm.trial_ends_at = tenant.trial_ends_at
        orm.canceled_at = tenant.canceled_at
        self.session.flush()
        return tenant


class SiteRepository(BaseRepository[Site]):
    def list(self, limit: int = 20, offset: int = 0) -> builtins.list[Site]:
        orms = (
            self.session.query(models.Site)
            .filter(models.Site.tenant_id == self.tenant_id)
            .order_by(models.Site.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return [self._to_domain(orm) for orm in orms]

    def get(self, site_id: uuid.UUID) -> Site | None:
        orm = (
            self.session.query(models.Site)
            .filter(models.Site.tenant_id == self.tenant_id)
            .filter(models.Site.id == site_id)
            .first()
        )
        if not orm:
            return None
        return self._to_domain(orm)

    def get_by_slug(self, slug: str) -> Site | None:
        orm = (
            self.session.query(models.Site)
            .filter(models.Site.tenant_id == self.tenant_id)
            .filter(models.Site.slug == slug)
            .first()
        )
        if not orm:
            return None
        return self._to_domain(orm)

    def create(self, site: Site) -> Site:
        orm = models.Site(
            id=site.id,
            tenant_id=site.tenant_id,
            slug=site.slug,
            template_id=site.template_id,
            publish_state=site.publish_state.value,
            seo=site.seo or {},
            brand_colors=site.brand_colors,
            custom_domain=site.custom_domain,
        )
        self.session.add(orm)
        self.session.flush()
        return site

    def update(self, site: Site) -> Site:
        orm = (
            self.session.query(models.Site)
            .filter(models.Site.tenant_id == self.tenant_id)
            .filter(models.Site.id == site.id)
            .first()
        )
        if not orm:
            raise ValueError("Site not found")
        orm.template_id = site.template_id
        orm.publish_state = site.publish_state.value
        orm.seo = site.seo or orm.seo
        orm.brand_colors = site.brand_colors if site.brand_colors is not None else orm.brand_colors
        orm.custom_domain = site.custom_domain
        self.session.flush()
        return site

    def delete(self, site_id: uuid.UUID) -> bool:
        orm = (
            self.session.query(models.Site)
            .filter(models.Site.tenant_id == self.tenant_id)
            .filter(models.Site.id == site_id)
            .first()
        )
        if not orm:
            return False
        self.session.delete(orm)
        self.session.flush()
        return True

    def _to_domain(self, orm: models.Site) -> Site:
        return Site(
            id=orm.id,
            tenant_id=orm.tenant_id,
            slug=orm.slug,
            template_id=orm.template_id,
            publish_state=SitePublishState(orm.publish_state),
            seo=orm.seo or {},
            brand_colors=orm.brand_colors,
            custom_domain=orm.custom_domain,
            created_at=orm.created_at,
            updated_at=orm.updated_at,
        )


class ContentBlockRepository(BaseRepository[ContentBlock]):
    def list_for_site(self, site_id: uuid.UUID) -> builtins.list[ContentBlock]:
        orms = (
            self.session.query(models.ContentBlock)
            .filter(models.ContentBlock.tenant_id == self.tenant_id)
            .filter(models.ContentBlock.site_id == site_id)
            .order_by(models.ContentBlock.sort_order.asc())
            .all()
        )
        return [self._to_domain(orm) for orm in orms]

    def get(self, block_id: uuid.UUID, site_id: uuid.UUID | None = None) -> ContentBlock | None:
        query = (
            self.session.query(models.ContentBlock)
            .filter(models.ContentBlock.tenant_id == self.tenant_id)
            .filter(models.ContentBlock.id == block_id)
        )
        if site_id is not None:
            query = query.filter(models.ContentBlock.site_id == site_id)
        orm = query.first()
        if not orm:
            return None
        return self._to_domain(orm)

    def create(self, block: ContentBlock) -> ContentBlock:
        orm = models.ContentBlock(
            id=block.id,
            site_id=block.site_id,
            tenant_id=block.tenant_id,
            block_type=block.block_type.value,
            schema_version=block.schema_version,
            data=block.data,
            sort_order=block.sort_order,
        )
        self.session.add(orm)
        self.session.flush()
        return block

    def update(self, block: ContentBlock) -> ContentBlock:
        orm = (
            self.session.query(models.ContentBlock)
            .filter(models.ContentBlock.tenant_id == self.tenant_id)
            .filter(models.ContentBlock.id == block.id)
            .first()
        )
        if not orm:
            raise ValueError("Content block not found")
        orm.block_type = block.block_type.value
        orm.schema_version = block.schema_version
        orm.data = block.data
        orm.sort_order = block.sort_order
        self.session.flush()
        return block

    def delete(self, block_id: uuid.UUID) -> bool:
        orm = (
            self.session.query(models.ContentBlock)
            .filter(models.ContentBlock.tenant_id == self.tenant_id)
            .filter(models.ContentBlock.id == block_id)
            .first()
        )
        if not orm:
            return False
        self.session.delete(orm)
        self.session.flush()
        return True

    def replace_for_site(
        self, site_id: uuid.UUID, blocks: builtins.list[ContentBlock]
    ) -> None:
        """Delete all existing blocks for a site and insert the given list."""
        self.session.query(models.ContentBlock).filter(
            models.ContentBlock.tenant_id == self.tenant_id
        ).filter(models.ContentBlock.site_id == site_id).delete()
        self.session.flush()
        for block in blocks:
            self.create(block)

    def _to_domain(self, orm: models.ContentBlock) -> ContentBlock:
        return ContentBlock(
            id=orm.id,
            site_id=orm.site_id,
            tenant_id=orm.tenant_id,
            block_type=ContentBlockType(orm.block_type),
            schema_version=orm.schema_version,
            data=orm.data,
            sort_order=orm.sort_order,
            created_at=orm.created_at,
            updated_at=orm.updated_at,
        )


class RevisionRepository(BaseRepository[Revision]):
    def list_for_site(
        self, site_id: uuid.UUID, limit: int = 20, offset: int = 0
    ) -> builtins.list[Revision]:
        orms = (
            self.session.query(models.Revision)
            .filter(models.Revision.tenant_id == self.tenant_id)
            .filter(models.Revision.site_id == site_id)
            .order_by(models.Revision.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return [self._to_domain(orm) for orm in orms]

    def get(self, revision_id: uuid.UUID, site_id: uuid.UUID | None = None) -> Revision | None:
        query = (
            self.session.query(models.Revision)
            .filter(models.Revision.tenant_id == self.tenant_id)
            .filter(models.Revision.id == revision_id)
        )
        if site_id is not None:
            query = query.filter(models.Revision.site_id == site_id)
        orm = query.first()
        if not orm:
            return None
        return self._to_domain(orm)

    def create(self, revision: Revision) -> Revision:
        orm = models.Revision(
            id=revision.id,
            site_id=revision.site_id,
            tenant_id=revision.tenant_id,
            triggered_by=revision.triggered_by,
            source=revision.source.value,
            ai_request_id=revision.ai_request_id,
            snapshot=revision.snapshot,
        )
        self.session.add(orm)
        self.session.flush()
        revision.id = orm.id
        return revision

    def _to_domain(self, orm: models.Revision) -> Revision:
        return Revision(
            id=orm.id,
            site_id=orm.site_id,
            tenant_id=orm.tenant_id,
            triggered_by=orm.triggered_by,
            source=RevisionSource(orm.source),
            ai_request_id=orm.ai_request_id,
            snapshot=orm.snapshot,
            created_at=orm.created_at,
        )


class IngestionJobRepository(BaseRepository[IngestionJob]):
    def list_for_site(
        self, site_id: uuid.UUID, limit: int = 20, offset: int = 0
    ) -> builtins.list[IngestionJob]:
        orms = (
            self.session.query(models.IngestionJob)
            .filter(models.IngestionJob.tenant_id == self.tenant_id)
            .filter(models.IngestionJob.site_id == site_id)
            .order_by(models.IngestionJob.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return [self._to_domain(orm) for orm in orms]

    def get(self, job_id: uuid.UUID, site_id: uuid.UUID | None = None) -> IngestionJob | None:
        query = (
            self.session.query(models.IngestionJob)
            .filter(models.IngestionJob.tenant_id == self.tenant_id)
            .filter(models.IngestionJob.id == job_id)
        )
        if site_id is not None:
            query = query.filter(models.IngestionJob.site_id == site_id)
        orm = query.first()
        if not orm:
            return None
        return self._to_domain(orm)

    def create(self, job: IngestionJob) -> IngestionJob:
        orm = models.IngestionJob(
            id=job.id,
            site_id=job.site_id,
            tenant_id=job.tenant_id,
            source_type=job.source_type.value,
            source_url=job.source_url,
            status=job.status.value,
            normalized_data=job.normalized_data,
            errors=job.errors,
            raw_payload=job.raw_payload,
            proposed_blocks=job.proposed_blocks,
        )
        self.session.add(orm)
        self.session.flush()
        job.id = orm.id
        return job

    def update(self, job: IngestionJob) -> IngestionJob:
        orm = (
            self.session.query(models.IngestionJob)
            .filter(models.IngestionJob.tenant_id == self.tenant_id)
            .filter(models.IngestionJob.id == job.id)
            .first()
        )
        if not orm:
            raise ValueError("Ingestion job not found")
        orm.status = job.status.value
        orm.normalized_data = job.normalized_data
        orm.errors = job.errors
        orm.raw_payload = job.raw_payload
        orm.proposed_blocks = job.proposed_blocks
        self.session.flush()
        return job

    def _to_domain(self, orm: models.IngestionJob) -> IngestionJob:
        return IngestionJob(
            id=orm.id,
            site_id=orm.site_id,
            tenant_id=orm.tenant_id,
            source_type=IngestionSourceType(orm.source_type),
            source_url=orm.source_url,
            status=IngestionJobStatus(orm.status),
            normalized_data=orm.normalized_data,
            errors=orm.errors or [],
            raw_payload=orm.raw_payload,
            proposed_blocks=orm.proposed_blocks or [],
            created_at=orm.created_at,
            updated_at=orm.updated_at,
        )


class AIRequestRepository(BaseRepository[AIRequest]):
    def get(self, request_id: uuid.UUID) -> AIRequest | None:
        orm = (
            self.session.query(models.AIRequest)
            .filter(models.AIRequest.tenant_id == self.tenant_id)
            .filter(models.AIRequest.id == request_id)
            .first()
        )
        if not orm:
            return None
        return self._to_domain(orm)

    def create(self, ai_request: AIRequest) -> AIRequest:
        orm = models.AIRequest(
            id=ai_request.id,
            tenant_id=ai_request.tenant_id,
            site_id=ai_request.site_id,
            user_id=ai_request.user_id,
            prompt=ai_request.prompt,
            prompt_hash=ai_request.prompt_hash,
            model=ai_request.model,
            status=ai_request.status.value,
            proposed_patch=ai_request.proposed_patch,
            applied_revision_id=ai_request.applied_revision_id,
        )
        self.session.add(orm)
        self.session.flush()
        ai_request.id = orm.id
        return ai_request

    def update(self, ai_request: AIRequest) -> AIRequest:
        orm = (
            self.session.query(models.AIRequest)
            .filter(models.AIRequest.tenant_id == self.tenant_id)
            .filter(models.AIRequest.id == ai_request.id)
            .first()
        )
        if not orm:
            raise ValueError("AI request not found")
        orm.status = ai_request.status.value
        orm.applied_revision_id = ai_request.applied_revision_id
        self.session.flush()
        return ai_request

    def _to_domain(self, orm: models.AIRequest) -> AIRequest:
        return AIRequest(
            id=orm.id,
            tenant_id=orm.tenant_id,
            site_id=orm.site_id,
            user_id=orm.user_id,
            prompt=orm.prompt,
            prompt_hash=orm.prompt_hash,
            model=orm.model,
            status=AIRequestStatus(orm.status),
            proposed_patch=orm.proposed_patch or [],
            applied_revision_id=orm.applied_revision_id,
            created_at=orm.created_at,
            updated_at=orm.updated_at,
        )
