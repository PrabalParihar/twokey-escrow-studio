import { useState } from 'react'
import type { Address } from 'viem'
import { useReadContracts } from 'wagmi'
import { AmountField } from './AmountField'
import { AddressLink, Btn, Card, Empty, FieldBlock, TxNote } from './ui'
import { CHAIN_ID, ESCROW_ADDRESS, MAX_PENDING_PER_AGENT, escrowAbi, fmt, parseAddressInput, parseUsdcInput } from '@/lib/escrow'
import { useTx } from '@/lib/hooks'

export function AgentsCard({ agents, isOwner }: { agents: Address[]; isOwner: boolean }) {
  const [addr, setAddr] = useState('')
  const [cap, setCap] = useState('')
  const tx = useTx()
  const base = { address: ESCROW_ADDRESS, abi: escrowAbi, chainId: CHAIN_ID } as const

  const q = useReadContracts({
    allowFailure: false,
    contracts: agents.flatMap((a) => [
      { ...base, functionName: 'getAgent' as const, args: [a] as const },
      { ...base, functionName: 'autoHeadroom' as const, args: [a] as const },
    ]),
    query: { enabled: agents.length > 0, refetchInterval: 8000 },
  })

  const rows = agents.map((a, i) => {
    const cfg = q.data?.[i * 2] as { allowed: boolean; dailyCap: bigint; pending: number } | undefined
    const headroom = q.data?.[i * 2 + 1] as bigint | undefined
    return { a, cfg, headroom }
  })

  const parsedAddr = parseAddressInput(addr)
  const parsedCap = cap.trim() === '0' ? 0n : parseUsdcInput(cap)

  const save = async (agent: Address, allowed: boolean, dailyCap: bigint, msg: string) => {
    const r = await tx.run(msg, (w) =>
      w({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'setAgent', args: [agent, allowed, dailyCap], chainId: CHAIN_ID }),
    )
    if (r) {
      setAddr('')
      setCap('')
    }
  }

  return (
    <Card title="Agents" subtitle="Wallets allowed to request payments. The daily cap limits what each one can auto-pay in any rolling 24 hours.">
      {rows.length === 0 ? (
        <Empty>No agents yet. Add the wallet your AI agent signs with.</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ a, cfg, headroom }) => (
            <li key={a} className="inner flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="text-sm">
                <div className="flex items-center gap-2">
                  <AddressLink address={a} />
                  <span
                    className="chip"
                    style={cfg?.allowed ? { background: 'rgba(26,128,71,0.12)', color: 'var(--success)' } : undefined}
                  >
                    {cfg === undefined ? '…' : cfg.allowed ? 'Allowed' : 'Disabled'}
                  </span>
                </div>
                {cfg && (
                  <div className="mt-1 text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                    Daily cap {fmt(cfg.dailyCap)} · headroom {fmt(headroom ?? 0n)} · held {cfg.pending}/{MAX_PENDING_PER_AGENT}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Btn
                  small
                  variant="ghost"
                  disabled={!cfg}
                  onClick={() => {
                    setAddr(a)
                    setCap(cfg ? fmt(cfg.dailyCap) : '')
                  }}
                >
                  Edit
                </Btn>
                {cfg?.allowed && (
                  <Btn small variant="danger" disabled={!isOwner} loading={tx.busy} onClick={() => save(a, false, cfg.dailyCap, 'Agent disabled')}>
                    Disable
                  </Btn>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 grid gap-4 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
        <FieldBlock label="Agent wallet">
          <input className="field mono" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} />
        </FieldBlock>
        <AmountField label="Rolling 24h auto-pay cap" value={cap} onChange={setCap} chips={['0.25', '1.00', '5.00']} hint="Use 0 to let the agent request but never auto-pay." />
        <Btn
          disabled={!isOwner || !parsedAddr || parsedCap === undefined}
          loading={tx.busy}
          onClick={() => parsedAddr && parsedCap !== undefined && save(parsedAddr, true, parsedCap, 'Agent saved')}
        >
          Save agent
        </Btn>
        <TxNote phase={tx.phase} hash={tx.hash} error={tx.error} />
      </div>
    </Card>
  )
}
