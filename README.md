# Twokey Escrow

A two-key USDC escrow for AI agents on Arc. An allowed agent asks for a payment. If the payee is one the owner pinned and the amount is within their limits, it is paid at once. Anything else waits in escrow until the owner countersigns the exact terms. The app has an owner view and an agent view, and works on Arc Testnet and Arc Mainnet.

Built with [Arc Studio](https://studio.arc.io)

## What you can do

- Owner: fund and withdraw USDC, allow agents with a rolling 24 hour auto-pay cap, pin payees with a per-payment cap, approve or reject held requests (the terms are re-checked before you approve), pause everything in an emergency, set the longest a request can wait, and hand over ownership in two steps.
- Agent: see how much you can still auto-pay, preview whether a request pays now or waits for the owner, send requests with a deadline, and cancel your own held requests.
- Held requests expire at the deadline the agent sets, capped by the owner.
- Deploy your own escrow from the app with your browser wallet, or paste an existing one.

## Testnet deployment

A live demo escrow is deployed on Arc Testnet:

- Contract: [`0xd212c6df078f0fcf981744c04921ab7ef9bbaac3`](https://explorer.testnet.arc.io/address/0xd212c6df078f0fcf981744c04921ab7ef9bbaac3)
- Owner: `0x548c68cD338442eE5C64D43cd3061C978aE2cF98`
- Token: Arc USDC `0x3600000000000000000000000000000000000000` (6 decimals)
- Longest hold: 7 days

Mainnet has no escrow configured yet. Follow [DEPLOY_MAINNET.md](DEPLOY_MAINNET.md) to deploy your own, from the command line or from your browser wallet using the Deploy card in the app.

This is unaudited software. The contract has had automated tests and a best-effort security review, not an independent audit. Get an independent audit before putting meaningful funds in, and start with cents.

## Tech stack

- React, Vite, TypeScript, Tailwind CSS
- wagmi, viem, ConnectKit
- Solidity 0.8.28 with Foundry and OpenZeppelin
- Arc Testnet and Arc Mainnet, USDC

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://getfoundry.sh).

```bash
bun install
forge install foundry-rs/forge-std   # test and script library, not committed
bun run dev                          # app on http://localhost:5173
bun run build                        # production build into dist/
bun run check                        # lint and typecheck
bun run contracts:build
bun run contracts:test
```

After changing the contract, run `forge build && bun run artifact:sync` so the app deploys the new bytecode. `bun run artifact:check` confirms it is current.

Environment variables: None required by the app. `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN` and `RPC_PROXY_CHAINS` are provisioned by Arc Studio and are optional elsewhere. Never commit `.env` files or private keys.

## Layout

- `contracts/TwokeyEscrow.sol`: the escrow. Design notes in `contracts/TwokeyEscrow-design.md`, tests in `contracts/test/`.
- `contracts/script/DeployTwokeyEscrow.s.sol`: command-line deploy script. It holds no keys.
- `contracts/verification/`: exact compiler input for explorer verification.
- `src/deployments.ts`: escrow address per network.
