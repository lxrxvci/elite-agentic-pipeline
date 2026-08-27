import { pgEnum } from "drizzle-orm/pg-core";

/**
 * All enumerated value sets, matching the values enumerated in the
 * engineering handoff (HANDOFF §6, §7, §11, §16-§20, §22).
 */

// §11 - six roles; owner/admin see everything, client/cpa are portal-only.
export const userRoleEnum = pgEnum("user_role", [
  "owner",
  "admin",
  "manager",
  "bookkeeper",
  "client",
  "cpa",
]);

// §6.4 - recurring rule cadence.
export const scheduleTypeEnum = pgEnum("schedule_type", [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
]);

// §6.5 - bookkeeping_frequency (books-close cadence) and billing_frequency
// (invoice cadence) are distinct concepts but share the same value set;
// bank_feed_frequency and report frequencies reuse it too.
export const frequencyEnum = pgEnum("frequency", [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
]);

// §5 - monthly close tier: delivery promised by the 5th, 10th, or 15th of
// the following month. Stored as the day-of-month digits so the value
// round-trips to the integer tier day used by the attribution rules.
export const closeTierEnum = pgEnum("close_tier", ["5", "10", "15"]);

// §7 - Task.
export const taskTypeEnum = pgEnum("task_type", [
  "recurring",
  "onboarding",
  "project",
  "ad_hoc",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "new",
  "open",
  "pending",
  "not_started",
  "in_progress",
  "completed",
  "cancelled",
  "waiting_on_client",
  "blocked", // onboarding only
]);

export const billableStatusEnum = pgEnum("billable_status", [
  "billable",
  "non_billable",
  "not_sure",
]);

// §7 - Billing.
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "paid",
  "overdue",
  "void",
]);

export const lineTypeEnum = pgEnum("line_type", [
  "recurring",
  "task",
  "quickbooks_subscription",
  "other",
]);

// §16 - Notifications.
export const notificationPriorityEnum = pgEnum("notification_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

// §16 - Chat.
export const chatChannelKindEnum = pgEnum("chat_channel_kind", [
  "general",
  "dm",
  "client_portal",
]);

// §20 - Projects.
export const projectStatusEnum = pgEnum("project_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export const projectBillingModeEnum = pgEnum("project_billing_mode", [
  "project",
  "tasks",
]);

// §20 - ProjectTask: standalone one-off or a monthly time-period grid row.
export const projectTaskKindEnum = pgEnum("project_task_kind", [
  "one_off",
  "time_period",
]);

// §16 - Feedback widget.
export const feedbackCategoryEnum = pgEnum("feedback_category", [
  "bug",
  "feature",
  "other",
]);

export const feedbackStatusEnum = pgEnum("feedback_status", [
  "pending",
  "reviewed",
  "addressed",
]);

// §22 - request → review → apply approval workflows (pause, purge, reset,
// time edits, portal change requests).
export const approvalRequestStatusEnum = pgEnum("approval_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

// §17 - Workstation activity timers.
export const workActivityTypeEnum = pgEnum("work_activity_type", [
  "day",
  "bank_feeds",
  "tasks",
  "recurring",
  "dashboard",
  "reconciliations",
  "projects",
  "tax_checklist",
]);

// §7 - Contacts and their relationship to clients.
export const contactTypeEnum = pgEnum("contact_type", ["individual", "entity"]);

export const relationshipTypeEnum = pgEnum("relationship_type", [
  "owner",
  "primary_contact",
  "cpa",
  "related",
]);

// §6.8 - intake lifecycle: new → in_progress → pending_review → completed,
// with archived as a side exit.
export const intakeStatusEnum = pgEnum("intake_status", [
  "new",
  "in_progress",
  "pending_review",
  "completed",
  "archived",
]);

// §16 - working-hours submissions: draft → pending → approved / rejected.
export const workingHoursStatusEnum = pgEnum("working_hours_status", [
  "draft",
  "pending",
  "approved",
  "rejected",
]);

// §18 - W-9/1099 workflow: pending_w9 → w9_received → 1099_sent.
export const w9StatusEnum = pgEnum("w9_status", [
  "pending_w9",
  "w9_received",
  "1099_sent",
]);

// §20 - staff → client pro-forma request; auto-completes when every non-sold
// property has a portal-submitted row.
export const proformaRequestStatusEnum = pgEnum("proforma_request_status", [
  "pending",
  "completed",
  "cancelled",
]);
