import { parseAbiItem } from "viem";
import type { GatelangType, GateSource, ParsedGate } from "./types";

function gateTypeToSolidity(t: GatelangType): string {
  if (t.kind === "primitive") {
    switch (t.primitive) {
      case "integer":
        return "int256";
      case "address":
        return "address";
      case "bytes":
        return "bytes32";
      case "boolean":
        return "bool";
      default:
        return "int256";
    }
  }
  if (t.kind === "list") {
    return `${gateTypeToSolidity(t.elementType!)}[]`;
  }
  throw new Error(
    `gateTypeToSolidity: tuple/map must be resolved via collectStructDefs — reached kind "${t.kind}"`
  );
}

function isJsonQuoted(t: GatelangType): boolean {
  if (t.kind !== "primitive") return false;
  return t.primitive === "address" || t.primitive === "bytes";
}

function pascalCase(s: string): string {
  return s
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function structName(sourceName: string): string {
  return `${pascalCase(sourceName)}Entry`;
}

// ─── Recursive struct collector ───

interface CollectedStruct {
  name: string;
  definition: string;
}

/**
 * Maps a single field type to its Solidity type name, given the parent struct's
 * name and the field's index.  Does not emit anything.
 *
 * For primitive/list-of-primitive: delegates to gateTypeToSolidity.
 * For tuple fields: returns the nested struct name (${parentName}Field${i}).
 * For list-of-tuple fields: returns the nested struct name with [] suffix.
 */
function resolveFieldSolidityType(
  f: GatelangType,
  parentName: string,
  fieldIndex: number
): string {
  if (f.kind === "primitive") return gateTypeToSolidity(f);
  if (f.kind === "list") {
    const elem = f.elementType!;
    if (elem.kind === "primitive") return `${gateTypeToSolidity(elem)}[]`;
    if (elem.kind === "tuple") return `${parentName}Field${fieldIndex}Entry[]`;
  }
  if (f.kind === "tuple") return `${parentName}Field${fieldIndex}`;
  return "bytes";
}

/**
 * Recursively collects all struct definitions needed for a tuple type, appending
 * them to `out` in post-order (children before parents).
 */
function collectStructDefs(
  parentName: string,
  fields: GatelangType[],
  fieldNames: string[],
  out: CollectedStruct[]
): void {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    if (f.kind === "tuple") {
      const childName = `${parentName}Field${i}`;
      collectStructDefs(childName, f.fields!, defaultFieldNames(f.fields!.length), out);
    } else if (f.kind === "list" && f.elementType?.kind === "tuple") {
      const childName = `${parentName}Field${i}Entry`;
      const elemFields = f.elementType.fields!;
      collectStructDefs(childName, elemFields, defaultFieldNames(elemFields.length), out);
    }
  }

  const lines = fields.map((f, i) => {
    const solType = resolveFieldSolidityType(f, parentName, i);
    return `        ${solType} ${fieldNames[i]};`;
  });
  out.push({
    name: parentName,
    definition: `    struct ${parentName} {\n${lines.join("\n")}\n    }`,
  });
}

// ─── Recursive serializer ───

interface SerializeLine {
  indent: number;  // extra indentation levels (×4 spaces) beyond the base 16-space indent
  content: string; // the raw text on this line, without leading spaces or newlines
}

interface SerializeFragment {
  preamble: string;        // code to emit before the string.concat call (e.g. inner loops)
  lines: SerializeLine[];  // token lines for the string.concat arguments
}

/**
 * Recursively builds the string.concat token lines and any preamble code
 * (inner loops for list-typed fields) needed to serialize a single value of
 * the given type.
 *
 * `accessor` is the Solidity expression for the value (e.g. "entries[i].field2").
 * `depth` tracks loop nesting to produce unique loop variable names (_i1, _i2, …).
 */
function generateSerializeExpr(
  fieldType: GatelangType,
  accessor: string,
  depth: number
): SerializeFragment {
  if (fieldType.kind === "primitive") {
    const content = isJsonQuoted(fieldType)
      ? `'"', VM.toString(${accessor}), '"'`
      : `VM.toString(${accessor})`;
    return { preamble: "", lines: [{ indent: 0, content }] };
  }

  if (fieldType.kind === "tuple") {
    const nestedFields = fieldType.fields!;
    const nestedNames = defaultFieldNames(nestedFields.length);
    let preamble = "";
    const lines: SerializeLine[] = [{ indent: 0, content: '"["' }];

    nestedFields.forEach((f, i) => {
      const nestedAccessor = `${accessor}.${nestedNames[i]}`;
      const nested = generateSerializeExpr(f, nestedAccessor, depth);
      preamble += nested.preamble;

      const isLastInner = i === nestedFields.length - 1;
      nested.lines.forEach((line, j) => {
        const isLastLine = j === nested.lines.length - 1;
        const suffix = !isLastInner && isLastLine ? `, ","` : "";
        lines.push({ indent: line.indent + 1, content: line.content + suffix });
      });
    });

    lines.push({ indent: 0, content: '"]"' });
    return { preamble, lines };
  }

  if (fieldType.kind === "list") {
    const elemType = fieldType.elementType!;
    const loopVar = `_i${depth}`;
    const listVar = `_list${depth}`;
    const elemAccessor = `${accessor}[${loopVar}]`;
    const elemFrag = generateSerializeExpr(elemType, elemAccessor, depth + 1);

    const elemContent = elemFrag.lines.map((l) => l.content).join(", ");
    let preamble = elemFrag.preamble;
    preamble += `            string memory ${listVar} = "[";\n`;
    preamble += `            for (uint256 ${loopVar} = 0; ${loopVar} < ${accessor}.length; ${loopVar}++) {\n`;
    preamble += `                if (${loopVar} > 0) ${listVar} = string.concat(${listVar}, ",");\n`;
    preamble += `                ${listVar} = string.concat(${listVar}, ${elemContent});\n`;
    preamble += `            }\n`;
    preamble += `            ${listVar} = string.concat(${listVar}, "]");\n`;

    return { preamble, lines: [{ indent: 0, content: listVar }] };
  }

  return { preamble: "", lines: [{ indent: 0, content: `VM.toString(${accessor})` }] };
}

// ─── Body generator ───

function generateSerializeBody(
  sourceName: string,
  sName: string,
  fields: GatelangType[],
  callSig?: string
): string {
  const fieldNames = extractFieldNames(fields.length, callSig);
  const varName = "entries";
  const baseIndent = "                "; // 16 spaces

  const fragments = fields.map((f, i) =>
    generateSerializeExpr(f, `${varName}[i].${fieldNames[i]}`, 1)
  );

  let body = "";
  body += `        string memory json = "[";\n`;
  body += `        for (uint256 i = 0; i < ${varName}.length; i++) {\n`;
  body += `            if (i > 0) json = string.concat(json, ",");\n`;

  for (const frag of fragments) {
    if (frag.preamble) body += frag.preamble;
  }

  body += `            json = string.concat(json, "["`;

  fragments.forEach((frag, fieldIdx) => {
    const isLastField = fieldIdx === fragments.length - 1;
    frag.lines.forEach((line, lineIdx) => {
      const isLastLine = lineIdx === frag.lines.length - 1;
      const separator = !isLastField && isLastLine ? `, ","` : "";
      const indentStr = baseIndent + "    ".repeat(line.indent);
      body += `,\n${indentStr}${line.content}${separator}`;
    });
  });

  body += `,\n            "]");\n`;
  body += `        }\n`;
  body += `        json = string.concat(json, "]");\n`;
  body += `        gate.mockRaw("${sourceName}", json);`;

  return body;
}

// ─── Scalar/list-scalar helpers (unchanged) ───

function generateScalarMockFn(source: GateSource): string {
  const solType = gateTypeToSolidity(source.type);
  const fnName = `mock${pascalCase(source.name)}`;

  let mockCall: string;
  switch (source.type.primitive) {
    case "integer":
      mockCall = `gate.mockInt("${source.name}", value)`;
      break;
    case "address":
      mockCall = `gate.mockAddress("${source.name}", value)`;
      break;
    case "boolean":
      mockCall = `gate.mockBool("${source.name}", value)`;
      break;
    case "bytes":
      mockCall = `gate.mockBytes32("${source.name}", value)`;
      break;
    default:
      mockCall = `gate.mockInt("${source.name}", value)`;
  }

  return `    function ${fnName}(Solgate.Gate memory gate, ${solType} value) internal {
        ${mockCall};
    }`;
}

function generateListScalarMockFn(source: GateSource): string {
  const elemType = source.type.elementType!;
  const solType = gateTypeToSolidity(elemType);
  const fnName = `mock${pascalCase(source.name)}`;

  let body = "";
  body += `    function ${fnName}(Solgate.Gate memory gate, ${solType}[] memory values) internal {\n`;
  body += `        string memory json = "[";\n`;
  body += `        for (uint256 i = 0; i < values.length; i++) {\n`;
  body += `            if (i > 0) json = string.concat(json, ",");\n`;

  if (isJsonQuoted(elemType)) {
    body += `            json = string.concat(json, '"', VM.toString(values[i]), '"');\n`;
  } else {
    body += `            json = string.concat(json, VM.toString(values[i]));\n`;
  }

  body += `        }\n`;
  body += `        json = string.concat(json, "]");\n`;
  body += `        gate.mockRaw("${source.name}", json);\n`;
  body += `    }`;

  return body;
}

// ─── ABI helpers ───

function extractFieldNames(count: number, sig?: string): string[] {
  if (!sig) return defaultFieldNames(count);

  try {
    const parsed = parseAbiItem(sig);

    if (parsed.type === "event") {
      const inputs = parsed.inputs ?? [];
      if (inputs.length === count) {
        return inputs.map((input, i) => input.name || `field${i}`);
      }
    }

    if (parsed.type === "function") {
      const outputs = parsed.outputs ?? [];
      if (outputs.length === count) {
        return outputs.map((output, i) => output.name || `field${i}`);
      }
    }
  } catch {
    // Fall through to defaults if viem can't parse the signature
  }

  return defaultFieldNames(count);
}

function defaultFieldNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `field${i}`);
}

function normalizeEventSig(sig: string): string {
  try {
    const parsed = parseAbiItem(sig);
    if (parsed.type === "event") {
      const params = (parsed.inputs ?? []).map((i) => i.type).join(",");
      return `${parsed.name}(${params})`;
    }
  } catch {
    // Fallback to regex
  }
  const match = sig.match(/event\s+(\w+)\s*\(([^)]*)\)/);
  if (!match) return sig;
  const name = match[1];
  const params = (match[2] ?? "")
    .split(",")
    .map((p) => p.trim().split(/\s+/)[0])
    .join(",");
  return `${name}(${params})`;
}

// ─── Main codegen ───

export function generateSolidity(gate: ParsedGate, gateName: string): string {
  const libName = `${pascalCase(gateName)}Mocks`;

  let sol = `// Auto-generated by solgate from ${gateName}.gate\n`;
  sol += `// DO NOT EDIT — re-run \`solgate codegen\` to regenerate\n`;
  sol += `// SPDX-License-Identifier: MIT\n`;
  sol += `pragma solidity ^0.8.0;\n\n`;
  sol += `import {Vm} from "forge-std/Vm.sol";\n`;
  sol += `import {Solgate} from "solgate/Solgate.sol";\n\n`;
  sol += `library ${libName} {\n`;
  sol += `    using Solgate for Solgate.Gate;\n\n`;
  sol += `    Vm constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));\n\n`;

  // Params
  if (gate.params.length > 0) {
    sol += `    // ─── Params ───\n\n`;
    for (const param of gate.params) {
      const solType = gateTypeToSolidity(param.type);
      const fnName = `set${pascalCase(param.name)}`;
      sol += `    function ${fnName}(Solgate.Gate memory gate, ${solType} value) internal {\n`;
      sol += `        gate.setParam("${param.name}", value);\n`;
      sol += `    }\n\n`;
    }
  }

  // ─── Helper for emitting a list<tuple> source ───
  function emitTupleListSource(
    source: GateSource,
    sig: string | undefined
  ): void {
    const sName = structName(source.name);
    const fields = source.type.elementType!.fields!;
    const fieldNames = extractFieldNames(fields.length, sig);

    const structs: CollectedStruct[] = [];
    collectStructDefs(sName, fields, fieldNames, structs);
    for (const s of structs) sol += s.definition + "\n\n";

    const fnName = `mock${pascalCase(source.name)}`;
    sol += `    function ${fnName}(Solgate.Gate memory gate, ${sName}[] memory entries) internal {\n`;
    sol += generateSerializeBody(source.name, sName, fields, sig);
    sol += `\n    }\n\n`;
  }

  // Event sources
  const eventSources = gate.sources.filter((s) => s.kind === "Events");
  if (eventSources.length > 0) {
    sol += `    // ─── Event Sources ───\n\n`;
    for (const source of eventSources) {
      if (source.type.kind === "map") {
        sol += `    // ${source.name}: [map type — not directly translatable to Solidity]\n\n`;
        continue;
      }
      sol += `    // ${source.name}: ${formatGateType(source.type)}\n`;
      if (source.eventSignature) {
        sol += `    // From: ${source.eventSignature}\n`;
        const normalized = normalizeEventSig(source.eventSignature);
        const constName = camelToScreamingSnake(source.name) + "_SELECTOR";
        sol += `    bytes32 constant ${constName} = keccak256("${normalized}");\n\n`;
      }

      if (source.type.kind === "list" && source.type.elementType?.kind === "tuple") {
        emitTupleListSource(source, source.eventSignature);
      } else if (source.type.kind === "primitive") {
        sol += generateScalarMockFn(source) + "\n\n";
      } else if (source.type.kind === "list" && source.type.elementType?.kind === "primitive") {
        sol += generateListScalarMockFn(source) + "\n\n";
      }
    }
  }

  // Call sources
  const callSources = gate.sources.filter((s) => s.kind === "Call");
  if (callSources.length > 0) {
    sol += `    // ─── Call Sources ───\n\n`;
    for (const source of callSources) {
      if (source.type.kind === "map") {
        sol += `    // ${source.name}: [map type — not directly translatable to Solidity]\n\n`;
        continue;
      }
      sol += `    // ${source.name}: ${formatGateType(source.type)}\n`;
      if (source.callSignature) {
        sol += `    // From: ${source.callSignature}\n`;
      }

      if (source.type.kind === "primitive") {
        sol += generateScalarMockFn(source) + "\n\n";
      } else if (source.type.kind === "list" && source.type.elementType?.kind === "tuple") {
        emitTupleListSource(source, source.callSignature);
      } else if (source.type.kind === "list" && source.type.elementType?.kind === "primitive") {
        sol += generateListScalarMockFn(source) + "\n\n";
      }
    }
  }

  sol += `}\n`;
  return sol;
}

function formatGateType(t: GatelangType): string {
  if (t.kind === "primitive") return t.primitive!;
  if (t.kind === "list") return `list<${formatGateType(t.elementType!)}>`;
  if (t.kind === "tuple")
    return `tuple<${t.fields!.map(formatGateType).join(", ")}>`;
  return "unknown";
}

function camelToScreamingSnake(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}
