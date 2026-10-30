import type { Address } from 'viem'

/**
 * Where the Twokey Escrow lives on each network.
 *
 * After you deploy to Arc mainnet, paste the contract address and the block it was
 * deployed in under `mainnet` below (see DEPLOY_MAINNET.md), or paste them into the
 * app once on the Mainnet network and it will remember them in your browser.
 */
export interface Deployment {
  escrow: Address | undefined
  /** Block of the deploy transaction. Event scans start here. */
  deployBlock: bigint | undefined
}

export const DEPLOYMENTS: Record<'testnet' | 'mainnet', Deployment> = {
  testnet: {
    escrow: '0xd212c6df078f0fcf981744c04921ab7ef9bbaac3',
    deployBlock: 69638100n,
  },
  mainnet: {
    escrow: undefined,
    deployBlock: undefined,
  },
}

/** Network the app opens on until a visitor picks another. Set to 'mainnet' for the live round. */
export const DEFAULT_NETWORK: 'testnet' | 'mainnet' = 'testnet'
