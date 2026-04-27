import type {
  GatelangType,
  GatelangPrimitive,
  GateParam,
  GateSource,
  ParsedGate,
} from "./types";

const PRIMITIVES: GatelangPrimitive[] = [
  "integer",
  "address",
  "bytes",
  "boolean",
];

export function parseGateType(raw: string): GatelangType {
  // Normalize whitespace around angle brackets and commas so types like
  // `list < tuple < bytes, address > >` parse the same as `list<tuple<bytes,address>>`
  const s = raw.trim().replace(/\s*<\s*/g, "<").replace(/\s*>\s*/g, ">").replace(/\s*,\s*/g, ",");

  if (PRIMITIVES.includes(s as GatelangPrimitive)) {
    return { kind: "primitive", primitive: s as GatelangPrimitive };
  }

  if (s.startsWith("list<") && s.endsWith(">")) {
    const inner = s.slice(5, -1).trim();
    return { kind: "list", elementType: parseGateType(inner) };
  }

  if (s.startsWith("tuple<") && s.endsWith(">")) {
    const inner = s.slice(6, -1).trim();
    const fields = splitTopLevelCommas(inner).map(parseGateType);
    return { kind: "tuple", fields };
  }

  if (s.startsWith("map<") && s.endsWith(">")) {
    const inner = s.slice(4, -1).trim();
    const parts = splitTopLevelCommas(inner);
    // parts[0] and parts[1] are asserted non-null but are not guaranteed by the
    // regex — a malformed map type (e.g. map<address> with no comma) would yield
    // undefined here and throw at runtime.
    return {
      kind: "map",
      keyType: parseGateType(parts[0]!),
      valueType: parseGateType(parts[1]!),
    };
  }

  return { kind: "primitive", primitive: "integer" };
}

function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const ch of s) {
    if (ch === "<") depth++;
    else if (ch === ">") depth--;

    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}


function classifySourceKind(
  rhs: string
): "Events" | "Call" {
  const trimmed = rhs.trim();
  if (trimmed.startsWith("Events") || trimmed.startsWith("HistoricalEvents")) return "Events";
  return "Call";
}

function extractSignatureFromBlock(
  block: string,
  prefix: string
): string | undefined {
  const sigPattern = new RegExp(
    `signature:\\s*"(${prefix}\\s[^"]+)"`,
    "s"
  );
  const match = block.match(sigPattern);
  return match?.[1];
}

export function parseGateFile(content: string): ParsedGate {
  const params: GateParam[] = [];
  const sources: GateSource[] = [];

  let fullText = content;

  // Parse param declarations: param name: type;
  const paramRegex = /^param\s+(\w+)\s*:\s*(\w+)\s*;/gm;
  let match: RegExpExecArray | null;

  while ((match = paramRegex.exec(fullText)) !== null) {
    params.push({
      name: match[1]!,
      type: parseGateType(match[2]!),
    });
  }

  // Parse source declarations: source name: type = ...;
  // Sources can span multiple lines, so we need to find balanced braces/brackets
  const sourceStartRegex = /^source\s+(\w+)\s*:\s*/gm;

  while ((match = sourceStartRegex.exec(fullText)) !== null) {
    const name = match[1]!;
    const afterName = fullText.slice(match.index + match[0].length);

    // Find the type annotation (everything before the '=')
    const eqIdx = findTopLevelEquals(afterName);
    if (eqIdx === -1) continue;

    const typeStr = afterName.slice(0, eqIdx).trim();
    const type = parseGateType(typeStr);

    // Find the RHS (everything after '=' until the matching ';')
    const rhsStart = eqIdx + 1;
    const rhsEnd = findBalancedEnd(afterName, rhsStart);
    const rhs = afterName.slice(rhsStart, rhsEnd).trim();

    const kind = classifySourceKind(rhs);

    const source: GateSource = { name, type, kind };

    if (kind === "Events") {
      source.eventSignature = extractSignatureFromBlock(rhs, "event");
    } else if (kind === "Call") {
      source.callSignature = extractSignatureFromBlock(rhs, "function");
    }

    sources.push(source);
  }

  return { params, sources };
}

function findTopLevelEquals(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "<") depth++;
    else if (ch === ">") depth--;
    else if (ch === "=" && depth === 0) return i;
  }
  return -1;
}

function findBalancedEnd(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === ";" && depth === 0) return i;
  }
  return s.length;
}
