export const THEMES = [
  { id: 'grove', label: 'Grove' },
  { id: 'harbor', label: 'Harbor' },
  { id: 'ember', label: 'Ember' },
  { id: 'tide', label: 'Tide' },
  { id: 'plum', label: 'Plum' },
] as const

export const TEXT_SIZES = ['small', 'medium', 'large'] as const
export const DENSITIES = ['comfortable', 'compact', 'tight'] as const

export type ThemeId = (typeof THEMES)[number]['id']
export type TextSize = (typeof TEXT_SIZES)[number]
export type Density = (typeof DENSITIES)[number]
export type Appearance = {
  theme: ThemeId
  mode: 'light' | 'dark'
  text: TextSize
  density: Density
}

const KEY = 'endtoend-appearance'

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'grove',
  mode: 'dark',
  text: 'medium',
  density: 'comfortable',
}

function isTheme(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

function isText(value: unknown): value is TextSize {
  return TEXT_SIZES.some((size) => size === value)
}

function isDensity(value: unknown): value is Density {
  return DENSITIES.some((density) => density === value)
}

function densityFrom(parsed: Partial<Appearance> & { compact?: boolean }): Density {
  if (isDensity(parsed.density)) return parsed.density
  if (parsed.compact === true) return 'compact'
  return DEFAULT_APPEARANCE.density
}

export function readAppearance(): Appearance {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '') as Partial<Appearance>
    return {
      theme: isTheme(parsed.theme) ? parsed.theme : DEFAULT_APPEARANCE.theme,
      mode: parsed.mode === 'light' || parsed.mode === 'dark' ? parsed.mode : DEFAULT_APPEARANCE.mode,
      text: isText(parsed.text) ? parsed.text : DEFAULT_APPEARANCE.text,
      density: densityFrom(parsed),
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement
  root.dataset.app = 'messenger'
  root.dataset.theme = appearance.theme
  root.dataset.mode = appearance.mode
  root.dataset.text = appearance.text
  root.dataset.density = appearance.density
  root.dataset.composer = appearance.density === 'comfortable' ? 'regular' : 'compact'
}

export function writeAppearance(appearance: Appearance) {
  localStorage.setItem(KEY, JSON.stringify(appearance))
  applyAppearance(appearance)
}
