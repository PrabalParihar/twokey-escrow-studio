// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TwokeyEscrowTestBase} from "./TwokeyEscrow.Base.t.sol";
import {TwokeyEscrow} from "../TwokeyEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Deployment, happy paths and events.
contract TwokeyEscrowUnitTest is TwokeyEscrowTestBase {
    // ---------------------------------------------------------------- deployment
    function test_Constructor_SetsState() public view {
        assertEq(escrow.owner(), owner);
        assertEq(address(escrow.usdc()), address(usdc));
        assertEq(escrow.maxHoldDuration(), HOLD);
        assertEq(escrow.nextId(), 1);
        assertEq(escrow.WINDOW_BUCKETS(), 25);
        assertEq(escrow.MAX_PENDING_PER_AGENT(), 32);
        assertEq(escrow.TERMS_TYPEHASH(), TYPEHASH);
        assertFalse(escrow.paused());
        assertEq(escrow.pendingOwner(), address(0));
    }

    function test_Constructor_EmitsMaxHoldDurationSet() public {
        vm.expectEmit(false, false, false, true);
        emit TwokeyEscrow.MaxHoldDurationSet(2 days);
        new TwokeyEscrow(owner, address(usdc), 2 days);
    }

    function test_Constructor_AcceptsDurationBounds() public {
        assertEq(new TwokeyEscrow(owner, address(usdc), 1 hours).maxHoldDuration(), 1 hours);
        assertEq(new TwokeyEscrow(owner, address(usdc), 90 days).maxHoldDuration(), 90 days);
    }

    function test_Constructor_RevertsZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new TwokeyEscrow(address(0), address(usdc), HOLD);
    }

    function test_Constructor_RevertsZeroUsdc() public {
        vm.expectRevert(TwokeyEscrow.ZeroAddress.selector);
        new TwokeyEscrow(owner, address(0), HOLD);
    }

    function test_Constructor_RevertsDurationOutOfBounds() public {
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidMaxHoldDuration.selector, uint64(1 hours - 1)));
        new TwokeyEscrow(owner, address(usdc), 1 hours - 1);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidMaxHoldDuration.selector, uint64(90 days + 1)));
        new TwokeyEscrow(owner, address(usdc), 90 days + 1);
    }

    // ---------------------------------------------------------------- requestPayment: auto
    function test_AutoPay_TransfersImmediatelyAndRecords() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(agent);
        (uint256 id, bool paid) = escrow.requestPayment(payee, 30e6, expiry, MEMO);
        assertEq(id, 1);
        assertTrue(paid);
        assertEq(usdc.balanceOf(payee), 30e6);
        assertEq(escrow.balance(), FUNDS - 30e6);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Paid));
        assertEq(_pending(agent), 0);
        assertEq(escrow.nextId(), 2);
        assertEq(escrow.autoSpentInWindow(agent), 30e6);
        assertEq(escrow.autoHeadroom(agent), DAILY_CAP - 30e6);
        assertEq(escrow.autoSpentByHour(agent, uint64(block.timestamp / 1 hours)), 30e6);
        _assertStoredAutoRequest(id, expiry);
    }

    function _assertStoredAutoRequest(uint256 id, uint64 expiry) internal view {
        (address ag, address to, uint128 amt, uint64 createdAt, uint64 exp,, bytes32 memo,) = escrow.requests(id);
        assertEq(ag, agent);
        assertEq(to, payee);
        assertEq(amt, 30e6);
        assertEq(createdAt, block.timestamp);
        assertEq(exp, expiry);
        assertEq(memo, MEMO);
        assertEq(_storedHash(id), _expectedHash(id, agent, payee, 30e6, expiry, MEMO));
    }

    function test_AutoPay_EmitsRequestedThenReleased() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 h = _expectedHash(1, agent, payee, 30e6, expiry, MEMO);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit TwokeyEscrow.PaymentRequested(1, agent, payee, 30e6, expiry, MEMO, h);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit TwokeyEscrow.PaymentReleased(1, payee, 30e6, true);
        vm.prank(agent);
        escrow.requestPayment(payee, 30e6, expiry, MEMO);
    }

    function test_AutoPay_ExactBoundariesPassAndOneOverHolds() public {
        // equal to payee cap pays
        (, bool paid) = _request(agent, payee, PAYEE_CAP);
        assertTrue(paid);
        // one over payee cap is held
        (uint256 id, bool paid2) = _request(agent, payee, PAYEE_CAP + 1);
        assertFalse(paid2);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Pending));
    }

    function test_AutoPay_ExactDailyCapPassesAndOneOverHolds() public {
        vm.prank(owner);
        escrow.setPayee(payee, DAILY_CAP); // lift payee cap so the agent cap binds
        (, bool paid) = _request(agent, payee, DAILY_CAP);
        assertTrue(paid);
        assertEq(escrow.autoHeadroom(agent), 0);
        (, bool paid2) = _request(agent, payee, 1);
        assertFalse(paid2);
    }

    function test_AutoPay_ExactBalancePassesAndOneOverHolds() public {
        vm.startPrank(owner);
        escrow.withdraw(owner, FUNDS - 10e6); // leaves 10e6
        vm.stopPrank();
        (, bool paid) = _request(agent, payee, 10e6 + 1);
        assertFalse(paid, "balance short -> held, not revert");
        (, bool paid2) = _request(agent, payee, 10e6);
        assertTrue(paid2);
        assertEq(escrow.balance(), 0);
    }

    // ---------------------------------------------------------------- requestPayment: held
    function test_Held_UnpinnedPayeeStoresPendingNoTransfer() public {
        uint256 id = _hold(agent, 10e6);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Pending));
        assertEq(_pending(agent), 1);
        assertEq(usdc.balanceOf(other), 0);
        assertEq(escrow.balance(), FUNDS);
        assertEq(escrow.autoSpentInWindow(agent), 0);
    }

    function test_Held_EmitsRequestedOnly() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 h = _expectedHash(1, agent, other, 10e6, expiry, MEMO);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit TwokeyEscrow.PaymentRequested(1, agent, other, 10e6, expiry, MEMO, h);
        vm.prank(agent);
        escrow.requestPayment(other, 10e6, expiry, MEMO);
    }

    function test_Held_ExpiryAtMaxHoldAccepted() public {
        vm.prank(agent);
        (uint256 id,) = escrow.requestPayment(other, 1e6, uint64(block.timestamp + HOLD), MEMO);
        assertEq(_expiryOf(id), block.timestamp + HOLD);
        vm.prank(agent);
        (id,) = escrow.requestPayment(other, 1e6, uint64(block.timestamp + 1), MEMO);
        assertEq(_expiryOf(id), block.timestamp + 1);
    }

    function test_Held_InsufficientBalanceStoresPending() public {
        (uint256 id, bool paid) = _request(agent, payee, PAYEE_CAP);
        assertTrue(paid);
        vm.prank(owner);
        escrow.withdraw(owner, FUNDS - PAYEE_CAP - 1e6); // leave 1e6
        (id, paid) = _request(agent, payee, 5e6);
        assertFalse(paid);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Pending));
    }

    // ---------------------------------------------------------------- approve
    function test_Approve_PaysExactTermsAndSettles() public {
        uint256 id = _hold(agent, 80e6);
        bytes32 h = _storedHash(id);
        assertEq(h, _expectedHash(id, agent, other, 80e6, _expiryOf(id), MEMO));
        vm.expectEmit(true, true, false, true, address(escrow));
        emit TwokeyEscrow.PaymentReleased(id, other, 80e6, false);
        vm.prank(owner);
        escrow.approve(id, h);
        assertEq(usdc.balanceOf(other), 80e6);
        assertEq(escrow.balance(), FUNDS - 80e6);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Approved));
        assertEq(_pending(agent), 0);
    }

    function test_Approve_DoesNotConsumeAgentWindow() public {
        uint256 id = _hold(agent, 80e6);
        bytes32 h = _storedHash(id);
        vm.prank(owner);
        escrow.approve(id, h);
        assertEq(escrow.autoSpentInWindow(agent), 0);
        assertEq(escrow.autoHeadroom(agent), DAILY_CAP);
    }

    function test_Approve_IgnoresCurrentLimitsAndAgentStatus() public {
        uint256 id = _hold(agent, 80e6); // over the cap of nothing: unpinned payee
        vm.startPrank(owner);
        escrow.setAgent(agent, false, 0); // agent disabled
        escrow.setPayee(other, 1); // tiny cap
        escrow.approve(id, _storedHash(id));
        vm.stopPrank();
        assertEq(usdc.balanceOf(other), 80e6);
        assertEq(_pending(agent), 0);
    }

    function test_Approve_AtExactExpiryStillAllowed() public {
        uint256 id = _hold(agent, 5e6);
        bytes32 h = _storedHash(id);
        vm.warp(_expiryOf(id));
        vm.prank(owner);
        escrow.approve(id, h);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Approved));
    }

    // ---------------------------------------------------------------- reject / cancel / expire
    function test_Reject_SettlesAndEmits() public {
        uint256 id = _hold(agent, 5e6);
        vm.expectEmit(true, false, false, false, address(escrow));
        emit TwokeyEscrow.PaymentRejected(id);
        vm.prank(owner);
        escrow.reject(id);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Rejected));
        assertEq(_pending(agent), 0);
        assertEq(escrow.balance(), FUNDS);
    }

    function test_Reject_WorksAfterExpiry() public {
        uint256 id = _hold(agent, 5e6);
        vm.warp(_expiryOf(id) + 365 days);
        vm.prank(owner);
        escrow.reject(id);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Rejected));
    }

    function test_Cancel_SettlesAndEmits() public {
        uint256 id = _hold(agent, 5e6);
        vm.expectEmit(true, false, false, false, address(escrow));
        emit TwokeyEscrow.PaymentCancelled(id);
        vm.prank(agent);
        escrow.cancel(id);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Cancelled));
        assertEq(_pending(agent), 0);
    }

    function test_Cancel_WorksForDisabledAgent() public {
        uint256 id = _hold(agent, 5e6);
        vm.prank(owner);
        escrow.setAgent(agent, false, 0);
        vm.prank(agent);
        escrow.cancel(id);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Cancelled));
        assertEq(_pending(agent), 0);
    }

    function test_Expire_StrictlyAfterExpiryByAnyone() public {
        uint256 id = _hold(agent, 5e6);
        vm.warp(_expiryOf(id) + 1);
        vm.expectEmit(true, false, false, false, address(escrow));
        emit TwokeyEscrow.PaymentExpired(id);
        vm.prank(stranger);
        escrow.expire(id);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Expired));
        assertEq(_pending(agent), 0);
        assertEq(escrow.balance(), FUNDS);
    }

    // ---------------------------------------------------------------- config
    function test_SetAgent_StoresAndEmitsKeepsPending() public {
        _hold(agent, 5e6);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit TwokeyEscrow.AgentSet(agent, false, 7e6);
        vm.prank(owner);
        escrow.setAgent(agent, false, 7e6);
        TwokeyEscrow.Agent memory a = escrow.getAgent(agent);
        assertFalse(a.allowed);
        assertEq(a.dailyCap, 7e6);
        assertEq(a.pending, 1);
    }

    function test_SetAgent_DoesNotResetSpend() public {
        _request(agent, payee, 30e6);
        vm.prank(owner);
        escrow.setAgent(agent, true, DAILY_CAP);
        assertEq(escrow.autoSpentInWindow(agent), 30e6);
    }

    function test_SetPayee_StoresAndEmits() public {
        vm.expectEmit(true, false, false, true, address(escrow));
        emit TwokeyEscrow.PayeeSet(other, 9e6);
        vm.prank(owner);
        escrow.setPayee(other, 9e6);
        TwokeyEscrow.Payee memory p = escrow.getPayee(other);
        assertTrue(p.pinned);
        assertEq(p.perPaymentCap, 9e6);
    }

    function test_RemovePayee_UnpinsAndEmits() public {
        vm.expectEmit(true, false, false, false, address(escrow));
        emit TwokeyEscrow.PayeeRemoved(payee);
        vm.prank(owner);
        escrow.removePayee(payee);
        assertFalse(escrow.getPayee(payee).pinned);
        (, bool paid) = _request(agent, payee, 1e6);
        assertFalse(paid);
    }

    function test_RemovePayee_UnknownIsNoop() public {
        vm.prank(owner);
        escrow.removePayee(stranger);
        assertFalse(escrow.getPayee(stranger).pinned);
    }

    function test_SetMaxHoldDuration_AppliesToFutureOnly() public {
        uint256 id = _hold(agent, 1e6);
        uint64 oldExpiry = _expiryOf(id);
        vm.expectEmit(false, false, false, true, address(escrow));
        emit TwokeyEscrow.MaxHoldDurationSet(2 hours);
        vm.prank(owner);
        escrow.setMaxHoldDuration(2 hours);
        assertEq(escrow.maxHoldDuration(), 2 hours);
        assertEq(_expiryOf(id), oldExpiry);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidExpiry.selector, uint64(block.timestamp + 2 hours + 1)));
        escrow.requestPayment(other, 1e6, uint64(block.timestamp + 2 hours + 1), MEMO);
    }

    // ---------------------------------------------------------------- funds
    function test_Funding_PlainTransferIncreasesBalance() public {
        usdc.mint(stranger, 5e6);
        vm.prank(stranger);
        usdc.transfer(address(escrow), 5e6);
        assertEq(escrow.balance(), FUNDS + 5e6);
    }

    function test_Withdraw_SendsAndEmits() public {
        vm.expectEmit(true, false, false, true, address(escrow));
        emit TwokeyEscrow.Withdrawn(stranger, 40e6);
        vm.prank(owner);
        escrow.withdraw(stranger, 40e6);
        assertEq(usdc.balanceOf(stranger), 40e6);
        assertEq(escrow.balance(), FUNDS - 40e6);
    }

    function test_RescueToken_SendsOtherTokenAndEmits() public {
        MockUSDC stray = new MockUSDC();
        stray.mint(address(escrow), 9e6);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit TwokeyEscrow.TokenRescued(address(stray), stranger, 9e6);
        vm.prank(owner);
        escrow.rescueToken(address(stray), stranger, 9e6);
        assertEq(stray.balanceOf(stranger), 9e6);
        assertEq(stray.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(address(escrow)), FUNDS);
    }

    function test_HashTerms_MatchesIndependentComputation() public view {
        bytes32 h = escrow.hashTerms(42, agent, payee, 7e6, 123456, MEMO);
        assertEq(h, _expectedHash(42, agent, payee, 7e6, 123456, MEMO));
        // changing any field changes the hash
        assertTrue(h != escrow.hashTerms(43, agent, payee, 7e6, 123456, MEMO));
        assertTrue(h != escrow.hashTerms(42, agent2, payee, 7e6, 123456, MEMO));
        assertTrue(h != escrow.hashTerms(42, agent, other, 7e6, 123456, MEMO));
        assertTrue(h != escrow.hashTerms(42, agent, payee, 7e6 + 1, 123456, MEMO));
        assertTrue(h != escrow.hashTerms(42, agent, payee, 7e6, 123457, MEMO));
        assertTrue(h != escrow.hashTerms(42, agent, payee, 7e6, 123456, bytes32(0)));
    }

    function test_HashTerms_BindsChainId() public {
        bytes32 h = escrow.hashTerms(1, agent, payee, 1, 1, MEMO);
        vm.chainId(block.chainid + 1);
        assertTrue(h != escrow.hashTerms(1, agent, payee, 1, 1, MEMO));
    }
}
