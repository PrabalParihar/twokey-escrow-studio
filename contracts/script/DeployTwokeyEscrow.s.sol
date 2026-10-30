// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {TwokeyEscrow} from "../TwokeyEscrow.sol";

/// @notice Deploys TwokeyEscrow to Arc mainnet (5042) or Arc Testnet (5042002).
///
/// The script holds NO key. The signer comes from the command line (a Foundry keystore with
/// `--account`, or a hardware wallet with `--ledger` / `--trezor`), so nothing secret ever
/// lives in the repo or in a file. See DEPLOY_MAINNET.md.
///
/// Env vars:
///   ESCROW_OWNER             required. The wallet that will own the escrow (it can approve, withdraw, pause).
///                            It does not have to be the wallet that pays gas for the deploy.
///   ESCROW_MAX_HOLD_SECONDS  optional, default 604800 (7 days). Must be between 1 hour and 90 days.
///
/// The USDC address is fixed to Arc's USDC and cannot be overridden.
contract DeployTwokeyEscrow is Script {
    uint256 internal constant ARC_MAINNET = 5042;
    uint256 internal constant ARC_TESTNET = 5042002;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant MIN_HOLD = 1 hours;
    uint256 internal constant MAX_HOLD = 90 days;

    function run() external returns (TwokeyEscrow escrow) {
        require(block.chainid == ARC_MAINNET || block.chainid == ARC_TESTNET, "DeployTwokeyEscrow: not an Arc chain");

        address escrowOwner = vm.envAddress("ESCROW_OWNER");
        uint256 maxHold = vm.envOr("ESCROW_MAX_HOLD_SECONDS", uint256(7 days));
        require(escrowOwner != address(0), "DeployTwokeyEscrow: ESCROW_OWNER is zero");
        require(maxHold >= MIN_HOLD && maxHold <= MAX_HOLD, "DeployTwokeyEscrow: hold must be 1 hour to 90 days");
        require(ARC_USDC.code.length > 0, "DeployTwokeyEscrow: no USDC at expected address");
        require(IERC20Metadata(ARC_USDC).decimals() == 6, "DeployTwokeyEscrow: USDC decimals != 6");

        console2.log("Chain id:        ", block.chainid);
        console2.log("Owner:           ", escrowOwner);
        console2.log("USDC:            ", ARC_USDC);
        console2.log("Max hold (secs): ", maxHold);

        vm.startBroadcast();
        escrow = new TwokeyEscrow(escrowOwner, ARC_USDC, uint64(maxHold));
        vm.stopBroadcast();

        // Read-backs: fail loudly if the deployed contract is not what we asked for.
        require(escrow.owner() == escrowOwner, "DeployTwokeyEscrow: owner mismatch");
        require(address(escrow.usdc()) == ARC_USDC, "DeployTwokeyEscrow: usdc mismatch");
        require(escrow.maxHoldDuration() == uint64(maxHold), "DeployTwokeyEscrow: hold mismatch");
        require(!escrow.paused(), "DeployTwokeyEscrow: unexpectedly paused");

        console2.log("TwokeyEscrow deployed at:", address(escrow));
    }
}
