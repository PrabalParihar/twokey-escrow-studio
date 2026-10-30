import { addressesFrom, useEscrowLogs, useRequests } from '@/lib/hooks'
import type { useEscrowCore } from '@/lib/hooks'
import { ActivityList, Inbox } from './Inbox'
import { OwnerSummary } from './OwnerSummary'
import { AgentsCard } from './AgentsCard'
import { PayeesCard } from './PayeesCard'
import { SettingsCard } from './SettingsCard'

type Core = ReturnType<typeof useEscrowCore>

export function OwnerView({ core, isOwner }: { core: Core; isOwner: boolean }) {
  const { requests } = useRequests(core.nextId)
  const logs = useEscrowLogs()
  const agents = addressesFrom(logs.data, ['AgentSet'], 'agent')
  const payees = addressesFrom(logs.data, ['PayeeSet', 'PayeeRemoved'], 'payee')

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-5 lg:self-start">
        <OwnerSummary balance={core.balance} paused={core.paused} owner={core.owner} isOwner={isOwner} />
      </div>
      <div className="space-y-5">
        <Inbox requests={requests} isOwner={isOwner} balance={core.balance} />
        {logs.isError && (
          <p className="text-sm" style={{ color: 'var(--warn)' }} role="status">
            Could not load the agent and payee lists from the chain yet. Retrying.
          </p>
        )}
        <AgentsCard agents={agents} isOwner={isOwner} />
        <PayeesCard payees={payees} isOwner={isOwner} />
        <ActivityList requests={requests} />
        <SettingsCard maxHold={core.maxHold} isOwner={isOwner} pendingOwner={core.pendingOwner} />
      </div>
    </div>
  )
}
