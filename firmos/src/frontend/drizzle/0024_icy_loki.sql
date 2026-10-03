CREATE TABLE "services_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_key" text NOT NULL,
	"product_name" text NOT NULL,
	"group" text NOT NULL,
	"unit" text NOT NULL,
	"unit_price" integer,
	"scaling" text NOT NULL,
	"bucket" text NOT NULL,
	"is_standard" boolean DEFAULT false NOT NULL,
	"is_addon" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "services_catalog_key_unique" ON "services_catalog" USING btree ("service_key");