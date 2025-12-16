/**
 * Mock Posting Helpers
 *
 * These helpers provide mock functions for posting-related tests.
 * Used to simulate:
 *   - Usage exceeded scenarios
 *   - Posting cooldown enforcement
 *   - Success path for posting operations
 *
 * NOTE: These are empty Vitest mocks to be configured in individual tests.
 */
import { vi } from "vitest";

/**
 * Mock function for checking if a user/workspace can post.
 * Configure return value in tests to simulate:
 *   - { canPost: true } for allowed posting
 *   - { canPost: false, reason: "usage_exceeded" } for quota hit
 *   - { canPost: false, reason: "cooldown" } for rate limiting
 */
export const mockCanPost = vi.fn();

/**
 * Mock function for recording a post action.
 * Configure in tests to simulate:
 *   - Successful post recording
 *   - Failed recording (database error)
 *   - Quota increment
 */
export const mockRecordPost = vi.fn();
