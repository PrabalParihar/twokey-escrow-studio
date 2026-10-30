import { defineChain } from 'viem'
import { arcTestnet } from 'viem/chains'
import { requireChain } from '@/onchain-facts'

const m = requireChain(5042)
const rpc = m.rpcUrls[0]

/** Arc mainnet, from Arc Studio's onchain facts. USDC is the native gas token (18-decimal native view). */
export const arcMainnet = defineChain({
  id: 5042,
  name: m.name,
  nativeCurrency: { name: 'USDC', symbol: m.nativeCurrency.symbol, decimals: m.nativeCurrency.decimals },
  rpcUrls: { default: { http: [rpc] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: m.explorerBase } },
})

export { arcTestnet }
