# Twokey Escrow

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

A two-key USDC escrow for AI agents on Arc Testnet. Allowed agents request payments; pinned payees within the per-payment cap and the agent's rolling 24h cap are paid at once; everything else is held until the owner calls approve with the exact terms hash. App has Owner and Agent views.

## Deployed Contracts

- TwokeyEscrow (Arc Testnet): `0xd212c6df078f0fcf981744c04921ab7ef9bbaac3`, deploy tx `0x679b1902ee170fc2d81b74e0efd7b93b7d386dd5dcbfe54b6568b2d934711291`, block 0x42697d4
- Constructor: owner `0x548c68cD338442eE5C64D43cd3061C978aE2cF98`, USDC `0x3600000000000000000000000000000000000000`, maxHoldDuration 604800 (7 days)
- Design doc: `contracts/TwokeyEscrow-design.md`. Immutable, no proxy. Pause blocks requests, auto-pays and approve; withdraw/reject/cancel/expire still work.
- RPC limits getLogs to under ~2000 blocks, so `src/lib/hooks.ts` scans in chunks and caches in localStorage.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Header, tabs (Owner / Agent), network guard
- `src/lib/escrow.ts` - address, ABI, terms-hash helper, formatting, error text
- `src/lib/hooks.ts` - reads, log scan, transaction hook
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```

## Networks

- App is network-aware (Arc Testnet 5042002, Arc Mainnet 5042). `src/lib/networks.ts` binds a page load to one network; switching reloads. Escrow per network comes from `src/deployments.ts` (mainnet is unset until the owner deploys) or a browser-saved address from the setup card.
- Mainnet deploy is done by the user from their own wallet: `contracts/script/DeployTwokeyEscrow.s.sol` + `DEPLOY_MAINNET.md`. Arc Studio never deploys to or signs on mainnet.
- Mainnet facts used: chain 5042, RPC https://rpc.mainnet.arc.io, explorer https://explorer.arc.io (Blockscout), USDC 0x3600000000000000000000000000000000000000.
- In-app deploy: `src/components/DeployCard.tsx` deploys `src/lib/escrowArtifact.ts` (generated from the forge artifact by `scripts/sync-artifact.ts`; keep in sync after contract edits). Checks live in `src/lib/verifyEscrow.ts`. Exact compiler input for explorer verification: `contracts/verification/TwokeyEscrow.standard-input.json` (bytecode confirmed identical to the artifact).
- Testnet deploy block is 69638100 (0x42697d4). Mainnet address/tx/block to be hardcoded in `src/deployments.ts` once the owner provides them.
