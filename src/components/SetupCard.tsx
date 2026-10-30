import { useState } from 'react'
import { usePublicClient } from 'wagmi'
import { isHash, type Address } from 'viem'
import { AddressLink, Btn, Card, FieldBlock } from './ui'
import { CHAIN_ID, NETWORK_LABEL, parseAddressInput } from '@/lib/escrow'
import { DeploymentCheckError, checkDeployment } from '@/lib/verifyEscrow'
import { saveDeployment } from '@/lib/networks'

interface Checked {
  escrow: Address
  owner: Address
  deployBlock: bigint
}

/**
 * Shown when no escrow is configured for the selected network.
 * It checks the pasted address against the chain before saving it in this browser.
 */
export function SetupCard() {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const [addr, setAddr] = useState('')
  const [txHash, setTxHash] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [checked, setChecked] = useState<Checked>()

  const check = async () => {
    setError(undefined)
    setChecked(undefined)
    const escrow = parseAddressInput(addr)
    const hash = txHash.trim()
    if (!escrow) return setError('That is not a valid contract address.')
    if (!isHash(hash)) return setError('Paste the deploy transaction hash (0x followed by 64 hex characters).')
    if (!client) return setError(`Could not reach ${NETWORK_LABEL}.`)
    setBusy(true)
    try {
      const result = await checkDeployment(client, escrow, hash)
      setChecked({ escrow, owner: result.owner, deployBlock: result.deployBlock })
    } catch (e) {
      setError(e instanceof DeploymentCheckError ? e.message : 'Could not verify that address. Check the network and the transaction hash, then try again.')
    } finally {
      setBusy(false)
    }
  }

  const use = () => {
    if (!checked) return
    saveDeployment(CHAIN_ID, checked.escrow, checked.deployBlock)
    window.location.reload()
  }

  return (
    <div className="mx-auto max-w-xl">
      <Card
        title="Already deployed? Paste it"
        subtitle={`Deployed from the command line or another tool? Paste the contract address and the deploy transaction hash for ${NETWORK_LABEL}.`}
      >
        <div className="grid gap-4">
          <FieldBlock label="Escrow contract address">
            <input className="field mono" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} />
          </FieldBlock>
          <FieldBlock label="Deploy transaction hash" hint="Used to find the block to start reading history from, and to confirm the contract was deployed by that transaction.">
            <input className="field mono" placeholder="0x…" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
          </FieldBlock>
          <Btn variant={checked ? 'ghost' : 'primary'} loading={busy} disabled={!addr.trim() || !txHash.trim()} onClick={check}>
            Check on {NETWORK_LABEL}
          </Btn>
          {error && (
            <p className="text-sm" style={{ color: 'var(--danger)' }} role="alert">
              {error}
            </p>
          )}
          {checked && (
            <div className="inner grid gap-2 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--muted)' }}>Contract</span>
                <AddressLink address={checked.escrow} />
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--muted)' }}>Owner</span>
                <AddressLink address={checked.owner} />
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--muted)' }}>Deployed in block</span>
                <span className="mono tabular-nums">{checked.deployBlock.toString()}</span>
              </div>
              <p className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>
                Check that the owner is the wallet you expect before continuing. It is saved in this browser only. To make it permanent for everyone, set it in
                src/deployments.ts.
              </p>
              <Btn onClick={use}>Use this escrow</Btn>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
