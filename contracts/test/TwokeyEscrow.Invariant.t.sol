// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TwokeyEscrow} from "../TwokeyEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Bounded random driver. All escrow calls are wrapped in try/catch so reverts never abort a run;
///      ghost variables are updated only on success.
contract TwokeyEscrowHandler is Test {
    TwokeyEscrow public escrow;
    MockUSDC public usdc;
    address public owner;
    address[2] public agents;
    address[3] public payees; // [0] pinned 50e6, [1] unpinned, [2] pinned 10e6

    uint256 public ghostFunded;
    uint256 public ghostPaid;
    uint256 public ghostWithdrawn;

    bool public badTransition; // terminal status changed / illegal transition / terms mutated
    bool public s2Violated; // true-24h auto-paid total exceeded the cap
    bool public windowUnderCounts; // contract window < true 24h total (would be unsafe)

    mapping(uint256 => uint8) public lastStatus;
    mapping(uint256 => bytes32) public seenTerms;
    mapping(address => uint256[]) private _ts;
    mapping(address => uint256[]) private _amt;

    uint256 public calls;

    constructor(TwokeyEscrow e, MockUSDC u, address owner_, address[2] memory ags, address[3] memory pys) {
        escrow = e;
        usdc = u;
        owner = owner_;
        agents = ags;
        payees = pys;
    }

    // ------------------------------------------------------------ actions
    function request(uint256 aSeed, uint256 pSeed, uint256 amount, uint256 expOff, bytes32 memo) external {
        address ag = agents[aSeed % 2];
        address py = payees[pSeed % 3];
        amount = bound(amount, 1, 120e6);
        expOff = bound(expOff, 1, 4 days);
        vm.prank(ag);
        try escrow.requestPayment(py, amount, uint64(block.timestamp + expOff), memo) returns (uint256, bool paid) {
            if (paid) {
                ghostPaid += amount;
                _recordAuto(ag, amount);
            }
        } catch {}
        _track();
    }

    function approve(uint256 idSeed, bool goodHash) external {
        uint256 id = _pickId(idSeed);
        if (id != 0) {
            (,, uint128 amt,,,,, bytes32 h) = escrow.requests(id);
            vm.prank(owner);
            try escrow.approve(id, goodHash ? h : keccak256(abi.encode(h))) {
                ghostPaid += amt;
            } catch {}
        }
        _track();
    }

    function reject(uint256 idSeed) external {
        uint256 id = _pickId(idSeed);
        if (id != 0) {
            vm.prank(owner);
            try escrow.reject(id) {} catch {}
        }
        _track();
    }

    function cancel(uint256 idSeed, bool wrongCaller) external {
        uint256 id = _pickId(idSeed);
        if (id != 0) {
            (address ag,,,,,,,) = escrow.requests(id);
            vm.prank(wrongCaller ? owner : ag);
            try escrow.cancel(id) {} catch {}
        }
        _track();
    }

    function expire(uint256 idSeed) external {
        uint256 id = _pickId(idSeed);
        if (id != 0) {
            try escrow.expire(id) {} catch {}
        }
        _track();
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 12 hours));
        _track();
    }

    function fund(uint256 amount) external {
        amount = bound(amount, 1, 300e6);
        usdc.mint(address(escrow), amount);
        ghostFunded += amount;
        _track();
    }

    function withdraw(uint256 amount) external {
        uint256 bal = escrow.balance();
        if (bal != 0) {
            amount = bound(amount, 1, bal);
            vm.prank(owner);
            try escrow.withdraw(owner, amount) {
                ghostWithdrawn += amount;
            } catch {}
        }
        _track();
    }

    function setBlocklisted(bool blocked) external {
        usdc.setBlocklisted(payees[0], blocked);
        _track();
    }

    function setPaused(bool p) external {
        vm.prank(owner);
        if (p) {
            try escrow.pause() {} catch {}
        } else {
            try escrow.unpause() {} catch {}
        }
        _track();
    }

    // ------------------------------------------------------------ internals
    function _pickId(uint256 seed) private view returns (uint256) {
        uint256 n = escrow.nextId();
        if (n <= 1) return 0;
        return (seed % (n - 1)) + 1;
    }

    function _recordAuto(address ag, uint256 amount) private {
        _ts[ag].push(block.timestamp);
        _amt[ag].push(amount);
        uint256 sum;
        for (uint256 i = 0; i < _ts[ag].length; ++i) {
            if (_ts[ag][i] + 24 hours >= block.timestamp) sum += _amt[ag][i];
        }
        if (sum > escrow.getAgent(ag).dailyCap) s2Violated = true;
        if (escrow.autoSpentInWindow(ag) < sum) windowUnderCounts = true;
    }

    function _track() private {
        ++calls;
        uint256 n = escrow.nextId();
        for (uint256 id = 1; id < n; ++id) {
            (,,,,, TwokeyEscrow.Status st,, bytes32 h) = escrow.requests(id);
            uint8 s = uint8(st);
            uint8 last = lastStatus[id];
            if (last == 0) {
                // new request may only appear as Pending(1) or Paid(2)
                if (s != uint8(TwokeyEscrow.Status.Pending) && s != uint8(TwokeyEscrow.Status.Paid)) badTransition = true;
                seenTerms[id] = h;
            } else if (last == uint8(TwokeyEscrow.Status.Pending)) {
                // Pending -> Approved/Rejected/Cancelled/Expired or stays Pending
                if (s == 0 || s == uint8(TwokeyEscrow.Status.Paid)) badTransition = true;
            } else if (s != last) {
                badTransition = true; // terminal status changed
            }
            if (seenTerms[id] != h) badTransition = true;
            lastStatus[id] = s;
        }
    }
}

contract TwokeyEscrowInvariantTest is Test {
    TwokeyEscrow internal escrow;
    MockUSDC internal usdc;
    TwokeyEscrowHandler internal handler;

    address internal owner = makeAddr("owner");
    address[2] internal agents = [makeAddr("agentA"), makeAddr("agentB")];
    address[3] internal payees = [makeAddr("payeeP1"), makeAddr("payeeUnpinned"), makeAddr("payeeP3")];

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC();
        escrow = new TwokeyEscrow(owner, address(usdc), 7 days);
        vm.startPrank(owner);
        escrow.setAgent(agents[0], true, 150e6);
        escrow.setAgent(agents[1], true, 60e6);
        escrow.setPayee(payees[0], 50e6);
        escrow.setPayee(payees[2], 10e6);
        vm.stopPrank();
        handler = new TwokeyEscrowHandler(escrow, usdc, owner, agents, payees);
        usdc.mint(address(escrow), 500e6);
        // the handler tracks funding relative to this initial balance
        targetContract(address(handler));
    }

    /// PROPERTY: balance == initial funding + funded - paid - withdrawn.
    function invariant_BalanceEqualsFundedMinusPaidMinusWithdrawn() public view {
        uint256 expected = 500e6 + handler.ghostFunded() - handler.ghostPaid() - handler.ghostWithdrawn();
        assertEq(escrow.balance(), expected);
        assertEq(usdc.balanceOf(address(escrow)), expected);
    }

    /// PROPERTY: payees only ever receive what the escrow recorded as paid (S1).
    function invariant_PayeeBalancesEqualPaid() public view {
        uint256 sum;
        for (uint256 i = 0; i < 3; ++i) sum += usdc.balanceOf(payees[i]);
        assertEq(sum, handler.ghostPaid());
    }

    /// PROPERTY: sum of Paid+Approved request amounts == total paid out.
    function invariant_SettledPaymentsSumToPaid() public view {
        uint256 sum;
        uint256 n = escrow.nextId();
        for (uint256 id = 1; id < n; ++id) {
            (,, uint128 amt,,, TwokeyEscrow.Status st,,) = escrow.requests(id);
            if (st == TwokeyEscrow.Status.Paid || st == TwokeyEscrow.Status.Approved) sum += amt;
        }
        assertEq(sum, handler.ghostPaid());
    }

    /// PROPERTY: agent.pending == number of that agent's Pending requests, and never exceeds 32.
    function invariant_PendingCounterEqualsPendingRequests() public view {
        uint256 n = escrow.nextId();
        for (uint256 a = 0; a < 2; ++a) {
            uint256 count;
            for (uint256 id = 1; id < n; ++id) {
                (address ag,,,,, TwokeyEscrow.Status st,,) = escrow.requests(id);
                if (ag == agents[a] && st == TwokeyEscrow.Status.Pending) ++count;
            }
            assertEq(escrow.getAgent(agents[a]).pending, count);
            assertLe(count, escrow.MAX_PENDING_PER_AGENT());
        }
    }

    /// PROPERTY: terminal statuses never change, terms never mutate, transitions are legal (S4, S7).
    function invariant_TerminalStatusesNeverChange() public view {
        assertFalse(handler.badTransition());
    }

    /// PROPERTY (S2): true 24h auto-paid total never exceeds the cap, and the window never under-counts.
    function invariant_S2_AutoPaidWithinCapInAny24h() public view {
        assertFalse(handler.s2Violated());
        assertFalse(handler.windowUnderCounts());
        for (uint256 a = 0; a < 2; ++a) {
            assertLe(escrow.autoSpentInWindow(agents[a]), escrow.getAgent(agents[a]).dailyCap);
        }
    }

    /// PROPERTY (S3): every auto-paid request is within its payee's per-payment cap.
    function invariant_S3_AutoPaidWithinPayeeCap() public view {
        uint256 n = escrow.nextId();
        for (uint256 id = 1; id < n; ++id) {
            (, address py, uint128 amt,,, TwokeyEscrow.Status st,,) = escrow.requests(id);
            if (st == TwokeyEscrow.Status.Paid) {
                assertTrue(escrow.getPayee(py).pinned);
                assertLe(amt, escrow.getPayee(py).perPaymentCap);
            }
        }
    }
}
