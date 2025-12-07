/**
 * Posting Guard: Anti-spam protection for TikTok and YouTube publishing.
 * 
 * Prevents accounts from:
 * - Exceeding daily posting limits (per account)
 * - Posting too frequently (minimum interval between posts)
 * 
 * Usage:
 * ```typescript
 * const history = await loadPostingHistory(workspaceId, accountId, platform);
 * const limits = getDefaultPostingLimitsForPlan(planName);
 * 
 * enforcePostLimits({
 *   now: new Date(),
 *   history,
 *   limits,
 *   platform: 'tiktok',
 *   accountId: 'abc123',
 * });
 * // Throws PostingLimitExceededError if violated
 * ```
 */

/**
 * A single posting event in the history.
 */
export interface PostHistoryEvent {
  /** Workspace that owns the post */
  workspaceId: string;
  /** Connected account ID (TikTok open_id or YouTube channel ID) */
  accountId: string;
  /** Platform: 'tiktok', 'youtube', 'youtube_shorts', etc. */
  platform: string;
  /** Clip ID that was posted */
  clipId: string;
  /** When the post was published */
  postedAt: Date;
}

/**
 * Posting rate limits for an account.
 */
export interface PostingLimits {
  /** Maximum posts per 24-hour rolling window */
  maxPerDay: number;
  /** Minimum milliseconds between consecutive posts */
  minIntervalMs: number;
}

/**
 * Error thrown when posting limits are exceeded.
 * 
 * This is a typed engine error that can be handled by surface code
 * to provide appropriate user feedback.
 */
export class PostingLimitExceededError extends Error {
  /** Error code for type discrimination */
  readonly code = 'POSTING_LIMIT_EXCEEDED';
  /** Specific reason for the violation */
  readonly reason: 'DAILY_LIMIT' | 'MIN_INTERVAL';
  /** Platform where limit was exceeded */
  readonly platform: string;
  /** Account ID that exceeded the limit */
  readonly accountId: string;
  /** If MIN_INTERVAL: milliseconds remaining until next post allowed */
  readonly remainingMs?: number;

  constructor(params: {
    reason: 'DAILY_LIMIT' | 'MIN_INTERVAL';
    platform: string;
    accountId: string;
    message?: string;
    remainingMs?: number;
  }) {
    const defaultMessage =
      params.reason === 'DAILY_LIMIT'
        ? `Daily posting limit reached for this account (${params.platform}).`
        : `Minimum interval between posts has not elapsed yet (${params.platform}).`;
    super(params.message ?? defaultMessage);
    this.name = 'PostingLimitExceededError';
    this.reason = params.reason;
    this.platform = params.platform;
    this.accountId = params.accountId;
    this.remainingMs = params.remainingMs;
  }
}

/**
 * Returns default posting limits based on plan tier.
 * 
 * These are conservative defaults. ME-I-04 will align these with
 * planMatrix and add plan-based enforcement.
 * 
 * @param planName - Plan tier: 'basic', 'pro', 'premium'
 * @returns Posting limits for the plan
 * 
 * @example
 * const limits = getDefaultPostingLimitsForPlan('pro');
 * // { maxPerDay: 30, minIntervalMs: 120_000 }
 */
export function getDefaultPostingLimitsForPlan(planName?: string): PostingLimits {
  // TODO (ME-I-04): Align with planMatrix limits and add to plan features
  switch (planName) {
    case 'premium':
      return { maxPerDay: 50, minIntervalMs: 60_000 }; // 1 minute
    case 'pro':
      return { maxPerDay: 30, minIntervalMs: 120_000 }; // 2 minutes
    case 'basic':
    default:
      return { maxPerDay: 10, minIntervalMs: 300_000 }; // 5 minutes
  }
}

/**
 * Checks if a clip can be posted given posting history and limits.
 * 
 * This is a pure function that doesn't throw - it returns a result object.
 * Use this for advisory checks; use `enforcePostLimits` to enforce.
 * 
 * Algorithm:
 * 1. Filter history to last 24 hours
 * 2. Check if daily limit would be exceeded
 * 3. Check if minimum interval since last post would be violated
 * 
 * @param options - Posting context
 * @returns Result indicating if posting is allowed
 * 
 * @example
 * const result = canPostClip({ now: new Date(), history, limits });
 * if (!result.allowed) {
 *   console.log(`Blocked: ${result.reason}`);
 * }
 */
export function canPostClip(options: {
  now: Date;
  history: PostHistoryEvent[];
  limits: PostingLimits;
}): { allowed: true } | { allowed: false; reason: 'DAILY_LIMIT' | 'MIN_INTERVAL'; remainingMs?: number } {
  const { now, history, limits } = options;
  const nowMs = now.getTime();
  const dayAgoMs = nowMs - 24 * 60 * 60 * 1000;

  // Filter to posts within last 24 hours
  const recent = history.filter((event) => event.postedAt.getTime() >= dayAgoMs);

  // Check daily limit
  if (recent.length >= limits.maxPerDay) {
    return { allowed: false, reason: 'DAILY_LIMIT' };
  }

  // Check minimum interval (if there are any recent posts)
  if (recent.length > 0) {
    // Find the most recent post
    const last = recent.reduce((latest, event) =>
      event.postedAt > latest.postedAt ? event : latest,
      recent[0]
    );

    const deltaMs = nowMs - last.postedAt.getTime();
    if (deltaMs < limits.minIntervalMs) {
      return {
        allowed: false,
        reason: 'MIN_INTERVAL',
        remainingMs: limits.minIntervalMs - deltaMs,
      };
    }
  }

  return { allowed: true };
}

/**
 * Enforces posting limits by throwing an error if violated.
 * 
 * This is the main entry point for publishing pipelines.
 * Call this before posting to ensure rate limits are respected.
 * 
 * @param options - Posting context with platform and account info
 * @throws {PostingLimitExceededError} If limits are exceeded
 * 
 * @example
 * enforcePostLimits({
 *   now: new Date(),
 *   history,
 *   limits,
 *   platform: 'tiktok',
 *   accountId: 'abc123',
 * });
 * // Will throw if limits exceeded, otherwise returns normally
 */
export function enforcePostLimits(options: {
  now: Date;
  history: PostHistoryEvent[];
  limits: PostingLimits;
  platform: string;
  accountId: string;
}): void {
  const { now, history, limits, platform, accountId } = options;
  const result = canPostClip({ now, history, limits });

  if (!result.allowed) {
    throw new PostingLimitExceededError({
      reason: result.reason,
      platform,
      accountId,
      remainingMs: result.remainingMs,
    });
  }
}

