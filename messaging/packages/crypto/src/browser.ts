import init, * as wasm from '../pkg-web/e2ee_crypto.js'
import type { SignalExports } from './node.ts'

export type { SignalExports }

let starting: Promise<void> | null = null

export async function loadSignal(): Promise<SignalExports> {
  if (!starting) {
    starting = init().then(() => undefined)
  }
  await starting
  return wasm as SignalExports
}
