import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  GraphQLBoolean,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  graphql,
  type GraphQLOutputType,
} from 'graphql'
import type { HeadlessClient } from './client.ts'
import { operations, readInput, type Field, type Operation } from './catalog.ts'
import { HeadlessError } from './types.ts'
import { checkLocalRequest, localGate, localHost, readLocalBody } from './localAccess.ts'
import {adapterDisclosure,serveAdapterMetadata,type DisclosureOptions} from './sourceInfo.ts'

const JsonType = new GraphQLScalarType({
  name: 'JSON',
  description: 'Operation result. The shape matches the direct client method.',
  serialize: (value) => value,
  parseValue: (value) => value,
})

const schema = new GraphQLSchema({
  query: root('Query', 'query'),
  mutation: root('Mutation', 'mutation'),
})

export function executeGraph(client: HeadlessClient, source: string, variableValues?: Record<string, unknown>) {
  return graphql({ schema, source, contextValue: client, variableValues })
}

export async function startGraphql(client: HeadlessClient, options: DisclosureOptions & { port?: number; host?: string; gate?: string } = {}) {
  const host = localHost(options.host)
  const gate = localGate(options.gate)
  const {disclosure,metadata}=await adapterDisclosure(options)
  const server = createServer(async (req, res) => {
    try {
      if(disclosure?.serve(req,res)||serveAdapterMetadata(req,res,metadata))return
      const address = server.address()
      if (!checkLocalRequest(req, res, gate, typeof address === 'object' && address ? address.port : 0, true)) return
      if (req.method === 'GET' && new URL(req.url ?? '/', 'http://localhost').pathname === '/health') {
        send(res, 200, { ok: true })
        return
      }
      if (req.method !== 'POST') {
        send(res, 405, { errors: [{ message: 'POST a GraphQL query to this URL' }] })
        return
      }
      const body = await readLocalBody(req) as { query?: string; variables?: Record<string, unknown> }
      if (!body.query) throw new HeadlessError('query is required', 'invalid')
      send(res, 200, await executeGraph(client, body.query, body.variables))
    } catch (reason) {
      send(res, 400, { errors: [{ message: (reason as Error).message }] })
    }
  })
  return new Promise<{ url: string; gate: string; capability: string; close: () => Promise<void> }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : options.port
      resolve({
        url: `http://${host}:${port}`,
        gate,
        capability: gate,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

function root(name: string, kind: Operation['kind']) {
  const fields: Record<string, unknown> = {}
  for (const operation of operations.filter((item) => item.kind === kind)) {
    fields[operation.name] = {
      type: JsonType as GraphQLOutputType,
      description: operation.summary,
      args: Object.fromEntries(operation.fields.map((field) => [field.name, { type: argType(field), description: field.description }])),
      resolve: async (_source: unknown, args: Record<string, unknown>, client: HeadlessClient) => operation.run(client, readInput(operation, args)),
    }
  }
  return new GraphQLObjectType({ name, fields: fields as never })
}

function argType(field: Field) {
  const base =
    field.kind === 'int' ? GraphQLInt : field.kind === 'boolean' ? GraphQLBoolean : field.kind === 'stringList' ? new GraphQLList(new GraphQLNonNull(GraphQLString)) : GraphQLString
  return field.required ? new GraphQLNonNull(base) : base
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
