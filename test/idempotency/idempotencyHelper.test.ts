import { describe, expect, it, vi, beforeEach } from "vitest";
import { runIdempotent, extractIdempotencyKey } from "../../packages/shared/idempotency/idempotencyHelper";
import type { IdempotencyContext } from "../../packages/shared/idempotency/idempotencyHelper";

// Mock Supabase client
const createMockSupabase = () => {
  let records: Record<string, any> = {};

  const from = vi.fn((table: string) => {
    if (table !== "idempotency") {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      select: vi.fn((columns?: string) => {
        const selectChain = {
          eq: vi.fn((key: string, value: string) => {
            return {
              maybeSingle: vi.fn(async () => {
                const record = records[value];
                if (!record) {
                  return { data: null, error: { code: "PGRST116" } };
                }
                // Return only selected columns if specified
                if (columns) {
                  const selected: any = {};
                  columns.split(",").forEach((col) => {
                    const trimmed = col.trim();
                    if (record[trimmed] !== undefined) {
                      selected[trimmed] = record[trimmed];
                    }
                  });
                  return { data: selected, error: null };
                }
                return { data: record, error: null };
              }),
            };
          }),
        };
        return selectChain;
      }),
      insert: vi.fn((data: any) => {
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => {
              const key = data.key;
              records[key] = { ...data, created_at: new Date().toISOString() };
              return { data: records[key], error: null };
            }),
          })),
        };
      }),
      update: vi.fn((data: any) => {
        return {
          eq: vi.fn((key: string, value: string) => {
            // Update the record immediately when eq is called
            if (records[value]) {
              records[value] = { ...records[value], ...data };
            }
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  if (records[value]) {
                    return { data: records[value], error: null };
                  }
                  return { data: null, error: null };
                }),
              })),
            };
          }),
        };
      }),
    };
  });

  return {
    from,
    _clear: () => {
      records = {};
    },
    _getRecords: () => records,
  };
};

describe("idempotencyHelper", () => {
  describe("runIdempotent", () => {
    let mockSupabase: ReturnType<typeof createMockSupabase>;
    let ctx: IdempotencyContext;

    beforeEach(() => {
      mockSupabase = createMockSupabase();
      ctx = {
        supabaseAdminClient: mockSupabase as any,
        workspaceId: "workspace-123",
        userId: "user-123",
        key: "test-key",
        endpoint: "test/endpoint",
      };
    });

    it("executes handler and stores result when no existing record", async () => {
      const handler = vi.fn(async () => ({ result: "success" }));

      const result = await runIdempotent(ctx, { data: "test" }, handler);

      expect(result.reused).toBe(false);
      expect(result.response).toEqual({ result: "success" });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("reuses response when completed record exists with matching request hash", async () => {
      // First call - create record
      const handler1 = vi.fn(async () => ({ result: "success" }));
      await runIdempotent(ctx, { data: "test" }, handler1, { storeResponseJson: true });

      // Second call - should reuse
      const handler2 = vi.fn(async () => ({ result: "should not run" }));
      const result = await runIdempotent(ctx, { data: "test" }, handler2, { storeResponseJson: true });

      expect(result.reused).toBe(true);
      expect(handler2).not.toHaveBeenCalled();
      expect(result.storedResponse).toEqual({ result: "success" });
    });

    it("throws error when same key used with different request body", async () => {
      // First call
      const handler1 = vi.fn(async () => ({ result: "success" }));
      await runIdempotent(ctx, { data: "test1" }, handler1);

      // Second call with different body
      const handler2 = vi.fn(async () => ({ result: "should not run" }));
      
      await expect(
        runIdempotent(ctx, { data: "test2" }, handler2)
      ).rejects.toThrow("Idempotency key conflict");
      
      expect(handler2).not.toHaveBeenCalled();
    });

    it("throws error when record is pending", async () => {
      // The composite key is computed inside runIdempotent using SHA256
      // We need to compute it the same way to insert a pending record
      const { createHash } = await import("node:crypto");
      const composite = `${ctx.workspaceId}:${ctx.endpoint}:${ctx.key}`;
      const compositeKey = createHash("sha256").update(composite).digest("hex");
      
      // Insert pending record manually using the mock
      const insertResult = await mockSupabase.from("idempotency").insert({
        key: compositeKey,
        user_id: ctx.userId,
        status: "pending",
        request_hash: "hash1",
      }).select().single();

      const handler = vi.fn(async () => ({ result: "should not run" }));
      
      await expect(
        runIdempotent(ctx, { data: "test" }, handler)
      ).rejects.toThrow("still processing");
      
      expect(handler).not.toHaveBeenCalled();
    });

    it("stores response JSON when storeResponseJson is true", async () => {
      const handler = vi.fn(async () => ({ checkoutUrl: "https://stripe.com/checkout", sessionId: "sess_123" }));
      
      const result = await runIdempotent(ctx, { data: "test" }, handler, { storeResponseJson: true });

      expect(result.reused).toBe(false);
      expect(result.response).toEqual({ checkoutUrl: "https://stripe.com/checkout", sessionId: "sess_123" });

      // Clear handler call count
      handler.mockClear();

      // Verify it can be retrieved (second call should reuse)
      const result2 = await runIdempotent(ctx, { data: "test" }, handler, { storeResponseJson: true });
      expect(result2.reused).toBe(true);
      expect(result2.storedResponse).toEqual({ checkoutUrl: "https://stripe.com/checkout", sessionId: "sess_123" });
      // Handler should not be called on reuse
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("extractIdempotencyKey", () => {
    it("extracts Idempotency-Key header (case-insensitive)", () => {
      const req = {
        headers: {
          "Idempotency-Key": "test-key-123",
        },
      };
      expect(extractIdempotencyKey(req)).toBe("test-key-123");
    });

    it("extracts idempotency-key header (lowercase)", () => {
      const req = {
        headers: {
          "idempotency-key": "test-key-456",
        },
      };
      expect(extractIdempotencyKey(req)).toBe("test-key-456");
    });

    it("returns null when header is missing", () => {
      const req = {
        headers: {},
      };
      expect(extractIdempotencyKey(req)).toBeNull();
    });

    it("handles array header values", () => {
      const req = {
        headers: {
          "Idempotency-Key": ["test-key-789"],
        },
      };
      expect(extractIdempotencyKey(req)).toBe("test-key-789");
    });
  });
});

