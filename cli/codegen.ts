import ejs from "ejs";
import { parseAbiItem } from "viem";
import type { GatelangType, GateSource, ParsedGate } from "./types";
import {
  LIBRARY_TEMPLATE,
  LIST_PREAMBLE_TEMPLATE,
  LIST_SCALAR_FN_TEMPLATE,
  SERIALIZE_BODY_TEMPLATE,
} from "./template.ts";

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
  indent: number;
  content: string;
}

interface SerializeFragment {
  preamble: string;
  lines: SerializeLine[];
}

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
    const preamble = elemFrag.preamble +
      ejs.render(LIST_PREAMBLE_TEMPLATE, { listVar, loopVar, accessor, elemContent });

    return { preamble, lines: [{ indent: 0, content: listVar }] };
  }

  return { preamble: "", lines: [{ indent: 0, content: `VM.toString(${accessor})` }] };
}

// ─── Body generator ───

function buildConcatCall(fragments: SerializeFragment[]): string {
  const baseIndent = "                ";
  let call = `            json = string.concat(json, "["`;
  fragments.forEach((frag, fieldIdx) => {
    const isLastField = fieldIdx === fragments.length - 1;
    frag.lines.forEach((line, lineIdx) => {
      const isLastLine = lineIdx === frag.lines.length - 1;
      const separator = !isLastField && isLastLine ? `, ","` : "";
      const indentStr = baseIndent + "    ".repeat(line.indent);
      call += `,\n${indentStr}${line.content}${separator}`;
    });
  });
  call += `,\n            "]");\n`;
  return call;
}

function generateSerializeBody(
  sourceName: string,
  fields: GatelangType[],
  callSig?: string
): string {
  const varName = "entries";
  const fragments = fields.map((f, i) =>
    generateSerializeExpr(f, `${varName}[i].${extractFieldNames(fields.length, callSig)[i]!}`, 1)
  );
  return ejs.render(SERIALIZE_BODY_TEMPLATE, {
    varName,
    sourceName,
    preambles: fragments.map((f) => f.preamble).join(""),
    concatCall: buildConcatCall(fragments),
  });
}

// ─── Scalar mock helper ───

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

// ─── Source block renderer ───

function renderSourceBlock(source: GateSource): string {
  if (source.type.kind === "map") {
    return `    // ${source.name}: [map type — not directly translatable to Solidity]\n\n`;
  }

  let block = `    // ${source.name}: ${formatGateType(source.type)}\n`;
  const sig = source.eventSignature ?? source.callSignature;
  if (sig) {
    block += `    // From: ${sig}\n`;
  }

  if (source.kind === "Events" && source.eventSignature) {
    const normalized = normalizeEventSig(source.eventSignature);
    const constName = camelToScreamingSnake(source.name) + "_SELECTOR";
    block += `    bytes32 constant ${constName} = keccak256("${normalized}");\n\n`;
  }

  if (source.type.kind === "list" && source.type.elementType?.kind === "tuple") {
    const sName = structName(source.name);
    const fields = source.type.elementType!.fields!;
    const fieldNames = extractFieldNames(fields.length, sig);

    const structs: CollectedStruct[] = [];
    collectStructDefs(sName, fields, fieldNames, structs);
    for (const s of structs) block += s.definition + "\n\n";

    const fnName = `mock${pascalCase(source.name)}`;
    block += `    function ${fnName}(Solgate.Gate memory gate, ${sName}[] memory entries) internal {\n`;
    block += generateSerializeBody(source.name, fields, sig);
    block += `    }\n\n`;
  } else if (source.type.kind === "primitive") {
    block += generateScalarMockFn(source) + "\n\n";
  } else if (source.type.kind === "list" && source.type.elementType?.kind === "primitive") {
    const elemType = source.type.elementType;
    const elemExpr = isJsonQuoted(elemType)
      ? `'"', VM.toString(values[i]), '"'`
      : `VM.toString(values[i])`;
    block += ejs.render(LIST_SCALAR_FN_TEMPLATE, {
      fnName: `mock${pascalCase(source.name)}`,
      solType: gateTypeToSolidity(elemType),
      elemExpr,
      sourceName: source.name,
    });
  }

  return block;
}

// ─── Main codegen ───

interface ParamData {
  name: string;
  fnName: string;
  solType: string;
}

export function generateSolidity(gate: ParsedGate, gateName: string): string {
  const libName = `${pascalCase(gateName)}Mocks`;

  const params: ParamData[] = gate.params.map((param) => ({
    name: param.name,
    fnName: `set${pascalCase(param.name)}`,
    solType: gateTypeToSolidity(param.type),
  }));

  const eventSources = gate.sources
    .filter((s) => s.kind === "Events")
    .map(renderSourceBlock);

  const callSources = gate.sources
    .filter((s) => s.kind === "Call")
    .map(renderSourceBlock);

  return ejs.render(LIBRARY_TEMPLATE, { gateName, libName, params, eventSources, callSources });
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
