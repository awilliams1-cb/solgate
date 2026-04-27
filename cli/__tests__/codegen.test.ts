import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseGateFile } from "../parser";
import { generateSolidity } from "../codegen";

function loadGate(filename: string) {
  const content = readFileSync(
    join(process.cwd(), "fault-proofs-example/gate", filename),
    "utf-8"
  );
  return parseGateFile(content);
}

function loadGenerated(filename: string) {
  return readFileSync(
    join(process.cwd(), "fault-proofs-example/generated", filename),
    "utf-8"
  );
}

// ─── challenged_proposal ─────────────────────────────────────────────────────

describe("generateSolidity — challenged_proposal", () => {
  const gate = loadGate("challenged_proposal.gate");
  const output = generateSolidity(gate, "challenged_proposal");
  const expected = loadGenerated("ChallengedProposalMocks.sol");

  it("matches the generated ChallengedProposalMocks.sol exactly", () => {
    expect(output).toBe(expected);
  });

  it("generates correct library name", () => {
    expect(output).toContain("library ChallengedProposalMocks");
  });

  it("generates param setters for all 3 params", () => {
    expect(output).toContain("function setDisputeGame(Solgate.Gate memory gate, address value)");
    expect(output).toContain("function setHonestProposer(Solgate.Gate memory gate, address value)");
    expect(output).toContain("function setHonestChallenger(Solgate.Gate memory gate, address value)");
  });

  it("generates MOVE_EVENTS_SELECTOR with normalized signature", () => {
    expect(output).toContain("bytes32 constant MOVE_EVENTS_SELECTOR");
    expect(output).toContain('keccak256("Move(uint256,bytes32,address)")');
  });

  it("generates MoveEventsEntry struct with ABI-derived field names", () => {
    expect(output).toContain("struct MoveEventsEntry");
    expect(output).toContain("int256 parentIndex");
    expect(output).toContain("bytes32 claim");
    expect(output).toContain("address claimant");
  });

  it("generates ClaimDataEntry struct with 7 generic field names", () => {
    expect(output).toContain("struct ClaimDataEntry");
    // outputs have no names in the ABI so fall back to field0..field6
    expect(output).toContain("int256 field0");
    expect(output).toContain("bytes32 field4");
    expect(output).toContain("int256 field6");
  });

  it("generates mockClaimCount as scalar int256 mock", () => {
    expect(output).toContain(
      "function mockClaimCount(Solgate.Gate memory gate, int256 value)"
    );
    expect(output).toContain('gate.mockInt("claimCount", value)');
  });

  it("generates mockRootClaimProposer as scalar address mock", () => {
    expect(output).toContain(
      "function mockRootClaimProposer(Solgate.Gate memory gate, address value)"
    );
    expect(output).toContain('gate.mockAddress("rootClaimProposer", value)');
  });

  it("generates mockAttackClaimParentIndices as list<integer> mock", () => {
    expect(output).toContain(
      "function mockAttackClaimParentIndices(Solgate.Gate memory gate, int256[] memory values)"
    );
  });

  it("generates mockChallengerAttacks as list<boolean> mock", () => {
    expect(output).toContain(
      "function mockChallengerAttacks(Solgate.Gate memory gate, bool[] memory values)"
    );
  });
});

// ─── eth_withdrawn_early ─────────────────────────────────────────────────────

describe("generateSolidity — eth_withdrawn_early", () => {
  const gate = loadGate("eth_withdrawn_early.gate");
  const output = generateSolidity(gate, "eth_withdrawn_early");
  const expected = loadGenerated("EthWithdrawnEarlyMocks.sol");

  it("matches the generated EthWithdrawnEarlyMocks.sol exactly", () => {
    expect(output).toBe(expected);
  });

  it("generates correct library name", () => {
    expect(output).toContain("library EthWithdrawnEarlyMocks");
  });

  it("generates param setters for multicall3 and disputeGame", () => {
    expect(output).toContain("function setMulticall3(Solgate.Gate memory gate, address value)");
    expect(output).toContain("function setDisputeGame(Solgate.Gate memory gate, address value)");
  });

  it("generates mockDelayedWETH as scalar address mock", () => {
    expect(output).toContain(
      "function mockDelayedWETH(Solgate.Gate memory gate, address value)"
    );
    expect(output).toContain('gate.mockAddress("delayedWETH", value)');
  });

  it("generates ClaimsEntry struct with single address field", () => {
    expect(output).toContain("struct ClaimsEntry");
    expect(output).toContain("address field0");
  });

  it("generates WithdrawalsEntry struct with ABI-derived field names", () => {
    expect(output).toContain("struct WithdrawalsEntry");
  });

  it("generates UnlocksEntry with nested UnlocksEntryField2 struct", () => {
    expect(output).toContain("struct UnlocksEntryField2");
    expect(output).toContain("struct UnlocksEntry");
    // nested struct field reference
    expect(output).toContain("UnlocksEntryField2 field2");
  });

  it("skips unlocksAndAmounts as unsupported map type", () => {
    expect(output).toContain(
      "// unlocksAndAmounts: [map type — not directly translatable to Solidity]"
    );
    expect(output).not.toContain("function mockUnlocksAndAmounts");
  });

  it("generates mockHasUnlockedCredit as list<boolean> mock", () => {
    expect(output).toContain(
      "function mockHasUnlockedCredit(Solgate.Gate memory gate, bool[] memory values)"
    );
  });

  it("generates mockDelayTime as scalar int256 mock", () => {
    expect(output).toContain(
      "function mockDelayTime(Solgate.Gate memory gate, int256 value)"
    );
    expect(output).toContain('gate.mockInt("delayTime", value)');
  });

  it("generates mockAddressesInTrace as list<address> mock with quoted addresses", () => {
    expect(output).toContain(
      "function mockAddressesInTrace(Solgate.Gate memory gate, address[] memory values)"
    );
    // addresses should be JSON-quoted
    expect(output).toContain('VM.toString(values[i]), \'"\'');
  });
});
