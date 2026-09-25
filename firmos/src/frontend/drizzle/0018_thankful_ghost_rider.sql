-- I6 (intake restructure, conversion wiring):
--  - clients.payroll_provider: the payroll provider captured on the intake
--    (required for corporate entities, I2), stamped at conversion so the
--    year-end package work knows where the payroll reports come from.
--  - contact_client_links.receives_reports: per-contact report delivery +
--    portal visibility (the intake's per-owner "receives reports" checkbox).
--    Default true: every existing link keeps receiving reports.
ALTER TABLE "clients" ADD COLUMN "payroll_provider" text;--> statement-breakpoint
ALTER TABLE "contact_client_links" ADD COLUMN "receives_reports" boolean DEFAULT true NOT NULL;
