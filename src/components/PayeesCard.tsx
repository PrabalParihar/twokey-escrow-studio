import { useState } from 'react'
import type { Address } from 'viem'
import { useReadContracts } from 'wagmi'
import { AmountField } from './AmountField'
import { AddressLink, Btn, Card, Empty, FieldBlock, TxNote } from './ui'
import { CHAIN_ID, ESCROW_ADDRESS, escrowAbi, fmt, parseAddressInput, parseUsdcInput } from '@/lib/escrow'
import { useTx } from '@/lib/hooks'

export function PayeesCard({ payees, isOwner }: { payees: Address[]; isOwner: boolean }) {
  const [addr, setAddr] = useState('')
  const [cap, setCap] = useState('')
  const tx = useTx()

  const q = useReadContracts({
    allowFailure: false,
    contracts: payees.map((p) => ({ address: ESCROW_ADDRESS, abi: escrowAbi, chainId: CHAIN_ID, functionName: 'getPayee' as const, args: [p] as const })),
    query: { enabled: payees.length > 0, refetchInterval: 8000 },
  })

  const pinned = payees
    .map((p, i) => ({ p, cfg: q.data?.[i] }))
    .filter((x) => x.cfg?.pinned)

  const parsedAddr = parseAddressInput(addr)
  const parsedCap = parseUsdcInput(cap)

  return (
    <Card
      title="Pinned payees"
      subtitle="Payments to these addresses go out at once when they are within the per-payment cap. Everyone else waits for you."
    >
      {pinned.length === 0 ? (
        <Empty>{q.isLoading ? 'Loading…' : 'No pinned payees. Every request will wait for your approval.'}</Empty>
      ) : (
        <ul className="space-y-2">
          {pinned.map(({ p, cfg }) => (
            <li key={p} className="inner flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="text-sm">
                <AddressLink address={p} />
                <div className="mt-1 text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                  Up to {fmt(cfg?.perPaymentCap ?? 0n)} USDC per payment
                </div>
              </div>
              <div className="flex gap-2">
                <Btn
                  small
                  variant="ghost"
                  onClick={() => {
                    setAddr(p)
                    setCap(fmt(cfg?.perPaymentCap ?? 0n))
                  }}
                >
                  Edit
                </Btn>
                <Btn
                  small
                  variant="danger"
                  disabled={!isOwner}
                  loading={tx.busy}
                  onClick={() =>
                    tx.run('Payee unpinned', (w) =>
                      w({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'removePayee', args: [p], chainId: CHAIN_ID }),
                    )
                  }
                >
                  Unpin
                </Btn>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 grid gap-4 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
        <FieldBlock label="Payee address">
          <input className="field mono" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} />
        </FieldBlock>
        <AmountField label="Per-payment cap" value={cap} onChange={setCap} chips={['0.05', '0.25', '1.00']} />
        <Btn
          disabled={!isOwner || !parsedAddr || parsedCap === undefined}
          loading={tx.busy}
          onClick={async () => {
            if (!parsedAddr || parsedCap === undefined) return
            const r = await tx.run('Payee pinned', (w) =>
              w({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'setPayee', args: [parsedAddr, parsedCap], chainId: CHAIN_ID }),
            )
            if (r) {
              setAddr('')
              setCap('')
            }
          }}
        >
          Pin payee
        </Btn>
        <TxNote phase={tx.phase} hash={tx.hash} error={tx.error} />
      </div>
    </Card>
  )
}
