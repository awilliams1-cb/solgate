import type { ValidateRequest, ValidateResponse } from "./types";

const HEXAGATE_API_URL =
  "https://api.hexagate.com/api/v1/invariants/validate";

export async function validate(
  apiKey: string,
  request: ValidateRequest
): Promise<ValidateResponse> {
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const response = await fetch(HEXAGATE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hexagate-Api-Key": apiKey,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      failed: [],
      exceptions: [[`Hexagate API error (${response.status}): ${text}`]],
    };
  }

  const data = (await response.json()) as ValidateResponse;
  return {
    failed: data.failed ?? [],
    exceptions: data.exceptions ?? [],
    trace: data.trace,
  };
}
