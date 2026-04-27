export type GatelangPrimitive = "integer" | "address" | "bytes" | "boolean";

export interface GatelangType {
  kind: "primitive" | "list" | "tuple" | "map";
  primitive?: GatelangPrimitive;
  elementType?: GatelangType; // for list<T>
  fields?: GatelangType[]; // for tuple<T1, T2, ...>
  keyType?: GatelangType; // for map<K, V>
  valueType?: GatelangType; // for map<K, V>
}

export interface GateParam {
  name: string;
  type: GatelangType;
}

export interface GateSource {
  name: string;
  type: GatelangType;
  kind: "Events" | "Call";
  eventSignature?: string;
  callSignature?: string;
}

export interface ParsedGate {
  params: GateParam[];
  sources: GateSource[];
}

export interface ValidateRequest {
  gate: string;
  chain_id: number;
  params?: Record<string, unknown>;
  mocks?: Record<string, unknown>;
  trace?: boolean;
}

export interface ValidateResponse {
  failed: string[][];
  exceptions: string[][];
  trace?: Record<string, string>;
}
