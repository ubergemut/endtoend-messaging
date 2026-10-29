import { DENSITIES, TEXT_SIZES, THEMES, type Appearance, type Density } from './appearance.ts'

const DENSITY_LABELS: Record<Density, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
  tight: 'Tight',
}

export function AppearanceBar({ value, onChange }: { value: Appearance; onChange: (next: Appearance) => void }) {
  const textIndex = TEXT_SIZES.indexOf(value.text)
  return (
    <div className="appearance" role="toolbar" aria-label="Appearance">
      <div className="swatches" role="group" aria-label="Theme">
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className="swatch"
            data-swatch={theme.id}
            aria-label={theme.label}
            title={theme.label}
            aria-pressed={value.theme === theme.id}
            onClick={() => onChange({ ...value, theme: theme.id })}
          />
        ))}
      </div>
      <div className="mode" role="group" aria-label="Color mode">
        <button
          type="button"
          aria-label="Dark"
          title="Dark"
          aria-pressed={value.mode === 'dark'}
          onClick={() => onChange({ ...value, mode: 'dark' })}
        >
          <Moon />
        </button>
        <button
          type="button"
          aria-label="Light"
          title="Light"
          aria-pressed={value.mode === 'light'}
          onClick={() => onChange({ ...value, mode: 'light' })}
        >
          <Sun />
        </button>
      </div>
      <div className="text-size" role="group" aria-label="Text size">
        <button
          type="button"
          className="down"
          aria-label="Smaller text"
          title="Smaller text"
          disabled={textIndex <= 0}
          onClick={() => onChange({ ...value, text: TEXT_SIZES[textIndex - 1] })}
        >
          A
        </button>
        <button
          type="button"
          className="up"
          aria-label="Larger text"
          title="Larger text"
          disabled={textIndex >= TEXT_SIZES.length - 1}
          onClick={() => onChange({ ...value, text: TEXT_SIZES[textIndex + 1] })}
        >
          A
        </button>
      </div>
      <select
        className="density"
        aria-label="Message layout"
        title="Message layout"
        value={value.density}
        onChange={(event) => onChange({ ...value, density: event.target.value as Density })}
      >
        {DENSITIES.map((density) => (
          <option key={density} value={density}>
            {DENSITY_LABELS[density]}
          </option>
        ))}
      </select>
    </div>
  )
}

function Moon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path fill="currentColor" d="M8.4 1.5a5.8 5.8 0 1 0 5.7 7.6A4.7 4.7 0 1 1 8.4 1.5z" />
    </svg>
  )
}

function Sun() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        d="M8 1.7v1.5M8 12.8v1.5M1.7 8h1.5M12.8 8h1.5M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"
      />
    </svg>
  )
}
