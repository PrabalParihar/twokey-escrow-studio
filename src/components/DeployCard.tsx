import { useState } from 'react'
import { useAccount, useDeployContract, usePublicClient, useSwitchChain } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { encodeAbiParameters, encodeDeployData, parseAbiParameters, zeroAddress, type Address, type Hash } from 'viem'
import { Check, Copy, Loader2 } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { toast } from 'sonner'
import { AddressLink, Btn, Card, FieldBlock } from './ui'
import {
  CHAIN_ID,
  HOLD_OPTIONS,
  IS_MAINNET,
  NETWORK_LABEL,
  USDC_ADDRESS,
  describeError,
  escrowConstructorAbi,
  parseAddressInput,
  short,
  txUrl,
} from '@/lib/escrow'
import { ESCROW_BUILD, ESCROW_CREATION_BYTECODE, ESCROW_CREATION_BYTECODE_HASH } from '@/lib/escrowArtifact'
import { saveDeployment } from '@/lib/networks'
import { DeploymentCheckError, checkDeployment, type CheckedDeployment } from '@/lib/verifyEscrow'
import { Amount, gasTokenDecimalsFor, gasTokenToUsdc } from '@/onchain-money'

type Phase = 'idle' | 'wallet' | 'confirming' | 'checking'

const pendingKey = `twokey:pending-deploy:${CHAIN_ID}`

interface Pending {
  hash: Hash
  owner: Address
  hold: string
}

function readPending(): Pending | undefined {
  try {
    const raw = localStorage.getItem(pendingKey)
    if (raw) return JSON.parse(raw) as Pending
  } catch {
    /* ignore */
  }
  return undefined
}

export function DeployCard() {
  const { address, chainId } = useAccount()
  const client = usePublicClient({ chainId: CHAIN_ID })
  const { switchChainAsync } = useSwitchChain()
  const { deployContractAsync } = useDeployContract()

  const [ownerText, setOwnerText] = useState<string>()
  const [hold, setHold] = useState(604800)
  const [ack, setAck] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string>()
  const [txHash, setTxHash] = useState<Hash>()
  const [done, setDone] = useState<CheckedDeployment & { hash: Hash }>()
  const [pending, setPending] = useState<Pending | undefined>(readPending)
  const [copied, setCopied] = useState(false)

  const ownerValue = ownerText ?? address ?? ''
  const owner = ownerValue.trim() ? parseAddressInput(ownerValue) : undefined
  const ownerOk = !!owner && owner !== zeroAddress
  const args = ownerOk ? ([owner, USDC_ADDRESS, BigInt(hold)] as const) : undefined
  const busy = phase !== 'idle'

  const estimate = useQuery({
    queryKey: ['twokey-deploy-estimate', CHAIN_ID, address, owner, hold],
    enabled: !!client && !!address && !!args,
    refetchInterval: 15000,
    queryFn: async () => {
      if (!client || !address || !args) throw new Error('not ready')
      const data = encodeDeployData({ abi: escrowConstructorAbi, bytecode: ESCROW_CREATION_BYTECODE, args })
      const gas = await client.estimateGas({ account: address, data })
      let price: bigint
      try {
        price = (await client.estimateFeesPerGas()).maxFeePerGas
      } catch {
        price = await client.getGasPrice()
      }
      const decimals = gasTokenDecimalsFor(CHAIN_ID)
      const cost = gasTokenToUsdc(CHAIN_ID, Amount.fromRaw(gas * price, decimals))
      const balance = gasTokenToUsdc(CHAIN_ID, Amount.fromRaw(await client.getBalance({ address }), decimals))
      return { gas, price, cost, balance }
    },
  })

  const encodedArgs = args
    ? encodeAbiParameters(parseAbiParameters('address initialOwner, address usdc_, uint64 maxHoldDuration_'), args)
    : undefined

  const finalize = async (hash: Hash, expectedOwner?: Address, expectedHold?: bigint) => {
    if (!client) throw new Error('No client')
    setTxHash(hash)
    setPhase('confirming')
    const receipt = await client.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new DeploymentCheckError('The deployment transaction did not succeed. Nothing was deployed.')
    }
    setPhase('checking')
    const result = await checkDeployment(client, receipt.contractAddress, hash, {
      requireDirectCreate: true,
      expectedOwner,
      expectedMaxHold: expectedHold,
    })
    saveDeployment(CHAIN_ID, result.escrow, result.deployBlock)
    localStorage.removeItem(pendingKey)
    setPending(undefined)
    setDone({ ...result, hash })
    toast.success('Escrow deployed and checked')
  }

  const fail = (e: unknown) => {
    const message = e instanceof DeploymentCheckError ? e.message : describeError(e)
    if (message) {
      setError(message)
      toast.error(message)
    }
  }

  const deploy = async () => {
    if (!args || !owner) return
    setError(undefined)
    try {
      if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
      setPhase('wallet')
      const hash = await deployContractAsync({ abi: escrowConstructorAbi, bytecode: ESCROW_CREATION_BYTECODE, args, chainId: CHAIN_ID })
      const record: Pending = { hash, owner, hold: String(hold) }
      localStorage.setItem(pendingKey, JSON.stringify(record))
      setPending(record)
      await finalize(hash, owner, BigInt(hold))
    } catch (e) {
      fail(e)
    } finally {
      setPhase('idle')
    }
  }

  const resume = async () => {
    if (!pending) return
    setError(undefined)
    try {
      await finalize(pending.hash, pending.owner, BigInt(pending.hold))
    } catch (e) {
      fail(e)
    } finally {
      setPhase('idle')
    }
  }

  const copyArgs = async () => {
    if (!encodedArgs) return
    await navigator.clipboard.writeText(encodedArgs.slice(2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (done) {
    return (
      <Card title="Escrow deployed" subtitle={`Checked on ${NETWORK_LABEL} and saved in this browser.`}>
        <dl className="grid gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: 'var(--muted)' }}>Contract</dt>
            <dd className="mono break-all text-right text-[13px]">{done.escrow}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: 'var(--muted)' }}>Owner</dt>
            <dd>
              <AddressLink address={done.owner} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: 'var(--muted)' }}>Deploy transaction</dt>
            <dd className="mono break-all text-right text-[13px]">
              <a className="link" href={txUrl(done.hash)} target="_blank" rel="noopener noreferrer">
                {done.hash}
              </a>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt style={{ color: 'var(--muted)' }}>Block</dt>
            <dd className="mono tabular-nums">{done.deployBlock.toString()}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-pretty" style={{ color: 'var(--muted)' }}>
          Keep the contract address, transaction hash and block. They go in src/deployments.ts to make this permanent for every visitor, and the
          address is what you verify on the explorer (see DEPLOY_MAINNET.md, step 7).
        </p>
        <Btn className="mt-4 w-full" onClick={() => window.location.reload()}>
          Open the escrow
        </Btn>
      </Card>
    )
  }

  const insufficient = estimate.data && estimate.data.balance.lt(estimate.data.cost)

  return (
    <Card
      title="Deploy TwokeyEscrow"
      subtitle={`Deploys the exact compiled contract from your connected wallet on ${NETWORK_LABEL}. Nothing is sent until you confirm in your wallet.`}
    >
      {!address ? (
        <ConnectKitButton />
      ) : (
        <div className="grid gap-4">
          <FieldBlock label="Owner (constructor argument 1)" hint="Defaults to your connected wallet. The owner can approve, withdraw and pause, and is the only one who can.">
            <input className="field mono" value={ownerValue} onChange={(e) => setOwnerText(e.target.value)} aria-invalid={!ownerOk || undefined} disabled={busy} />
          </FieldBlock>
          {owner && owner !== address && (
            <p className="text-sm text-pretty" style={{ color: 'var(--warn)' }} role="status">
              This owner is not the wallet you are connected with. You will not be able to manage the escrow from this wallet.
            </p>
          )}
          {ownerValue.trim() && !ownerOk && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              Enter a valid, non-zero address.
            </p>
          )}
          <FieldBlock label="Maximum hold (constructor argument 3)" hint="The longest an agent can ask a request to wait for you. You can change it later.">
            <select className="field" value={hold} onChange={(e) => setHold(Number(e.target.value))} disabled={busy}>
              {HOLD_OPTIONS.map((h) => (
                <option key={h.s} value={h.s}>
                  {h.label}
                </option>
              ))}
            </select>
          </FieldBlock>

          <div className="inner grid gap-2 p-4 text-sm">
            <div className="label">Constructor arguments</div>
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: 'var(--muted)' }}>initialOwner</span>
              <span className="mono text-[13px]">{owner ? short(owner) : '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: 'var(--muted)' }}>usdc_ (Arc USDC, fixed)</span>
              <AddressLink address={USDC_ADDRESS} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: 'var(--muted)' }}>maxHoldDuration_</span>
              <span className="mono tabular-nums text-[13px]">{hold} s</span>
            </div>
            <details className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              <summary className="cursor-pointer">Build details and encoded arguments</summary>
              <div className="mt-2 grid gap-1.5">
                <div>
                  Compiler {ESCROW_BUILD.solc}, EVM {ESCROW_BUILD.evmVersion}, optimizer {ESCROW_BUILD.optimizerRuns} runs
                </div>
                <div className="mono break-all">Creation bytecode keccak: {ESCROW_CREATION_BYTECODE_HASH}</div>
                {encodedArgs && (
                  <>
                    <div className="mono break-all">{encodedArgs.slice(2)}</div>
                    <button type="button" className="link inline-flex w-fit cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs" onClick={() => void copyArgs()}>
                      {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
                      {copied ? 'Copied' : 'Copy encoded arguments (for explorer verification)'}
                    </button>
                  </>
                )}
              </div>
            </details>
          </div>

          <div className="inner grid gap-1 p-4 text-sm" aria-live="polite">
            <div className="label">Estimated network fee</div>
            {!args ? (
              <span style={{ color: 'var(--muted)' }}>Enter a valid owner to estimate.</span>
            ) : estimate.isLoading ? (
              <span className="inline-flex items-center gap-2" style={{ color: 'var(--muted)' }}>
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Estimating…
              </span>
            ) : estimate.data ? (
              <>
                <span className="display text-xl font-bold tabular-nums">up to {estimate.data.cost.toFixed(4)} USDC</span>
                <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                  {estimate.data.gas.toString()} gas at up to {(Number(estimate.data.price) / 1e9).toFixed(2)} gwei. Your wallet holds about{' '}
                  {estimate.data.balance.toFixed(4)} USDC for fees.
                </span>
                {insufficient && (
                  <span style={{ color: 'var(--danger)' }}>Your wallet may not have enough USDC to cover this fee.</span>
                )}
              </>
            ) : (
              <span style={{ color: 'var(--warn)' }}>Could not estimate the fee. Your wallet will show its own estimate.</span>
            )}
          </div>

          {IS_MAINNET && (
            <label className="flex items-start gap-2 text-sm text-pretty">
              <input type="checkbox" className="mt-1 size-4" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} />
              <span>I checked the owner address above. This deploys on Arc Mainnet with real USDC for fees and cannot be undone.</span>
            </label>
          )}

          <Btn disabled={!ownerOk || (IS_MAINNET && !ack) || !!insufficient} loading={busy} onClick={deploy}>
            {phase === 'wallet'
              ? 'Confirm in your wallet…'
              : phase === 'confirming'
                ? 'Waiting for the transaction…'
                : phase === 'checking'
                  ? 'Checking the deployed contract…'
                  : `Deploy to ${NETWORK_LABEL}`}
          </Btn>
          {txHash && busy && (
            <a className="link text-sm" href={txUrl(txHash)} target="_blank" rel="noopener noreferrer">
              View transaction {short(txHash)}
            </a>
          )}
        </div>
      )}

      {pending && !busy && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm" style={{ borderColor: 'var(--border)' }}>
          <span className="text-pretty" style={{ color: 'var(--muted)' }}>
            A deploy transaction {short(pending.hash)} was sent from this browser and not finished.
          </span>
          <Btn small variant="ghost" onClick={resume}>
            Finish checking it
          </Btn>
        </div>
      )}
      {error && (
        <p className="mt-3 text-sm text-pretty" style={{ color: 'var(--danger)' }} role="alert">
          {error}
        </p>
      )}
    </Card>
  )
}
