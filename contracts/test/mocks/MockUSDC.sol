// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Unrestricted test-only six-decimal token with simulated USDC blocklisting.
/// @dev Never use as a production token: anyone may mint or change the blocklist.
contract MockUSDC is ERC20 {
    /// @notice Whether an account is blocklisted.
    mapping(address => bool) public blocklisted;

    error Blocklisted(address account);

    /// @notice Creates the test token with no initial supply.
    constructor() ERC20("MockUSDC", "USDC") {}

    /// @notice Returns USDC's six-decimal precision.
    function decimals() public pure override returns (uint8) { return 6; }

    /// @notice Mints base-unit test tokens; deliberately unrestricted for test fixtures.
    function mint(address to, uint256 amount) external { _mint(to, amount); }

    /// @notice Toggles an account's blocklist flag; deliberately unrestricted for test fixtures.
    function setBlocklisted(address account, bool blocked) external { blocklisted[account] = blocked; }

    /// @dev Rejects movements involving a blocklisted nonzero account, including mint recipients.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && blocklisted[from]) revert Blocklisted(from);
        if (to != address(0) && blocklisted[to]) revert Blocklisted(to);
        super._update(from, to, value);
    }
}
