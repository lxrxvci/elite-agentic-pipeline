CREATE TABLE "institutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "institution_id" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "proof_category" text DEFAULT 'statement' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "institutions_name_unique" ON "institutions" USING btree ("name");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- I3: seed the firm's known banks (plan §7 open question 2 - editable later
-- from an admin screen; idempotent so re-running is safe).
INSERT INTO "institutions" ("name") VALUES
	('Chase'),
	('Wells Fargo'),
	('Bank of America'),
	('Columbia'),
	('Umpqua'),
	('Mr. Cooper'),
	('Amex'),
	('Capital One'),
	('US Bank'),
	('KeyBank')
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
-- I3 backfill: the column default marks everything statement-proof; the
-- bank/credit-card statement-category types keep it, every other existing
-- row (loans, equity, assets) is owner-declared evidence.
UPDATE "accounts" SET "proof_category" = 'owner_declared'
WHERE "account_type" NOT IN ('checking', 'savings', 'credit_card', 'merchant', 'investment');