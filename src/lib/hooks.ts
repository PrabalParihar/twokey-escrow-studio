import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useBlock, usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWriteContract } from 'wagmi'
import { erc20Abi, type Address, type Hex, type TransactionReceipt } from 'viem'
import { toast } from 'sonner'
import {
  CHAIN_ID,
  DEPLOY_BLOCK,
  ESCROW_ADDRESS,
  IS_CONFIGURED,
  USDC_ADDRESS,
  describeError,
  escrowAbi,
  sameAddress,
  toRequest,
  type EscrowRequest,
} from './escrow'

const POLL = 6000

export function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

/** Latest block timestamp in seconds, or undefined until the first block loads. */
export function useChainTime(): number | undefined {
  const { data } = useBlock({ chainId: CHAIN_ID, query: { refetchInterval: POLL } })
  return data ? Number(data.timestamp) : undefined
}

export function useEscrowCore() {
  const base = { address: ESCROW_ADDRESS, abi: escrowAbi, chainId: CHAIN_ID } as const
  const q = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...base, functionName: 'owner' },
      { ...base, functionName: 'paused' },
      { ...base, functionName: 'maxHoldDuration' },
      { ...base, functionName: 'nextId' },
      { ...base, functionName: 'balance' },
      { ...base, functionName: 'pendingOwner' },
    ],
    query: { enabled: IS_CONFIGURED, refetchInterval: POLL },
  })
  const d = q.data
  return {
    isLoading: q.isLoading,
    isError: q.isError,
    owner: d?.[0],
    paused: d?.[1],
    maxHold: d ? Number(d[2]) : undefined,
    nextId: d?.[3],
    balance: d?.[4],
    pendingOwner: d?.[5],
  }
}

/** Most recent requests (newest first), read straight from contract storage. */
export function useRequests(nextId: bigint | undefined, limit = 60) {
  const ids = useMemo(() => {
    if (!nextId || nextId <= 1n) return []
    const out: bigint[] = []
    for (let i = nextId - 1n; i >= 1n && out.length < limit; i--) out.push(i)
    return out
  }, [nextId, limit])
  const q = useReadContracts({
    allowFailure: false,
    contracts: ids.map((id) => ({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'requests' as const, args: [id] as const, chainId: CHAIN_ID })),
    query: { enabled: ids.length > 0, refetchInterval: POLL },
  })
  const requests: EscrowRequest[] = useMemo(
    () => (q.data ?? []).map((r, i) => toRequest(ids[i], r)),
    [q.data, ids],
  )
  return { requests, isLoading: q.isLoading }
}

export function useUsdcBalance(address?: Address) {
  const q = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: POLL },
  })
  return q.data
}

/* ---------- Event log scan (the RPC limits ranges, so scan in small chunks and cache progress) ---------- */

export interface EscrowLog {
  eventName: string
  args: Record<string, unknown>
  blockNumber: bigint
  logIndex: number
  transactionHash: Hex
}

/** Largest block range per getLogs call; halves automatically if the RPC says the range is too large. */
const START_CHUNK = 1900n
const MIN_CHUNK = 100n
const RANGE_ERROR = /range|too large|too many|query returned more than/i
const CACHE_KEY = `twokey:logs:${ESCROW_ADDRESS}`
const events = escrowAbi.filter((item) => item.type === 'event')

const serialize = (v: unknown): string =>
  JSON.stringify(v, (_k: string, x: unknown): unknown => (typeof x === 'bigint' ? `bn:${x.toString()}` : x))
const revive = (s: string): { last: bigint; logs: EscrowLog[] } =>
  JSON.parse(s, (_k: string, x: unknown): unknown => (typeof x === 'string' && x.startsWith('bn:') ? BigInt(x.slice(3)) : x)) as {
    last: bigint
    logs: EscrowLog[]
  }

function loadCache(): { last: bigint; logs: EscrowLog[] } {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return revive(raw)
  } catch {
    /* ignore corrupt cache */
  }
  return { last: DEPLOY_BLOCK - 1n, logs: [] }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const isRangeError = (e: unknown) => e instanceof Error && RANGE_ERROR.test(e.message)

async function getLogsWithRetry(client: NonNullable<ReturnType<typeof usePublicClient>>, from: bigint, to: bigint) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.getLogs({ address: ESCROW_ADDRESS, events, fromBlock: from, toBlock: to })
    } catch (e) {
      // A too-large range will not fix itself by waiting: let the caller shrink it.
      if (isRangeError(e) || attempt >= 3) throw e
      await sleep(700 * (attempt + 1))
    }
  }
}

export function useEscrowLogs() {
  const client = usePublicClient({ chainId: CHAIN_ID })
  return useQuery({
    queryKey: ['twokey-logs', ESCROW_ADDRESS],
    enabled: !!client && IS_CONFIGURED,
    refetchInterval: 10000,
    queryFn: async (): Promise<EscrowLog[]> => {
      if (!client) return []
      const cache = loadCache()
      const head = await client.getBlockNumber()
      let { last } = cache
      const logs = [...cache.logs]
      let chunk = START_CHUNK
      try {
        while (last < head) {
          const from = last + 1n
          const to = from + chunk - 1n > head ? head : from + chunk - 1n
          let found
          try {
            found = await getLogsWithRetry(client, from, to)
          } catch (e) {
            if (isRangeError(e) && chunk > MIN_CHUNK) {
              chunk = chunk / 2n
              continue
            }
            throw e
          }
          for (const l of found) {
            logs.push({
              eventName: l.eventName ?? 'Unknown',
              args: (l.args ?? {}),
              blockNumber: l.blockNumber ?? 0n,
              logIndex: l.logIndex ?? 0,
              transactionHash: l.transactionHash ?? '0x',
            })
          }
          last = to
          localStorage.setItem(CACHE_KEY, serialize({ last, logs }))
          if (last < head) await sleep(150)
        }
      } catch (e) {
        if (last === cache.last && logs.length === cache.logs.length) throw e
      }
      return logs
    },
  })
}

/** Distinct addresses mentioned by a given event argument, in first-seen order. */
export function addressesFrom(logs: EscrowLog[] | undefined, eventNames: string[], arg: string): Address[] {
  const seen = new Set<string>()
  const out: Address[] = []
  for (const l of logs ?? []) {
    if (!eventNames.includes(l.eventName)) continue
    const a = l.args[arg]
    if (typeof a === 'string' && !seen.has(a.toLowerCase())) {
      seen.add(a.toLowerCase())
      out.push(a as Address)
    }
  }
  return out
}

/* ---------- Transactions ---------- */

export type TxPhase = 'idle' | 'wallet' | 'confirming' | 'done' | 'error'

export function useTx() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const client = usePublicClient({ chainId: CHAIN_ID })
  const qc = useQueryClient()
  const [phase, setPhase] = useState<TxPhase>('idle')
  const [hash, setHash] = useState<Hex>()
  const [error, setError] = useState<string>()

  const run = useCallback(
    async (successText: string, send: (write: typeof writeContractAsync) => Promise<Hex>): Promise<TransactionReceipt | undefined> => {
      setError(undefined)
      setHash(undefined)
      try {
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
        setPhase('wallet')
        const h = await send(writeContractAsync)
        setHash(h)
        setPhase('confirming')
        if (!client) throw new Error('No client')
        const receipt = await client.waitForTransactionReceipt({ hash: h })
        if (receipt.status !== 'success') throw new Error('reverted')
        setPhase('done')
        toast.success(successText)
        await qc.invalidateQueries()
        return receipt
      } catch (e) {
        const msg = describeError(e)
        if (msg) {
          setError(msg)
          setPhase('error')
          toast.error(msg)
        } else {
          setPhase('idle')
        }
        return undefined
      }
    },
    [chainId, client, qc, switchChainAsync, writeContractAsync],
  )

  return { run, phase, hash, error, busy: phase === 'wallet' || phase === 'confirming' }
}

export function useRole(owner?: Address) {
  const { address } = useAccount()
  const base = { address: ESCROW_ADDRESS, abi: escrowAbi, chainId: CHAIN_ID } as const
  const agent = useReadContract({
    ...base,
    functionName: 'getAgent',
    args: address ? [address] : undefined,
    query: { enabled: !!address && IS_CONFIGURED, refetchInterval: POLL },
  })
  return {
    address,
    isOwner: sameAddress(address, owner),
    isAgent: !!agent.data?.allowed,
    agent: agent.data,
  }
}
