import { useState } from 'react'
import { AlertTriangle, BadgeCheck, Clock } from 'lucide-react'
import { AddressLink, Btn, Card, Empty, StatusBadge, TxNote } from './ui'
import {
  CHAIN_ID,
  ESCROW_ADDRESS,
  computeTermsHash,
  escrowAbi,
  fmt,
  formatDuration,
  memoToRef,
  short,
  type EscrowRequest,
} from '@/lib/escrow'
import { useNow, useTx } from '@/lib/hooks'

const ZERO32 = `0x${'0'.repeat(64)}`

function HeldRow({ r, isOwner, balance, now }: { r: EscrowRequest; isOwner: boolean; balance?: bigint; now: number }) {
  const tx = useTx()
  const [memoText, setMemoText] = useState('')
  const localHash = computeTermsHash(r)
  const verified = localHash.toLowerCase() === r.termsHash.toLowerCase()
  const expired = BigInt(now) > r.expiry
  const left = Number(r.expiry) - now
  const memoMatches = memoText.trim() ? memoToRef(memoText).toLowerCase() === r.memoRef.toLowerCase() : undefined
  const short32 = balance !== undefined && balance < r.amount

  return (
    <li className="inner p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="display text-2xl font-bold tabular-nums">{fmt(r.amount)}</span>
            <span className="text-sm" style={{ color: 'var(--subtle)' }}>
              USDC · request #{r.id.toString()}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" style={{ color: 'var(--muted)' }}>
            <span>
              To <AddressLink address={r.payee} />
            </span>
            <span>
              From agent <AddressLink address={r.agent} />
            </span>
          </div>
        </div>
        <span className="chip" style={{ color: expired ? 'var(--danger)' : 'var(--warn)' }}>
          <Clock className="size-3.5" aria-hidden />
          {expired ? 'Expired' : `Expires in ${formatDuration(left)}`}
        </span>
      </div>

      <div className="mt-3 grid gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
        <div className="flex items-center gap-2">
          {verified ? (
            <BadgeCheck className="size-4 shrink-0" style={{ color: 'var(--success)' }} aria-hidden />
          ) : (
            <AlertTriangle className="size-4 shrink-0" style={{ color: 'var(--danger)' }} aria-hidden />
          )}
          <span className="text-pretty">
            {verified
              ? 'Terms hash recomputed from the details above matches the contract.'
              : 'Terms hash does not match the contract. Do not approve.'}{' '}
            <span className="mono">{short(r.termsHash)}</span>
          </span>
        </div>
        <div className="mono break-all">
          Memo ref: {r.memoRef === ZERO32 ? 'none' : r.memoRef}
        </div>
        {r.memoRef !== ZERO32 && (
          <div>
            <input
              className="field mt-1 !min-h-9 text-xs"
              placeholder="Paste the invoice or task text to check it against the memo ref"
              value={memoText}
              onChange={(e) => setMemoText(e.target.value)}
            />
            {memoMatches !== undefined && (
              <span className="mt-1 block font-semibold" style={{ color: memoMatches ? 'var(--success)' : 'var(--danger)' }}>
                {memoMatches ? 'Text matches the memo ref' : 'Text does not match the memo ref'}
              </span>
            )}
          </div>
        )}
        {short32 && <span style={{ color: 'var(--warn)' }}>The escrow holds less than this amount. Add funds before approving.</span>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {expired ? (
          <Btn
            small
            variant="ghost"
            loading={tx.busy}
            onClick={() =>
              tx.run('Request marked expired', (w) =>
                w({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'expire', args: [r.id], chainId: CHAIN_ID }),
              )
            }
          >
            Mark expired
          </Btn>
        ) : (
          <Btn
            small
            disabled={!isOwner || !verified || short32}
            loading={tx.busy}
            onClick={() =>
              tx.run('Payment approved and sent', (w) =>
                w({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'approve', args: [r.id, localHash], chainId: CHAIN_ID }),
              )
            }
          >
            Approve and pay
          </Btn>
        )}
        <Btn
          small
          variant="danger"
          disabled={!isOwner}
          loading={tx.busy}
          onClick={() =>
            tx.run('Request rejected', (w) =>
              w({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'reject', args: [r.id], chainId: CHAIN_ID }),
            )
          }
        >
          Reject
        </Btn>
      </div>
      <TxNote phase={tx.phase} hash={tx.hash} error={tx.error} />
    </li>
  )
}

export function Inbox({ requests, isOwner, balance }: { requests: EscrowRequest[]; isOwner: boolean; balance?: bigint }) {
  const now = useNow(10000)
  const held = requests.filter((r) => r.status === 'Pending').reverse()
  return (
    <Card
      title="Waiting for your countersign"
      subtitle="Approving sends the exact amount to the exact payee shown. The terms hash is recomputed here before you can approve."
      action={held.length > 0 ? <span className="chip">{held.length} held</span> : undefined}
    >
      {held.length === 0 ? (
        <Empty>Nothing is waiting. Requests outside an agent's auto limit will appear here.</Empty>
      ) : (
        <ul className="space-y-3">
          {held.map((r) => (
            <HeldRow key={r.id.toString()} r={r} isOwner={isOwner} balance={balance} now={now} />
          ))}
        </ul>
      )}
    </Card>
  )
}

export function ActivityList({ requests }: { requests: EscrowRequest[] }) {
  const done = requests.filter((r) => r.status !== 'Pending' && r.status !== 'None').slice(0, 12)
  return (
    <Card title="Recent activity" subtitle="Settled requests, newest first.">
      {done.length === 0 ? (
        <Empty>No payments yet.</Empty>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {done.map((r) => (
            <li key={r.id.toString()} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <div className="text-sm">
                <span className="display font-bold tabular-nums">{fmt(r.amount)}</span> USDC to <AddressLink address={r.payee} />
                <div className="text-xs" style={{ color: 'var(--subtle)' }}>
                  #{r.id.toString()} · agent {short(r.agent)}
                </div>
              </div>
              <StatusBadge status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
