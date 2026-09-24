CREATE TABLE "correspondence" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"contact_id" integer,
	"direction" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body_text" text NOT NULL,
	"from_email" text,
	"to_email" text,
	"task_id" integer,
	"note" text,
	"template" text DEFAULT 'staff_composer' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"resend_message_id" text,
	"portal_visible" boolean DEFAULT true NOT NULL,
	"sent_by_id" integer,
	"intake_id" integer,
	"portal_read_at" timestamp with time zone,
	"staff_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "correspondence" ADD CONSTRAINT "correspondence_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence" ADD CONSTRAINT "correspondence_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence" ADD CONSTRAINT "correspondence_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondence" ADD CONSTRAINT "correspondence_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "correspondence_client_idx" ON "correspondence" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "correspondence_contact_idx" ON "correspondence" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "correspondence_task_idx" ON "correspondence" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "correspondence_staff_unread_idx" ON "correspondence" USING btree ("client_id") WHERE "correspondence"."direction" = 'inbound' and "correspondence"."staff_read_at" is null;--> statement-breakpoint
CREATE INDEX "correspondence_portal_unread_idx" ON "correspondence" USING btree ("client_id") WHERE "correspondence"."direction" = 'outbound' and "correspondence"."portal_visible" = true and "correspondence"."portal_read_at" is null;--> statement-breakpoint
CREATE INDEX "correspondence_resend_message_idx" ON "correspondence" USING btree ("resend_message_id");