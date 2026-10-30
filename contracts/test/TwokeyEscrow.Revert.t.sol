// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {TwokeyEscrowTestBase} from "./TwokeyEscrow.Base.t.sol";
import {TwokeyEscrow} from "../TwokeyEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Every revert path, access control, blocklist failure path, pending cap.
contract TwokeyEscrowRevertTest is TwokeyEscrowTestBase {
    function _onlyOwnerErr(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who);
    }

    // ---------------------------------------------------------------- requestPayment
    function test_Request_RevertsForNonAgent() public {
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.AgentNotAllowed.selector, stranger));
        vm.prank(stranger);
        escrow.requestPayment(payee, 1e6, uint64(block.timestamp + 1 days), MEMO);
    }

    function test_Request_RevertsForDisabledAgent() public {
        vm.prank(owner);
        escrow.setAgent(agent, false, DAILY_CAP);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.AgentNotAllowed.selector, agent));
        vm.prank(agent);
        escrow.requestPayment(payee, 1e6, uint64(block.timestamp + 1 days), MEMO);
    }

    function test_Request_RevertsZeroPayee() public {
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidPayee.selector, address(0)));
        vm.prank(agent);
        escrow.requestPayment(address(0), 1e6, uint64(block.timestamp + 1 days), MEMO);
    }

    function test_Request_RevertsSelfPayee() public {
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidPayee.selector, address(escrow)));
        vm.prank(agent);
        escrow.requestPayment(address(escrow), 1e6, uint64(block.timestamp + 1 days), MEMO);
    }

    function test_Request_RevertsZeroAmount() public {
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidAmount.selector, 0));
        vm.prank(agent);
        escrow.requestPayment(payee, 0, uint64(block.timestamp + 1 days), MEMO);
    }

    function test_Request_RevertsAmountAboveUint128() public {
        uint256 big = uint256(type(uint128).max) + 1;
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidAmount.selector, big));
        vm.prank(agent);
        escrow.requestPayment(payee, big, uint64(block.timestamp + 1 days), MEMO);
    }

    function test_Request_AmountUint128MaxIsHeldNotRevert() public {
        (uint256 id, bool paid) = _request(agent, payee, type(uint128).max);
        assertFalse(paid);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Pending));
    }

    function test_Request_RevertsExpiryNotInFuture() public {
        vm.startPrank(agent);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidExpiry.selector, uint64(block.timestamp)));
        escrow.requestPayment(payee, 1e6, uint64(block.timestamp), MEMO);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidExpiry.selector, uint64(block.timestamp - 1)));
        escrow.requestPayment(payee, 1e6, uint64(block.timestamp - 1), MEMO);
        vm.stopPrank();
    }

    function test_Request_RevertsExpiryBeyondMaxHold() public {
        uint64 tooLate = uint64(block.timestamp + HOLD + 1);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidExpiry.selector, tooLate));
        vm.prank(agent);
        escrow.requestPayment(payee, 1e6, tooLate, MEMO);
    }

    function test_Request_PendingCapOf32() public {
        for (uint256 i = 0; i < 32; ++i) _hold(agent, 1e6);
        assertEq(_pending(agent), 32);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.TooManyPending.selector, agent));
        vm.prank(agent);
        escrow.requestPayment(other, 1e6, uint64(block.timestamp + 1 days), MEMO);
        assertEq(_pending(agent), 32);
        assertEq(escrow.nextId(), 33);
    }

    function test_Request_PendingCapDoesNotBlockAutoPay() public {
        for (uint256 i = 0; i < 32; ++i) _hold(agent, 1e6);
        (, bool paid) = _request(agent, payee, 1e6);
        assertTrue(paid);
        assertEq(_pending(agent), 32);
    }

    function test_Request_PendingCapIsPerAgentAndFreesOnSettle() public {
        vm.prank(owner);
        escrow.setAgent(agent2, true, DAILY_CAP);
        uint256 first;
        for (uint256 i = 0; i < 32; ++i) {
            uint256 id = _hold(agent, 1e6);
            if (i == 0) first = id;
        }
        _hold(agent2, 1e6); // other agent unaffected
        vm.prank(agent);
        escrow.cancel(first);
        _hold(agent, 1e6); // slot freed
        assertEq(_pending(agent), 32);
        assertEq(_pending(agent2), 1);
    }

    function test_Request_RevertsWhenBlocklistedPayeeAutoPay() public {
        usdc.setBlocklisted(payee, true);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.Blocklisted.selector, payee));
        vm.prank(agent);
        escrow.requestPayment(payee, 1e6, uint64(block.timestamp + 1 days), MEMO);
        // whole call rolled back
        assertEq(escrow.nextId(), 1);
        assertEq(escrow.autoSpentInWindow(agent), 0);
        assertEq(escrow.balance(), FUNDS);
    }

    // ---------------------------------------------------------------- approve
    function test_Approve_RevertsNonOwner() public {
        uint256 id = _hold(agent, 5e6);
        bytes32 h = _storedHash(id);
        vm.expectRevert(_onlyOwnerErr(agent));
        vm.prank(agent);
        escrow.approve(id, h);
    }

    function test_Approve_RevertsUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotPending.selector, 99));
        vm.prank(owner);
        escrow.approve(99, bytes32(0));
    }

    function test_Approve_RevertsAutoPaidRequest() public {
        (uint256 id,) = _request(agent, payee, 1e6);
        bytes32 h = _storedHash(id);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotPending.selector, id));
        vm.prank(owner);
        escrow.approve(id, h);
    }

    function test_Approve_RevertsSecondApproval() public {
        uint256 id = _hold(agent, 5e6);
        bytes32 h = _storedHash(id);
        vm.startPrank(owner);
        escrow.approve(id, h);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotPending.selector, id));
        escrow.approve(id, h);
        vm.stopPrank();
        assertEq(usdc.balanceOf(other), 5e6);
    }

    function test_Approve_RevertsAfterExpiry() public {
        uint256 id = _hold(agent, 5e6);
        bytes32 h = _storedHash(id);
        vm.warp(_expiryOf(id) + 1);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.RequestExpired.selector, id));
        vm.prank(owner);
        escrow.approve(id, h);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Pending));
    }

    function test_Approve_ExpiryCheckedBeforeHashCheck() public {
        uint256 id = _hold(agent, 5e6);
        vm.warp(_expiryOf(id) + 1);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.RequestExpired.selector, id));
        vm.prank(owner);
        escrow.approve(id, bytes32(uint256(1)));
    }

    function test_Approve_RevertsOnTermsHashMismatch() public {
        uint256 id = _hold(agent, 5e6);
        bytes32 good = _storedHash(id);
        bytes32 bad = bytes32(uint256(good) ^ 1);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.TermsHashMismatch.selector, good, bad));
        vm.prank(owner);
        escrow.approve(id, bad);
        // zero hash
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.TermsHashMismatch.selector, good, bytes32(0)));
        vm.prank(owner);
        escrow.approve(id, bytes32(0));
        // hash for tampered amount
        bytes32 tampered = _expectedHash(id, agent, other, 6e6, _expiryOf(id), MEMO);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.TermsHashMismatch.selector, good, tampered));
        vm.prank(owner);
        escrow.approve(id, tampered);
        // hash belonging to a different request
        uint256 id2 = _hold(agent, 5e6);
        bytes32 otherHash = _storedHash(id2);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.TermsHashMismatch.selector, good, otherHash));
        vm.prank(owner);
        escrow.approve(id, otherHash);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Pending));
        assertEq(usdc.balanceOf(other), 0);
    }

    function test_Approve_InsufficientBalanceRevertsAndStaysPending() public {
        uint256 id = _hold(agent, 5e6);
        bytes32 h = _storedHash(id);
        vm.prank(owner);
        escrow.withdraw(owner, FUNDS - 1e6);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, address(escrow), 1e6, 5e6)
        );
        vm.prank(owner);
        escrow.approve(id, h);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Pending));
        assertEq(_pending(agent), 1);
        // fund and retry succeeds
        usdc.mint(address(escrow), 10e6);
        vm.prank(owner);
        escrow.approve(id, h);
        assertEq(usdc.balanceOf(other), 5e6);
    }

    function test_Approve_BlocklistedPayeeRevertsStaysPendingThenRejectable() public {
        uint256 id = _hold(agent, 5e6);
        bytes32 h = _storedHash(id);
        usdc.setBlocklisted(other, true);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.Blocklisted.selector, other));
        vm.prank(owner);
        escrow.approve(id, h);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Pending));
        assertEq(_pending(agent), 1);
        assertEq(escrow.balance(), FUNDS);
        vm.prank(owner);
        escrow.reject(id);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Rejected));
        assertEq(_pending(agent), 0);
    }

    // ---------------------------------------------------------------- reject / cancel / expire
    function test_Reject_RevertsNonOwner() public {
        uint256 id = _hold(agent, 5e6);
        vm.expectRevert(_onlyOwnerErr(agent));
        vm.prank(agent);
        escrow.reject(id);
    }

    function test_Reject_RevertsNotPending() public {
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotPending.selector, 1));
        vm.prank(owner);
        escrow.reject(1); // unknown
        (uint256 id,) = _request(agent, payee, 1e6); // Paid
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotPending.selector, id));
        vm.prank(owner);
        escrow.reject(id);
    }

    function test_Cancel_RevertsForOtherAgentOwnerAndStranger() public {
        vm.prank(owner);
        escrow.setAgent(agent2, true, DAILY_CAP);
        uint256 id = _hold(agent, 5e6);
        address[3] memory callers = [agent2, owner, stranger];
        for (uint256 i = 0; i < 3; ++i) {
            vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotRequestAgent.selector, id, callers[i]));
            vm.prank(callers[i]);
            escrow.cancel(id);
        }
        assertEq(_pending(agent), 1);
    }

    function test_Cancel_RevertsNotPending() public {
        uint256 id = _hold(agent, 5e6);
        vm.prank(agent);
        escrow.cancel(id);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotPending.selector, id));
        vm.prank(agent);
        escrow.cancel(id);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotPending.selector, 77));
        vm.prank(agent);
        escrow.cancel(77);
    }

    function test_Expire_RevertsAtOrBeforeExpiry() public {
        uint256 id = _hold(agent, 5e6);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.RequestNotExpired.selector, id));
        escrow.expire(id);
        vm.warp(_expiryOf(id)); // exactly at expiry: not yet expired
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.RequestNotExpired.selector, id));
        escrow.expire(id);
    }

    function test_Expire_RevertsNotPending() public {
        uint256 id = _hold(agent, 5e6);
        vm.warp(_expiryOf(id) + 1);
        escrow.expire(id);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotPending.selector, id));
        escrow.expire(id);
    }

    function test_SettledRequestCannotBeSettledAgain() public {
        uint256 id = _hold(agent, 5e6);
        bytes32 h = _storedHash(id);
        vm.prank(owner);
        escrow.reject(id);
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotPending.selector, id));
        escrow.approve(id, h);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotPending.selector, id));
        escrow.reject(id);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotPending.selector, id));
        vm.prank(agent);
        escrow.cancel(id);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.NotPending.selector, id));
        escrow.expire(id);
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Rejected));
        assertEq(_pending(agent), 0);
    }

    // ---------------------------------------------------------------- config access control + validation
    function test_Config_RevertsForNonOwner() public {
        vm.startPrank(stranger);
        bytes memory err = _onlyOwnerErr(stranger);
        vm.expectRevert(err);
        escrow.setAgent(agent, true, 1);
        vm.expectRevert(err);
        escrow.setPayee(payee, 1);
        vm.expectRevert(err);
        escrow.removePayee(payee);
        vm.expectRevert(err);
        escrow.setMaxHoldDuration(2 hours);
        vm.expectRevert(err);
        escrow.withdraw(stranger, 1);
        vm.expectRevert(err);
        escrow.rescueToken(address(usdc), stranger, 1);
        vm.expectRevert(err);
        escrow.pause();
        vm.expectRevert(err);
        escrow.unpause();
        vm.expectRevert(err);
        escrow.transferOwnership(stranger);
        vm.stopPrank();
    }

    function test_SetAgent_RevertsZeroAddress() public {
        vm.expectRevert(TwokeyEscrow.ZeroAddress.selector);
        vm.prank(owner);
        escrow.setAgent(address(0), true, 1);
    }

    function test_SetPayee_RevertsZeroAndSelf() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidPayee.selector, address(0)));
        escrow.setPayee(address(0), 1);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidPayee.selector, address(escrow)));
        escrow.setPayee(address(escrow), 1);
        vm.stopPrank();
    }

    function test_SetMaxHoldDuration_RevertsOutOfBoundsAcceptsEdges() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidMaxHoldDuration.selector, uint64(1 hours - 1)));
        escrow.setMaxHoldDuration(1 hours - 1);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidMaxHoldDuration.selector, uint64(90 days + 1)));
        escrow.setMaxHoldDuration(90 days + 1);
        escrow.setMaxHoldDuration(1 hours);
        escrow.setMaxHoldDuration(90 days);
        vm.stopPrank();
        assertEq(escrow.maxHoldDuration(), 90 days);
    }

    // ---------------------------------------------------------------- withdraw / rescue
    function test_Withdraw_RevertsZeroToZeroAmountAndOverBalance() public {
        vm.startPrank(owner);
        vm.expectRevert(TwokeyEscrow.ZeroAddress.selector);
        escrow.withdraw(address(0), 1);
        vm.expectRevert(abi.encodeWithSelector(TwokeyEscrow.InvalidAmount.selector, 0));
        escrow.withdraw(owner, 0);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, address(escrow), FUNDS, FUNDS + 1)
        );
        escrow.withdraw(owner, FUNDS + 1);
        vm.stopPrank();
    }

    function test_Withdraw_ToBlocklistedReverts() public {
        usdc.setBlocklisted(stranger, true);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.Blocklisted.selector, stranger));
        vm.prank(owner);
        escrow.withdraw(stranger, 1e6);
    }

    function test_RescueToken_RefusesUsdc() public {
        vm.expectRevert(TwokeyEscrow.CannotRescueUSDC.selector);
        vm.prank(owner);
        escrow.rescueToken(address(usdc), owner, 1);
        assertEq(escrow.balance(), FUNDS);
    }

    function test_RescueToken_RevertsZeroTo() public {
        MockUSDC stray = new MockUSDC();
        vm.expectRevert(TwokeyEscrow.ZeroAddress.selector);
        vm.prank(owner);
        escrow.rescueToken(address(stray), address(0), 1);
    }

    function test_NativeTransferToEscrowReverts() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(escrow).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(escrow).balance, 0);
    }
}
