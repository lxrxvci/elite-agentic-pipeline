ALTER TABLE "clients" ADD COLUMN "has_payroll" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quick_notes" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "quick_notes" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "quick_notes" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "milestone_interval_months" smallint;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "milestone_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "bill_on_completion" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "milestones_invoiced" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "completion_invoiced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "year_end_tax_templates" ADD COLUMN "requires_payroll" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- E11 backfills: flag the seeded payroll/W-2 template row, and carry the
-- intake payroll answer onto already-converted clients.
UPDATE "year_end_tax_templates" SET "requires_payroll" = true WHERE "title" ILIKE '%payroll%';--> statement-breakpoint
UPDATE "clients" SET "has_payroll" = true WHERE "id" IN (
  SELECT "client_id" FROM "client_intakes"
  WHERE "client_id" IS NOT NULL AND "form_data"->>'hasPayroll' = 'true'
);