// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Vm} from "forge-std/Vm.sol";
import {GateResult} from "./SolgateResult.sol";

library Solgate {
    Vm constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    string constant PARAMS_OBJ = "solgate_params";
    string constant MOCKS_OBJ = "solgate_mocks";
    string constant REQUEST_OBJ = "solgate_request";

    struct Gate {
        string gateFile;
        uint256 chainId;
        bool trace;
    }

    // ─── Builder ───

    function create() internal returns (Gate memory) {
        // Reset JSON serializer state for a fresh request
        VM.serializeUint(PARAMS_OBJ, "__init", 0);
        VM.serializeUint(MOCKS_OBJ, "__init", 0);
        return Gate({gateFile: "", chainId: 1, trace: false});
    }

    function setGateFile(Gate memory self, string memory path) internal pure returns (Gate memory) {
        self.gateFile = path;
        return self;
    }

    function setChainId(Gate memory self, uint256 id) internal pure returns (Gate memory) {
        self.chainId = id;
        return self;
    }

    function enableTrace(Gate memory self) internal pure returns (Gate memory) {
        self.trace = true;
        return self;
    }

    // ─── Param Setters ───

    function setParam(Gate memory, string memory key, address value) internal {
        VM.serializeAddress(PARAMS_OBJ, key, value);
    }

    function setParam(Gate memory, string memory key, uint256 value) internal {
        VM.serializeUint(PARAMS_OBJ, key, value);
    }

    function setParam(Gate memory, string memory key, int256 value) internal {
        VM.serializeInt(PARAMS_OBJ, key, value);
    }

    function setParam(Gate memory, string memory key, string memory value) internal {
        VM.serializeString(PARAMS_OBJ, key, value);
    }

    // ─── Mock Setters (used by generated code) ───

    function mockInt(Gate memory, string memory sourceName, int256 value) internal {
        VM.serializeInt(MOCKS_OBJ, sourceName, value);
    }

    function mockUint(Gate memory, string memory sourceName, uint256 value) internal {
        VM.serializeUint(MOCKS_OBJ, sourceName, value);
    }

    function mockBool(Gate memory, string memory sourceName, bool value) internal {
        VM.serializeBool(MOCKS_OBJ, sourceName, value);
    }

    function mockAddress(Gate memory, string memory sourceName, address value) internal {
        VM.serializeAddress(MOCKS_OBJ, sourceName, value);
    }

    function mockBytes32(Gate memory, string memory sourceName, bytes32 value) internal {
        VM.serializeBytes32(MOCKS_OBJ, sourceName, value);
    }

    function mockRaw(Gate memory, string memory sourceName, string memory jsonValue) internal {
        // Use serializeString to embed raw JSON — the CLI will parse it
        // We prefix with __raw: so the CLI knows to parse it as JSON, not a string
        VM.serializeString(MOCKS_OBJ, string.concat("__raw:", sourceName), jsonValue);
    }

    // ─── Validate ───

    function validate(Gate memory self) internal returns (GateResult memory result) {
        string memory paramsJson = VM.serializeUint(PARAMS_OBJ, "__init", 0);
        string memory mocksJson = VM.serializeUint(MOCKS_OBJ, "__init", 0);

        VM.serializeString(REQUEST_OBJ, "gateFile", self.gateFile);
        VM.serializeUint(REQUEST_OBJ, "chainId", self.chainId);
        VM.serializeBool(REQUEST_OBJ, "trace", self.trace);
        VM.serializeString(REQUEST_OBJ, "paramsJson", paramsJson);
        string memory requestJson = VM.serializeString(REQUEST_OBJ, "mocksJson", mocksJson);

        string[] memory cmd = new string[](3);
        cmd[0] = "solgate";
        cmd[1] = "validate";
        cmd[2] = requestJson;

        bytes memory ffiResult = VM.ffi(cmd);

        (string[][] memory failed, string[][] memory exceptions, string memory traceJson) =
            abi.decode(ffiResult, (string[][], string[][], string));

        result.failed = failed;
        result.exceptions = exceptions;
        result.traceJson = traceJson;
    }
}
