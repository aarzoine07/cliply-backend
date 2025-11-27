import type { NextApiRequest, NextApiResponse } from "next";

import { handler, ok, err } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getAdminClient } from "@/lib/supabase";
import * as productService from "@/lib/dropshipping/productService";
import { buildAuthContext, handleAuthError } from "@/lib/auth/context";

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  let auth;
  try {
    auth = await buildAuthContext(req);
  } catch (error) {
    handleAuthError(error, res);
    return;
  }

  const workspaceId = auth.workspaceId || auth.workspace_id;
  if (!workspaceId) {
    res.status(400).json(err("invalid_request", "workspace required"));
    return;
  }

  const supabase = getAdminClient();
  const { id } = req.query;

  if (typeof id !== "string") {
    res.status(400).json(err("invalid_request", "Invalid product id"));
    return;
  }

  //
  // GET — read a single product by filtering listProductsForWorkspace
  //
  if (req.method === "GET") {
    try {
      const products = await productService.listProductsForWorkspace(
        workspaceId,
        { supabase }
      );

      const product = products.find((p) => p.id === id);

      if (!product) {
        res.status(404).json(err("not_found", "Product not found"));
        return;
      }

      logger.info("product_read", {
        workspaceId,
        productId: id,
      });

      res.status(200).json(ok(product));
      return;
    } catch (error) {
      logger.error("product_read_failed", {
        workspaceId,
        productId: id,
        message: (error as any)?.message ?? "unknown",
      });

      res
        .status(500)
        .json(err("internal_error", "Failed to fetch product"));
      return;
    }
  }

  //
  // PUT — update a product
  //
  if (req.method === "PUT") {
    let body: unknown = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json(err("invalid_request", "Invalid JSON payload"));
        return;
      }
    }

    // Update via Supabase directly
    try {
      const { data, error } = await supabase
        .from("dropshipping_products")
        .update(body as any)
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .select()
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // row not found
          res.status(404).json(err("not_found", "Product not found"));
          return;
        }

        throw error;
      }

      logger.info("product_updated", {
        workspaceId,
        productId: id,
      });

      res.status(200).json(ok(data));
      return;
    } catch (error) {
      logger.error("product_update_failed", {
        workspaceId,
        productId: id,
        message: (error as any)?.message ?? "unknown",
      });

      res
        .status(500)
        .json(err("internal_error", "Failed to update product"));
      return;
    }
  }

  //
  // DELETE — delete product directly
  //
  if (req.method === "DELETE") {
    try {
      const { error } = await supabase
        .from("dropshipping_products")
        .delete()
        .eq("id", id)
        .eq("workspace_id", workspaceId);

      if (error) {
        if (error.code === "PGRST116") {
          res.status(404).json(err("not_found", "Product not found"));
          return;
        }
        throw error;
      }

      logger.info("product_deleted", {
        workspaceId,
        productId: id,
      });

      res.status(200).json(ok({ success: true }));
      return;
    } catch (error) {
      logger.error("product_delete_failed", {
        workspaceId,
        productId: id,
        message: (error as any)?.message ?? "unknown",
      });

      res
        .status(500)
        .json(err("internal_error", "Failed to delete product"));
      return;
    }
  }

  res.setHeader("Allow", "GET, PUT, DELETE");
  res.status(405).json(err("method_not_allowed", "Method not allowed"));
});



