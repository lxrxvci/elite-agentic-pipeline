ALTER TYPE "public"."work_activity_type" ADD VALUE 'break_paid';--> statement-breakpoint
ALTER TYPE "public"."work_activity_type" ADD VALUE 'break_unpaid';--> statement-breakpoint
ALTER TYPE "public"."work_activity_type" ADD VALUE 'lunch_paid';--> statement-breakpoint
ALTER TYPE "public"."work_activity_type" ADD VALUE 'lunch_unpaid';--> statement-breakpoint
CREATE TABLE "bumper_lane_override_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"work_item_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"reason" text,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" integer,
	"reviewed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bumper_lanes_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bumper_lane_override_requests" ADD CONSTRAINT "bumper_lane_override_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bumper_lane_override_requests" ADD CONSTRAINT "bumper_lane_override_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bumper_lane_override_requests" ADD CONSTRAINT "bumper_lane_override_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bumper_lane_override_requests_user_idx" ON "bumper_lane_override_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "bumper_lane_override_requests_status_idx" ON "bumper_lane_override_requests" USING btree ("status");