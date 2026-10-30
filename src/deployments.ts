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
    // Deployed from the owner's wallet with the in-app Deploy card. Deploy tx:
    // 0xf360bf0fda031a1e500d56cc7e4153397430f3835c2be5649571e732973b16c7
    escrow: '0x5D1333bA6E53Cb3A5Ff26Ff22cC1d4E9c8A49715',
    deployBlock: 28645318n,
  },
}

/** Network the app opens on until a visitor picks another. */
export const DEFAULT_NETWORK: 'testnet' | 'mainnet' = 'mainnet'
