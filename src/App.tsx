import { useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { KeyRound, TriangleAlert } from 'lucide-react'
import { OwnerView } from '@/components/OwnerView'
import { AgentView } from '@/components/AgentView'
import { NetworkSwitcher } from '@/components/NetworkSwitcher'
import { DeployCard } from '@/components/DeployCard'
import { SetupCard } from '@/components/SetupCard'
import { AddressLink, Btn } from '@/components/ui'
import { CHAIN_ID, ESCROW_ADDRESS, IS_CONFIGURED, IS_MAINNET, NETWORK_LABEL } from '@/lib/escrow'
import { useEscrowCore, useRole } from '@/lib/hooks'
import { ACTIVE, clearSavedDeployment } from '@/lib/networks'

type Tab = 'owner' | 'agent'

export default function App() {
  const core = useEscrowCore()
  const role = useRole(core.owner)
  const { chainId, isConnected } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const [picked, setPicked] = useState<Tab>()
  // Until you choose a tab, an allowed agent that is not the owner lands on the agent view.
  const tab: Tab = picked ?? (role.isAgent && !role.isOwner ? 'agent' : 'owner')

  return (
    <div className="mx-auto min-h-dvh max-w-6xl px-4 pb-24 pt-5 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl" style={{ background: 'var(--accent)', color: '#fff' }}>
            <KeyRound className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="display text-2xl font-bold leading-none">Twokey Escrow</h1>
            <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              Agents ask. You countersign. USDC on {NETWORK_LABEL}.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <NetworkSwitcher />
          {IS_CONFIGURED && (
            <div role="tablist" aria-label="View" className="flex gap-1 rounded-2xl p-1" style={{ background: 'var(--surface-muted)' }}>
              <button role="tab" className="tab" aria-selected={tab === 'owner'} onClick={() => setPicked('owner')}>
                Owner
              </button>
              <button role="tab" className="tab" aria-selected={tab === 'agent'} onClick={() => setPicked('agent')}>
                Agent
              </button>
            </div>
          )}
          <ConnectKitButton showBalance={false} />
        </div>
      </header>

      {IS_MAINNET && (
        <div
          className="card mb-5 flex items-start gap-3 p-4 text-sm text-pretty"
          style={{ borderColor: 'rgba(161,92,7,0.4)' }}
          role="note"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warn)' }} aria-hidden />
          <span>
            You are on Arc Mainnet. Payments move real USDC and cannot be undone. Start with cents and double-check every payee address.
          </span>
        </div>
      )}

      {isConnected && chainId !== CHAIN_ID && (
        <div className="card mb-5 flex flex-wrap items-center justify-between gap-3 p-4 text-sm" role="alert">
          <span>Your wallet is on a different network. Switch to {NETWORK_LABEL} to send transactions.</span>
          <Btn small loading={switching} onClick={() => switchChain({ chainId: CHAIN_ID })}>
            Switch to {NETWORK_LABEL}
          </Btn>
        </div>
      )}

      {!IS_CONFIGURED ? (
        <div className="mx-auto grid max-w-xl gap-5">
          <DeployCard />
          <SetupCard />
        </div>
      ) : core.isError ? (
        <div className="card p-6 text-sm" role="alert">
          Could not read the escrow from {NETWORK_LABEL}. Check your connection and reload.
        </div>
      ) : tab === 'owner' ? (
        <OwnerView core={core} isOwner={role.isOwner} />
      ) : (
        <AgentView core={core} />
      )}

      <footer className="mt-10 grid justify-items-center gap-2 text-center text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
        {IS_CONFIGURED && (
          <span className="inline-flex flex-wrap items-center justify-center gap-2">
            Escrow <AddressLink address={ESCROW_ADDRESS} />
            {ACTIVE.fromBrowser && (
              <button
                type="button"
                className="link cursor-pointer border-0 bg-transparent p-0 text-xs"
                onClick={() => {
                  clearSavedDeployment(CHAIN_ID)
                  window.location.reload()
                }}
              >
                Forget this address
              </button>
            )}
          </span>
        )}
        <span>
          {IS_MAINNET
            ? 'Mainnet. Keep amounts to cents until you are sure.'
            : 'Testnet demo. Amounts are meant to be cents. Need test USDC? Use Get test USDC in the Arc Studio sidebar.'}
        </span>
      </footer>
    </div>
  )
}
