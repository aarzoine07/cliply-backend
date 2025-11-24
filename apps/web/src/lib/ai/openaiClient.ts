import { getEnv } from "@cliply/shared/env";
import { logger } from "../logger";

/**
 * Minimal OpenAI client helper for structured JSON output
 */
export interface OpenAICallOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Call OpenAI API with structured JSON response
 */
export async function callOpenAI<T = unknown>(
  options: OpenAICallOptions,
): Promise<T> {
  const env = getEnv();
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const maxTokens = options.maxTokens ?? 2000;
  const temperature = options.temperature ?? 0.7;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: options.userPrompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("openai_api_error", {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("OpenAI API returned no content");
    }

    try {
      return JSON.parse(content) as T;
    } catch (parseError) {
      logger.error("openai_json_parse_error", {
        content,
        error: (parseError as Error).message,
      });
      throw new Error("Failed to parse OpenAI response as JSON");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("OpenAI")) {
      throw error;
    }
    logger.error("openai_request_failed", {
      error: (error as Error).message,
    });
    throw new Error(`Failed to call OpenAI API: ${(error as Error).message}`);
  }
}

