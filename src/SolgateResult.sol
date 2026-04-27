// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {console} from "forge-std/console.sol";
import {Vm} from "forge-std/Vm.sol";

struct GateResult {
    string[][] failed;
    string[][] exceptions;
    string traceJson;
}

library SolgateResult {
    Vm constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // ─── Assertions ───

    function assertFired(GateResult memory result) internal pure {
        require(result.failed.length > 0, "Expected gate to fire but no failures reported");
    }

    function assertFired(GateResult memory result, string memory message) internal pure {
        require(result.failed.length > 0, message);
    }

    function assertNotFired(GateResult memory result) internal pure {
        if (result.failed.length > 0) {
            string memory firstFailure = result.failed[0].length > 0 ? result.failed[0][0] : "unknown";
            revert(string.concat("Expected gate to not fire but got failure: ", firstFailure));
        }
    }

    function assertNoExceptions(GateResult memory result) internal pure {
        if (result.exceptions.length > 0) {
            string memory firstException = result.exceptions[0].length > 0 ? result.exceptions[0][0] : "unknown";
            revert(string.concat("Gate threw exception: ", firstException));
        }
    }

    function assertFailureContains(GateResult memory result, string memory substring) internal pure {
        for (uint256 i = 0; i < result.failed.length; i++) {
            for (uint256 j = 0; j < result.failed[i].length; j++) {
                if (VM.contains(result.failed[i][j], substring)) {
                    return;
                }
            }
        }
        revert(string.concat("No failure containing: ", substring));
    }

    function assertExceptionCount(GateResult memory result, uint256 count) internal pure {
        require(result.exceptions.length == count, "Expected exception count mismatch");
    }

    // ─── Print Helpers ───

    function print(GateResult memory result) internal pure {
        printSummary(result);
        printFailures(result);
        printExceptions(result);
        printTrace(result);
    }

    function printSummary(GateResult memory result) internal pure {
        console.log("");
        console.log("=== Hexagate Gate Result ===");
        console.log("Failures:  ", result.failed.length);
        console.log("Exceptions:", result.exceptions.length);
        console.log("Trace:     ", bytes(result.traceJson).length > 0 ? "yes" : "(none)");
    }

    function printFailures(GateResult memory result) internal pure {
        if (result.failed.length == 0) {
            console.log("No failures.");
            return;
        }
        console.log("--- Failures ---");
        for (uint256 i = 0; i < result.failed.length; i++) {
            string memory prefix = string.concat("  [", VM.toString(i), "]");
            string[] memory row = result.failed[i];
            if (row.length == 0) {
                console.log(prefix, "(empty)");
                continue;
            }
            for (uint256 j = 0; j < row.length; j++) {
                console.log(prefix, row[j]);
            }
        }
    }

    function printExceptions(GateResult memory result) internal pure {
        if (result.exceptions.length == 0) {
            console.log("No exceptions.");
            return;
        }
        console.log("--- Exceptions ---");
        for (uint256 i = 0; i < result.exceptions.length; i++) {
            string memory prefix = string.concat("  [", VM.toString(i), "]");
            string[] memory row = result.exceptions[i];
            if (row.length == 0) {
                console.log(prefix, "(empty)");
                continue;
            }
            for (uint256 j = 0; j < row.length; j++) {
                console.log(prefix, row[j]);
            }
        }
    }

    function printTrace(GateResult memory result) internal pure {
        if (bytes(result.traceJson).length == 0) {
            console.log("No trace data (enable with .enableTrace()).");
            return;
        }
        console.log("--- Trace ---");
        console.log(result.traceJson);
    }
}
