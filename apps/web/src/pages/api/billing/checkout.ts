import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: { code: "METHOD_NOT_ALLOWED" } });
  }

  const { priceId, success_url, cancel_url } = req.body || {};
  const wsid = req.cookies["wsid"];

  if (!wsid || !priceId) {
    return res.status(400).json({
      ok: false,
      error: { code: "BAD_REQUEST", message: "wsid and priceId required" },
    });
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      ok: false,
      error: { code: "CONFIGURATION_ERROR", message: "Missing required environment variables" },
    });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2023-10-16",
  });  
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    // Ensure a Stripe customer exists for this workspace
    const { data: existing, error: qErr } = await supabase
      .from("billing_customers")
      .select("stripe_customer_id, email")
      .eq("workspace_id", wsid)
      .maybeSingle();

    if (qErr) {
      console.error("Failed to query billing_customers:", qErr);
      return res.status(500).json({ ok: false, error: { code: "DB_QUERY_FAILED" } });
    }

    let customerId = existing?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { workspace_id: wsid },
      });
      customerId = customer.id;

      const { error: upErr } = await supabase
        .from("billing_customers")
        .upsert(
          {
            workspace_id: wsid,
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id" },
        );

      if (upErr) {
        console.error("Failed to upsert billing_customers:", upErr);
        return res.status(500).json({ ok: false, error: { code: "DB_UPSERT_FAILED" } });
      }
    }

    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: success_url || `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${appUrl}/billing/cancel`,
    });

    return res.status(200).json({ ok: true, data: { url: session.url } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Checkout session creation error:", message);
    return res.status(500).json({
      ok: false,
      error: { code: "CHECKOUT_ERROR", message },
    });
  }
}
