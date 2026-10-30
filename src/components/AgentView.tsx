import { useMemo, useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { parseEventLogs } from 'viem'
import { CheckCircle2, Hourglass } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { AmountField } from './AmountField'
import { AddressLink, Btn, Card, Empty, FieldBlock, StatusBadge, TxNote } from './ui'
import {
  CHAIN_ID,
  ESCROW_ADDRESS,
  MAX_PENDING_PER_AGENT,
  REASONS,
  escrowAbi,
  fmt,
  formatDuration,
  memoToRef,
  parseAddressInput,
  parseUsdcInput,
  sameAddress,
  type EscrowRequest,
} from '@/lib/escrow'
import { useChainTime, useNow, useRequests, useRole, useTx } from '@/lib/hooks'
import type { useEscrowCore } from '@/lib/hooks'

type Core = ReturnType<typeof useEscrowCore>

const EXPIRIES = [
  { label: '1 hour', s: 3600 },
  { label: '1 day', s: 86400 },
  { label: '3 days', s: 259200 },
  { label: '7 days', s: 604800 },
]

interface Outcome {
  paid: boolean
  id?: bigint
  amount: bigint
}

function StatusCard({ core }: { core: Core }) {
  const role = useRole(core.owner)
  const headroom = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    chainId: CHAIN_ID,
    functionName: 'autoHeadroom',
    args: role.address ? [role.address] : undefined,
    query: { enabled: !!role.address, refetchInterval: 8000 },
  })
  if (!role.address) {
    return (
      <Card title="Agent console" subtitle="Connect the wallet your agent signs with to request payments.">
        <ConnectKitButton />
      </Card>
    )
  }
  const a = role.agent
  return (
    <Card title="Your agent wallet">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <AddressLink address={role.address} you />
        <span className="chip" style={a?.allowed ? { background: 'rgba(26,128,71,0.12)', color: 'var(--success)' } : undefined}>
          {a?.allowed ? 'Allowed agent' : 'Not an allowed agent'}
        </span>
      </div>
      {a?.allowed ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="inner p-3">
            <div className="label">Auto-pay left</div>
            <div className="display mt-1 text-xl font-bold tabular-nums">{fmt(headroom.data ?? 0n)}</div>
            <div className="text-xs" style={{ color: 'var(--subtle)' }}>of {fmt(a.dailyCap)} per 24h</div>
          </div>
          <div className="inner p-3">
            <div className="label">Held</div>
            <div className="display mt-1 text-xl font-bold tabular-nums">
              {a.pending}/{MAX_PENDING_PER_AGENT}
            </div>
            <div className="text-xs" style={{ color: 'var(--subtle)' }}>awaiting owner</div>
          </div>
          <div className="inner p-3">
            <div className="label">Escrow</div>
            <div className="display mt-1 text-xl font-bold tabular-nums">{core.balance === undefined ? '…' : fmt(core.balance)}</div>
            <div className="text-xs" style={{ color: 'var(--subtle)' }}>USDC available</div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          Ask the owner to add this wallet as an agent. Until then you can browse, but requests will be refused.
        </p>
      )}
    </Card>
  )
}

function RequestForm({ core, isAgent }: { core: Core; isAgent: boolean }) {
  const { address } = useAccount()
  const chainNow = useChainTime()
  const [payee, setPayee] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [dur, setDur] = useState(86400)
  const [outcome, setOutcome] = useState<Outcome>()
  const tx = useTx()

  const payeeAddr = parseAddressInput(payee)
  const raw = parseUsdcInput(amount)
  const options = EXPIRIES.filter((e) => core.maxHold === undefined || e.s <= core.maxHold)
  const safeDur = options.some((o) => o.s === dur) ? dur : (options[options.length - 1]?.s ?? 3600)

  const preview = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    chainId: CHAIN_ID,
    functionName: 'previewAutoPay',
    args: address && payeeAddr && raw !== undefined ? [address, payeeAddr, raw] : undefined,
    query: { enabled: !!address && !!payeeAddr && raw !== undefined, refetchInterval: 8000 },
  })
  const auto = preview.data?.[0]
  const reason = preview.data?.[1]
  const blocked = reason !== undefined && reason >= 1 && reason <= 4
  const ready = isAgent && !!payeeAddr && raw !== undefined && chainNow !== undefined && !blocked && !core.paused

  const submit = async () => {
    if (!payeeAddr || raw === undefined || chainNow === undefined) return
    setOutcome(undefined)
    const receipt = await tx.run(auto ? 'Payment sent' : 'Request sent to the owner', (w) =>
      w({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: 'requestPayment',
        args: [payeeAddr, raw, BigInt(chainNow + safeDur), memoToRef(memo)],
        chainId: CHAIN_ID,
      }),
    )
    if (!receipt) return
    const requested = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: 'PaymentRequested' }).find((l) =>
      sameAddress(l.address, ESCROW_ADDRESS),
    )
    const released = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: 'PaymentReleased' }).find((l) =>
      sameAddress(l.address, ESCROW_ADDRESS),
    )
    setOutcome({ paid: !!released, id: requested?.args.id, amount: raw })
    setAmount('')
  }

  return (
    <Card title="Request a payment" subtitle="Within your auto limit to a pinned payee, it pays at once. Anything else waits for the owner.">
      <div className="grid gap-4">
        <FieldBlock label="Payee">
          <input className="field mono" placeholder="0x…" value={payee} onChange={(e) => setPayee(e.target.value)} />
        </FieldBlock>
        <AmountField label="Amount" value={amount} onChange={setAmount} />
        <FieldBlock label="Memo (optional)" hint="Only a fingerprint of this text goes onchain, so the owner can check an invoice or task description against it.">
          <input className="field" placeholder="Invoice #1042, API credits" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </FieldBlock>
        <FieldBlock label="Hold for at most" hint="If the owner has not approved by then, the request expires.">
          <select className="field" value={safeDur} onChange={(e) => setDur(Number(e.target.value))}>
            {options.map((o) => (
              <option key={o.s} value={o.s}>
                {o.label}
              </option>
            ))}
          </select>
        </FieldBlock>

        {preview.data && (
          <div
            className="inner flex items-start gap-2 p-3 text-sm"
            style={{ color: auto ? 'var(--success)' : blocked ? 'var(--danger)' : 'var(--warn)' }}
            role="status"
          >
            {auto ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <span>{REASONS[reason ?? 0] ?? 'Will be held for the owner'}</span>
          </div>
        )}

        <Btn disabled={!ready} loading={tx.busy} onClick={submit}>
          {!address ? 'Connect a wallet' : !isAgent ? 'Not an allowed agent' : core.paused ? 'Escrow is paused' : auto ? 'Pay now' : 'Request owner approval'}
        </Btn>
        <TxNote phase={tx.phase} hash={tx.hash} error={tx.error} />
        {outcome && (
          <div className="inner p-3 text-sm" style={{ color: outcome.paid ? 'var(--success)' : 'var(--warn)' }}>
            {outcome.paid
              ? `Paid ${fmt(outcome.amount)} USDC immediately.`
              : `Request #${outcome.id?.toString() ?? ''} for ${fmt(outcome.amount)} USDC is waiting for the owner.`}
          </div>
        )}
      </div>
    </Card>
  )
}

function MyRequests({ requests, address }: { requests: EscrowRequest[]; address?: `0x${string}` }) {
  const now = useNow(10000)
  const tx = useTx()
  const mine = useMemo(() => requests.filter((r) => sameAddress(r.agent, address)).slice(0, 15), [requests, address])
  return (
    <Card title="Your requests" subtitle="Newest first.">
      {mine.length === 0 ? (
        <Empty>{address ? 'You have not made any requests yet.' : 'Connect your agent wallet to see its requests.'}</Empty>
      ) : (
        <ul className="space-y-2">
          {mine.map((r) => {
            const live = r.status === 'Pending'
            const expired = live && BigInt(now) > r.expiry
            return (
              <li key={r.id.toString()} className="inner flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="text-sm">
                  <span className="display font-bold tabular-nums">{fmt(r.amount)}</span> USDC to <AddressLink address={r.payee} />
                  <div className="text-xs" style={{ color: 'var(--subtle)' }}>
                    #{r.id.toString()}
                    {live && ` · ${expired ? 'expired' : `expires in ${formatDuration(Number(r.expiry) - now)}`}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={expired ? 'Expired' : r.status} />
                  {live && (
                    <Btn
                      small
                      variant="ghost"
                      loading={tx.busy}
                      onClick={() =>
                        tx.run('Request cancelled', (w) =>
                          w({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'cancel', args: [r.id], chainId: CHAIN_ID }),
                        )
                      }
                    >
                      Cancel
                    </Btn>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <TxNote phase={tx.phase} hash={tx.hash} error={tx.error} />
    </Card>
  )
}

export function AgentView({ core }: { core: Core }) {
  const role = useRole(core.owner)
  const { requests } = useRequests(core.nextId, 100)
  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <StatusCard core={core} />
      <RequestForm core={core} isAgent={role.isAgent} />
      <MyRequests requests={requests} address={role.address} />
    </div>
  )
}
