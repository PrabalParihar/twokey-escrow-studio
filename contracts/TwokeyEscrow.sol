// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TwokeyEscrow
/// @notice Immutable USDC escrow with bounded agent auto-payments and explicit owner approvals.
/// @dev Held requests reserve no funds. Only automatic payments consume hourly limits.
contract TwokeyEscrow is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { None, Pending, Paid, Approved, Rejected, Cancelled, Expired }

    struct Agent {
        bool allowed;
        uint128 dailyCap;
        uint32 pending;
    }

    struct Payee {
        bool pinned;
        uint128 perPaymentCap;
    }

    struct Request {
        address agent;
        address payee;
        uint128 amount;
        uint64 createdAt;
        uint64 expiry;
        Status status;
        bytes32 memoRef;
        bytes32 termsHash;
    }

    /// @notice Number of hourly buckets included in the conservative rolling window.
    uint256 public constant WINDOW_BUCKETS = 25;
    /// @notice Maximum number of held requests per agent.
    uint32 public constant MAX_PENDING_PER_AGENT = 32;
    /// @notice Domain tag for abi.encode-based terms hashing; this is not an EIP-712 signature.
    bytes32 public constant TERMS_TYPEHASH = keccak256(
        "PaymentTerms(address escrow,uint256 chainId,uint256 id,address agent,address payee,uint128 amount,uint64 expiry,bytes32 memoRef)"
    );

    /// @notice The fixed ERC-20 token used for all payments.
    IERC20 public immutable usdc;
    /// @notice Maximum lifetime for newly created requests; existing expiries never change.
    uint64 public maxHoldDuration;
    /// @notice Next request identifier. Identifiers start at one.
    uint256 public nextId = 1;
    /// @notice Immutable terms and current status of a request, or zero fields for unknown IDs.
    mapping(uint256 => Request) public requests;
    mapping(address => Agent) private _agents;
    mapping(address => Payee) private _payees;
    /// @notice Auto-paid amount for an agent and absolute hour index (timestamp / 3600).
    mapping(address => mapping(uint64 => uint128)) public autoSpentByHour;

    error ZeroAddress();
    error InvalidPayee(address payee);
    error InvalidAmount(uint256 amount);
    error InvalidMaxHoldDuration(uint64 duration);
    error InvalidExpiry(uint64 expiry);
    error AgentNotAllowed(address agent);
    error TooManyPending(address agent);
    error NotPending(uint256 id);
    error RequestExpired(uint256 id);
    error RequestNotExpired(uint256 id);
    error TermsHashMismatch(bytes32 expected, bytes32 supplied);
    error NotRequestAgent(uint256 id, address caller);
    error CannotRescueUSDC();
    error OwnershipRenunciationDisabled();

    event PaymentRequested(
        uint256 indexed id, address indexed agent, address indexed payee,
        uint128 amount, uint64 expiry, bytes32 memoRef, bytes32 termsHash
    );
    event PaymentReleased(uint256 indexed id, address indexed payee, uint128 amount, bool isAuto);
    event PaymentRejected(uint256 indexed id);
    event PaymentCancelled(uint256 indexed id);
    event PaymentExpired(uint256 indexed id);
    event AgentSet(address indexed agent, bool allowed, uint128 dailyCap);
    event PayeeSet(address indexed payee, uint128 perPaymentCap);
    event PayeeRemoved(address indexed payee);
    event MaxHoldDurationSet(uint64 maxHoldDuration);
    event Withdrawn(address indexed to, uint256 amount);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    modifier onlyAllowedAgent() {
        if (!_agents[msg.sender].allowed) revert AgentNotAllowed(msg.sender);
        _;
    }

    /// @notice Creates an escrow with no agents or pinned payees.
    /// @param initialOwner Account controlling configuration, approvals and withdrawals; must be nonzero.
    /// @param usdc_ Fixed USDC ERC-20 address; must be nonzero.
    /// @param maxHoldDuration_ Initial hold limit, inclusive between one hour and ninety days.
    constructor(address initialOwner, address usdc_, uint64 maxHoldDuration_) Ownable(initialOwner) {
        // Ownable validates initialOwner before this constructor body runs.
        if (usdc_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        _setMaxHoldDuration(maxHoldDuration_);
    }

    /// @notice Sets an agent's permission and auto-pay cap without resetting spend or pending count.
    function setAgent(address agent, bool allowed, uint128 dailyCap) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        Agent storage config = _agents[agent];
        config.allowed = allowed;
        config.dailyCap = dailyCap;
        emit AgentSet(agent, allowed, dailyCap);
    }

    /// @notice Pins a payee with a per-payment cap; zero cap effectively disables its auto-payments.
    function setPayee(address payee, uint128 perPaymentCap) external onlyOwner {
        _validatePayee(payee);
        _payees[payee] = Payee(true, perPaymentCap);
        emit PayeeSet(payee, perPaymentCap);
    }

    /// @notice Unpins a payee without changing previously stored request terms.
    function removePayee(address payee) external onlyOwner {
        delete _payees[payee];
        emit PayeeRemoved(payee);
    }

    /// @notice Changes the maximum lifetime for future requests, from one hour through ninety days.
    function setMaxHoldDuration(uint64 duration) external onlyOwner {
        _setMaxHoldDuration(duration);
    }

    /// @notice Requests payment, paying immediately if all auto-pay rules hold, otherwise holding it.
    /// @param payee Nonzero recipient other than this escrow.
    /// @param amount Positive USDC base-unit amount no larger than uint128.max.
    /// @param expiry Expiry strictly after now and no later than now plus maxHoldDuration.
    /// @param memoRef Application-defined invoice or task hash.
    /// @return id Unique request identifier.
    /// @return paid Whether USDC was transferred automatically in this transaction.
    function requestPayment(address payee, uint256 amount, uint64 expiry, bytes32 memoRef)
        external onlyAllowedAgent whenNotPaused nonReentrant returns (uint256 id, bool paid)
    {
        _validatePayee(payee);
        if (amount == 0 || amount > type(uint128).max) revert InvalidAmount(amount);
        if (expiry <= block.timestamp || uint256(expiry) > block.timestamp + maxHoldDuration) {
            revert InvalidExpiry(expiry);
        }

        (paid,) = previewAutoPay(msg.sender, payee, amount);
        Agent storage agent = _agents[msg.sender];
        if (!paid && agent.pending >= MAX_PENDING_PER_AGENT) revert TooManyPending(msg.sender);

        id = nextId;
        nextId = id + 1;
        uint128 paymentAmount = uint128(amount);
        bytes32 termsHash = hashTerms(id, msg.sender, payee, paymentAmount, expiry, memoRef);
        requests[id] = Request({
            agent: msg.sender,
            payee: payee,
            amount: paymentAmount,
            createdAt: uint64(block.timestamp),
            expiry: expiry,
            status: paid ? Status.Paid : Status.Pending,
            memoRef: memoRef,
            termsHash: termsHash
        });
        if (paid) {
            // The window check bounds the bucket total by the uint128 agent cap.
            autoSpentByHour[msg.sender][uint64(block.timestamp / 1 hours)] += paymentAmount;
        } else {
            agent.pending += 1;
        }
        emit PaymentRequested(id, msg.sender, payee, paymentAmount, expiry, memoRef, termsHash);
        if (paid) {
            emit PaymentReleased(id, payee, paymentAmount, true);
            usdc.safeTransfer(payee, amount);
        }
    }

    /// @notice Approves the exact stored terms of an unexpired held request; ignores current agent/payee limits.
    /// @dev At the expiry timestamp approval remains possible. Transfer failure rolls back all changes.
    function approve(uint256 id, bytes32 termsHash) external onlyOwner whenNotPaused nonReentrant {
        Request storage request = _pendingRequest(id);
        if (block.timestamp > request.expiry) revert RequestExpired(id);
        if (termsHash != request.termsHash) revert TermsHashMismatch(request.termsHash, termsHash);
        _finishPending(request, Status.Approved);
        emit PaymentReleased(id, request.payee, request.amount, false);
        usdc.safeTransfer(request.payee, request.amount);
    }

    /// @notice Rejects a held request, including while paused or after its expiry.
    function reject(uint256 id) external onlyOwner {
        Request storage request = _pendingRequest(id);
        _finishPending(request, Status.Rejected);
        emit PaymentRejected(id);
    }

    /// @notice Cancels the caller's held request, even if the caller has since been disabled.
    function cancel(uint256 id) external {
        Request storage request = _pendingRequest(id);
        if (request.agent != msg.sender) revert NotRequestAgent(id, msg.sender);
        _finishPending(request, Status.Cancelled);
        emit PaymentCancelled(id);
    }

    /// @notice Marks a held request expired strictly after its expiry; callable by anyone while paused.
    function expire(uint256 id) external {
        Request storage request = _pendingRequest(id);
        if (block.timestamp <= request.expiry) revert RequestNotExpired(id);
        _finishPending(request, Status.Expired);
        emit PaymentExpired(id);
    }

    /// @notice Withdraws positive USDC to a nonzero recipient, including while paused.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount(amount);
        emit Withdrawn(to, amount);
        usdc.safeTransfer(to, amount);
    }

    /// @notice Recovers a non-USDC ERC-20 to a nonzero recipient, including while paused.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(usdc)) revert CannotRescueUSDC();
        if (to == address(0)) revert ZeroAddress();
        emit TokenRescued(token, to, amount);
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Blocks new requests and approvals; other operations remain available.
    function pause() public onlyOwner { _pause(); }

    /// @notice Re-enables requests and approvals.
    function unpause() public onlyOwner { _unpause(); }

    /// @notice Always reverts; ownership can only change through the inherited two-step process.
    function renounceOwnership() public pure override { revert OwnershipRenunciationDisabled(); }

    /// @notice Returns an agent's permission, cap and current held-request count.
    function getAgent(address agent) external view returns (Agent memory) { return _agents[agent]; }

    /// @notice Returns a payee's pin and per-payment cap.
    function getPayee(address payee) external view returns (Payee memory) { return _payees[payee]; }

    /// @notice Sums the current hour and previous 24 hour buckets in USDC base units.
    /// @dev Conservative window may retain a spend for up to 25 hours. No pre-genesis underflow.
    function autoSpentInWindow(address agent) public view returns (uint256 spent) {
        uint64 hour = uint64(block.timestamp / 1 hours);
        for (uint256 i = 0; i < WINDOW_BUCKETS; ++i) {
            if (i > hour) break;
            spent += autoSpentByHour[agent][hour - uint64(i)];
        }
    }

    /// @notice Returns cap minus conservative spend, saturated at zero after cap reductions.
    /// @dev Does not imply permission to spend: disabled agents and paused escrows cannot request.
    function autoHeadroom(address agent) external view returns (uint256) {
        uint256 spent = autoSpentInWindow(agent);
        uint256 cap = _agents[agent].dailyCap;
        return spent >= cap ? 0 : cap - spent;
    }

    /// @notice Previews automatic eligibility only; does not check expiry, pending capacity or token blocklists.
    /// @dev First matching reason wins: 0 eligible; 1 paused; 2 agent disabled;
    /// 3 invalid payee (zero/self); 4 invalid amount (zero/>uint128.max); 5 payee unpinned;
    /// 6 payee cap exceeded; 7 agent window cap exceeded; 8 insufficient USDC balance.
    /// Reasons 1-4 mean requestPayment reverts; reasons 5-8 normally create a held request.
    /// @return isAuto Whether the proposed payment satisfies all automatic rules right now.
    /// @return reasonCode The documented first failing rule, or zero on success.
    function previewAutoPay(address agent, address payee, uint256 amount)
        public view returns (bool isAuto, uint8 reasonCode)
    {
        if (paused()) return (false, 1);
        if (!_agents[agent].allowed) return (false, 2);
        if (payee == address(0) || payee == address(this)) return (false, 3);
        if (amount == 0 || amount > type(uint128).max) return (false, 4);
        Payee storage config = _payees[payee];
        if (!config.pinned) return (false, 5);
        if (amount > config.perPaymentCap) return (false, 6);
        if (autoSpentInWindow(agent) + amount > _agents[agent].dailyCap) return (false, 7);
        if (usdc.balanceOf(address(this)) < amount) return (false, 8);
        return (true, 0);
    }

    /// @notice Hashes the fixed terms with the type tag, this escrow and the current chain ID.
    /// @dev Does not require the request to exist or validate supplied terms.
    function hashTerms(uint256 id, address agent, address payee, uint128 amount, uint64 expiry, bytes32 memoRef)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(TERMS_TYPEHASH, address(this), block.chainid, id, agent, payee, amount, expiry, memoRef));
    }

    /// @notice Returns this escrow's current USDC ERC-20 balance, with no request reservations.
    function balance() external view returns (uint256) { return usdc.balanceOf(address(this)); }

    function _validatePayee(address payee) private view {
        if (payee == address(0) || payee == address(this)) revert InvalidPayee(payee);
    }

    function _setMaxHoldDuration(uint64 duration) private {
        if (duration < 1 hours || duration > 90 days) revert InvalidMaxHoldDuration(duration);
        maxHoldDuration = duration;
        emit MaxHoldDurationSet(duration);
    }

    function _pendingRequest(uint256 id) private view returns (Request storage request) {
        request = requests[id];
        if (request.status != Status.Pending) revert NotPending(id);
    }

    function _finishPending(Request storage request, Status terminalStatus) private {
        request.status = terminalStatus;
        _agents[request.agent].pending -= 1;
    }
}
