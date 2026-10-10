# TaskQueue

Aplicación de escritorio (Electron + React + TypeScript) que encola tareas y las despacha a agentes de código instalados localmente (Claude Code, Codex). Los agentes leen la tarea y reportan su estado a través de un servidor MCP local.

## Desarrollo

```bash
npm install
npm run dev        # app en modo desarrollo con HMR
npm run typecheck
npm run build
```

Requiere Node 22+ y git. La base de datos SQLite usa `node:sqlite` (incluido en Electron), sin módulos nativos que compilar.
Se guarda en `%APPDATA%/task-queue/taskqueue.db`.

## Flujo

1. Se da de alta un **proyecto** (carpeta, idealmente un repositorio git) y su modo de permisos para el agente.
2. Se crea una **tarea** (`DK-0001`, …) en estado `Created`.
3. Al pasarla a `Pending` entra en la cola. Se ejecuta como mucho una tarea por proyecto a la vez.
4. La app lanza el agente en la carpeta del proyecto con el código de la tarea como prompt, el MCP ya configurado y unas instrucciones de sistema.
5. El agente llama a `get_task`, después a `start_task` (`InProgress`), trabaja y termina con `complete_task` y un resumen en Markdown (`Done`).
6. La app hace commit de los cambios con el mensaje `DK-0001: <título>` y el resumen.

El stream JSON del agente se guarda en `task_events`, clasificado como `text`, `thinking`, `command`, `output`, `system` o `error`. Se muestra en la pestaña **History** de la tarea.

### Preguntas al usuario

Si el agente necesita una decisión, llama a `ask_user` y termina su turno. La tarea pasa a `WaitingForInput` y la pregunta aparece en la ficha. Al responder, la tarea vuelve a `Pending` y el agente se reanuda en la misma sesión (`--resume`) con la respuesta.

### Estados

`Created → Pending → InProgress → (WaitingForInput ↔ Pending) → Done`

Transiciones manuales: detener (`Stopped`, que mata el proceso), cancelar (`Cancelled`) y volver a encolar una tarea detenida. Si el agente termina sin llamar a `complete_task`, la tarea queda en `Stopped`.

## Estructura

```
src/
  shared/types.ts      modelo de dominio y contrato IPC
  main/
    index.ts           ventana, IPC
    db.ts              SQLite (proyectos, tareas, eventos)
    mcp.ts             servidor MCP (Streamable HTTP en 127.0.0.1:47821, con token)
    queue.ts           cola, ejecución de agentes, commit
    git.ts             commit y lectura de diffs
    agents/            detección y adaptadores (claude, codex)
  preload/             puente IPC
  renderer/            UI React
```

## Estado actual / pendiente

- Claude Code: probado de extremo a extremo, incluidas las preguntas y la reanudación.
- Codex: adaptador escrito según el formato `codex exec --json`, **sin probar**. En Windows, si se instala como `codex.cmd`, el lanzamiento necesitará ajustes.
- El commit hace `git add -A`: incluye cualquier cambio sin commitear que hubiera en el repositorio.
- Editor del prompt: textarea Markdown con vista previa. Pendiente un editor enriquecido (TipTap o MDXEditor).
- Visor de diff simple. Pendiente un Monaco DiffEditor.
- Pendiente: adjuntos multimedia, borrar o editar proyectos, empaquetado (electron-builder).
