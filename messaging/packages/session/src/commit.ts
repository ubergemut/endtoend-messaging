export type CommitTransaction = {
  oncomplete: ((event: Event) => void) | null
  onabort: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  error: { message?: string } | null
}

export function waitForCommit(transaction: {
  oncomplete: unknown
  onabort: unknown
  onerror: unknown
  error: { message?: string } | null
}): Promise<void> {
  const target = transaction as CommitTransaction
  return new Promise((resolve, reject) => {
    target.oncomplete = () => resolve()
    target.onabort = () => reject(new Error(target.error?.message || 'IndexedDB transaction aborted'))
    target.onerror = () => reject(new Error(target.error?.message || 'IndexedDB transaction failed'))
  })
}
