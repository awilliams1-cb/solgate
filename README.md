# Solgate

Solgate is a Foundry library and CLI that lets you test [Hexagate](https://www.chainalysis.com/product/hexagate/) gate files directly inside your Forge test suite. You write `.gate` files that define onchain monitoring invariants, run `solgate codegen` to generate typed Solidity mock helpers, then write Forge tests that mock source data and assert whether the gate invariants fire.

## How it works

A `.gate` file declares typed **sources** (data the gate reads) and **invariants** (conditions that trigger an alert when violated). Solgate bridges Foundry and the Hexagate API:

1. **Codegen** — `solgate codegen` parses a `.gate` file and generates a Solidity library of typed mock helpers, one per source.
2. **Test** — Your Forge test calls those helpers to supply mock data, then calls `gate.validate()`.
3. **Validate** — `validate()` serialises params and mocks to JSON and calls the Hexagate API via FFI. The result is returned as a `GateResult` you can assert against.

## Prerequisites

- [Foundry](https://getfoundry.sh)
- [Node.js](https://nodejs.org) with `npm`
- A Hexagate API key set as `HEXAGATE_API_KEY` in your environment

## Installation

Add Solgate as a Foundry dependency:

```sh
forge install your-org/solgate
```

Add the remappings to `foundry.toml` or `remappings.txt`:

```
solgate/=lib/solgate/src/
forge-std/=lib/forge-std/src/
```

Add a dedicated FFI profile to `foundry.toml` (see [Security](#security)):

```toml
[profile.ffi]
ffi = true
```

Install and build the CLI, then install it globally so `solgate` is available in your shell:

```sh
npm install
npm run build
npm install -g .
```

## CLI

### Codegen

Generate a typed Solidity mock library from a `.gate` file:

```sh
solgate codegen <gate-file> [--output <dir>]
```

The output directory defaults to `src/generated`. Example:

```sh
solgate codegen fault-proofs-example/gate/eth_withdrawn_early.gate --output fault-proofs-example/generated
```

This produces `EthWithdrawnEarlyMocks.sol` containing:
- A setter function per `param`
- A typed mock function per `source` (structs for tuple types, scalar helpers for primitives)
- A comment for any source whose type cannot be represented in Solidity (e.g. `map<>` types)

During development you can run the CLI directly without building first:

```sh
npx tsx cli/index.ts codegen <gate-file> [--output <dir>]
```

## Writing tests

### 1. Generate the mocks

```sh
solgate codegen fault-proofs-example/gate/my_invariant.gate --output fault-proofs-example/generated
```

### 2. Write a Forge test

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {Solgate} from "solgate/Solgate.sol";
import {SolgateResult, GateResult} from "solgate/SolgateResult.sol";
import {MyInvariantMocks as Mocks} from "../generated/MyInvariantMocks.sol";

contract MyInvariantTest is Test {
    using Solgate for Solgate.Gate;
    using Mocks for Solgate.Gate;
    using SolgateResult for GateResult;

    Solgate.Gate gate;

    function setUp() public {
        gate = Solgate.create()
            .setGateFile("fault-proofs-example/gate/my_invariant.gate")
            .setChainId(1)
            .enableTrace();

        gate.setMyParam(address(0x...));
    }

    function test_alertFires() public {
        gate.mockMySource(...);

        GateResult memory result = gate.validate();
        result.assertNoExceptions();
        result.assertFired();
    }

    function test_noAlert() public {
        gate.mockMySource(...);

        GateResult memory result = gate.validate();
        result.assertNoExceptions();
        result.assertNotFired();
    }
}
```

### 3. Run the tests

```sh
HEXAGATE_API_KEY=your_key forge test --profile ffi
```

## Security

`gate.validate()` uses Foundry's FFI cheatcode to call the Hexagate API at test runtime. FFI allows Solidity tests to execute arbitrary shell commands, which is a significant capability — a malicious dependency could abuse it.

Do not enable FFI in your default profile. Instead, keep it in a separate profile as shown above and opt in explicitly when running gate tests:

```sh
HEXAGATE_API_KEY=<your_key> forge test --profile ffi --match-contract MyInvariantTest
```

This way, your standard `forge test` run never has FFI enabled, and you retain full visibility over when shell access is granted.

**Use a read-only Hexagate API key.** Solgate only calls the gate validation endpoint and requires no write access. Generate a read-only key in the Hexagate dashboard and use that as `HEXAGATE_API_KEY`.

## Gate type system

Solgate maps gatelang types to Solidity as follows:

| Gatelang type | Solidity type |
|---|---|
| `integer` | `int256` |
| `address` | `address` |
| `bytes` | `bytes32` |
| `boolean` | `bool` |
| `list<T>` | `T[]` |
| `tuple<T1, T2, ...>` | Generated struct (e.g. `MySourceEntry`) |
| `tuple<..., tuple<T1, T2>, ...>` | Nested structs (e.g. `MySourceEntryField2`) |
| `map<K, V>` | Not translatable — commented in output |

For `list<tuple<...>>` sources, codegen generates a struct and a mock function that serialises entries to the JSON array format the gate expects. Arbitrarily nested tuples are supported — each nested tuple becomes a sub-struct named `{Parent}Field{N}`.

## Assertions

`SolgateResult` provides these assertion helpers on `GateResult`:

| Helper | Description |
|---|---|
| `result.assertFired()` | Fails if no invariant fired |
| `result.assertNotFired()` | Fails if any invariant fired |
| `result.assertNoExceptions()` | Fails if the gate threw any exceptions |
| `result.assertFailureContains(str)` | Fails if no failure message contains the substring |
| `result.assertExceptionCount(n)` | Fails if exception count != n |
| `result.print()` | Logs a summary of failures, exceptions, and trace |

## Example

See [`fault-proofs-example/gate/eth_withdrawn_early.gate`](fault-proofs-example/gate/eth_withdrawn_early.gate) and its test suite [`fault-proofs-example/tests/EthWithdrawnEarly.t.sol`](fault-proofs-example/tests/EthWithdrawnEarly.t.sol) for a full worked example covering multiple alert and no-alert scenarios.
