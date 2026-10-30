// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TwokeyEscrowTestBase} from "./TwokeyEscrow.Base.t.sol";
import {TwokeyEscrow} from "../TwokeyEscrow.sol";

/// @dev Rolling-window edge tests (deterministic) and fuzz tests of key arithmetic.
contract TwokeyEscrowFuzzTest is TwokeyEscrowTestBase {
    uint128 internal constant CAP = 200e6;

    function setUp() public override {
        super.setUp();
        vm.prank(owner);
        escrow.setPayee(payee, type(uint128).max); // agent cap is the binding limit
        usdc.mint(address(escrow), 1e15);
    }

    function _paid(uint256 amount) internal returns (bool paid) {
        (, paid) = _request(agent, payee, amount);
    }

    // ---------------------------------------------------------------- deterministic rollover edges
    function test_Window_SpendFromHourStartCountedThrough24h59m59s() public {
        assertTrue(_paid(CAP)); // at t0 (hour start)
        vm.warp(t0 + 24 hours); // exactly 24h later
        assertEq(escrow.autoSpentInWindow(agent), CAP);
        assertFalse(_paid(1), "24h edge still counted");
        vm.warp(t0 + 25 hours - 1);
        assertEq(escrow.autoHeadroom(agent), 0);
        assertFalse(_paid(1), "just under 25h still counted");
    }

    function test_Window_SpendFreedAtExactly25hFromHourStart() public {
        assertTrue(_paid(CAP));
        vm.warp(t0 + 25 hours);
        assertEq(escrow.autoSpentInWindow(agent), 0);
        assertEq(escrow.autoHeadroom(agent), CAP);
        assertTrue(_paid(CAP), "25h edge frees full cap");
    }

    function test_Window_SpendAtHourEndFreedAfter24hPlus1s() public {
        vm.warp(t0 + 1 hours - 1);
        assertTrue(_paid(CAP));
        vm.warp(t0 + 1 hours - 1 + 24 hours); // exactly 24h after the spend
        assertEq(escrow.autoSpentInWindow(agent), CAP, "must still count at 24h");
        assertFalse(_paid(1));
        vm.warp(t0 + 1 hours - 1 + 24 hours + 1); // 24h + 1s: first free second
        assertEq(escrow.autoSpentInWindow(agent), 0);
        assertTrue(_paid(CAP));
    }

    function test_Window_PartialRolloverFreesOldestBucketOnly() public {
        assertTrue(_paid(100e6)); // hour H
        vm.warp(t0 + 1 hours);
        assertTrue(_paid(100e6)); // hour H+1
        vm.warp(t0 + 25 hours);
        assertEq(escrow.autoSpentInWindow(agent), 100e6);
        assertEq(escrow.autoHeadroom(agent), 100e6);
        assertTrue(_paid(100e6));
        assertFalse(_paid(1));
        vm.warp(t0 + 26 hours);
        assertEq(escrow.autoSpentInWindow(agent), 100e6); // only the 25h-ago-bucket-just-added one remains
    }

    function test_Window_SameHourAccumulates() public {
        assertTrue(_paid(60e6));
        vm.warp(t0 + 10 minutes);
        assertTrue(_paid(60e6));
        vm.warp(t0 + 20 minutes);
        assertTrue(_paid(80e6));
        assertEq(escrow.autoSpentByHour(agent, uint64(t0 / 1 hours)), 200e6);
        assertFalse(_paid(1));
    }

    function test_Window_AgentsHaveIndependentBuckets() public {
        vm.prank(owner);
        escrow.setAgent(agent2, true, CAP);
        assertTrue(_paid(CAP));
        (, bool paid) = _request(agent2, payee, CAP);
        assertTrue(paid);
        assertEq(escrow.autoSpentInWindow(agent), CAP);
        assertEq(escrow.autoSpentInWindow(agent2), CAP);
    }

    // ---------------------------------------------------------------- fuzz: per-payment cap
    function testFuzz_PerPaymentCapBoundary(uint256 cap, uint256 amount) public {
        cap = bound(cap, 1, 1e12);
        amount = bound(amount, 1, 2e12);
        vm.startPrank(owner);
        escrow.setPayee(payee, uint128(cap));
        escrow.setAgent(agent, true, type(uint128).max);
        vm.stopPrank();

        (uint256 id, bool paid) = _request(agent, payee, amount);
        assertEq(paid, amount <= cap, "auto iff amount <= payee cap");
        if (paid) {
            assertLe(usdc.balanceOf(payee), cap, "S3: single auto-payment never exceeds cap");
            assertEq(usdc.balanceOf(payee), amount);
            assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Paid));
        } else {
            assertEq(usdc.balanceOf(payee), 0);
            assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Pending));
        }
    }

    // ---------------------------------------------------------------- fuzz: agent cap boundary
    function testFuzz_AgentCapBoundary(uint256 cap, uint256 first, uint256 second) public {
        cap = bound(cap, 1, 1e12);
        first = bound(first, 1, cap);
        second = bound(second, 1, 2e12);
        vm.prank(owner);
        escrow.setAgent(agent, true, uint128(cap));

        assertTrue(_paid(first));
        (, bool paid2) = _request(agent, payee, second);
        assertEq(paid2, first + second <= cap, "second auto iff total <= cap");
        assertLe(escrow.autoSpentInWindow(agent), cap);
    }

    // ---------------------------------------------------------------- fuzz: rollover
    function testFuzz_WindowRollover(uint256 offset, uint256 delay) public {
        offset = bound(offset, 0, 1 hours - 1);
        delay = bound(delay, 0, 60 hours);
        vm.warp(t0 + offset);
        assertTrue(_paid(CAP));
        uint256 spendHour = (t0 + offset) / 1 hours;
        vm.warp(t0 + offset + delay);
        uint256 nowHour = (t0 + offset + delay) / 1 hours;

        bool counted = nowHour - spendHour <= 24;
        assertEq(escrow.autoSpentInWindow(agent), counted ? CAP : 0);
        // Safety guarantee (S2): never freed within 24h of the spend.
        if (delay <= 24 hours) assertEq(escrow.autoSpentInWindow(agent), CAP);
        // Liveness guarantee: always freed once 25h have passed.
        if (delay >= 25 hours) assertEq(escrow.autoSpentInWindow(agent), 0);
        // Behaviour follows the window.
        assertEq(_paid(1), !counted);
    }

    // ---------------------------------------------------------------- fuzz: S2 over arbitrary sequences
    function testFuzz_S2_AutoPaidNeverExceedsCapInAny24h(uint256 seed) public {
        uint256 n = 48;
        uint256[] memory ts = new uint256[](n);
        uint256[] memory amt = new uint256[](n);
        uint256 count;
        for (uint256 i = 0; i < n; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 dt = seed % 6 hours; // sometimes 0 -> same-second bursts
            uint256 a = ((seed >> 64) % CAP) + 1;
            vm.warp(block.timestamp + dt);
            (uint256 id, bool paid) = _request(agent, payee, a);
            if (!paid) {
                vm.prank(agent);
                escrow.cancel(id); // free the pending slot so the 32-cap never interferes
                continue;
            }
            ts[count] = block.timestamp;
            amt[count] = a;
            ++count;
            // closed 24h interval ending at this payment (the worst case for any interval)
            uint256 sum;
            for (uint256 j = 0; j < count; ++j) {
                if (ts[j] + 24 hours >= block.timestamp) sum += amt[j];
            }
            assertLe(sum, CAP, "S2 violated");
        }
        assertGt(count, 0);
    }

    // ---------------------------------------------------------------- fuzz: terms hash
    function testFuzz_TermsHashMismatchAlwaysReverts(bytes32 supplied) public {
        uint256 id = _hold(agent, 5e6);
        bytes32 stored = _storedHash(id);
        vm.assume(supplied != stored);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.TermsHashMismatch.selector, stored, supplied));
        vm.prank(owner);
        escrow.approve(id, supplied);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Pending));
        assertEq(usdc.balanceOf(other), 0);
    }

    function testFuzz_StoredHashMatchesIndependentComputation(uint256 amount, uint256 expOffset, bytes32 memo) public {
        amount = bound(amount, 1, type(uint128).max);
        expOffset = bound(expOffset, 1, HOLD);
        uint64 expiry = uint64(block.timestamp + expOffset);
        vm.prank(agent);
        (uint256 id,) = escrow.requestPayment(other, amount, expiry, memo);
        assertEq(_storedHash(id), _expectedHash(id, agent, other, uint128(amount), expiry, memo));
        assertEq(_storedHash(id), escrow.hashTerms(id, agent, other, uint128(amount), expiry, memo));
    }

    // ---------------------------------------------------------------- fuzz: expiry validation / edges
    function testFuzz_ExpiryValidation(uint256 offset) public {
        offset = bound(offset, 0, uint256(HOLD) * 2);
        uint64 expiry = uint64(block.timestamp + offset);
        bool valid = offset >= 1 && offset <= HOLD;
        if (!valid) vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidExpiry.selector, expiry));
        vm.prank(agent);
        (uint256 id,) = escrow.requestPayment(other, 1e6, expiry, MEMO);
        if (valid) assertEq(_expiryOf(id), expiry);
    }

    function testFuzz_ApproveVsExpireAroundExpiry(uint256 dt) public {
        uint256 id = _hold(agent, 5e6);
        bytes32 h = _storedHash(id);
        uint256 expiry = _expiryOf(id);
        dt = bound(dt, 0, 2 days);
        vm.warp(block.timestamp + dt);
        bool expired = block.timestamp > expiry;
        if (expired) {
            vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.RequestExpired.selector, id));
            vm.prank(owner);
            escrow.approve(id, h);
            escrow.expire(id);
            assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Expired));
        } else {
            vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.RequestNotExpired.selector, id));
            escrow.expire(id);
            vm.prank(owner);
            escrow.approve(id, h);
            assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Approved));
        }
    }

    function testFuzz_AmountAboveUint128Reverts(uint256 amount) public {
        amount = bound(amount, uint256(type(uint128).max) + 1, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidAmount.selector, amount));
        vm.prank(agent);
        escrow.requestPayment(payee, amount, uint64(block.timestamp + 1 days), MEMO);
    }

    function testFuzz_WithdrawMovesExactlyAmount(uint256 amount) public {
        uint256 bal = escrow.balance();
        amount = bound(amount, 1, bal);
        vm.prank(owner);
        escrow.withdraw(stranger, amount);
        assertEq(usdc.balanceOf(stranger), amount);
        assertEq(escrow.balance(), bal - amount);
    }
}
