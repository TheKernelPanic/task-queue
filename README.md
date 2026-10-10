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
5. El agente llama a `get_task` (y a `get_procedure` por cada procedimiento vinculado), después a `start_task` (`InProgress`), trabaja y termina con `complete_task` y un resumen en Markdown (`Done`).
6. La app hace commit de los cambios con el mensaje `DK-0001: <título>` y el resumen.

El stream JSON del agente se guarda en `task_events`, clasificado como `text`, `thinking`, `command`, `output`, `system` o `error`. Se muestra en la pestaña **History** de la tarea.

### Procedimientos

Un **procedimiento** (`PR-0001`, …) es un bloque reutilizable de instrucciones: título corto y prompt en Markdown, donde también se pueden insertar rutas. Se gestionan desde *Biblioteca → Procedimientos* y pueden editarse en cualquier momento.

Cada procedimiento pertenece a uno o varios proyectos, y como mínimo a uno. Una tarea solo puede vincular procedimientos de su propio proyecto. No se puede quitar un proyecto de un procedimiento mientras alguna tarea de ese proyecto lo use.

Al crear o editar una tarea se le pueden vincular procedimientos, en orden. `get_task` devuelve la lista (código y título) y el agente lee cada uno con la tool MCP `get_procedure`. El agente siempre lee la versión actual del procedimiento. Un procedimiento vinculado a alguna tarea no se puede eliminar.

### Recursos y outputs

Cada tarea tiene dos carpetas internas en `%APPDATA%/task-queue/storage/`:

- `resources/<TAREA>/`: ficheros que el usuario suelta en la tarea (pestaña **Ficheros**, o al crearla). Se copian ahí y, si un nombre ya existe, se renombra (`data (1).csv`). `get_task` devuelve sus rutas absolutas en `resources`.
- `outputs/<TAREA>/`: ficheros que genera el agente y que no pertenecen al proyecto. `get_task` devuelve la ruta en `outputDir`. No entran en el commit.

El agente se lanza con ambas carpetas como directorios adicionales (`--add-dir`), así que tiene acceso completo incluso en modo `acceptEdits`.

### Consumo

Cada ejecución del agente queda registrada como un *run* en `task_runs`. Una tarea reanudada tras una pregunta tiene varios. La pestaña **Consumo** de la tarea muestra:

- Totales: coste estimado (precio de lista de la API), tokens de entrada, salida y caché, número de ejecuciones y tiempo.
- Desglose por modelo y tabla de ejecuciones (estado, duración, turnos, tokens y coste).
- Cuota del plan: uso de las ventanas de 5 h y 7 días y su hora de reinicio, según el último `rate_limit_event`. Es de toda la cuenta, no solo de la tarea.

Claude Code informa del coste, del desglose por modelo y del tiempo de API acumulados por sesión. En los runs reanudados (`--resume`) se resta lo que ya está registrado en los runs anteriores de la misma sesión, para que no se cuente dos veces. Codex solo informa de tokens, sin coste ni modelo.

### Preguntas al usuario

Si el agente necesita una decisión, llama a `ask_user` y termina su turno. La tarea pasa a `WaitingForInput` y la pregunta aparece en la ficha. Al responder, la tarea vuelve a `Pending` y el agente se reanuda en la misma sesión (`--resume`) con la respuesta.

### Estados

`Created → Pending → InProgress → (WaitingForInput ↔ Pending) → Done`

Transiciones manuales: detener (`Stopped`, que mata el proceso), cancelar (`Cancelled`) y volver a encolar una tarea detenida.

**Una tarea solo puede modificarse en `Created`.** Eso incluye título, prompt, agente, procedimientos y recursos. Al encolarla queda bloqueada para siempre: no hay transición de vuelta a `Created`, y el backend rechaza cualquier modificación. Si el agente termina sin llamar a `complete_task`, la tarea queda en `Stopped`.

## Estructura

```
src/
  shared/types.ts      modelo de dominio y contrato IPC
  main/
    index.ts           ventana, IPC
    db.ts              SQLite (proyectos, tareas, procedimientos, eventos, runs)
    mcp.ts             servidor MCP (Streamable HTTP en 127.0.0.1:47821, con token)
    queue.ts           cola, ejecución de agentes, commit
    git.ts             commit y lectura de diffs
    storage.ts         carpetas internas de recursos y outputs por tarea
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
- Pendiente: borrar o editar proyectos, empaquetado (electron-builder).
