import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  isTaskEditable,
  TASK_LOCKED_MESSAGE,
  type NewProject,
  type NewTask,
  type ProcedureInput,
  type Task,
  type TaskFolderKind,
  type TaskStatus,
  type TaskUpdate
} from '@shared/types'
import * as db from './db'
import { detectAgents } from './agents'
import { isGitRepo } from './git'
import { startMcpServer } from './mcp'
import * as storage from './storage'
import * as queue from './queue'
import { backupOnVersionChange } from './backup'
import * as updater from './updater'

const APP_ID = 'com.thekernelpanic.taskqueue'

// Data always lives in %APPDATA%/task-queue, whatever the product name of the build, so dev runs,
// installed builds and updates all share it. TASKQUEUE_DATA_DIR points it elsewhere (separate
// data and its own single-instance lock), e.g. to develop without touching real data.
// Must be set before anything reads userData.
app.setPath('userData', process.env.TASKQUEUE_DATA_DIR ?? join(app.getPath('appData'), 'task-queue'))

let mainWindow: BrowserWindow | null = null

const WORKSPACE_LIST_LIMIT = 2000

function editableTask(code: string): Task {
  const task = db.getTask(code)
  if (!task) throw new Error(`Task ${code} not found`)
  if (!isTaskEditable(task)) throw new Error(TASK_LOCKED_MESSAGE)
  return task
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'TaskQueue',
    icon: join(
      process.env.ELECTRON_RENDERER_URL
        ? join(app.getAppPath(), 'src/renderer/public')
        : join(__dirname, '../renderer'),
      process.platform === 'win32' ? 'icon.ico' : 'icon.png'
    ),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('agents:list', () => detectAgents())

  ipcMain.handle('projects:list', () => db.listProjects())
  ipcMain.handle('projects:create', async (_e, input: NewProject) =>
    db.createProject(input, await isGitRepo(input.path))
  )
  ipcMain.handle('projects:delete', (_e, id: number) => db.deleteProject(id))

  ipcMain.handle('tasks:list', (_e, projectId?: number) => db.listTasks(projectId))
  ipcMain.handle('tasks:get', (_e, code: string) => db.getTask(code))
  ipcMain.handle('tasks:create', (_e, input: NewTask) => db.createTask(input))
  ipcMain.handle('tasks:update', (_e, code: string, patch: TaskUpdate) => {
    editableTask(code)
    return db.patchTask(code, {
      title: patch.title,
      prompt: patch.prompt,
      agent: patch.agent,
      model: patch.model === undefined ? undefined : patch.model?.trim() || null,
      commit: patch.commit,
      procedures: patch.procedures,
      dependencies: patch.dependencies
    })
  })
  ipcMain.handle('tasks:setStatus', (_e, code: string, status: TaskStatus) =>
    queue.setStatus(code, status)
  )
  ipcMain.handle('tasks:delete', (_e, code: string) => queue.deleteTask(code))
  ipcMain.handle('tasks:answer', (_e, code: string, answer: string, paths: string[]) =>
    queue.answerQuestion(code, answer, paths)
  )
  ipcMain.handle('procedures:list', () => db.listProcedures())
  ipcMain.handle('procedures:create', (_e, input: ProcedureInput) => db.createProcedure(input))
  ipcMain.handle('procedures:update', (_e, code: string, input: ProcedureInput) =>
    db.updateProcedure(code, input)
  )
  ipcMain.handle('procedures:delete', (_e, code: string) => db.deleteProcedure(code))

  ipcMain.handle('resources:list', (_e, code: string) =>
    storage.listFiles(storage.resourcesDir(code))
  )
  ipcMain.handle('resources:add', (_e, code: string, paths: string[]) => {
    editableTask(code)
    return storage.addResources(code, paths)
  })
  ipcMain.handle('resources:remove', (_e, code: string, name: string) => {
    editableTask(code)
    return storage.removeResource(code, name)
  })
  ipcMain.handle('outputs:list', (_e, code: string) => storage.listFiles(storage.outputsDir(code)))
  ipcMain.handle('answers:list', (_e, code: string) => storage.listFiles(storage.answersDir(code)))
  ipcMain.handle('workspace:list', (_e, code: string) =>
    storage.listFilesCapped(storage.workspaceDir(code), WORKSPACE_LIST_LIMIT)
  )
  ipcMain.handle('folders:open', async (_e, code: string, kind: TaskFolderKind) => {
    if (!db.getTask(code)) throw new Error(`Task ${code} not found`)
    const error = await shell.openPath(storage.taskDir(kind, code, true))
    if (error) throw new Error(error)
  })
  ipcMain.handle('files:open', async (_e, path: string) => {
    if (!storage.isStoragePath(path)) throw new Error('Ruta fuera del almacenamiento interno')
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  ipcMain.handle('files:showInFolder', (_e, path: string) => {
    if (!storage.isStoragePath(path)) throw new Error('Ruta fuera del almacenamiento interno')
    shell.showItemInFolder(path)
  })

  ipcMain.handle('tasks:runs', (_e, code: string) => db.listRuns(code))
  ipcMain.handle('tasks:events', (_e, code: string) => db.listEvents(code))
  ipcMain.handle('tasks:commit', (_e, code: string) => queue.getCommit(code))

  ipcMain.handle('dialog:pickPath', async (_e, kind: 'file' | 'directory') => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: [kind === 'directory' ? 'openDirectory' : 'openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    dataDir: app.getPath('userData'),
    releasesDir: updater.releasesDir()
  }))
  ipcMain.handle('update:check', () => updater.checkForUpdate())
  ipcMain.handle('update:install', async () => {
    if (queue.hasRunningTasks()) {
      throw new Error('Hay agentes trabajando; espera a que terminen o detén sus tareas antes de actualizar')
    }
    await updater.installUpdate()
  })

  db.bus.on('task', (task) => mainWindow?.webContents.send('task:changed', task))
  db.bus.on('event', (event) => mainWindow?.webContents.send('task:event', event))
  db.bus.on('run', (run) => mainWindow?.webContents.send('task:run', run))
  db.bus.on('done', (task) => mainWindow?.webContents.send('task:done', task))
  db.bus.on('deleted', (code) => mainWindow?.webContents.send('task:deleted', code))
}

// The Done chime must play even if the window never received a user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// taskfile://f/?p=<absolute path> lets the UI show images and play audio from the internal
// storage (and only from there). Must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'taskfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function registerTaskFileProtocol(): void {
  protocol.handle('taskfile', (request) => {
    const path = new URL(request.url).searchParams.get('p')
    if (!path || !storage.isStoragePath(path)) return new Response('Forbidden', { status: 403 })
    // Forward headers so Range requests work for audio seeking.
    return net.fetch(pathToFileURL(path).toString(), { headers: request.headers })
  })
}

// One instance only: two would share the database, the MCP port and the agent queue.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })
  app.whenReady().then(start)
}

async function start(): Promise<void> {
  app.setAppUserModelId(APP_ID)
  const dataDir = app.getPath('userData')
  const dbFile = join(dataDir, 'taskqueue.db')
  backupOnVersionChange(dataDir, dbFile, app.getVersion())
  db.openDatabase(dbFile)
  storage.initStorage(join(app.getPath('userData'), 'storage'))
  registerTaskFileProtocol()
  await startMcpServer()
  registerIpc()
  queue.startQueue()
  createWindow()
  updater.startUpdateChecks((info) => mainWindow?.webContents.send('update:available', info))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('before-quit', () => queue.stopAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
