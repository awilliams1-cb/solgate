// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {Solgate} from "solgate/Solgate.sol";
import {SolgateResult, GateResult} from "solgate/SolgateResult.sol";
import {ChallengedProposalMocks as Mocks} from "../generated/ChallengedProposalMocks.sol";

contract ChallengedProposalTest is Test {
    using Solgate for Solgate.Gate;
    using Mocks for Solgate.Gate;
    using SolgateResult for GateResult;

    address constant DISPUTE_GAME = address(0);
    address constant HONEST_PROPOSER = 0x49277EE36A024120Ee218127354c4a3591dc90A9;
    address constant HONEST_CHALLENGER = 0xc96775081bcA132B0E7cbECDd0B58d9Ec07Fdaa4;

    Solgate.Gate gate;

    function setUp() public {
        gate = Solgate.create()
            .setGateFile("fault-proofs-example/gate/challenged_proposal.gate")
            .setChainId(1)
            .enableTrace();

        gate.setDisputeGame(DISPUTE_GAME);
        gate.setHonestProposer(HONEST_PROPOSER);
        gate.setHonestChallenger(HONEST_CHALLENGER);
    }

    function test_challengerAttacksRootClaim_shouldAlert() public {
        Mocks.MoveEventsEntry[] memory moves = new Mocks.MoveEventsEntry[](1);
        moves[0] = Mocks.MoveEventsEntry(2, bytes32(0), HONEST_CHALLENGER);
        gate.mockMoveEvents(moves);

        gate.mockClaimCount(4);

        Mocks.ClaimDataEntry[] memory claims = new Mocks.ClaimDataEntry[](4);
        claims[0] = Mocks.ClaimDataEntry(
            int256(uint256(type(uint32).max)), address(0), HONEST_PROPOSER, 1, bytes32(0), 1, 123456
        );
        claims[1] = Mocks.ClaimDataEntry(0, address(0), HONEST_CHALLENGER, 1, bytes32(0), 2, 123456);
        claims[2] = Mocks.ClaimDataEntry(1, address(0), address(0), 1, bytes32(0), 3, 123456);
        claims[3] = Mocks.ClaimDataEntry(2, address(0), HONEST_CHALLENGER, 1, bytes32(0), 4, 1233456);
        gate.mockClaimData(claims);

        GateResult memory result = gate.validate();
        result.print();

        result.assertNoExceptions();
        result.assertFired();
    }

    function test_challengerDefendsRootClaim_noAlert() public {
        Mocks.MoveEventsEntry[] memory moves = new Mocks.MoveEventsEntry[](1);
        moves[0] = Mocks.MoveEventsEntry(2, bytes32(0), HONEST_CHALLENGER);
        gate.mockMoveEvents(moves);

        gate.mockClaimCount(4);

        Mocks.ClaimDataEntry[] memory claims = new Mocks.ClaimDataEntry[](4);
        claims[0] = Mocks.ClaimDataEntry(
            int256(uint256(type(uint32).max)), address(0), HONEST_PROPOSER, 1, bytes32(0), 1, 123456
        );
        claims[1] = Mocks.ClaimDataEntry(0, address(0), address(0), 1, bytes32(0), 2, 123456);
        // Defender (odd parent index = defense)
        claims[2] = Mocks.ClaimDataEntry(1, address(0), HONEST_CHALLENGER, 1, bytes32(0), 3, 123456);
        claims[3] = Mocks.ClaimDataEntry(2, address(0), address(0), 1, bytes32(0), 4, 1233456);
        gate.mockClaimData(claims);

        GateResult memory result = gate.validate();

        result.assertNoExceptions();
        result.assertNotFired();
    }

    function test_challengerNotKnown_noAlert() public {
        address randomChallenger = 0x09dE888033b1e815419a3fb865f0DA5689332FdB;

        Mocks.MoveEventsEntry[] memory moves = new Mocks.MoveEventsEntry[](1);
        moves[0] = Mocks.MoveEventsEntry(2, bytes32(0), randomChallenger);
        gate.mockMoveEvents(moves);

        gate.mockClaimCount(4);

        Mocks.ClaimDataEntry[] memory claims = new Mocks.ClaimDataEntry[](4);
        claims[0] = Mocks.ClaimDataEntry(
            int256(uint256(type(uint32).max)), address(0), HONEST_PROPOSER, 1, bytes32(0), 1, 123456
        );
        claims[1] = Mocks.ClaimDataEntry(0, address(0), randomChallenger, 1, bytes32(0), 2, 123456);
        claims[2] = Mocks.ClaimDataEntry(1, address(0), address(0), 1, bytes32(0), 3, 123456);
        claims[3] = Mocks.ClaimDataEntry(2, address(0), randomChallenger, 1, bytes32(0), 4, 1233456);
        gate.mockClaimData(claims);

        GateResult memory result = gate.validate();

        result.assertNoExceptions();
        result.assertNotFired();
    }

    function test_proposerNotKnown_noAlert() public {
        Mocks.MoveEventsEntry[] memory moves = new Mocks.MoveEventsEntry[](1);
        moves[0] = Mocks.MoveEventsEntry(2, bytes32(0), HONEST_CHALLENGER);
        gate.mockMoveEvents(moves);

        gate.mockClaimCount(4);

        Mocks.ClaimDataEntry[] memory claims = new Mocks.ClaimDataEntry[](4);
        // Root claim NOT proposed by the honest proposer
        claims[0] = Mocks.ClaimDataEntry(
            int256(uint256(type(uint32).max)), address(0), address(0), 1, bytes32(0), 1, 123456
        );
        claims[1] = Mocks.ClaimDataEntry(0, address(0), HONEST_CHALLENGER, 1, bytes32(0), 2, 123456);
        claims[2] = Mocks.ClaimDataEntry(1, address(0), address(0), 1, bytes32(0), 3, 123456);
        claims[3] = Mocks.ClaimDataEntry(2, address(0), HONEST_CHALLENGER, 1, bytes32(0), 4, 1233456);
        gate.mockClaimData(claims);

        GateResult memory result = gate.validate();

        result.assertNoExceptions();
        result.assertNotFired();
    }

    function test_onlyRootClaim_noAlert() public {
        Mocks.MoveEventsEntry[] memory moves = new Mocks.MoveEventsEntry[](1);
        moves[0] = Mocks.MoveEventsEntry(0, bytes32(0), HONEST_PROPOSER);
        gate.mockMoveEvents(moves);

        gate.mockClaimCount(4);

        Mocks.ClaimDataEntry[] memory claims = new Mocks.ClaimDataEntry[](1);
        claims[0] = Mocks.ClaimDataEntry(
            int256(uint256(type(uint32).max)), address(0), HONEST_PROPOSER, 1, bytes32(0), 1, 123456
        );
        gate.mockClaimData(claims);

        GateResult memory result = gate.validate();

        result.assertNoExceptions();
        result.assertNotFired();
    }

    function test_noMoveEventInBlock_noAlert() public {
        // No moveEvents mock — omit it entirely
        gate.mockClaimCount(4);

        Mocks.ClaimDataEntry[] memory claims = new Mocks.ClaimDataEntry[](4);
        claims[0] = Mocks.ClaimDataEntry(
            int256(uint256(type(uint32).max)), address(0), HONEST_PROPOSER, 1, bytes32(0), 1, 123456
        );
        claims[1] = Mocks.ClaimDataEntry(0, address(0), HONEST_CHALLENGER, 1, bytes32(0), 2, 123456);
        claims[2] = Mocks.ClaimDataEntry(1, address(0), address(0), 1, bytes32(0), 3, 123456);
        claims[3] = Mocks.ClaimDataEntry(2, address(0), HONEST_CHALLENGER, 1, bytes32(0), 4, 1233456);
        gate.mockClaimData(claims);

        GateResult memory result = gate.validate();

        result.assertNoExceptions();
        result.assertNotFired();
    }
}
