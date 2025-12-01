-- Create billing_customers table for Stripe customer tracking
CREATE TABLE IF NOT EXISTS "public"."billing_customers" (
    "workspace_id" uuid NOT NULL,
    "stripe_customer_id" text NOT NULL,
    "email" text,
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY ("workspace_id"),
    CONSTRAINT "billing_customers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_customers_stripe_customer_id_key" ON "public"."billing_customers" USING btree ("stripe_customer_id");

ALTER TABLE "public"."billing_customers" ENABLE ROW LEVEL SECURITY;

