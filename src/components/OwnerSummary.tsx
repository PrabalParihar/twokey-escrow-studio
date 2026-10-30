import { useState } from 'react'
import { useAccount } from 'wagmi'
import { erc20Abi, type Address } from 'viem'
import { ExternalLink, PauseCircle, PlayCircle, ShieldCheck } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { AmountField } from './AmountField'
import { AddressLink, Btn, Card, TxNote } from './ui'
import { CHAIN_ID, ESCROW_ADDRESS, USDC_ADDRESS, addressUrl, escrowAbi, fmt, parseAddressInput, parseUsdcInput } from '@/lib/escrow'
import { useTx, useUsdcBalance } from '@/lib/hooks'

interface Props {
  balance?: bigint
  paused?: boolean
  owner?: Address
  isOwner: boolean
}

export function OwnerSummary({ balance, paused, owner, isOwner }: Props) {
  const { address } = useAccount()
  const walletUsdc = useUsdcBalance(address)
  const [fund, setFund] = useState('')
  const [out, setOut] = useState('')
  const [to, setTo] = useState('')
  const fundTx = useTx()
  const outTx = useTx()
  const pauseTx = useTx()

  const fundRaw = parseUsdcInput(fund)
  const outRaw = parseUsdcInput(out)
  const dest = to.trim() ? parseAddressInput(to) : address
  const overBalance = outRaw !== undefined && balance !== undefined && outRaw > balance
  const overWallet = fundRaw !== undefined && walletUsdc !== undefined && fundRaw > walletUsdc

  return (
    <div className="space-y-5">
      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="label">Held in escrow</span>
          <span className="chip" style={paused ? { background: 'rgba(186,43,76,0.1)', color: 'var(--danger)' } : undefined}>
            {paused ? <PauseCircle className="size-3.5" aria-hidden /> : <ShieldCheck className="size-3.5" aria-hidden />}
            {paused ? 'Paused' : 'Active'}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <TokenUSDC variant="branded" size={28} className="self-center" />
          <span className="display text-5xl font-bold tabular-nums">{balance === undefined ? '…' : fmt(balance)}</span>
          <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>
            USDC
          </span>
        </div>
        <dl className="mt-4 grid gap-2 text-sm">
          <div className="flex items-center justify-between">
            <dt style={{ color: 'var(--muted)' }}>Owner</dt>
            <dd>{owner ? <AddressLink address={owner} you={isOwner} /> : '…'}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt style={{ color: 'var(--muted)' }}>Contract</dt>
            <dd className="inline-flex items-center gap-1.5">
              <AddressLink address={ESCROW_ADDRESS} />
              <a href={addressUrl(ESCROW_ADDRESS)} target="_blank" rel="noopener noreferrer" aria-label="Open contract in explorer">
                <ExternalLink className="size-3.5" style={{ color: 'var(--subtle)' }} />
              </a>
            </dd>
          </div>
        </dl>
        <div className="mt-4">
          <Btn
            variant={paused ? 'primary' : 'danger'}
            small
            disabled={!isOwner}
            loading={pauseTx.busy}
            onClick={() =>
              pauseTx.run(paused ? 'Escrow resumed' : 'Escrow paused', (w) =>
                w({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: paused ? 'unpause' : 'pause', chainId: CHAIN_ID }),
              )
            }
          >
            {paused ? <PlayCircle className="size-4" aria-hidden /> : <PauseCircle className="size-4" aria-hidden />}
            {paused ? 'Resume payments' : 'Emergency pause'}
          </Btn>
          <p className="mt-2 text-xs text-pretty" style={{ color: 'var(--muted)' }}>
            Pausing blocks new requests, auto-pays and approvals. Withdrawals and rejections keep working.
          </p>
          <TxNote phase={pauseTx.phase} hash={pauseTx.hash} error={pauseTx.error} />
        </div>
        {!isOwner && (
          <p className="mt-4 text-xs text-pretty" style={{ color: 'var(--muted)' }}>
            Connect the owner wallet to manage this escrow. You are viewing it read-only.
          </p>
        )}
      </Card>

      <Card title="Add funds" subtitle="Send USDC from your wallet into the escrow.">
        <AmountField label="Amount" value={fund} onChange={setFund} invalid={overWallet} hint={walletUsdc !== undefined ? `Wallet balance ${fmt(walletUsdc)} USDC` : undefined} />
        <Btn
          className="mt-4 w-full"
          disabled={!address || fundRaw === undefined || overWallet}
          loading={fundTx.busy}
          onClick={async () => {
            if (fundRaw === undefined) return
            const r = await fundTx.run('Funds added to escrow', (w) =>
              w({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'transfer', args: [ESCROW_ADDRESS, fundRaw], chainId: CHAIN_ID }),
            )
            if (r) setFund('')
          }}
        >
          {overWallet ? 'More than your wallet balance' : 'Add USDC to escrow'}
        </Btn>
        <TxNote phase={fundTx.phase} hash={fundTx.hash} error={fundTx.error} />
      </Card>

      <Card title="Withdraw" subtitle="Owner only. Works even while paused.">
        <div className="space-y-4">
          <AmountField label="Amount" value={out} onChange={setOut} invalid={overBalance} />
          <label className="block">
            <span className="label mb-1.5 block">Send to</span>
            <input className="field mono" placeholder={address ?? '0x…'} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <Btn
          className="mt-4 w-full"
          variant="ghost"
          disabled={!isOwner || outRaw === undefined || overBalance || !dest}
          loading={outTx.busy}
          onClick={async () => {
            if (outRaw === undefined || !dest) return
            const r = await outTx.run('Withdrawal sent', (w) =>
              w({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'withdraw', args: [dest, outRaw], chainId: CHAIN_ID }),
            )
            if (r) setOut('')
          }}
        >
          {overBalance ? 'More than the escrow holds' : 'Withdraw'}
        </Btn>
        <TxNote phase={outTx.phase} hash={outTx.hash} error={outTx.error} />
      </Card>
    </div>
  )
}
