import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import * as db from './db'

export const MCP_SERVER_NAME = 'taskqueue'
const DEFAULT_PORT = 47821

export interface McpEndpoint {
  url: string
  token: string
}

let endpoint: McpEndpoint | null = null

export function getMcpEndpoint(): McpEndpoint {
  if (!endpoint) throw new Error('MCP server not started')
  return endpoint
}

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] }
}

function fail(value: string) {
  return { content: [{ type: 'text' as const, text: value }], isError: true }
}

function buildServer(): McpServer {
  const server = new McpServer({ name: 'TaskQueue', version: '0.1.0' })

  server.registerTool(
    'get_task',
    {
      title: 'Get task',
      description:
        'Returns the instructions of a TaskQueue task (title, prompt, project path) and, if the task was resumed after a question, the answer from the user.',
      inputSchema: { code: z.string().describe('Task code, e.g. DK-0001') }
    },
    async ({ code }) => {
      const task = db.getTask(code)
      if (!task) return fail(`Task ${code} not found`)
      const project = db.getProject(task.projectId)
      return text(
        JSON.stringify(
          {
            code: task.code,
            title: task.title,
            status: task.status,
            projectPath: project?.path,
            prompt: task.prompt,
            previousQuestion: task.question,
            answer: task.answer
          },
          null,
          2
        )
      )
    }
  )

  server.registerTool(
    'start_task',
    {
      title: 'Start task',
      description: 'Marks the task as InProgress. Call it right after reading the task, before starting work.',
      inputSchema: { code: z.string() }
    },
    async ({ code }) => {
      const task = db.getTask(code)
      if (!task) return fail(`Task ${code} not found`)
      if (!['Pending', 'InProgress', 'WaitingForInput'].includes(task.status)) {
        return fail(`Task ${code} is ${task.status}; it cannot be started`)
      }
      db.patchTask(code, { status: 'InProgress' })
      db.addEvent(code, 'system', 'Agent started the task')
      return text(`Task ${code} is now InProgress`)
    }
  )

  server.registerTool(
    'ask_user',
    {
      title: 'Ask the user',
      description:
        'Use when you cannot continue without a decision from the user. The task is set to WaitingForInput. After calling this tool, STOP working and end your turn; you will be resumed with the answer.',
      inputSchema: { code: z.string(), question: z.string() }
    },
    async ({ code, question }) => {
      const task = db.getTask(code)
      if (!task) return fail(`Task ${code} not found`)
      db.patchTask(code, { status: 'WaitingForInput', question, answer: null })
      db.addEvent(code, 'system', `Question for the user: ${question}`)
      return text('Question registered. Stop working now and end your turn without further actions.')
    }
  )

  server.registerTool(
    'complete_task',
    {
      title: 'Complete task',
      description:
        'Marks the task as Done and stores a Markdown summary of the work. Do NOT commit; TaskQueue commits the changes with the task code.',
      inputSchema: {
        code: z.string(),
        summary: z.string().describe('Markdown summary of what was done, files touched and how to verify it')
      }
    },
    async ({ code, summary }) => {
      const task = db.getTask(code)
      if (!task) return fail(`Task ${code} not found`)
      db.patchTask(code, { status: 'Done', summary })
      db.addEvent(code, 'system', 'Agent completed the task')
      return text(`Task ${code} marked as Done. You can end your turn now.`)
    }
  )

  return server
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

export async function startMcpServer(): Promise<McpEndpoint> {
  const token = randomBytes(24).toString('hex')

  // Stateless mode: a fresh server + transport per request.
  const http = createServer(async (req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end()
      return
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end()
      return
    }
    try {
      const body = await readJson(req)
      const server = buildServer()
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      res.on('close', () => {
        transport.close()
        server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (err) {
      console.error('[mcp] request failed', err)
      if (!res.headersSent) res.writeHead(500).end()
    }
  })

  let port: number
  try {
    port = await listen(http, DEFAULT_PORT)
  } catch {
    port = await listen(http, 0)
  }

  endpoint = { url: `http://127.0.0.1:${port}/mcp`, token }
  console.log(`[mcp] listening on ${endpoint.url}`)
  return endpoint
}
