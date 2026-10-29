import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { migrateDatabase } from './migrations.ts'

export type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
  exec(text: string): Promise<void>
  transaction<T>(run: (connection: Pick<Sql, 'query' | 'exec'>) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export async function openDatabase(databaseUrl?: string, dataDir?: string): Promise<Sql> {
  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl })
    try {
      const client = await pool.connect()
      try {
        await migrateDatabase({
          async query<T>(text: string, params?: unknown[]) {
            return (await client.query(text, params)).rows as T[]
          },
          async exec(text) { await client.query(text) },
        }, { postgres: true })
      } finally {
        client.release()
      }
    } catch (error) {
      await pool.end().catch(() => undefined)
      throw error
    }
    return {
      async query<T>(text: string, params?: unknown[]) {
        return (await pool.query(text, params)).rows as T[]
      },
      async exec(text) {
        await pool.query(text)
      },
      async transaction<T>(run: (connection: Pick<Sql, 'query' | 'exec'>) => Promise<T>) {
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const result = await run({
            async query<T>(text: string, params?: unknown[]) { return (await client.query(text, params)).rows as T[] },
            async exec(text) { await client.query(text) },
          })
          await client.query('COMMIT')
          return result
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined)
          throw error
        } finally { client.release() }
      },
      async close() {
        await pool.end()
      },
    }
  }

  const db = new PGlite(dataDir)
  const connection = {
    async query<T>(text: string, params?: unknown[]) {
      return (await db.query<T>(text, params)).rows
    },
    async exec(text: string) {
      await db.exec(text)
    },
  }
  try {
    await db.waitReady
    await migrateDatabase(connection)
  } catch (error) {
    await db.close().catch(() => undefined)
    throw error
  }
  // All normal queries wait outside an active transaction. Otherwise unrelated
  // requests could accidentally join PGlite's single-connection transaction.
  let tail: Promise<unknown> = Promise.resolve()
  function serialized<T>(run: () => Promise<T>): Promise<T> {
    const result = tail.then(run)
    tail = result.catch(() => undefined)
    return result
  }
  return {
    query<T>(text: string, params?: unknown[]) { return serialized(() => connection.query<T>(text, params)) },
    exec(text) { return serialized(() => connection.exec(text)) },
    transaction<T>(run: (connection: Pick<Sql, 'query' | 'exec'>) => Promise<T>) {
      return serialized(async () => {
        await connection.exec('BEGIN')
        try {
          const result = await run(connection)
          await connection.exec('COMMIT')
          return result
        } catch (error) {
          await connection.exec('ROLLBACK').catch(() => undefined)
          throw error
        }
      })
    },
    async close() { await tail; await db.close() },
  }
}

export { SCHEMA, CURRENT_SCHEMA_VERSION, readDatabaseSchemaVersion, UnsupportedDatabaseVersionError } from './migrations.ts'
