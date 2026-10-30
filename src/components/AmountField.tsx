import { FieldBlock } from './ui'

/** USDC amount input that only accepts digits and one decimal point. */
export function AmountField({
  label,
  value,
  onChange,
  chips = ['0.01', '0.05', '0.25'],
  hint,
  invalid,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  chips?: string[]
  hint?: string
  invalid?: boolean
}) {
  return (
    <div>
      <FieldBlock label={label} hint={hint}>
        <div className="relative">
          <input
            className="field tabular-nums pr-16"
            inputMode="decimal"
            placeholder="0.00"
            value={value}
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, '')
              if (v === '' || /^\d*\.?\d{0,6}$/.test(v)) onChange(v)
            }}
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
            USDC
          </span>
        </div>
      </FieldBlock>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button key={c} type="button" className="chip cursor-pointer border-0 tabular-nums" onClick={() => onChange(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
