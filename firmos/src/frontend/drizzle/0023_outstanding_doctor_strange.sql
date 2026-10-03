CREATE TABLE "option_list_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_key" text NOT NULL,
	"name" text NOT NULL,
	"meta" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "option_list_values_list_name_unique" ON "option_list_values" USING btree ("list_key","name");--> statement-breakpoint
CREATE INDEX "option_list_values_list_idx" ON "option_list_values" USING btree ("list_key");