CREATE TYPE "public"."approval_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."billable_status" AS ENUM('billable', 'non_billable', 'not_sure');--> statement-breakpoint
CREATE TYPE "public"."chat_channel_kind" AS ENUM('general', 'dm', 'client_portal');--> statement-breakpoint
CREATE TYPE "public"."close_tier" AS ENUM('5', '10', '15');--> statement-breakpoint
CREATE TYPE "public"."contact_type" AS ENUM('individual', 'entity');--> statement-breakpoint
CREATE TYPE "public"."feedback_category" AS ENUM('bug', 'feature', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('pending', 'reviewed', 'addressed');--> statement-breakpoint
CREATE TYPE "public"."frequency" AS ENUM('daily', 'weekly', 'monthly', 'quarterly', 'semi_annual', 'annual');--> statement-breakpoint
CREATE TYPE "public"."intake_status" AS ENUM('new', 'in_progress', 'pending_review', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'paid', 'overdue', 'void');--> statement-breakpoint
CREATE TYPE "public"."line_type" AS ENUM('recurring', 'task', 'quickbooks_subscription', 'other');--> statement-breakpoint
CREATE TYPE "public"."notification_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."proforma_request_status" AS ENUM('pending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_billing_mode" AS ENUM('project', 'tasks');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_task_kind" AS ENUM('one_off', 'time_period');--> statement-breakpoint
CREATE TYPE "public"."relationship_type" AS ENUM('owner', 'primary_contact', 'cpa', 'related');--> statement-breakpoint
CREATE TYPE "public"."schedule_type" AS ENUM('daily', 'weekly', 'monthly', 'quarterly', 'semi_annual', 'annual');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('new', 'open', 'pending', 'not_started', 'in_progress', 'completed', 'cancelled', 'waiting_on_client', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('recurring', 'onboarding', 'project', 'ad_hoc');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'manager', 'bookkeeper', 'client', 'cpa');--> statement-breakpoint
CREATE TYPE "public"."w9_status" AS ENUM('pending_w9', 'w9_received', '1099_sent');--> statement-breakpoint
CREATE TYPE "public"."work_activity_type" AS ENUM('day', 'bank_feeds', 'tasks', 'recurring', 'dashboard', 'reconciliations', 'projects', 'tax_checklist');--> statement-breakpoint
CREATE TYPE "public"."working_hours_status" AS ENUM('draft', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "auth_pending_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_id" integer,
	"payload" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_user_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"can_upload_docs" boolean DEFAULT false NOT NULL,
	"can_view_tasks" boolean DEFAULT true NOT NULL,
	"can_message" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"contact_id" integer,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_encrypted" text,
	"mfa_backup_code_hashes" jsonb,
	"commission_rate_override" numeric(5, 4),
	"base_hourly_pay" numeric(12, 2),
	"idle_timeout_minutes" integer DEFAULT 15 NOT NULL,
	"can_access_statements" boolean DEFAULT false NOT NULL,
	"can_edit_task_templates" boolean DEFAULT false NOT NULL,
	"can_edit_sops" boolean DEFAULT false NOT NULL,
	"can_edit_tax_templates" boolean DEFAULT false NOT NULL,
	"tour_seen_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_intakes" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" "intake_status" DEFAULT 'new' NOT NULL,
	"legal_name" text NOT NULL,
	"dba_name" text,
	"tax_structure" text,
	"tax_id" text,
	"industry" text,
	"referral_source" text,
	"business_address" text,
	"business_city" text,
	"business_state" text,
	"business_zip" text,
	"is_existing_client" boolean DEFAULT false NOT NULL,
	"engagement_type" text,
	"quickbooks_status" text,
	"needs_quickbooks_setup" boolean DEFAULT false NOT NULL,
	"bookkeeping_start_date" date,
	"bank_feed_catchup_date" date,
	"bookkeeping_frequency" "frequency",
	"billing_frequency" "frequency",
	"monthly_close_tier" "close_tier",
	"accounting_method" text,
	"payroll_provider" text,
	"manager_id" integer,
	"bookkeeper_id" integer,
	"monthly_recurring_amount" numeric(12, 2),
	"base_monthly_amount" numeric(12, 2),
	"per_account_price" numeric(12, 2),
	"report_definitions" jsonb,
	"custom_recurring_rules" jsonb,
	"form_data" jsonb,
	"internal_notes" text,
	"client_id" integer,
	"submitted_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"linked_client_id" integer NOT NULL,
	"link_type" text DEFAULT 'intercompany' NOT NULL,
	"notes" text,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"author_id" integer,
	"parent_id" integer,
	"body" text NOT NULL,
	"attachments" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_pause_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"requested_by_id" integer NOT NULL,
	"reason" text,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_purge_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"requested_by_id" integer NOT NULL,
	"reason" text,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_reset_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"requested_by_id" integer NOT NULL,
	"reason" text,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"dba_name" text,
	"tax_id" text,
	"tax_structure" text,
	"accounting_method" text,
	"business_address" text,
	"business_city" text,
	"business_state" text,
	"business_zip" text,
	"tier" text,
	"monthly_close_tier" "close_tier",
	"bookkeeping_frequency" "frequency" DEFAULT 'monthly' NOT NULL,
	"billing_frequency" "frequency" DEFAULT 'monthly' NOT NULL,
	"manager_id" integer,
	"bookkeeper_id" integer,
	"reconciliation_assignee_role" text,
	"requires_weekly_bank_feeds" boolean DEFAULT true NOT NULL,
	"bank_feed_frequency" "frequency" DEFAULT 'weekly' NOT NULL,
	"bank_feed_day_of_week" smallint DEFAULT 5 NOT NULL,
	"bank_feed_catchup_date" date,
	"bookkeeping_start_date" date,
	"system_start_date" date,
	"monthly_recurring_amount" numeric(12, 2),
	"base_monthly_amount" numeric(12, 2),
	"per_account_price" numeric(12, 2),
	"recurring_services_template" jsonb,
	"billing_last_synced_at" timestamp with time zone,
	"estimated_1099_count" integer,
	"include_1099_collection" boolean DEFAULT false NOT NULL,
	"include_1099_full_management" boolean DEFAULT false NOT NULL,
	"include_merchant_reconciliation" boolean DEFAULT false NOT NULL,
	"is_auto_pay" boolean DEFAULT false NOT NULL,
	"qbo_class_names" jsonb,
	"qbo_location_names" jsonb,
	"is_real_estate_client" boolean DEFAULT false NOT NULL,
	"is_project_engagement" boolean DEFAULT false NOT NULL,
	"project_cutoff_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_by_id" integer,
	"primary_contact_id" integer,
	"cpa_contact_id" integer,
	"legacy_primary_contact_name" text,
	"legacy_primary_contact_email" text,
	"legacy_cpa_name" text,
	"legacy_cpa_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_client_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"relationship_type" "relationship_type" DEFAULT 'related' NOT NULL,
	"ownership_percent" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "contact_type" DEFAULT 'individual' NOT NULL,
	"first_name" text,
	"last_name" text,
	"entity_name" text,
	"email" text,
	"phone" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"zip" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_owners" (
	"id" serial PRIMARY KEY NOT NULL,
	"intake_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"ownership_percent" numeric(5, 2),
	"contact_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"requested_by_id" integer NOT NULL,
	"field_name" text NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quick_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"client_id" integer,
	"body" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_reconciliations" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"attributed_year" integer NOT NULL,
	"attributed_month" smallint NOT NULL,
	"statement_date" date,
	"due_date" date,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_id" integer,
	"waiting_on_client" boolean DEFAULT false NOT NULL,
	"client_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_client_id" integer NOT NULL,
	"to_client_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"amount" numeric(12, 2),
	"transfer_date" date NOT NULL,
	"notes" text,
	"task_id" integer,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"name" text NOT NULL,
	"account_type" text NOT NULL,
	"institution" text,
	"statement_day" smallint,
	"open_date" date,
	"close_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_statement_date" date,
	"statements_deferred_until" date,
	"requires_manual_transactions" boolean DEFAULT false NOT NULL,
	"last_transactions_downloaded_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"name" text NOT NULL,
	"property_type" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"zip" text,
	"is_sold" boolean DEFAULT false NOT NULL,
	"sold_date" date,
	"sale_price" numeric(12, 2),
	"purchase_price" numeric(12, 2),
	"purchase_date" date,
	"annual_revenue" numeric(12, 2),
	"annual_expenses" numeric(12, 2),
	"mortgage_lender" text,
	"mortgage_balance" numeric(12, 2),
	"monthly_mortgage_payment" numeric(12, 2),
	"depreciation" jsonb,
	"qbo_class_name" text,
	"merchant_account_id" integer,
	"merchant_processor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_proforma_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"year" integer NOT NULL,
	"requested_by_id" integer NOT NULL,
	"status" "proforma_request_status" DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_proformas" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"year" integer NOT NULL,
	"figures" jsonb,
	"last_edited_by_id" integer,
	"last_edited_at" timestamp with time zone,
	"from_portal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_hoc_task_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"default_assignee_id" integer,
	"default_assignee_role" text,
	"due_in_days" integer DEFAULT 7 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_manual_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"sop_template_id" integer,
	"title" text NOT NULL,
	"content" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offboarding_template_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"default_assignee_role" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_template_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_admin_phase" boolean DEFAULT false NOT NULL,
	"default_assignee_role" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_task_sop_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"sop_template_id" integer NOT NULL,
	"recurring_task_id" integer,
	"task_id" integer,
	"ad_hoc_template_id" integer,
	"client_manual_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_task_subtasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"recurring_task_id" integer NOT NULL,
	"title" text NOT NULL,
	"assignee_id" integer,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"schedule_type" "schedule_type" NOT NULL,
	"days_of_week" text,
	"day_of_month" smallint,
	"weekday" smallint,
	"week_of_month" smallint,
	"anchor_month" smallint,
	"next_run" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"assignee_id" integer,
	"is_billable" boolean DEFAULT false NOT NULL,
	"unit_price" numeric(12, 2),
	"is_custom" boolean DEFAULT false NOT NULL,
	"recurring_template_task_id" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_template_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"schedule_type" "schedule_type" NOT NULL,
	"days_of_week" text,
	"day_of_month" smallint,
	"weekday" smallint,
	"week_of_month" smallint,
	"anchor_month" smallint,
	"default_assignee_role" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_client_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"author_id" integer,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_subtasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"title" text NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"assignee_id" integer,
	"completed_at" timestamp with time zone,
	"completed_by_id" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_time_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_minutes" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"recurring_task_id" integer,
	"title" text NOT NULL,
	"description" text,
	"task_type" "task_type" DEFAULT 'ad_hoc' NOT NULL,
	"status" "task_status" DEFAULT 'new' NOT NULL,
	"billable_status" "billable_status" DEFAULT 'non_billable' NOT NULL,
	"due_date" date,
	"attributed_year" integer,
	"attributed_month" smallint,
	"assignee_id" integer,
	"created_by_id" integer,
	"completed_at" timestamp with time zone,
	"completed_by_id" integer,
	"clocked_in_at" timestamp with time zone,
	"invoiced_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"name" text NOT NULL,
	"attributed_year" integer NOT NULL,
	"attributed_month" smallint NOT NULL,
	"due_date" date,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_id" integer,
	"document_id" integer,
	"recurring_task_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_bank_feeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"week_start_date" date NOT NULL,
	"week_end_date" date NOT NULL,
	"due_date" date,
	"attributed_year" integer,
	"attributed_month" smallint,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_id" integer,
	"waiting_on_client" boolean DEFAULT false NOT NULL,
	"client_note" text,
	"deferred_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"weekly_bank_feed_id" integer,
	"account_reconciliation_id" integer,
	"author_id" integer,
	"body" text NOT NULL,
	"is_client_visible" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"is_protected" boolean DEFAULT false NOT NULL,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"account_id" integer,
	"folder_id" integer,
	"uploaded_by_id" integer,
	"file_name" text NOT NULL,
	"stored_path" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"doc_type" text DEFAULT 'general' NOT NULL,
	"statement_date" date,
	"attributed_year" integer,
	"attributed_month" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"task_id" integer,
	"title" text NOT NULL,
	"description" text,
	"task_kind" "project_task_kind" DEFAULT 'one_off' NOT NULL,
	"prerequisite_id" integer,
	"assignee_id" integer,
	"due_date" date,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_id" integer,
	"period_completions" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_template_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"task_kind" "project_task_kind" DEFAULT 'one_off' NOT NULL,
	"prerequisite_id" integer,
	"default_assignee_role" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"template_id" integer,
	"name" text NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'pending' NOT NULL,
	"billing_mode" "project_billing_mode" DEFAULT 'project' NOT NULL,
	"fixed_price" numeric(12, 2),
	"start_date" date,
	"due_date" date,
	"auto_generate_tasks" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"line_type" "line_type" DEFAULT 'recurring' NOT NULL,
	"service_key" text,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"task_id" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"name" text NOT NULL,
	"line_items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"invoice_number" text,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"year" integer,
	"month" smallint,
	"is_auto_generated" boolean DEFAULT false NOT NULL,
	"issue_date" date,
	"due_date" date,
	"total" numeric(12, 2),
	"notes" text,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "w9_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"vendor_name" text NOT NULL,
	"email" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"zip" text,
	"tax_id" text,
	"year" integer NOT NULL,
	"total_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"payment_type" text,
	"needs_1099" boolean DEFAULT false NOT NULL,
	"needs_1099_manual_override" boolean,
	"status" "w9_status" DEFAULT 'pending_w9' NOT NULL,
	"w9_requested_at" timestamp with time zone,
	"w9_received_date" date,
	"form_1099_sent_date" date,
	"w9_document_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "year_end_tax_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"year" integer NOT NULL,
	"template_id" integer,
	"title" text NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_id" integer,
	"assignee_id" integer,
	"notes" text,
	"cpa_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "year_end_tax_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"default_assignee_role" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_working_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"schedule" jsonb NOT NULL,
	"status" "working_hours_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_by_id" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workstation_time_edit_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"time_entry_id" integer NOT NULL,
	"requested_started_at" timestamp with time zone NOT NULL,
	"requested_ended_at" timestamp with time zone,
	"reason" text,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workstation_time_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"activity_type" "work_activity_type" NOT NULL,
	"client_id" integer,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_minutes" integer,
	"last_activity_at" timestamp with time zone,
	"auto_closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_channel_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"last_read_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "chat_channel_kind" NOT NULL,
	"slug" text,
	"client_id" integer,
	"name" text,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"body" text NOT NULL,
	"attachment_path" text,
	"attachment_name" text,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"notification_type" text NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"link" text,
	"entity_type" text,
	"entity_id" integer,
	"priority" "notification_priority" DEFAULT 'normal' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"sms_sent_at" timestamp with time zone,
	"push_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" integer,
	"details" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"category" "feedback_category" NOT NULL,
	"status" "feedback_status" DEFAULT 'pending' NOT NULL,
	"message" text NOT NULL,
	"page_url" text,
	"screenshot_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_pending_sessions" ADD CONSTRAINT "auth_pending_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_user_access" ADD CONSTRAINT "client_user_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_user_access" ADD CONSTRAINT "client_user_access_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_intakes" ADD CONSTRAINT "client_intakes_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_intakes" ADD CONSTRAINT "client_intakes_bookkeeper_id_users_id_fk" FOREIGN KEY ("bookkeeper_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_intakes" ADD CONSTRAINT "client_intakes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_links" ADD CONSTRAINT "client_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_links" ADD CONSTRAINT "client_links_linked_client_id_clients_id_fk" FOREIGN KEY ("linked_client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_links" ADD CONSTRAINT "client_links_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_parent_id_client_notes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."client_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_pause_requests" ADD CONSTRAINT "client_pause_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_pause_requests" ADD CONSTRAINT "client_pause_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_pause_requests" ADD CONSTRAINT "client_pause_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_purge_requests" ADD CONSTRAINT "client_purge_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_purge_requests" ADD CONSTRAINT "client_purge_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_purge_requests" ADD CONSTRAINT "client_purge_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_reset_requests" ADD CONSTRAINT "client_reset_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_reset_requests" ADD CONSTRAINT "client_reset_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_reset_requests" ADD CONSTRAINT "client_reset_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_bookkeeper_id_users_id_fk" FOREIGN KEY ("bookkeeper_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_paused_by_id_users_id_fk" FOREIGN KEY ("paused_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_primary_contact_id_contacts_id_fk" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_cpa_contact_id_contacts_id_fk" FOREIGN KEY ("cpa_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_client_links" ADD CONSTRAINT "contact_client_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_client_links" ADD CONSTRAINT "contact_client_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_owners" ADD CONSTRAINT "intake_owners_intake_id_client_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."client_intakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_owners" ADD CONSTRAINT "intake_owners_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_change_requests" ADD CONSTRAINT "portal_change_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_change_requests" ADD CONSTRAINT "portal_change_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_change_requests" ADD CONSTRAINT "portal_change_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_notes" ADD CONSTRAINT "quick_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_notes" ADD CONSTRAINT "quick_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_reconciliations" ADD CONSTRAINT "account_reconciliations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_reconciliations" ADD CONSTRAINT "account_reconciliations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_reconciliations" ADD CONSTRAINT "account_reconciliations_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_from_client_id_clients_id_fk" FOREIGN KEY ("from_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_to_client_id_clients_id_fk" FOREIGN KEY ("to_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_merchant_account_id_accounts_id_fk" FOREIGN KEY ("merchant_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_proforma_requests" ADD CONSTRAINT "property_proforma_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_proforma_requests" ADD CONSTRAINT "property_proforma_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_proformas" ADD CONSTRAINT "property_proformas_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_proformas" ADD CONSTRAINT "property_proformas_last_edited_by_id_users_id_fk" FOREIGN KEY ("last_edited_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_hoc_task_templates" ADD CONSTRAINT "ad_hoc_task_templates_default_assignee_id_users_id_fk" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_manual_entries" ADD CONSTRAINT "client_manual_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_manual_entries" ADD CONSTRAINT "client_manual_entries_sop_template_id_sop_templates_id_fk" FOREIGN KEY ("sop_template_id") REFERENCES "public"."sop_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_task_sop_links" ADD CONSTRAINT "recurring_task_sop_links_sop_template_id_sop_templates_id_fk" FOREIGN KEY ("sop_template_id") REFERENCES "public"."sop_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_task_sop_links" ADD CONSTRAINT "recurring_task_sop_links_recurring_task_id_recurring_tasks_id_fk" FOREIGN KEY ("recurring_task_id") REFERENCES "public"."recurring_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_task_sop_links" ADD CONSTRAINT "recurring_task_sop_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_task_sop_links" ADD CONSTRAINT "recurring_task_sop_links_ad_hoc_template_id_ad_hoc_task_templates_id_fk" FOREIGN KEY ("ad_hoc_template_id") REFERENCES "public"."ad_hoc_task_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_task_sop_links" ADD CONSTRAINT "recurring_task_sop_links_client_manual_entry_id_client_manual_entries_id_fk" FOREIGN KEY ("client_manual_entry_id") REFERENCES "public"."client_manual_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_task_subtasks" ADD CONSTRAINT "recurring_task_subtasks_recurring_task_id_recurring_tasks_id_fk" FOREIGN KEY ("recurring_task_id") REFERENCES "public"."recurring_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_task_subtasks" ADD CONSTRAINT "recurring_task_subtasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD CONSTRAINT "recurring_tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD CONSTRAINT "recurring_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD CONSTRAINT "recurring_tasks_recurring_template_task_id_recurring_template_tasks_id_fk" FOREIGN KEY ("recurring_template_task_id") REFERENCES "public"."recurring_template_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_client_links" ADD CONSTRAINT "task_client_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_client_links" ADD CONSTRAINT "task_client_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_client_links" ADD CONSTRAINT "task_client_links_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurring_task_id_recurring_tasks_id_fk" FOREIGN KEY ("recurring_task_id") REFERENCES "public"."recurring_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_recurring_task_id_recurring_tasks_id_fk" FOREIGN KEY ("recurring_task_id") REFERENCES "public"."recurring_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_bank_feeds" ADD CONSTRAINT "weekly_bank_feeds_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_bank_feeds" ADD CONSTRAINT "weekly_bank_feeds_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_notes" ADD CONSTRAINT "work_item_notes_weekly_bank_feed_id_weekly_bank_feeds_id_fk" FOREIGN KEY ("weekly_bank_feed_id") REFERENCES "public"."weekly_bank_feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_notes" ADD CONSTRAINT "work_item_notes_account_reconciliation_id_account_reconciliations_id_fk" FOREIGN KEY ("account_reconciliation_id") REFERENCES "public"."account_reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_notes" ADD CONSTRAINT "work_item_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_parent_id_document_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."document_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."document_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_prerequisite_id_project_tasks_id_fk" FOREIGN KEY ("prerequisite_id") REFERENCES "public"."project_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD CONSTRAINT "project_template_tasks_template_id_project_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD CONSTRAINT "project_template_tasks_prerequisite_id_project_template_tasks_id_fk" FOREIGN KEY ("prerequisite_id") REFERENCES "public"."project_template_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_template_id_project_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "w9_recipients" ADD CONSTRAINT "w9_recipients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "w9_recipients" ADD CONSTRAINT "w9_recipients_w9_document_id_documents_id_fk" FOREIGN KEY ("w9_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_tax_checklists" ADD CONSTRAINT "year_end_tax_checklists_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_tax_checklists" ADD CONSTRAINT "year_end_tax_checklists_template_id_year_end_tax_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."year_end_tax_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_tax_checklists" ADD CONSTRAINT "year_end_tax_checklists_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_tax_checklists" ADD CONSTRAINT "year_end_tax_checklists_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_working_hours" ADD CONSTRAINT "user_working_hours_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_working_hours" ADD CONSTRAINT "user_working_hours_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstation_time_edit_requests" ADD CONSTRAINT "workstation_time_edit_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstation_time_edit_requests" ADD CONSTRAINT "workstation_time_edit_requests_time_entry_id_workstation_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."workstation_time_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstation_time_edit_requests" ADD CONSTRAINT "workstation_time_edit_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstation_time_entries" ADD CONSTRAINT "workstation_time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstation_time_entries" ADD CONSTRAINT "workstation_time_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_pending_sessions_user_idx" ON "auth_pending_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_user_access_user_client_unique" ON "client_user_access" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "client_intakes_client_unique" ON "client_intakes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_intakes_status_idx" ON "client_intakes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "client_links_pair_unique" ON "client_links" USING btree ("client_id","linked_client_id","link_type");--> statement-breakpoint
CREATE INDEX "client_links_linked_idx" ON "client_links" USING btree ("linked_client_id");--> statement-breakpoint
CREATE INDEX "client_notes_client_idx" ON "client_notes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_pause_requests_status_idx" ON "client_pause_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "client_purge_requests_status_idx" ON "client_purge_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "client_reset_requests_status_idx" ON "client_reset_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clients_manager_idx" ON "clients" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "clients_bookkeeper_idx" ON "clients" USING btree ("bookkeeper_id");--> statement-breakpoint
CREATE INDEX "clients_work_state_idx" ON "clients" USING btree ("is_active","is_paused","is_project_engagement");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_client_links_unique" ON "contact_client_links" USING btree ("contact_id","client_id","relationship_type");--> statement-breakpoint
CREATE INDEX "contact_client_links_client_idx" ON "contact_client_links" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "intake_owners_intake_idx" ON "intake_owners" USING btree ("intake_id");--> statement-breakpoint
CREATE INDEX "portal_change_requests_client_status_idx" ON "portal_change_requests" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "quick_notes_user_idx" ON "quick_notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "quick_notes_client_idx" ON "quick_notes" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_reconciliations_account_period_unique" ON "account_reconciliations" USING btree ("account_id","attributed_year","attributed_month");--> statement-breakpoint
CREATE INDEX "account_reconciliations_client_period_idx" ON "account_reconciliations" USING btree ("client_id","attributed_year","attributed_month");--> statement-breakpoint
CREATE INDEX "account_reconciliations_queue_idx" ON "account_reconciliations" USING btree ("client_id","is_completed","due_date");--> statement-breakpoint
CREATE INDEX "account_transfers_account_idx" ON "account_transfers" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "accounts_client_idx" ON "accounts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "accounts_statement_queue_idx" ON "accounts" USING btree ("client_id","is_active","statement_day");--> statement-breakpoint
CREATE INDEX "properties_client_idx" ON "properties" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "property_proforma_requests_client_idx" ON "property_proforma_requests" USING btree ("client_id","year","status");--> statement-breakpoint
CREATE UNIQUE INDEX "property_proformas_property_year_unique" ON "property_proformas" USING btree ("property_id","year");--> statement-breakpoint
CREATE INDEX "client_manual_entries_client_idx" ON "client_manual_entries" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "recurring_task_sop_links_sop_idx" ON "recurring_task_sop_links" USING btree ("sop_template_id");--> statement-breakpoint
CREATE INDEX "recurring_task_subtasks_rule_idx" ON "recurring_task_subtasks" USING btree ("recurring_task_id");--> statement-breakpoint
CREATE INDEX "recurring_tasks_client_idx" ON "recurring_tasks" USING btree ("client_id","is_active");--> statement-breakpoint
CREATE INDEX "recurring_tasks_next_run_idx" ON "recurring_tasks" USING btree ("next_run");--> statement-breakpoint
CREATE UNIQUE INDEX "task_client_links_unique" ON "task_client_links" USING btree ("task_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_documents_unique" ON "task_documents" USING btree ("task_id","document_id");--> statement-breakpoint
CREATE INDEX "task_notes_task_idx" ON "task_notes" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_subtasks_task_idx" ON "task_subtasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_time_entries_task_idx" ON "task_time_entries" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_time_entries_user_idx" ON "task_time_entries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_recurring_period_unique" ON "tasks" USING btree ("recurring_task_id","attributed_year","attributed_month") WHERE "tasks"."recurring_task_id" is not null;--> statement-breakpoint
CREATE INDEX "tasks_client_period_idx" ON "tasks" USING btree ("client_id","attributed_year","attributed_month");--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_idx" ON "tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_due_date_idx" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "tasks_billable_uninvoiced_idx" ON "tasks" USING btree ("client_id","billable_status","invoiced_at");--> statement-breakpoint
CREATE INDEX "client_reports_client_period_idx" ON "client_reports" USING btree ("client_id","attributed_year","attributed_month");--> statement-breakpoint
CREATE INDEX "client_reports_queue_idx" ON "client_reports" USING btree ("client_id","is_completed","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_bank_feeds_client_week_unique" ON "weekly_bank_feeds" USING btree ("client_id","week_start_date");--> statement-breakpoint
CREATE INDEX "weekly_bank_feeds_client_period_idx" ON "weekly_bank_feeds" USING btree ("client_id","attributed_year","attributed_month");--> statement-breakpoint
CREATE INDEX "weekly_bank_feeds_queue_idx" ON "weekly_bank_feeds" USING btree ("client_id","is_completed","due_date");--> statement-breakpoint
CREATE INDEX "work_item_notes_feed_idx" ON "work_item_notes" USING btree ("weekly_bank_feed_id");--> statement-breakpoint
CREATE INDEX "work_item_notes_recon_idx" ON "work_item_notes" USING btree ("account_reconciliation_id");--> statement-breakpoint
CREATE INDEX "document_folders_client_idx" ON "document_folders" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_folders_name_unique" ON "document_folders" USING btree ("client_id","parent_id","name");--> statement-breakpoint
CREATE INDEX "documents_account_period_idx" ON "documents" USING btree ("account_id","attributed_year","attributed_month");--> statement-breakpoint
CREATE INDEX "documents_client_type_idx" ON "documents" USING btree ("client_id","doc_type");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_stored_path_unique" ON "documents" USING btree ("stored_path");--> statement-breakpoint
CREATE INDEX "project_tasks_project_idx" ON "project_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_template_tasks_template_idx" ON "project_template_tasks" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "projects_client_status_idx" ON "projects" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "invoice_line_items_invoice_idx" ON "invoice_line_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_templates_client_idx" ON "invoice_templates" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_generated_client_period_unique" ON "invoices" USING btree ("client_id","year","month") WHERE "invoices"."is_auto_generated";--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unique" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_client_status_idx" ON "invoices" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "invoices_sent_at_idx" ON "invoices" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "invoices_paid_at_idx" ON "invoices" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "w9_recipients_client_year_idx" ON "w9_recipients" USING btree ("client_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "year_end_tax_checklists_template_unique" ON "year_end_tax_checklists" USING btree ("client_id","year","template_id") WHERE "year_end_tax_checklists"."template_id" is not null;--> statement-breakpoint
CREATE INDEX "year_end_tax_checklists_client_year_idx" ON "year_end_tax_checklists" USING btree ("client_id","year");--> statement-breakpoint
CREATE INDEX "user_working_hours_user_status_idx" ON "user_working_hours" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "workstation_time_edit_requests_status_idx" ON "workstation_time_edit_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workstation_time_entries_open_day_unique" ON "workstation_time_entries" USING btree ("user_id") WHERE "workstation_time_entries"."activity_type" = 'day' and "workstation_time_entries"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "workstation_time_entries_user_started_idx" ON "workstation_time_entries" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_channel_members_unique" ON "chat_channel_members" USING btree ("channel_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_channels_slug_unique" ON "chat_channels" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_channels_client_portal_unique" ON "chat_channels" USING btree ("client_id") WHERE "chat_channels"."kind" = 'client_portal';--> statement-breakpoint
CREATE INDEX "chat_messages_channel_idx" ON "chat_messages" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_dedup_idx" ON "notifications" USING btree ("user_id","notification_type","entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "notifications_deferred_push_idx" ON "notifications" USING btree ("user_id","created_at") WHERE "notifications"."push_sent_at" is null and "notifications"."is_read" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_unique" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_user_idx" ON "audit_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status");