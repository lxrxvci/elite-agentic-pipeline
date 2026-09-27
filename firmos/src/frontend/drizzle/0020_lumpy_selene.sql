CREATE TABLE "merchant_processors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last4" text;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_processors_name_unique" ON "merchant_processors" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_providers_name_unique" ON "payroll_providers" USING btree ("name");--> statement-breakpoint
-- J1 (meeting #3, DB1/P2): seed the mainstream payroll providers; the intake
-- dropdown + inline add-new grow this list globally from here. Idempotent.
INSERT INTO "payroll_providers" ("name") VALUES
	('Gusto'),
	('ADP'),
	('QuickBooks Payroll'),
	('Square Payroll'),
	('OnPay'),
	('Rippling'),
	('Paychex')
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
-- J1 (meeting #3, DB1/E4): seed the firm's known merchant processors; same
-- global-persistence rule as the banks list.
INSERT INTO "merchant_processors" ("name") VALUES
	('Stripe'),
	('Square'),
	('QuickBooks Online'),
	('Toast'),
	('Shopify'),
	('Clover'),
	('Authorize.net'),
	('PayPal')
ON CONFLICT ("name") DO NOTHING;