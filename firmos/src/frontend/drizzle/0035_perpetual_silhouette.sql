CREATE TABLE "chart_account_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"contributions" text NOT NULL,
	"distributions" text NOT NULL,
	"net_investment" text NOT NULL,
	"grouped" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_intakes" ADD COLUMN "accepted_estimate_snapshot" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "chart_account_templates_key_version_unique" ON "chart_account_templates" USING btree ("key","version");
INSERT INTO "chart_account_templates" ("key", "version", "contributions", "distributions", "net_investment", "grouped", "status", "is_active") VALUES
  ('sole_proprietor', 1, 'Owner Contribution', 'Owner''s Draw', 'Net Investment Gain/Loss', 'Owner''s Equity', 'draft', true),
  ('partnership', 1, 'Partner Contribution', 'Partner Distribution', 'Net Investment Gain/Loss', 'Partner''s Equity', 'draft', true),
  ('corporation', 1, 'Shareholder Contribution', 'Shareholder Distribution', 'Net Investment Gain/Loss', 'Shareholder Equity', 'draft', true)
ON CONFLICT DO NOTHING;
