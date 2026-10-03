CREATE TABLE "industry_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"industry_key" text NOT NULL,
	"service_key" text NOT NULL,
	"explainer" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "industry_suggestions_industry_idx" ON "industry_suggestions" USING btree ("industry_key");