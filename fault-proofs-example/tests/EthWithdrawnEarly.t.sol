// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {Solgate} from "solgate/Solgate.sol";
import {SolgateResult, GateResult} from "solgate/SolgateResult.sol";
import {EthWithdrawnEarlyMocks as Mocks} from "../generated/EthWithdrawnEarlyMocks.sol";

contract EthWithdrawnEarlyTest is Test {
    using Solgate for Solgate.Gate;
    using Mocks for Solgate.Gate;
    using SolgateResult for GateResult;

    address constant DISPUTE_GAME = address(uint160(0xAA));
    address constant MULTICALL3   = address(uint160(0xBB));
    address constant DELAYED_WETH = address(0);
    address constant RECIPIENT_1  = address(1);
    address constant RECIPIENT_2  = address(2);

    Solgate.Gate gate;

    function setUp() public {
        gate = Solgate.create()
            .setGateFile("fault-proofs-example/gate/eth_withdrawn_early.gate")
            .setChainId(1)
            .enableTrace();
        gate.setMulticall3(MULTICALL3);
        gate.setDisputeGame(DISPUTE_GAME);
    }

    // ─── Alert tests ───

    function test_withdrawnTooEarly_shouldAlert() public {
        // currTimestamp - Max(unlockTimestamps) = 99 ≤ delayTime (100) → withdrawal is too early
        address[] memory trace = new address[](1);
        trace[0] = DISPUTE_GAME;
        gate.mockAddressesInTrace(trace);

        gate.mockDelayedWETH(DELAYED_WETH);

        Mocks.ClaimsEntry[] memory claims = new Mocks.ClaimsEntry[](1);
        claims[0] = Mocks.ClaimsEntry(RECIPIENT_1);
        gate.mockClaims(claims);

        Mocks.WithdrawalsEntry[] memory withdrawals = new Mocks.WithdrawalsEntry[](1);
        withdrawals[0] = Mocks.WithdrawalsEntry(RECIPIENT_1, 100);
        gate.mockWithdrawals(withdrawals);

        gate.mockDelayTime(100);
        gate.mockCurrTimestamp(1099);

        // Both unlocks timestamped at 1000; 1099 - 1000 = 99 ≤ 100 → invalid
        int256[] memory timestamps = new int256[](2);
        timestamps[0] = 1000;
        timestamps[1] = 1000;
        gate.mockUnlockTimestamps(timestamps);

        Mocks.UnlocksEntry[] memory unlocks = new Mocks.UnlocksEntry[](2);
        unlocks[0] = Mocks.UnlocksEntry(50,  DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_1, 50));
        unlocks[1] = Mocks.UnlocksEntry(101, DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_1, 50));
        gate.mockUnlocks(unlocks);

        bool[] memory credited = new bool[](2);
        credited[0] = true;
        credited[1] = true;
        gate.mockHasUnlockedCredit(credited);

        GateResult memory result = gate.validate();
        result.print();

        result.assertNoExceptions();
        result.assertFired();
    }

    function test_noMatchingUnlock_shouldAlert() public {
        // Recipient 2 has a claim and withdrawal but no corresponding unlock entry
        address[] memory trace = new address[](1);
        trace[0] = DISPUTE_GAME;
        gate.mockAddressesInTrace(trace);

        gate.mockDelayedWETH(DELAYED_WETH);

        Mocks.ClaimsEntry[] memory claims = new Mocks.ClaimsEntry[](2);
        claims[0] = Mocks.ClaimsEntry(RECIPIENT_1);
        claims[1] = Mocks.ClaimsEntry(RECIPIENT_2);
        gate.mockClaims(claims);

        Mocks.WithdrawalsEntry[] memory withdrawals = new Mocks.WithdrawalsEntry[](2);
        withdrawals[0] = Mocks.WithdrawalsEntry(RECIPIENT_1, 100);
        withdrawals[1] = Mocks.WithdrawalsEntry(RECIPIENT_2, 200);
        gate.mockWithdrawals(withdrawals);

        gate.mockDelayTime(10);
        gate.mockCurrTimestamp(2000);

        int256[] memory timestamps = new int256[](1);
        timestamps[0] = 1000;
        gate.mockUnlockTimestamps(timestamps);

        // Only recipient 1 has an unlock — MapContains for recipient 2 returns false → alert
        Mocks.UnlocksEntry[] memory unlocks = new Mocks.UnlocksEntry[](1);
        unlocks[0] = Mocks.UnlocksEntry(90, DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_1, 100));
        gate.mockUnlocks(unlocks);

        bool[] memory credited = new bool[](1);
        credited[0] = true;
        gate.mockHasUnlockedCredit(credited);

        GateResult memory result = gate.validate();
        result.print();

        result.assertNoExceptions();
        result.assertFired();
    }

    function test_incorrectAmount_shouldAlert() public {
        // Recipient 2 withdraws 200 but their unlocks only sum to 100
        address[] memory trace = new address[](1);
        trace[0] = DISPUTE_GAME;
        gate.mockAddressesInTrace(trace);

        gate.mockDelayedWETH(DELAYED_WETH);

        Mocks.ClaimsEntry[] memory claims = new Mocks.ClaimsEntry[](2);
        claims[0] = Mocks.ClaimsEntry(RECIPIENT_1);
        claims[1] = Mocks.ClaimsEntry(RECIPIENT_2);
        gate.mockClaims(claims);

        Mocks.WithdrawalsEntry[] memory withdrawals = new Mocks.WithdrawalsEntry[](2);
        withdrawals[0] = Mocks.WithdrawalsEntry(RECIPIENT_1, 100);
        withdrawals[1] = Mocks.WithdrawalsEntry(RECIPIENT_2, 200);
        gate.mockWithdrawals(withdrawals);

        gate.mockDelayTime(10);
        gate.mockCurrTimestamp(2000);

        int256[] memory timestamps = new int256[](2);
        timestamps[0] = 1000;
        timestamps[1] = 1000;
        gate.mockUnlockTimestamps(timestamps);

        Mocks.UnlocksEntry[] memory unlocks = new Mocks.UnlocksEntry[](2);
        unlocks[0] = Mocks.UnlocksEntry(90, DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_1, 100));
        unlocks[1] = Mocks.UnlocksEntry(90, DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_2, 100)); // sum 100, withdrew 200
        gate.mockUnlocks(unlocks);

        bool[] memory credited = new bool[](2);
        credited[0] = true;
        credited[1] = true;
        gate.mockHasUnlockedCredit(credited);

        GateResult memory result = gate.validate();
        result.print();

        result.assertNoExceptions();
        result.assertFired();
    }

    function test_noUnlockedCredit_shouldAlert() public {
        // Amounts and timing are valid but recipient 2 has not unlocked their credit
        address[] memory trace = new address[](1);
        trace[0] = DISPUTE_GAME;
        gate.mockAddressesInTrace(trace);

        gate.mockDelayedWETH(DELAYED_WETH);

        Mocks.ClaimsEntry[] memory claims = new Mocks.ClaimsEntry[](2);
        claims[0] = Mocks.ClaimsEntry(RECIPIENT_1);
        claims[1] = Mocks.ClaimsEntry(RECIPIENT_2);
        gate.mockClaims(claims);

        Mocks.WithdrawalsEntry[] memory withdrawals = new Mocks.WithdrawalsEntry[](2);
        withdrawals[0] = Mocks.WithdrawalsEntry(RECIPIENT_1, 100);
        withdrawals[1] = Mocks.WithdrawalsEntry(RECIPIENT_2, 200);
        gate.mockWithdrawals(withdrawals);

        gate.mockDelayTime(10);
        gate.mockCurrTimestamp(2000);

        int256[] memory timestamps = new int256[](3);
        timestamps[0] = 1000;
        timestamps[1] = 1000;
        timestamps[2] = 1000;
        gate.mockUnlockTimestamps(timestamps);

        // Two unlocks for recipient 2 summing to 200 — correct amount, delay elapsed
        Mocks.UnlocksEntry[] memory unlocks = new Mocks.UnlocksEntry[](3);
        unlocks[0] = Mocks.UnlocksEntry(90, DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_1, 100));
        unlocks[1] = Mocks.UnlocksEntry(90, DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_2, 100));
        unlocks[2] = Mocks.UnlocksEntry(89, DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_2, 100));
        gate.mockUnlocks(unlocks);

        bool[] memory credited = new bool[](2);
        credited[0] = true;
        credited[1] = false; // recipient 2 has not unlocked credit → second invariant fires
        gate.mockHasUnlockedCredit(credited);

        GateResult memory result = gate.validate();
        result.print();

        result.assertNoExceptions();
        result.assertFired();
    }

    // ─── No-alert tests ───

    function test_correctWithdrawal_noAlert() public {
        // Delay elapsed, withdrawal amounts match unlock sums, all credit unlocked
        address[] memory trace = new address[](1);
        trace[0] = DISPUTE_GAME;
        gate.mockAddressesInTrace(trace);

        gate.mockDelayedWETH(DELAYED_WETH);

        Mocks.ClaimsEntry[] memory claims = new Mocks.ClaimsEntry[](2);
        claims[0] = Mocks.ClaimsEntry(RECIPIENT_1);
        claims[1] = Mocks.ClaimsEntry(RECIPIENT_2);
        gate.mockClaims(claims);

        Mocks.WithdrawalsEntry[] memory withdrawals = new Mocks.WithdrawalsEntry[](2);
        withdrawals[0] = Mocks.WithdrawalsEntry(RECIPIENT_1, 100);
        withdrawals[1] = Mocks.WithdrawalsEntry(RECIPIENT_2, 200);
        gate.mockWithdrawals(withdrawals);

        gate.mockDelayTime(10);
        gate.mockCurrTimestamp(2000);

        int256[] memory timestamps = new int256[](3);
        timestamps[0] = 1000;
        timestamps[1] = 1000;
        timestamps[2] = 1000;
        gate.mockUnlockTimestamps(timestamps);

        Mocks.UnlocksEntry[] memory unlocks = new Mocks.UnlocksEntry[](3);
        unlocks[0] = Mocks.UnlocksEntry(90, DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_1, 100));
        unlocks[1] = Mocks.UnlocksEntry(90, DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_2, 100));
        unlocks[2] = Mocks.UnlocksEntry(89, DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_2, 100));
        gate.mockUnlocks(unlocks);

        bool[] memory credited = new bool[](2);
        credited[0] = true;
        credited[1] = true;
        gate.mockHasUnlockedCredit(credited);

        GateResult memory result = gate.validate();

        result.assertNoExceptions();
        result.assertNotFired();
    }

    function test_noClaimInBlock_noAlert() public {
        // No matching claim for the withdrawal this block — claimsAndWithdrawals is empty
        address[] memory trace = new address[](1);
        trace[0] = DISPUTE_GAME;
        gate.mockAddressesInTrace(trace);

        gate.mockDelayedWETH(DELAYED_WETH);

        Mocks.ClaimsEntry[] memory claims = new Mocks.ClaimsEntry[](0);
        gate.mockClaims(claims);

        Mocks.WithdrawalsEntry[] memory withdrawals = new Mocks.WithdrawalsEntry[](1);
        withdrawals[0] = Mocks.WithdrawalsEntry(RECIPIENT_1, 200);
        gate.mockWithdrawals(withdrawals);

        gate.mockDelayTime(10);
        gate.mockCurrTimestamp(2000);

        int256[] memory timestamps = new int256[](1);
        timestamps[0] = 1000;
        gate.mockUnlockTimestamps(timestamps);

        Mocks.UnlocksEntry[] memory unlocks = new Mocks.UnlocksEntry[](2);
        unlocks[0] = Mocks.UnlocksEntry(90, DISPUTE_GAME,          Mocks.UnlocksEntryField2(RECIPIENT_1, 100));
        unlocks[1] = Mocks.UnlocksEntry(90, address(uint160(0xCC)), Mocks.UnlocksEntryField2(RECIPIENT_2, 100)); // different game, filtered out
        gate.mockUnlocks(unlocks);

        bool[] memory credited = new bool[](1);
        credited[0] = true;
        gate.mockHasUnlockedCredit(credited);

        GateResult memory result = gate.validate();

        result.assertNoExceptions();
        result.assertNotFired();
    }

    function test_noFilterAddress_noAlert() public {
        // disputeGame not in addressesInTrace — both invariants short-circuit to true

        // addressesInTrace intentionally not mocked — gate sees empty list, Len > 0 is false

        gate.mockDelayedWETH(DELAYED_WETH);

        Mocks.ClaimsEntry[] memory claims = new Mocks.ClaimsEntry[](1);
        claims[0] = Mocks.ClaimsEntry(RECIPIENT_1);
        gate.mockClaims(claims);

        Mocks.WithdrawalsEntry[] memory withdrawals = new Mocks.WithdrawalsEntry[](1);
        withdrawals[0] = Mocks.WithdrawalsEntry(RECIPIENT_1, 100);
        gate.mockWithdrawals(withdrawals);

        gate.mockDelayTime(100);
        gate.mockCurrTimestamp(1099);

        int256[] memory timestamps = new int256[](2);
        timestamps[0] = 1000;
        timestamps[1] = 1000;
        gate.mockUnlockTimestamps(timestamps);

        Mocks.UnlocksEntry[] memory unlocks = new Mocks.UnlocksEntry[](2);
        unlocks[0] = Mocks.UnlocksEntry(50,  DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_1, 50));
        unlocks[1] = Mocks.UnlocksEntry(101, DISPUTE_GAME, Mocks.UnlocksEntryField2(RECIPIENT_1, 50));
        gate.mockUnlocks(unlocks);

        bool[] memory credited = new bool[](1);
        credited[0] = true;
        gate.mockHasUnlockedCredit(credited);

        GateResult memory result = gate.validate();

        result.assertNoExceptions();
        result.assertNotFired();
    }
}
