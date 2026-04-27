import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseGateType, parseGateFile } from "../parser";

// ─── parseGateType ───────────────────────────────────────────────────────────

describe("parseGateType", () => {
  describe("primitives", () => {
    it.each(["integer", "address", "bytes", "boolean"] as const)(
      "parses %s",
      (primitive) => {
        expect(parseGateType(primitive)).toEqual({ kind: "primitive", primitive });
      }
    );
  });

  describe("list", () => {
    it("parses list<integer>", () => {
      expect(parseGateType("list<integer>")).toEqual({
        kind: "list",
        elementType: { kind: "primitive", primitive: "integer" },
      });
    });

    it("parses list<address>", () => {
      expect(parseGateType("list<address>")).toEqual({
        kind: "list",
        elementType: { kind: "primitive", primitive: "address" },
      });
    });

    it("parses list<boolean>", () => {
      expect(parseGateType("list<boolean>")).toEqual({
        kind: "list",
        elementType: { kind: "primitive", primitive: "boolean" },
      });
    });
  });

  describe("tuple", () => {
    it("parses tuple<integer,address>", () => {
      expect(parseGateType("tuple<integer,address>")).toEqual({
        kind: "tuple",
        fields: [
          { kind: "primitive", primitive: "integer" },
          { kind: "primitive", primitive: "address" },
        ],
      });
    });

    it("parses tuple with 3 fields", () => {
      expect(parseGateType("tuple<integer,bytes,address>")).toEqual({
        kind: "tuple",
        fields: [
          { kind: "primitive", primitive: "integer" },
          { kind: "primitive", primitive: "bytes" },
          { kind: "primitive", primitive: "address" },
        ],
      });
    });

    it("parses nested tuple<integer,address,tuple<address,integer>>", () => {
      expect(parseGateType("tuple<integer,address,tuple<address,integer>>")).toEqual({
        kind: "tuple",
        fields: [
          { kind: "primitive", primitive: "integer" },
          { kind: "primitive", primitive: "address" },
          {
            kind: "tuple",
            fields: [
              { kind: "primitive", primitive: "address" },
              { kind: "primitive", primitive: "integer" },
            ],
          },
        ],
      });
    });
  });

  describe("list<tuple>", () => {
    it("parses list<tuple<integer,bytes,address>>", () => {
      expect(parseGateType("list<tuple<integer,bytes,address>>")).toEqual({
        kind: "list",
        elementType: {
          kind: "tuple",
          fields: [
            { kind: "primitive", primitive: "integer" },
            { kind: "primitive", primitive: "bytes" },
            { kind: "primitive", primitive: "address" },
          ],
        },
      });
    });

    it("parses list<tuple> with nested tuple element", () => {
      expect(
        parseGateType("list<tuple<integer,address,tuple<address,integer>>>")
      ).toEqual({
        kind: "list",
        elementType: {
          kind: "tuple",
          fields: [
            { kind: "primitive", primitive: "integer" },
            { kind: "primitive", primitive: "address" },
            {
              kind: "tuple",
              fields: [
                { kind: "primitive", primitive: "address" },
                { kind: "primitive", primitive: "integer" },
              ],
            },
          ],
        },
      });
    });
  });

  describe("map", () => {
    it("parses map<address,integer>", () => {
      expect(parseGateType("map<address,integer>")).toEqual({
        kind: "map",
        keyType: { kind: "primitive", primitive: "address" },
        valueType: { kind: "primitive", primitive: "integer" },
      });
    });
  });

  describe("whitespace normalization", () => {
    it("normalizes spaces around angle brackets and commas", () => {
      expect(parseGateType("list < tuple < integer, address > >")).toEqual(
        parseGateType("list<tuple<integer,address>>")
      );
    });

    it("normalizes mixed spacing in tuple", () => {
      expect(parseGateType("tuple< integer , bytes , address >")).toEqual(
        parseGateType("tuple<integer,bytes,address>")
      );
    });
  });
});

// ─── parseGateFile — challenged_proposal.gate ────────────────────────────────

describe("parseGateFile — challenged_proposal.gate", () => {
  const content = readFileSync(
    join(process.cwd(), "fault-proofs-example/gate/challenged_proposal.gate"),
    "utf-8"
  );
  const gate = parseGateFile(content);

  describe("params", () => {
    it("parses 3 params", () => {
      expect(gate.params).toHaveLength(3);
    });

    it("parses disputeGame as address", () => {
      expect(gate.params[0]).toEqual({
        name: "disputeGame",
        type: { kind: "primitive", primitive: "address" },
      });
    });

    it("parses honestProposer as address", () => {
      expect(gate.params[1]).toEqual({
        name: "honestProposer",
        type: { kind: "primitive", primitive: "address" },
      });
    });

    it("parses honestChallenger as address", () => {
      expect(gate.params[2]).toEqual({
        name: "honestChallenger",
        type: { kind: "primitive", primitive: "address" },
      });
    });
  });

  describe("sources", () => {
    it("parses 6 sources", () => {
      expect(gate.sources).toHaveLength(6);
    });

    it("parses moveEvents as Events source with list<tuple<integer,bytes,address>>", () => {
      const src = gate.sources.find((s) => s.name === "moveEvents");
      expect(src).toBeDefined();
      expect(src!.kind).toBe("Events");
      expect(src!.type).toEqual({
        kind: "list",
        elementType: {
          kind: "tuple",
          fields: [
            { kind: "primitive", primitive: "integer" },
            { kind: "primitive", primitive: "bytes" },
            { kind: "primitive", primitive: "address" },
          ],
        },
      });
      expect(src!.eventSignature).toBe(
        "event Move(uint256 indexed parentIndex, bytes32 indexed claim, address indexed claimant)"
      );
    });

    it("parses claimCount as Call source with integer type and function signature", () => {
      const src = gate.sources.find((s) => s.name === "claimCount");
      expect(src).toBeDefined();
      expect(src!.kind).toBe("Call");
      expect(src!.type).toEqual({ kind: "primitive", primitive: "integer" });
      expect(src!.callSignature).toBe(
        "function claimDataLen() view returns (uint256)"
      );
    });

    it("parses claimData as Call source with list<tuple> of 7 fields", () => {
      const src = gate.sources.find((s) => s.name === "claimData");
      expect(src).toBeDefined();
      expect(src!.kind).toBe("Call");
      expect(src!.type.kind).toBe("list");
      expect(src!.type.elementType!.kind).toBe("tuple");
      expect(src!.type.elementType!.fields).toHaveLength(7);
      expect(src!.callSignature).toBe(
        "function claimData(uint256 idx) view returns (uint32,address,address,uint128,bytes32,uint128,uint128)"
      );
    });

    it("parses rootClaimProposer as Call source with address type", () => {
      const src = gate.sources.find((s) => s.name === "rootClaimProposer");
      expect(src).toBeDefined();
      expect(src!.kind).toBe("Call");
      expect(src!.type).toEqual({ kind: "primitive", primitive: "address" });
    });

    it("parses attackClaimParentIndices as Call source with list<integer>", () => {
      const src = gate.sources.find((s) => s.name === "attackClaimParentIndices");
      expect(src).toBeDefined();
      expect(src!.kind).toBe("Call");
      expect(src!.type).toEqual({
        kind: "list",
        elementType: { kind: "primitive", primitive: "integer" },
      });
    });

    it("parses challengerAttacks as Call source with list<boolean>", () => {
      const src = gate.sources.find((s) => s.name === "challengerAttacks");
      expect(src).toBeDefined();
      expect(src!.kind).toBe("Call");
      expect(src!.type).toEqual({
        kind: "list",
        elementType: { kind: "primitive", primitive: "boolean" },
      });
    });
  });
});

// ─── parseGateFile — eth_withdrawn_early.gate ────────────────────────────────

describe("parseGateFile — eth_withdrawn_early.gate", () => {
  const content = readFileSync(
    join(process.cwd(), "fault-proofs-example/gate/eth_withdrawn_early.gate"),
    "utf-8"
  );
  const gate = parseGateFile(content);

  describe("params", () => {
    it("parses 2 params", () => {
      expect(gate.params).toHaveLength(2);
    });

    it("parses multicall3 and disputeGame as address", () => {
      expect(gate.params[0]).toEqual({
        name: "multicall3",
        type: { kind: "primitive", primitive: "address" },
      });
      expect(gate.params[1]).toEqual({
        name: "disputeGame",
        type: { kind: "primitive", primitive: "address" },
      });
    });
  });

  describe("sources", () => {
    it("parses 13 sources", () => {
      expect(gate.sources).toHaveLength(13);
    });

    it("parses addressesInTrace as Call source with list<address>", () => {
      const src = gate.sources.find((s) => s.name === "addressesInTrace");
      expect(src).toBeDefined();
      expect(src!.kind).toBe("Call");
      expect(src!.type).toEqual({
        kind: "list",
        elementType: { kind: "primitive", primitive: "address" },
      });
    });

    it("parses delayedWETH as Call source with address type and function signature", () => {
      const src = gate.sources.find((s) => s.name === "delayedWETH");
      expect(src).toBeDefined();
      expect(src!.kind).toBe("Call");
      expect(src!.type).toEqual({ kind: "primitive", primitive: "address" });
      expect(src!.callSignature).toBe("function weth() returns (address)");
    });

    it("parses claims as Call source with list<tuple<address>>", () => {
      const src = gate.sources.find((s) => s.name === "claims");
      expect(src).toBeDefined();
      expect(src!.type.kind).toBe("list");
      expect(src!.type.elementType!.kind).toBe("tuple");
      expect(src!.type.elementType!.fields).toHaveLength(1);
      expect(src!.type.elementType!.fields![0]).toEqual({
        kind: "primitive",
        primitive: "address",
      });
    });

    it("parses withdrawals as Call source with list<tuple<address,integer>>", () => {
      const src = gate.sources.find((s) => s.name === "withdrawals");
      expect(src).toBeDefined();
      expect(src!.type.kind).toBe("list");
      expect(src!.type.elementType!.fields).toHaveLength(2);
      expect(src!.callSignature).toBe(
        "function withdraw(address _guy, uint256 _wad)"
      );
    });

    it("parses unlocks with nested tuple type (list<tuple<integer,address,tuple<address,integer>>>)", () => {
      const src = gate.sources.find((s) => s.name === "unlocks");
      expect(src).toBeDefined();
      expect(src!.type.kind).toBe("list");
      const fields = src!.type.elementType!.fields!;
      expect(fields).toHaveLength(3);
      expect(fields[0]).toEqual({ kind: "primitive", primitive: "integer" });
      expect(fields[1]).toEqual({ kind: "primitive", primitive: "address" });
      expect(fields[2]!.kind).toBe("tuple");
      expect(fields[2]!.fields).toHaveLength(2);
      expect(fields[2]!.fields![0]).toEqual({ kind: "primitive", primitive: "address" });
      expect(fields[2]!.fields![1]).toEqual({ kind: "primitive", primitive: "integer" });
    });

    it("parses unlocksAndAmounts as a map type", () => {
      const src = gate.sources.find((s) => s.name === "unlocksAndAmounts");
      expect(src).toBeDefined();
      expect(src!.type.kind).toBe("map");
      expect(src!.type.keyType).toEqual({ kind: "primitive", primitive: "address" });
    });

    it("parses delayTime as Call source with integer type", () => {
      const src = gate.sources.find((s) => s.name === "delayTime");
      expect(src).toBeDefined();
      expect(src!.kind).toBe("Call");
      expect(src!.type).toEqual({ kind: "primitive", primitive: "integer" });
      expect(src!.callSignature).toBe("function delay() returns (uint256)");
    });

    it("parses hasUnlockedCredit as Call source with list<boolean>", () => {
      const src = gate.sources.find((s) => s.name === "hasUnlockedCredit");
      expect(src).toBeDefined();
      expect(src!.type).toEqual({
        kind: "list",
        elementType: { kind: "primitive", primitive: "boolean" },
      });
    });

    it("parses currTimestamp as Call source with integer type", () => {
      const src = gate.sources.find((s) => s.name === "currTimestamp");
      expect(src).toBeDefined();
      expect(src!.kind).toBe("Call");
      expect(src!.type).toEqual({ kind: "primitive", primitive: "integer" });
    });
  });
});
