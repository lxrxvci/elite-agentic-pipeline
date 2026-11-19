CREATE TABLE "client_vendor_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"vendor_option_id" integer NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"payment_method" text,
	"portal_url_override" text,
	"sop_template_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_vendor_assignments" ADD CONSTRAINT "client_vendor_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_vendor_assignments" ADD CONSTRAINT "client_vendor_assignments_vendor_option_id_option_list_values_id_fk" FOREIGN KEY ("vendor_option_id") REFERENCES "public"."option_list_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_vendor_assignments" ADD CONSTRAINT "client_vendor_assignments_sop_template_id_sop_templates_id_fk" FOREIGN KEY ("sop_template_id") REFERENCES "public"."sop_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_vendor_assignments_unique" ON "client_vendor_assignments" USING btree ("client_id","vendor_option_id");--> statement-breakpoint
CREATE INDEX "client_vendor_assignments_client_idx" ON "client_vendor_assignments" USING btree ("client_id");