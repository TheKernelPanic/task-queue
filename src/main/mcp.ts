import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { commitMessage, reasoningLevelsFor, type Task } from '@shared/types'
import { detectAgents } from './agents'
import * as db from './db'
import { answersDir, listFiles, outputsDir, resourcesDir, workspaceDir } from './storage'

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

/** Procedures of a task with full instructions: the frozen copy if queued, else the current version. */
function taskProcedures(task: Task) {
  return task.procedures.map((code) => {
    const frozen = task.procedureSnapshots.find((p) => p.code === code)
    const source = frozen ?? db.getProcedure(code)
    return { code, title: source?.title, prompt: source?.prompt }
  })
}

/**
 * Done tasks this task builds on (linked dependencies and blocking tasks):
 * what was asked, what was done and where the result lives.
 */
function taskDependencies(task: Task) {
  return [...new Set([...task.dependencies, ...task.blockedBy])].map((code) => {
    const dep = db.getTask(code)
    return {
      code,
      title: dep?.title,
      prompt: dep?.prompt,
      summary: dep?.summary,
      commit: dep?.commitHash ? { hash: dep.commitHash, message: commitMessage(dep) } : null,
      outputs: listFiles(outputsDir(code)).map((f) => f.path)
    }
  })
}

/**
 * Everything create_task accepts for a new task in the project of `parent`: agents with their
 * models and reasoning levels, the project's procedures and the tasks that can be linked.
 */
async function taskCreationOptions(parent: Task) {
  const project = db.getProject(parent.projectId)
  const agents = await detectAgents()
  const tasks = db.listTasks(parent.projectId).filter((t) => t.status !== 'Cancelled')
  return {
    project: { name: project?.name, path: project?.path, isGitRepo: project?.isGitRepo ?? false },
    defaults: {
      agent: parent.agent,
      model: null,
      reasoning_effort: null,
      commit: project?.isGitRepo ?? false
    },
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      installed: a.installed,
      defaultModel: a.defaultModel ?? null,
      defaultReasoningEffort: a.defaultReasoning ?? null,
      models: a.models.map((m) => ({
        id: m.id,
        label: m.label,
        ...(m.reasoningLevels && {
          reasoningEfforts: m.reasoningLevels.map((l) => l.effort),
          defaultReasoningEffort: m.defaultReasoning ?? null
        })
      }))
    })),
    procedures: db
      .listProcedures()
      .filter((p) => p.projectIds.includes(parent.projectId))
      .map((p) => ({ code: p.code, title: p.title })),
    tasks: tasks.map((t) => ({
      code: t.code,
      title: t.title,
      status: t.status,
      canBeDependency: t.status === 'Done',
      canBlock: true
    })),
    notes: [
      'model: omit it to use the agent default; any id from agents[].models is valid, and for Claude also a full model id.',
      'reasoning_effort: Codex only; one of the reasoningEfforts of the chosen model (or of defaultModel if no model is set).',
      'dependencies: only tasks with canBeDependency (Done). blocked_by: any listed task; Cancelled tasks are not listed.',
      'commit: only possible if project.isGitRepo.'
    ]
  }
}

function buildServer(): McpServer {
  const server = new McpServer({ name: 'TaskQueue', version: '0.1.0' })

  server.registerTool(
    'get_task',
    {
      title: 'Get task',
      description:
        'Returns the instructions of a TaskQueue task: title, prompt, project path, the procedures to follow (with their full instructions), the previously completed tasks it depends on (their prompt, summary, commit and output files, as context), absolute paths of the resource files attached to the task, the output directory for deliverable files that do not belong to the project, the working directory for any other work outside the project (backups, scratch files, temporary clones…) and, if the task was resumed after a question, the answer from the user and any files attached to answers.',
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
            procedures: taskProcedures(task),
            dependencies: taskDependencies(task),
            resources: listFiles(resourcesDir(task.code)).map((f) => f.path),
            outputDir: outputsDir(task.code, true),
            workspaceDir: workspaceDir(task.code, true),
            previousQuestion: task.question,
            answer: task.answer,
            commit:
              task.commit && project?.isGitRepo
                ? { required: true, message: commitMessage(task) }
                : { required: false, note: 'Do not commit your changes' },
            answerFiles: listFiles(answersDir(task.code)).map((f) => f.path)
          },
          null,
          2
        )
      )
    }
  )

  server.registerTool(
    'get_procedure',
    {
      title: 'Get procedure',
      description:
        'Returns a reusable TaskQueue procedure (title and Markdown instructions) by its code, e.g. PR-0001. Pass task_code to get the version frozen into that task when it was queued, which is the one to follow.',
      inputSchema: {
        code: z.string().describe('Procedure code, e.g. PR-0001'),
        task_code: z.string().optional().describe('Task code, to get the version frozen into the task')
      }
    },
    async ({ code, task_code }) => {
      const task = task_code ? db.getTask(task_code) : null
      const frozen = task?.procedureSnapshots.find((p) => p.code === code)
      if (frozen) {
        return text(JSON.stringify({ code, title: frozen.title, prompt: frozen.prompt }, null, 2))
      }
      const procedure = db.getProcedure(code)
      if (!procedure) return fail(`Procedure ${code} not found`)
      return text(
        JSON.stringify({ code: procedure.code, title: procedure.title, prompt: procedure.prompt }, null, 2)
      )
    }
  )

  server.registerTool(
    'create_procedure',
    {
      title: 'Create procedure',
      description: [
        'Creates a new reusable TaskQueue procedure in the project of the given task and returns it (code, title, prompt, projectIds).',
        'A procedure is a block of instructions that the user can later link to other tasks of the same project; agents running those tasks receive it in get_task and must follow it.',
        'Use it only when the task asks you to create a procedure, or when you have worked out a repeatable process (release steps, a review checklist, how to run a migration…) that future tasks should follow. Do not use it to store notes, summaries or results of the current task; those go in complete_task or outputDir.',
        'Write the prompt as standalone Markdown addressed to a future agent who has no context of this task: state the goal, the steps in order, the commands to run, the files or absolute paths involved and how to verify the result.',
        'The procedure is NOT linked to the current task (its procedures are frozen once queued) and the user can edit or delete it afterwards. Each call creates a new procedure with a new code (PR-0001, …), so do not call it twice for the same procedure; use get_procedure to read an existing one.'
      ].join('\n'),
      inputSchema: {
        task_code: z
          .string()
          .describe('Code of the task you are executing, e.g. DK-0001. The procedure is created in its project and the creation is logged in its history.'),
        title: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .describe('Short, descriptive title shown in the procedure library, e.g. "Publish a release"'),
        prompt: z
          .string()
          .trim()
          .min(1)
          .describe('Full Markdown instructions of the procedure, self-contained and addressed to the agent that will follow it')
      }
    },
    async ({ task_code, title, prompt }) => {
      const task = db.getTask(task_code)
      if (!task) return fail(`Task ${task_code} not found`)
      let procedure
      try {
        procedure = db.createProcedure({ title, prompt, projectIds: [task.projectId] })
      } catch (err) {
        return fail(`Could not create the procedure: ${err instanceof Error ? err.message : String(err)}`)
      }
      db.addEvent(task_code, 'system', `Agent created procedure ${procedure.code}: ${procedure.title}`)
      return text(
        JSON.stringify(
          {
            code: procedure.code,
            title: procedure.title,
            prompt: procedure.prompt,
            projectIds: procedure.projectIds
          },
          null,
          2
        )
      )
    }
  )

  server.registerTool(
    'get_task_creation_options',
    {
      title: 'Get task creation options',
      description: [
        'Returns every value create_task accepts for a new task in the project of the given task: whether the project is a git repository, the defaults that apply when a field is omitted, the agents (installed or not) with their models and the reasoning efforts each model supports, the procedures of the project, and the tasks of the project that can be linked (code, title, status and whether each one can be a dependency or a blocker).',
        'ALWAYS call it before create_task and use only codes and values it returns; never guess task codes, procedure codes, model ids or reasoning efforts.'
      ].join('\n'),
      inputSchema: {
        task_code: z.string().describe('Code of the task you are executing, e.g. DK-0001')
      }
    },
    async ({ task_code }) => {
      const parent = db.getTask(task_code)
      if (!parent) return fail(`Task ${task_code} not found`)
      return text(JSON.stringify(await taskCreationOptions(parent), null, 2))
    }
  )

  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description: [
        'Creates a new TaskQueue task in the project of the task you are executing and returns it (code, title, status…).',
        'The new task is always created in status Created: it is a draft that does NOT run. Only the user can review it, edit it and queue it; you cannot start or queue it, and you must not wait for it.',
        'Use it only when the task asks you to plan or split work into tasks, or when you find follow-up work that is clearly out of the scope of your task and the user should decide on. Do not use it to delegate part of your own task; do that work yourself.',
        'Write the prompt as standalone Markdown addressed to a future agent who has no context of this task: the goal, relevant files or absolute paths, constraints and how to verify the result.',
        'Call get_task_creation_options first: it lists the agents, models, reasoning efforts, procedures and tasks you can use. Optional links must belong to the same project: procedures, dependencies (tasks already Done, given as context) and blocked_by (tasks that must be Done before it runs).',
        'Invalid values (an agent that is not installed, an unsupported reasoning effort, unknown or unlinkable codes…) are rejected with the reason and nothing is created; fix them and call again.',
        'Each call creates a new task with a new code, so do not call it twice for the same work. Mention the codes of the tasks you created in your complete_task summary.'
      ].join('\n'),
      inputSchema: {
        task_code: z
          .string()
          .describe('Code of the task you are executing, e.g. DK-0001. The new task is created in its project and the creation is logged in its history.'),
        title: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .describe('Short, descriptive title, e.g. "Add pagination to the users list"'),
        prompt: z
          .string()
          .trim()
          .min(1)
          .describe('Full Markdown instructions of the task, self-contained and addressed to the agent that will execute it'),
        agent: z
          .enum(['claude', 'codex'])
          .optional()
          .describe('Agent that will execute it. Defaults to the agent of the current task.'),
        model: z
          .string()
          .trim()
          .optional()
          .describe("Model for the agent. Omit it to use the agent's default; only set it if the task asks for a specific model."),
        reasoning_effort: z
          .string()
          .trim()
          .optional()
          .describe('Codex only: reasoning effort, e.g. low, medium, high. Omit it to use the default.'),
        commit: z
          .boolean()
          .optional()
          .describe('Whether the agent must commit its changes. Defaults to true; ignored if the project is not a git repository.'),
        procedures: z
          .array(z.string())
          .optional()
          .describe('Codes of procedures of the project to follow, in order, e.g. ["PR-0001"]'),
        dependencies: z
          .array(z.string())
          .optional()
          .describe('Codes of Done tasks of the project whose prompt, summary, commit and outputs are given as context'),
        blocked_by: z
          .array(z.string())
          .optional()
          .describe('Codes of tasks of the project (not Cancelled) that must be Done before the new task runs')
      }
    },
    async (input) => {
      const parent = db.getTask(input.task_code)
      if (!parent) return fail(`Task ${input.task_code} not found`)
      const project = db.getProject(parent.projectId)
      if (!project) return fail(`Project of task ${input.task_code} not found`)
      const agent = input.agent ?? parent.agent
      const model = input.model || null
      const effort = input.reasoning_effort || null
      const info = (await detectAgents()).find((a) => a.id === agent)
      const errors: string[] = []
      const warnings: string[] = []
      if (!info?.installed) errors.push(`Agent ${agent} is not installed`)
      if (effort) {
        const levels = reasoningLevelsFor(info, model).map((l) => l.effort)
        if (agent !== 'codex') errors.push('reasoning_effort is only supported by codex')
        else if (levels.length > 0 && !levels.includes(effort)) {
          errors.push(
            `Reasoning effort "${effort}" is not supported by ${model ?? 'the default model'}; use one of: ${levels.join(', ')}`
          )
        }
      }
      if (model && info && !info.models.some((m) => m.id === model)) {
        warnings.push(`Model "${model}" is not among the known models of ${agent}; it is passed to the agent as is`)
      }
      if (input.commit && !project.isGitRepo) {
        warnings.push('The project is not a git repository; commit was set to false')
      }
      if (errors.length > 0) {
        return fail(`Task not created:\n- ${errors.join('\n- ')}\nCall get_task_creation_options to see the valid values.`)
      }
      let task
      try {
        task = db.createTask({
          projectId: parent.projectId,
          title: input.title,
          prompt: input.prompt,
          agent,
          model,
          reasoningEffort: effort,
          commit: project.isGitRepo && (input.commit ?? true),
          procedures: input.procedures ?? [],
          dependencies: input.dependencies ?? [],
          blockedBy: input.blocked_by ?? []
        })
      } catch (err) {
        return fail(
          `Task not created: ${err instanceof Error ? err.message : String(err)}\nCall get_task_creation_options to see the valid values.`
        )
      }
      db.addEvent(input.task_code, 'system', `Agent created task ${task.code}: ${task.title}`)
      return text(
        JSON.stringify(
          {
            code: task.code,
            title: task.title,
            status: task.status,
            agent: task.agent,
            model: task.model,
            reasoningEffort: task.reasoningEffort,
            commit: task.commit,
            procedures: task.procedures,
            dependencies: task.dependencies,
            blockedBy: task.blockedBy,
            warnings,
            note: 'The task is in status Created; the user will review and queue it.'
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
        'Marks the task as Done and stores a Markdown summary of the work. If get_task says commit.required, commit your changes with commit.message BEFORE calling this.',
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
