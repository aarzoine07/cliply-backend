import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getPlanFromPriceId } from "@cliply/shared/billing/stripePlanMap";

export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper to read raw body from request stream
async function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: { code: "METHOD_NOT_ALLOWED" } });
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).send("Missing signature");
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: { code: "CONFIGURATION_ERROR" } });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const buf = await getRawBody(req);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig as string, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const customer = s.customer as string;

        // Retrieve expanded session with line items
        const sessionExpanded = await stripe.checkout.sessions.retrieve(s.id, {
          expand: ["line_items", "subscription"],
        });

        const price =
          (sessionExpanded?.line_items?.data?.[0]?.price?.id) ||
          (s?.metadata?.price_id) ||
          undefined;

        // workspace_id is stored in Customer metadata at creation time
        const cust = (await stripe.customers.retrieve(customer)) as Stripe.Customer;
        const wsid = (cust.metadata && cust.metadata["workspace_id"]) || null;

        if (wsid) {
          await supabase
            .from("billing_customers")
            .upsert(
              {
                workspace_id: wsid,
                stripe_customer_id: customer,
                email: cust.email ?? null,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "workspace_id" },
            );

          if (sessionExpanded.subscription) {
            const subId =
              typeof sessionExpanded.subscription === "string"
                ? sessionExpanded.subscription
                : sessionExpanded.subscription.id;
            const sub = await stripe.subscriptions.retrieve(subId);
            const priceId = sub.items.data[0]?.price?.id || price || null;
            const plan = priceId ? (getPlanFromPriceId(priceId) ?? "basic") : "basic";

            await supabase
              .from("subscriptions")
              .upsert(
                {
                  workspace_id: wsid,
                  stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id || "",
                  stripe_subscription_id: sub.id,
                  plan_name: plan,
                  price_id: priceId || "",
                  status: sub.status === "active" || sub.status === "trialing" ? sub.status : "incomplete",
                  current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "workspace_id,stripe_subscription_id" },
              );
          }
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const cust = (await stripe.customers.retrieve(sub.customer as string)) as Stripe.Customer;
        const wsid = (cust.metadata && cust.metadata["workspace_id"]) || null;

        if (wsid) {
          const priceId = sub.items.data[0]?.price?.id || null;
          const plan = priceId ? (getPlanFromPriceId(priceId) ?? "basic") : "basic";

          await supabase
            .from("subscriptions")
            .upsert(
              {
                workspace_id: wsid,
                stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id || "",
                stripe_subscription_id: sub.id,
                plan_name: plan,
                price_id: priceId || "",
                status: sub.status === "active" || sub.status === "trialing" ? sub.status : sub.status === "canceled" ? "canceled" : "incomplete",
                current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: "workspace_id,stripe_subscription_id" },
            );
        }
        break;
      }
      default:
        // no-op
        break;
    }
  } catch (e) {
    // avoid logging secrets
    console.error("Stripe webhook processing error");
  }

  return res.status(200).json({ received: true });
}

