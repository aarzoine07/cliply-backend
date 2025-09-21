import { createHash } from 'node:crypto';

import { getAdminClient } from './supabase';

export type ExecFn<T> = () => Promise<T>;

export type IdempotencyResult<T> =
  | { fresh: true; value: T; responseHash: string }
  | { fresh: false; responseHash: string | null };

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function keyFromRequest(req: { method?: string; url?: string; body?: unknown }): string {
  const payload = JSON.stringify({
    m: (req.method ?? 'GET').toUpperCase(),
    u: req.url ?? '',
    b: req.body ?? null,
  });
  return sha256(payload);
}

export async function withIdempotency<T>(
  key: string,
  exec: ExecFn<T>,
  hashResponse: (value: T) => string = (value) => sha256(JSON.stringify(value)),
): Promise<IdempotencyResult<T>> {
  const admin = getAdminClient();

  const existing = await admin
    .from('idempotency')
    .select('status,response_hash')
    .eq('key', key)
    .maybeSingle();

  if (existing.error && existing.error.code !== 'PGRST116') {
    throw existing.error;
  }

  if (existing.data && existing.data.status === 'completed') {
    return { fresh: false, responseHash: existing.data.response_hash ?? null };
  }

  await admin
    .from('idempotency')
    .upsert({ key, status: 'pending' }, { onConflict: 'key', ignoreDuplicates: true });

  const value = await exec();
  const responseHash = hashResponse(value);

  await admin
    .from('idempotency')
    .upsert({ key, status: 'completed', response_hash: responseHash }, { onConflict: 'key' });

  return { fresh: true, value, responseHash };
}