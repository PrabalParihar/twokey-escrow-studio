// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TwokeyEscrow} from "../TwokeyEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Shared fixtures and helpers. Contains no test/fuzz/invariant functions.
abstract contract TwokeyEscrowTestBase is Test {
    TwokeyEscrow internal escrow;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal agent2 = makeAddr("agent2");
    address internal payee = makeAddr("payee"); // pinned, cap PAYEE_CAP
    address internal other = makeAddr("other"); // NOT pinned
    address internal stranger = makeAddr("stranger");

    uint64 internal constant HOLD = 7 days;
    uint128 internal constant DAILY_CAP = 200e6;
    uint128 internal constant PAYEE_CAP = 50e6;
    uint256 internal constant FUNDS = 1_000e6;
    bytes32 internal constant MEMO = keccak256("memo");
    bytes32 internal constant TYPEHASH = keccak256(
        "PaymentTerms(address escrow,uint256 chainId,uint256 id,address agent,address payee,uint128 amount,uint64 expiry,bytes32 memoRef)"
    );

    uint256 internal t0; // hour-aligned start time

    function setUp() public virtual {
        uint256 base = 1_700_000_000; // NB: must be a variable; literal math would be exact rational (no truncation)
        t0 = (base / 1 hours) * 1 hours;
        assertEq(t0 % 1 hours, 0);
        vm.warp(t0);
        usdc = new MockUSDC();
        escrow = new TwokeyEscrow(owner, address(usdc), HOLD);
        vm.startPrank(owner);
        escrow.setAgent(agent, true, DAILY_CAP);
        escrow.setPayee(payee, PAYEE_CAP);
        vm.stopPrank();
        usdc.mint(address(escrow), FUNDS);
    }

    /// @dev Request from `who` with 1-day expiry.
    function _request(address who, address to, uint256 amount) internal returns (uint256 id, bool paid) {
        vm.prank(who);
        return escrow.requestPayment(to, amount, uint64(block.timestamp + 1 days), MEMO);
    }

    /// @dev Creates a Pending request by targeting the unpinned payee `other`.
    function _hold(address who, uint256 amount) internal returns (uint256 id) {
        bool paid;
        (id, paid) = _request(who, other, amount);
        assertFalse(paid, "expected held");
    }

    function _status(uint256 id) internal view returns (TwokeyEscrow.Status s) {
        (,,,,, s,,) = escrow.requests(id);
    }

    function _storedHash(uint256 id) internal view returns (bytes32 h) {
        (,,,,,,, h) = escrow.requests(id);
    }

    function _expiryOf(uint256 id) internal view returns (uint64 e) {
        (,,,, e,,,) = escrow.requests(id);
    }

    function _expectedHash(uint256 id, address ag, address to, uint128 amount, uint64 expiry, bytes32 memo)
        internal
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(TYPEHASH, address(escrow), block.chainid, id, ag, to, amount, expiry, memo));
    }

    function _pending(address a) internal view returns (uint32) {
        return escrow.getAgent(a).pending;
    }
}
