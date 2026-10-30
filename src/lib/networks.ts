import { getAddress, isAddress, type Address } from 'viem'
import { DEFAULT_NETWORK, DEPLOYMENTS } from '@/deployments'

export type NetworkKey = 'testnet' | 'mainnet'
export type ArcChainId = 5042002 | 5042

export const NETWORK_META: Record<NetworkKey, { chainId: ArcChainId; label: string; isMainnet: boolean }> = {
  testnet: { chainId: 5042002, label: 'Arc Testnet', isMainnet: false },
  mainnet: { chainId: 5042, label: 'Arc Mainnet', isMainnet: true },
}

const NETWORK_KEY = 'twokey:network'
const depKey = (chainId: number) => `twokey:deployment:${chainId}`

function storedNetwork(): NetworkKey {
  try {
    const v = localStorage.getItem(NETWORK_KEY)
    if (v === 'mainnet' || v === 'testnet') return v
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_NETWORK
}

interface SavedDeployment {
  escrow: Address
  deployBlock: bigint
}

function readSaved(chainId: number): SavedDeployment | undefined {
  try {
    const raw = localStorage.getItem(depKey(chainId))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { escrow?: unknown; deployBlock?: unknown }
    if (typeof parsed.escrow === 'string' && isAddress(parsed.escrow) && typeof parsed.deployBlock === 'string') {
      return { escrow: getAddress(parsed.escrow), deployBlock: BigInt(parsed.deployBlock) }
    }
  } catch {
    /* ignore corrupt entry */
  }
  return undefined
}

export function saveDeployment(chainId: number, escrow: Address, deployBlock: bigint): void {
  localStorage.setItem(depKey(chainId), JSON.stringify({ escrow, deployBlock: deployBlock.toString() }))
}

export function clearSavedDeployment(chainId: number): void {
  localStorage.removeItem(depKey(chainId))
}

/** Switching networks reloads the page so every read, cache and wallet request starts clean on the new chain. */
export function selectNetwork(key: NetworkKey): void {
  localStorage.setItem(NETWORK_KEY, key)
  window.location.reload()
}

function resolve() {
  const key = storedNetwork()
  const meta = NETWORK_META[key]
  const saved = readSaved(meta.chainId)
  const constant = DEPLOYMENTS[key]
  const escrow = saved?.escrow ?? constant.escrow
  const deployBlock = saved?.deployBlock ?? constant.deployBlock
  return {
    key,
    ...meta,
    escrow,
    deployBlock,
    configured: escrow !== undefined && deployBlock !== undefined,
    /** True when the address comes from this browser rather than src/deployments.ts. */
    fromBrowser: saved !== undefined,
  }
}

/** The network this page load is bound to. */
export const ACTIVE = resolve()
