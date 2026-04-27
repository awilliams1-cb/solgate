import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { basename, join } from "path";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { parseGateFile } from "./parser";
import { generateSolidity } from "./codegen";
import { validate } from "./api";

const command = process.argv[2];

if (command === "codegen") {
  handleCodegen();
} else if (command === "validate") {
  await handleValidate();
} else {
  process.stderr.write(
    `Usage:\n  solgate codegen <gate-file> [--output <dir>]\n  solgate validate --request <path>\n`
  );
  process.exit(1);
}

function handleCodegen() {
  const gateFilePath = process.argv[3];
  if (!gateFilePath) {
    process.stderr.write("Error: gate file path required\n");
    process.exit(1);
  }

  let outputDir = "src/generated";
  const outputIdx = process.argv.indexOf("--output");
  if (outputIdx !== -1 && process.argv[outputIdx + 1]) {
    outputDir = process.argv[outputIdx + 1]!;
  }

  const content = readFileSync(gateFilePath, "utf-8");
  const parsed = parseGateFile(content);

  const gateName = basename(gateFilePath, ".gate");
  const solidity = generateSolidity(parsed, gateName);

  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(
    outputDir,
    `${pascalCase(gateName)}Mocks.sol`
  );
  writeFileSync(outputPath, solidity);
  process.stderr.write(`Generated ${outputPath}\n`);
}

async function handleValidate() {
  // The request JSON is passed directly as the third argument
  // (after `validate`). This avoids unsafe writeFile/removeFile cheatcodes
  // on the Solidity side.
  const requestJson = process.argv[3];
  if (!requestJson) {
    process.stderr.write("Error: request JSON argument required\n");
    process.exit(1);
  }

  const raw = JSON.parse(requestJson);

  // Post-process: Foundry's vm.serializeJson may embed params/mocks as
  // nested JSON objects or as JSON strings depending on the content
  const params = processSerializedJson(resolveJsonField(raw, "paramsJson", "params"));
  const mocks = processSerializedJson(resolveJsonField(raw, "mocksJson", "mocks"));

  const gateContent = readFileSync(raw.gateFile, "utf-8");

  const apiKey = process.env.HEXAGATE_API_KEY;
  if (!apiKey) {
    writeEncodedResponse([], [["HEXAGATE_API_KEY environment variable not set"]], "");
    return;
  }

  const response = await validate(apiKey, {
    gate: gateContent,
    chain_id: raw.chainId,
    params,
    mocks,
    trace: raw.trace,
  });

  const traceJson = response.trace ? JSON.stringify(response.trace) : "";
  writeEncodedResponse(response.failed, response.exceptions, traceJson);
}

function resolveJsonField(
  raw: Record<string, unknown>,
  jsonKey: string,
  fallbackKey: string
): Record<string, unknown> {
  const val = raw[jsonKey];
  if (typeof val === "string") return JSON.parse(val);
  if (typeof val === "object" && val !== null) return val as Record<string, unknown>;
  const fallback = raw[fallbackKey];
  if (typeof fallback === "object" && fallback !== null) return fallback as Record<string, unknown>;
  return {};
}

function processSerializedJson(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "__init") continue;
    if (key.startsWith("__raw:")) {
      const realKey = key.slice("__raw:".length);
      result[realKey] = typeof value === "string" ? JSON.parse(value) : value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function writeEncodedResponse(
  failed: string[][],
  exceptions: string[][],
  traceJson: string
) {
  const encoded = encodeAbiParameters(
    parseAbiParameters("string[][], string[][], string"),
    [
      failed as readonly (readonly string[])[],
      exceptions as readonly (readonly string[])[],
      traceJson,
    ]
  );
  process.stdout.write(encoded.slice(2));
}

function pascalCase(s: string): string {
  return s
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}
