import type { ValidateRequest, ValidateResponse } from "./types";

const HEXAGATE_API_URL =
  "https://api.hexagate.com/api/v1/invariants/validate";

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function validate(
  apiKey: string,
  request: ValidateRequest
): Promise<ValidateResponse> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    }

    const response = await fetch(HEXAGATE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hexagate-Api-Key": apiKey,
      },
      body: JSON.stringify(request),
    });

    if (response.ok) {
      const data = (await response.json()) as ValidateResponse;
      return {
        failed: data.failed ?? [],
        exceptions: data.exceptions ?? [],
        trace: data.trace,
      };
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) {
      const text = await response.text();
      return {
        failed: [],
        exceptions: [[`Hexagate API error (${response.status}): ${text}`]],
      };
    }
  }

  return { failed: [], exceptions: [["validate: exhausted retries"]] };
}
