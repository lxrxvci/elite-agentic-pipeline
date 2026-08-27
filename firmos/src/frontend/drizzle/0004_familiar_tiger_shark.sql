ALTER TABLE "users" ALTER COLUMN "commission_rate_override" SET DATA TYPE numeric(6, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "manager_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;