# Deploy Twokey Escrow to Arc mainnet

You deploy and sign this yourself, from your own wallet. Nothing here runs on your behalf, and no private key ever goes in this repo.

Mainnet moves real USDC and cannot be undone. Rehearse on Arc Testnet first (same script, `--rpc-url https://rpc.testnet.arc.io`), get an independent audit before you put meaningful funds in, and check every address below twice.

Arc mainnet: chain ID `5042`, RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io`, USDC `0x3600000000000000000000000000000000000000` (6 decimals). Gas is paid in USDC.

## Deploying from MetaMask instead (in the app)

If you would rather sign in a browser wallet, skip steps 2 to 6 and use the app:

1. `bun run dev`, open the app, switch to **Mainnet**, and connect your wallet (the app asks MetaMask to add Arc mainnet if needed).
2. With no escrow set for the network, the app shows a **Deploy TwokeyEscrow** card. The owner defaults to your connected address and is editable. The card lists the constructor arguments, an estimated fee, and a mainnet checkbox for confirming the owner.
3. Confirm in MetaMask. The app waits for the receipt, then checks the contract (uses Arc's USDC, owner and hold match what you chose, created by that transaction) and saves it in your browser.
4. Copy the contract address, transaction hash and block from the success card, then continue at step 7 (verify) and step 8 (hardcode for everyone).

The app deploys the exact forge bytecode (`src/lib/escrowArtifact.ts`, generated from `contracts/out`). Confirm it is current with `bun run artifact:check`; regenerate after any contract change with `forge build && bun run artifact:sync`.

## 0. Prerequisites

- [Foundry](https://getfoundry.sh) (`forge`, `cast`) and [Bun](https://bun.sh)
- A wallet with a little mainnet USDC for gas (the simulation in step 4 prints the estimate)
- Optional: Arc's `arc-forge` / `arc-cast` wrappers work with the same flags if you already use them

## 1. Build and test from a clean checkout

```bash
bun install
forge build
forge test
```

Verification in step 7 only matches if you deploy from the same source and settings (`foundry.toml`: solc 0.8.28, cancun, optimizer 200 runs). Do not edit the contract between deploying and verifying.

## 2. Set up your signer (no key in the repo)

Pick one.

Encrypted Foundry keystore (stored in `~/.foundry/keystores`, outside the repo):

```bash
cast wallet import arc-deployer --interactive   # paste the key at the hidden prompt, set a password
```

Hardware wallet: use `--ledger` (or `--trezor`) in step 5 instead of `--account arc-deployer`.

Avoid `--private-key` on the command line, since it lands in your shell history.

## 3. Set variables

```bash
export ARC_MAINNET_RPC=https://rpc.mainnet.arc.io
export ESCROW_OWNER=0x548c68cD338442eE5C64D43cd3061C978aE2cF98   # owns the escrow: approves, withdraws, pauses
export ESCROW_MAX_HOLD_SECONDS=604800                            # optional, 7 days (allowed: 1 hour to 90 days)
export DEPLOYER=$(cast wallet address --account arc-deployer)    # wallet that pays gas; use your Ledger address if hardware
```

The deployer can be a different wallet from the owner. Whoever you set as `ESCROW_OWNER` has all the power over the escrow, so confirm it is the address you intend. It cannot be changed except by a two-step transfer by that owner.

Confirm the chain and your gas balance:

```bash
cast chain-id --rpc-url $ARC_MAINNET_RPC            # must print 5042
cast balance $DEPLOYER --rpc-url $ARC_MAINNET_RPC --ether
```

## 4. Simulate (no transaction is sent)

```bash
forge script contracts/script/DeployTwokeyEscrow.s.sol:DeployTwokeyEscrow \
  --rpc-url $ARC_MAINNET_RPC --sender $DEPLOYER
```

Check the printed chain id (`5042`), owner, USDC address, and max hold. The script refuses to run on any chain other than Arc mainnet or Arc Testnet, and refuses to run without `ESCROW_OWNER`.

## 5. Deploy

Keystore:

```bash
forge script contracts/script/DeployTwokeyEscrow.s.sol:DeployTwokeyEscrow \
  --rpc-url $ARC_MAINNET_RPC --account arc-deployer --sender $DEPLOYER --broadcast
```

Hardware wallet:

```bash
forge script contracts/script/DeployTwokeyEscrow.s.sol:DeployTwokeyEscrow \
  --rpc-url $ARC_MAINNET_RPC --ledger --sender $DEPLOYER --broadcast
```

Then read the result from the broadcast file (it holds no secrets):

```bash
RUN=broadcast/DeployTwokeyEscrow.s.sol/5042/run-latest.json
export ESCROW=$(jq -r '.transactions[0].contractAddress' $RUN)
export DEPLOY_TX=$(jq -r '.receipts[0].transactionHash' $RUN)
export DEPLOY_BLOCK=$(cast receipt $DEPLOY_TX blockNumber --rpc-url $ARC_MAINNET_RPC)
echo $ESCROW $DEPLOY_TX $DEPLOY_BLOCK
```

## 6. Check what you deployed

```bash
cast call $ESCROW "owner()(address)"          --rpc-url $ARC_MAINNET_RPC   # your owner
cast call $ESCROW "usdc()(address)"           --rpc-url $ARC_MAINNET_RPC   # 0x3600...0000
cast call $ESCROW "maxHoldDuration()(uint64)" --rpc-url $ARC_MAINNET_RPC   # 604800
cast call $ESCROW "paused()(bool)"            --rpc-url $ARC_MAINNET_RPC   # false
```

## 7. Verify on explorer.arc.io

The explorer runs Blockscout.

```bash
forge verify-contract $ESCROW contracts/TwokeyEscrow.sol:TwokeyEscrow \
  --chain-id 5042 \
  --rpc-url $ARC_MAINNET_RPC \
  --verifier blockscout \
  --verifier-url https://explorer.arc.io/api/ \
  --constructor-args $(cast abi-encode "constructor(address,address,uint64)" $ESCROW_OWNER 0x3600000000000000000000000000000000000000 ${ESCROW_MAX_HOLD_SECONDS:-604800}) \
  --watch
```

Open `https://explorer.arc.io/address/$ESCROW` and confirm the Contract tab shows the source.

If the command is rejected or blocked, verify from the explorer's web form instead. The exact compiler input for the bytecode the app deploys is committed at `contracts/verification/TwokeyEscrow.standard-input.json` (I compiled it and confirmed it produces byte-identical bytecode). You can also regenerate it:

```bash
forge verify-contract $ESCROW contracts/TwokeyEscrow.sol:TwokeyEscrow --show-standard-json-input > contracts/verification/TwokeyEscrow.standard-input.json
```

Then open `https://explorer.arc.io/contract-verification`, choose the Standard JSON input method, upload `contracts/verification/TwokeyEscrow.standard-input.json`, and enter: compiler `v0.8.28+commit.7893614a`, EVM `cancun`, optimizer on with 200 runs, and the constructor arguments (from `cast abi-encode` above, or copied from the app's Deploy card under Build details).

## 8. Point the app at it

Either:

1. Edit `src/deployments.ts`: set `mainnet.escrow` to `$ESCROW`, `mainnet.deployBlock` to `$DEPLOY_BLOCK` (add `n`, for example `12345678n`), and `DEFAULT_NETWORK` to `'mainnet'` so visitors land on mainnet, or
2. Open the app, switch to Mainnet, and paste the contract address and `$DEPLOY_TX` into the setup card. It checks the contract against the chain and saves it in that browser only.

## 9. First run with cents

1. Connect the owner wallet on Mainnet. Add `0.10` USDC to the escrow.
2. Add your agent wallet with a rolling 24h cap of `0.25`. Pin one payee you control with a per-payment cap of `0.05`.
3. From the agent view, request `0.01` to the pinned payee (pays at once), then `0.20` (held). Approve the held one from the owner view.
4. Test Reject, Pause and Withdraw with cents before adding more.

## Notes

- The deploy script is `contracts/script/DeployTwokeyEscrow.s.sol`. The USDC address is fixed in it and cannot be overridden.
- The contract is immutable: no proxy, no admin beyond the owner. A fix means deploying a new escrow, withdrawing from the old one, and re-adding agents and payees.
- Keep `.env` files and `broadcast/` out of version control (`.gitignore` covers them).
