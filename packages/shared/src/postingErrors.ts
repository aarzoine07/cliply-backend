/**
 * Posting-related error classes for publish flows.
 *
 * These errors are thrown when posting/publishing operations fail
 * due to rate limits, missing accounts, or invalid clip states.
 */

import { ERROR_CODES } from "./errorCodes";

export class PostingLimitExceededError extends Error {
  readonly code = ERROR_CODES.posting_limit_exceeded;

  constructor(message = "Posting rate limit exceeded") {
    super(message);
    this.name = "PostingLimitExceededError";
  }
}

export class MissingConnectedAccountError extends Error {
  readonly code = ERROR_CODES.missing_connected_account;

  constructor(message = "Missing or invalid connected account") {
    super(message);
    this.name = "MissingConnectedAccountError";
  }
}

export class InvalidClipStateError extends Error {
  readonly code = ERROR_CODES.invalid_clip_state;

  constructor(message = "Clip is in an invalid state for this operation") {
    super(message);
    this.name = "InvalidClipStateError";
  }
}

export class ClipAlreadyPublishedError extends Error {
  readonly code = ERROR_CODES.clip_already_published;

  constructor(message = "Clip has already been published") {
    super(message);
    this.name = "ClipAlreadyPublishedError";
  }
}
