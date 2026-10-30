import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Check, ExternalLink, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { addressUrl, short, txUrl, type StatusName } from '@/lib/escrow'
import type { TxPhase } from '@/lib/hooks'

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={clsx('card p-5 sm:p-6', className)}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="display text-lg font-bold text-balance">{title}</h2>}
            {subtitle && (
              <p className="mt-0.5 max-w-[60ch] text-sm text-pretty" style={{ color: 'var(--muted)' }}>
                {subtitle}
              </p>
            )}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  variant?: 'primary' | 'ghost' | 'danger'
  small?: boolean
  loading?: boolean
  /** May be async: the transaction hook reports its own progress and errors. */
  onClick?: () => unknown
}

export function Btn({ variant = 'primary', small, loading, className, children, disabled, onClick, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      onClick={() => {
        void onClick?.()
      }}
      disabled={disabled || loading}
      className={clsx('btn', `btn-${variant}`, small && 'btn-sm', className)}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function FieldBlock({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs text-pretty" style={{ color: 'var(--muted)' }}>
          {hint}
        </span>
      )}
    </label>
  )
}

export function AddressLink({ address, you }: { address: string; you?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <a className="link mono text-[13px]" href={addressUrl(address)} target="_blank" rel="noopener noreferrer" title={address}>
        {short(address)}
      </a>
      {you && <span className="chip">You</span>}
    </span>
  )
}

const STATUS_STYLE: Record<StatusName, { bg: string; fg: string; label: string }> = {
  None: { bg: 'var(--surface-muted)', fg: 'var(--muted)', label: 'Unknown' },
  Pending: { bg: 'rgba(161,92,7,0.12)', fg: 'var(--warn)', label: 'Held' },
  Paid: { bg: 'rgba(26,128,71,0.12)', fg: 'var(--success)', label: 'Auto-paid' },
  Approved: { bg: 'rgba(26,128,71,0.12)', fg: 'var(--success)', label: 'Approved' },
  Rejected: { bg: 'rgba(186,43,76,0.1)', fg: 'var(--danger)', label: 'Rejected' },
  Cancelled: { bg: 'var(--surface-muted)', fg: 'var(--muted)', label: 'Cancelled' },
  Expired: { bg: 'var(--surface-muted)', fg: 'var(--muted)', label: 'Expired' },
}

export function StatusBadge({ status }: { status: StatusName }) {
  const s = STATUS_STYLE[status]
  return (
    <span className="chip" style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  )
}

/** Honest transaction feedback: only states the wallet and chain have actually reported. */
export function TxNote({ phase, hash, error }: { phase: TxPhase; hash?: `0x${string}`; error?: string }) {
  if (phase === 'idle') return null
  return (
    <div className="mt-3 text-sm" role="status" aria-live="polite">
      {phase === 'wallet' && <span style={{ color: 'var(--muted)' }}>Confirm in your wallet…</span>}
      {phase === 'confirming' && (
        <span className="inline-flex items-center gap-2" style={{ color: 'var(--muted)' }}>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Confirming onchain…
        </span>
      )}
      {phase === 'done' && hash && (
        <span className="inline-flex items-center gap-2" style={{ color: 'var(--success)' }}>
          <Check className="size-4" aria-hidden /> Confirmed
          <a className="link inline-flex items-center gap-1" href={txUrl(hash)} target="_blank" rel="noopener noreferrer">
            View transaction <ExternalLink className="size-3" aria-hidden />
          </a>
        </span>
      )}
      {phase === 'error' && <span style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="inner px-4 py-6 text-center text-sm text-pretty" style={{ color: 'var(--muted)' }}>
      {children}
    </div>
  )
}
