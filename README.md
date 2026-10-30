# Twokey Escrow

A two-key USDC escrow for AI agents on Arc. An allowed agent asks for a payment. If the payee is one the owner pinned and the amount is within their limits, it is paid at once. Anything else waits in escrow until the owner countersigns the exact terms. The app has an owner view and an agent view, and works on Arc Testnet and Arc Mainnet.

Built with [Arc Studio](https://studio.arc.io)

Live app: https://fascinating-figolla-b5b7a2.netlify.app

## What you can do

- Owner: fund and withdraw USDC, allow agents with a rolling 24 hour auto-pay cap, pin payees with a per-payment cap, approve or reject held requests (the terms are re-checked before you approve), pause everything in an emergency, set the longest a request can wait, and hand over ownership in two steps.
- Agent: see how much you can still auto-pay, preview whether a request pays now or waits for the owner, send requests with a deadline, and cancel your own held requests.
- Held requests expire at the deadline the agent sets, capped by the owner.
- Deploy your own escrow from the app with your browser wallet, or paste an existing one.

## Deployments

Arc Mainnet (live):

- Contract: [`0x5D1333bA6E53Cb3A5Ff26Ff22cC1d4E9c8A49715`](https://explorer.arc.io/address/0x5D1333bA6E53Cb3A5Ff26Ff22cC1d4E9c8A49715)
- Deploy transaction: [`0xf360bf0f…73b16c7`](https://explorer.arc.io/tx/0xf360bf0fda031a1e500d56cc7e4153397430f3835c2be5649571e732973b16c7) (block 28645318)
- Owner: `0x548c68cD338442eE5C64D43cd3061C978aE2cF98`
- Token: Arc USDC `0x3600000000000000000000000000000000000000` (6 decimals)
- Longest hold: 7 days

Arc Testnet (demo):

- Contract: [`0xd212c6df078f0fcf981744c04921ab7ef9bbaac3`](https://explorer.testnet.arc.io/address/0xd212c6df078f0fcf981744c04921ab7ef9bbaac3)
- Same owner, token and hold settings as mainnet

The app opens on Mainnet and has a Testnet toggle in the header. To deploy your own escrow, follow [DEPLOY_MAINNET.md](DEPLOY_MAINNET.md), from the command line or from your browser wallet using the Deploy card in the app.

## Mainnet transactions

A first run on Arc Mainnet with cents, all against the escrow above ([explorer](https://explorer.arc.io/address/0x5D1333bA6E53Cb3A5Ff26Ff22cC1d4E9c8A49715)). Amounts are USDC.

| Step | What happened | Transaction |
| --- | --- | --- |
| Deploy | Escrow deployed from the owner's wallet with the in-app Deploy card | [`0xf360bf0f…3b16c7`](https://explorer.arc.io/tx/0xf360bf0fda031a1e500d56cc7e4153397430f3835c2be5649571e732973b16c7) |
| Fund | Owner added 0.30 USDC to the escrow | [`0xe70900eb…c3778c`](https://explorer.arc.io/tx/0xe70900eb6c9e25e78d62bbf486a07853a5a1c742b0b814ab9fec35f15dc3778c) |
| Set agent | Owner set itself as an agent with a 0.25 limit per rolling 24 hours | [`0x60456d7e…f529cc`](https://explorer.arc.io/tx/0x60456d7ec6f8e9efa72f10315662a71575e9f214af69ea5a1d6c9e2823f529cc) |
| Pin payee | Owner pinned payee `0x6d57604cbefd802a0d74ae5bb0461891711adbf2` (Twokey treasury) with a 0.05 per-payment cap | [`0xd054a757…a448b5`](https://explorer.arc.io/tx/0xd054a757df555eb2368bdb90459bb32295d7a48c8c1791fc314a816840a448b5) |
| Request #1 | 0.05 USDC to the pinned payee, within both limits, so it was paid at once | [`0xe7419fba…7d1fce`](https://explorer.arc.io/tx/0xe7419fbacc7bc55307ad102169a6ed5556ea0db2c43a188b23740981a07d1fce) |
| Request #2 | 0.20 USDC to the same payee, over the 0.05 cap, so it was held in escrow | [`0x3a4b4370…920dce`](https://explorer.arc.io/tx/0x3a4b437059a89f8200afeb536e43637c3d49bdc7860fb952617e4481ab920dce) |
| Countersign | Owner approved request #2 and it was paid | [`0x2d74a412…dbf24d`](https://explorer.arc.io/tx/0x2d74a412751c41974f2637ad30ef3b2cccbec1af4d0baa3654b531d8dbdbf24d) |

The escrow now holds 0.05 USDC (0.30 funded, 0.05 and 0.20 paid out).

The mainnet escrow uses real USDC. This is unaudited software: the contract has had automated tests and a best-effort security review, not an independent audit. Get an independent audit before putting meaningful funds in, and start with cents.

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
