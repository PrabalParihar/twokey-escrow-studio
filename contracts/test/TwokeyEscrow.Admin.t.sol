// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {TwokeyEscrowTestBase} from "./TwokeyEscrow.Base.t.sol";
import {TwokeyEscrow} from "../TwokeyEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Pause matrix, two-step ownership, renounce, previewAutoPay reason codes.
contract TwokeyEscrowAdminTest is TwokeyEscrowTestBase {
    address internal newOwner = makeAddr("newOwner");

    // ---------------------------------------------------------------- pause
    function test_Pause_EmitsAndSetsFlag() public {
        vm.expectEmit(false, false, false, true, address(escrow));
        emit Pausable.Paused(owner);
        vm.prank(owner);
        escrow.pause();
        assertTrue(escrow.paused());
    }

    function test_Unpause_EmitsAndRestoresRequests() public {
        vm.startPrank(owner);
        escrow.pause();
        vm.expectEmit(false, false, false, true, address(escrow));
        emit Pausable.Unpaused(owner);
        escrow.unpause();
        vm.stopPrank();
        assertFalse(escrow.paused());
        (, bool paid) = _request(agent, payee, 1e6);
        assertTrue(paid);
    }

    function test_Pause_RevertsWhenAlreadyPausedOrUnpauseWhenNot() public {
        vm.startPrank(owner);
        vm.expectRevert(Pausable.ExpectedPause.selector);
        escrow.unpause();
        escrow.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.pause();
        vm.stopPrank();
    }

    function test_PauseMatrix_BlocksRequestAutoPayAndHeldRequest() public {
        vm.prank(owner);
        escrow.pause();
        vm.startPrank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.requestPayment(payee, 1e6, uint64(block.timestamp + 1 days), MEMO); // would auto-pay
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.requestPayment(other, 1e6, uint64(block.timestamp + 1 days), MEMO); // would be held
        vm.stopPrank();
        assertEq(escrow.nextId(), 1);
        assertEq(usdc.balanceOf(payee), 0);
    }

    function test_PauseMatrix_BlocksApprove() public {
        uint256 id = _hold(agent, 5e6);
        bytes32 h = _storedHash(id);
        vm.startPrank(owner);
        escrow.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.approve(id, h);
        vm.stopPrank();
        assertEq(uint8(_status(id)), uint8(TwokeyEscrow.Status.Pending));
        // after unpause the same approve succeeds
        vm.startPrank(owner);
        escrow.unpause();
        escrow.approve(id, h);
        vm.stopPrank();
        assertEq(usdc.balanceOf(other), 5e6);
    }

    function test_PauseMatrix_RejectCancelExpireStillWork() public {
        uint256 a = _hold(agent, 1e6);
        uint256 b = _hold(agent, 1e6);
        uint256 c = _hold(agent, 1e6);
        vm.prank(owner);
        escrow.pause();

        vm.prank(owner);
        escrow.reject(a);
        vm.prank(agent);
        escrow.cancel(b);
        vm.warp(_expiryOf(c) + 1);
        escrow.expire(c);

        assertEq(uint8(_status(a)), uint8(TwokeyEscrow.Status.Rejected));
        assertEq(uint8(_status(b)), uint8(TwokeyEscrow.Status.Cancelled));
        assertEq(uint8(_status(c)), uint8(TwokeyEscrow.Status.Expired));
        assertEq(_pending(agent), 0);
    }

    function test_PauseMatrix_WithdrawAndRescueStillWork() public {
        MockUSDC stray = new MockUSDC();
        stray.mint(address(escrow), 3e6);
        vm.startPrank(owner);
        escrow.pause();
        escrow.withdraw(owner, 100e6);
        escrow.rescueToken(address(stray), owner, 3e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(owner), 100e6);
        assertEq(stray.balanceOf(owner), 3e6);
    }

    function test_PauseMatrix_ConfigChangesStillWork() public {
        vm.startPrank(owner);
        escrow.pause();
        escrow.setAgent(agent2, true, 1e6);
        escrow.setPayee(other, 2e6);
        escrow.removePayee(other);
        escrow.setMaxHoldDuration(3 days);
        vm.stopPrank();
        assertTrue(escrow.getAgent(agent2).allowed);
        assertFalse(escrow.getPayee(other).pinned);
        assertEq(escrow.maxHoldDuration(), 3 days);
    }

    function test_PauseMatrix_PreviewReportsPaused() public {
        vm.prank(owner);
        escrow.pause();
        (bool ok, uint8 reason) = escrow.previewAutoPay(agent, payee, 1e6);
        assertFalse(ok);
        assertEq(reason, 1);
    }

    // ---------------------------------------------------------------- ownership
    function test_Ownership_TwoStepTransfer() public {
        vm.expectEmit(true, true, false, false, address(escrow));
        emit Ownable2Step.OwnershipTransferStarted(owner, newOwner);
        vm.prank(owner);
        escrow.transferOwnership(newOwner);
        assertEq(escrow.owner(), owner, "owner unchanged until accept");
        assertEq(escrow.pendingOwner(), newOwner);

        // pending owner has no powers yet
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner));
        vm.prank(newOwner);
        escrow.pause();

        vm.expectEmit(true, true, false, false, address(escrow));
        emit Ownable.OwnershipTransferred(owner, newOwner);
        vm.prank(newOwner);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), newOwner);
        assertEq(escrow.pendingOwner(), address(0));

        // old owner is out, new owner is in
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        vm.prank(owner);
        escrow.withdraw(owner, 1);
        vm.prank(newOwner);
        escrow.withdraw(newOwner, 1e6);
        assertEq(usdc.balanceOf(newOwner), 1e6);
    }

    function test_Ownership_AcceptByNonPendingReverts() public {
        vm.prank(owner);
        escrow.transferOwnership(newOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        escrow.acceptOwnership();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        vm.prank(owner);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), owner);
    }

    function test_Ownership_AcceptWithNoPendingReverts() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        escrow.acceptOwnership();
    }

    function test_Ownership_NewTransferOverridesPending() public {
        vm.startPrank(owner);
        escrow.transferOwnership(newOwner);
        escrow.transferOwnership(stranger);
        vm.stopPrank();
        assertEq(escrow.pendingOwner(), stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner));
        vm.prank(newOwner);
        escrow.acceptOwnership();
    }

    function test_Renounce_AlwaysReverts() public {
        vm.expectRevert(TwokeyEscrow.OwnershipRenunciationDisabled.selector);
        vm.prank(owner);
        escrow.renounceOwnership();
        vm.expectRevert(TwokeyEscrow.OwnershipRenunciationDisabled.selector);
        vm.prank(stranger);
        escrow.renounceOwnership();
        assertEq(escrow.owner(), owner);
    }

    // ---------------------------------------------------------------- previewAutoPay reason codes
    function test_Preview_Eligible() public view {
        (bool ok, uint8 r) = escrow.previewAutoPay(agent, payee, PAYEE_CAP);
        assertTrue(ok);
        assertEq(r, 0);
    }

    function test_Preview_ReasonCodes() public {
        bool ok;
        uint8 r;
        (ok, r) = escrow.previewAutoPay(stranger, payee, 1e6);
        assertFalse(ok);
        assertEq(r, 2, "agent disabled");
        (, r) = escrow.previewAutoPay(agent, address(0), 1e6);
        assertEq(r, 3, "zero payee");
        (, r) = escrow.previewAutoPay(agent, address(escrow), 1e6);
        assertEq(r, 3, "self payee");
        (, r) = escrow.previewAutoPay(agent, payee, 0);
        assertEq(r, 4, "zero amount");
        (, r) = escrow.previewAutoPay(agent, payee, uint256(type(uint128).max) + 1);
        assertEq(r, 4, "amount > uint128");
        (, r) = escrow.previewAutoPay(agent, other, 1e6);
        assertEq(r, 5, "unpinned");
        (, r) = escrow.previewAutoPay(agent, payee, PAYEE_CAP + 1);
        assertEq(r, 6, "payee cap");

        vm.prank(owner);
        escrow.setPayee(payee, DAILY_CAP);
        _request(agent, payee, DAILY_CAP - 1e6);
        (, r) = escrow.previewAutoPay(agent, payee, 1e6 + 1);
        assertEq(r, 7, "agent window cap");
        (ok, r) = escrow.previewAutoPay(agent, payee, 1e6);
        assertTrue(ok);

        vm.prank(owner);
        escrow.setAgent(agent, true, type(uint128).max);
        uint256 bal = escrow.balance();
        (, r) = escrow.previewAutoPay(agent, payee, bal + 1);
        // bal+1 may exceed the payee cap first; make payee cap large for the balance test
        assertEq(r, 6);
        vm.prank(owner);
        escrow.setPayee(payee, type(uint128).max);
        (, r) = escrow.previewAutoPay(agent, payee, bal + 1);
        assertEq(r, 8, "balance");
    }

    function test_Preview_FirstMatchingReasonWins() public view {
        // disabled agent AND unpinned payee AND amount 0 -> agent reason (2) wins
        (, uint8 r) = escrow.previewAutoPay(stranger, other, 0);
        assertEq(r, 2);
        // enabled agent, bad payee and bad amount -> payee reason (3) wins
        (, r) = escrow.previewAutoPay(agent, address(0), 0);
        assertEq(r, 3);
    }

    // ---------------------------------------------------------------- views
    function test_Headroom_SaturatesAtZeroAfterCapReduction() public {
        _request(agent, payee, 40e6);
        vm.prank(owner);
        escrow.setAgent(agent, true, 10e6);
        assertEq(escrow.autoHeadroom(agent), 0);
        (, bool paid) = _request(agent, payee, 1);
        assertFalse(paid);
    }

    function test_Window_NoUnderflowNearGenesis() public {
        vm.warp(100); // hour index 0
        (, bool paid) = _request(agent, payee, 5e6);
        assertTrue(paid);
        assertEq(escrow.autoSpentInWindow(agent), 5e6);
        vm.warp(3 hours + 5); // hour index 3, fewer than 25 buckets exist
        assertEq(escrow.autoSpentInWindow(agent), 5e6);
        (, paid) = _request(agent, payee, 5e6);
        assertTrue(paid);
        assertEq(escrow.autoSpentInWindow(agent), 10e6);
    }

    function test_Balance_ReflectsUsdcHeld() public view {
        assertEq(escrow.balance(), FUNDS);
    }
}
