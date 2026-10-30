import { useState } from 'react'
import { useAccount } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { AddressLink, Btn, Card, FieldBlock, TxNote } from './ui'
import { CHAIN_ID, ESCROW_ADDRESS, HOLD_OPTIONS, escrowAbi, formatDuration, parseAddressInput, sameAddress } from '@/lib/escrow'
import { useTx } from '@/lib/hooks'

export function SettingsCard({ maxHold, isOwner, pendingOwner }: { maxHold?: number; isOwner: boolean; pendingOwner?: Address }) {
  const { address } = useAccount()
  const [hold, setHold] = useState<number | undefined>()
  const [next, setNext] = useState('')
  const holdTx = useTx()
  const ownTx = useTx()
  const selected = hold ?? maxHold ?? 604800
  const nextOwner = parseAddressInput(next)
  const hasPending = !!pendingOwner && pendingOwner !== zeroAddress
  const canAccept = hasPending && sameAddress(address, pendingOwner)

  return (
    <Card title="Settings" subtitle="The longest an agent can ask the escrow to hold a request, and who owns it.">
      <FieldBlock label="Maximum hold" hint={maxHold ? `Currently ${formatDuration(maxHold)}. Applies to new requests only.` : undefined}>
        <div className="flex gap-2">
          <select className="field" value={selected} onChange={(e) => setHold(Number(e.target.value))}>
            {HOLD_OPTIONS.map((h) => (
              <option key={h.s} value={h.s}>
                {h.label}
              </option>
            ))}
            {!HOLD_OPTIONS.some((h) => h.s === maxHold) && maxHold !== undefined && <option value={maxHold}>{formatDuration(maxHold)}</option>}
          </select>
          <Btn
            variant="ghost"
            disabled={!isOwner || selected === maxHold}
            loading={holdTx.busy}
            onClick={() =>
              holdTx.run('Maximum hold updated', (w) =>
                w({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'setMaxHoldDuration', args: [BigInt(selected)], chainId: CHAIN_ID }),
              )
            }
          >
            Save
          </Btn>
        </div>
      </FieldBlock>
      <TxNote phase={holdTx.phase} hash={holdTx.hash} error={holdTx.error} />

      <div className="mt-5 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
        <FieldBlock label="Transfer ownership" hint="Two steps: the new owner must accept from their own wallet. Ownership cannot be renounced.">
          <div className="flex gap-2">
            <input className="field mono" placeholder="New owner 0x…" value={next} onChange={(e) => setNext(e.target.value)} />
            <Btn
              variant="ghost"
              disabled={!isOwner || !nextOwner}
              loading={ownTx.busy}
              onClick={async () => {
                if (!nextOwner) return
                const r = await ownTx.run('Transfer started. The new owner must accept.', (w) =>
                  w({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'transferOwnership', args: [nextOwner], chainId: CHAIN_ID }),
                )
                if (r) setNext('')
              }}
            >
              Start
            </Btn>
          </div>
        </FieldBlock>
        {hasPending && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span style={{ color: 'var(--muted)' }}>
              Pending owner <AddressLink address={pendingOwner} you={canAccept} />
            </span>
            {canAccept && (
              <Btn
                small
                loading={ownTx.busy}
                onClick={() =>
                  ownTx.run('You are now the owner', (w) =>
                    w({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'acceptOwnership', chainId: CHAIN_ID }),
                  )
                }
              >
                Accept ownership
              </Btn>
            )}
          </div>
        )}
        <TxNote phase={ownTx.phase} hash={ownTx.hash} error={ownTx.error} />
      </div>
    </Card>
  )
}
