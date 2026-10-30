import { ACTIVE, NETWORK_META, selectNetwork, type NetworkKey } from '@/lib/networks'

const KEYS: NetworkKey[] = ['testnet', 'mainnet']

export function NetworkSwitcher() {
  return (
    <div role="group" aria-label="Network" className="flex gap-1 rounded-2xl p-1" style={{ background: 'var(--surface-muted)' }}>
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className="tab"
          aria-pressed={ACTIVE.key === k}
          onClick={() => ACTIVE.key !== k && selectNetwork(k)}
        >
          {NETWORK_META[k].isMainnet ? 'Mainnet' : 'Testnet'}
        </button>
      ))}
    </div>
  )
}
