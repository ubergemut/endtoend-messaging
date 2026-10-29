const FILE_LIMIT = 25 * 1024 * 1024

export function fileTooLarge(size: number): boolean {
  return size > FILE_LIMIT
}
