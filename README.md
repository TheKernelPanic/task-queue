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
2. Se crea una **tarea** (`DK-0001`, …) en estado `Created`, con su agente y, opcionalmente, su modelo. En Claude se puede elegir un alias (`fable`, `opus`, `sonnet`, `haiku`) o un identificador completo; en Codex se escribe el nombre. Sin modelo se usa el predeterminado del agente.
3. Al pasarla a `Pending` entra en la cola. Se ejecuta como mucho una tarea por proyecto a la vez.
4. La app lanza el agente en la carpeta del proyecto con el código de la tarea como prompt, el MCP ya configurado y unas instrucciones de sistema.
5. El agente llama a `get_task` (y a `get_procedure` por cada procedimiento vinculado), después a `start_task` (`InProgress`), trabaja y termina con `complete_task` y un resumen en Markdown (`Done`).
6. Si la tarea tiene activado el switch **Hacer commit de los cambios** (activado por defecto y solo disponible en proyectos git), el propio agente hace commit antes de `complete_task` con exactamente el mensaje `<Agente>: <código>`, por ejemplo `Claude: DK-0012` o `Codex: DK-0012`. La instrucción va en el prompt del agente y en `get_task` (`commit`). Al terminar, la app busca ese commit para mostrarlo en la pestaña Commit y avisa en el History si no lo encuentra. Con el switch desactivado, el agente deja los cambios sin commitear.

El stream JSON del agente se guarda en `task_events`, clasificado como `text`, `thinking`, `command`, `output`, `system` o `error`. Se muestra en la pestaña **History** de la tarea.

### Procedimientos

Un **procedimiento** (`PR-0001`, …) es un bloque reutilizable de instrucciones: título corto y prompt en Markdown, donde también se pueden insertar rutas. Se gestionan desde *Biblioteca → Procedimientos* y pueden editarse en cualquier momento.

Cada procedimiento pertenece a uno o varios proyectos, y como mínimo a uno. Una tarea solo puede vincular procedimientos de su propio proyecto. No se puede quitar un proyecto de un procedimiento mientras alguna tarea de ese proyecto lo use.

Al crear o editar una tarea se le pueden vincular procedimientos, en orden. Al encolar la tarea (Created → Pending) se guarda una **copia** de cada procedimiento vinculado. `get_task` devuelve los procedimientos con sus instrucciones completas tomadas de esa copia, así que editar un procedimiento no afecta a las tareas ya encoladas. La ficha avisa si el procedimiento se ha modificado después. `get_procedure(code, task_code?)` devuelve la copia de la tarea si se le pasa `task_code`. Un procedimiento vinculado a alguna tarea no se puede eliminar.

### Recursos y outputs

Cada tarea tiene sus carpetas internas en `%APPDATA%/task-queue/storage/`:

- `resources/<TAREA>/`: ficheros que el usuario suelta en la tarea (pestaña **Ficheros**, o al crearla). Se copian ahí y, si un nombre ya existe, se renombra (`data (1).csv`). `get_task` devuelve sus rutas absolutas en `resources`.
- `answers/<TAREA>/`: ficheros adjuntados al responder una pregunta del agente. Los recursos quedan bloqueados al encolar, así que esta es la vía para darle ficheros nuevos. Sus rutas absolutas van en la respuesta y en `get_task` (`answerFiles`).
- `outputs/<TAREA>/`: entregables que genera el agente y que no pertenecen al proyecto. `get_task` devuelve la ruta en `outputDir`. No entran en el commit.
- `workspace/<TAREA>/`: directorio de trabajo del agente fuera del proyecto, para copias de seguridad, ficheros temporales, clones, etc. `get_task` devuelve la ruta en `workspaceDir`. Su contenido se ve en la pestaña **Workspace**, que lista hasta 2000 ficheros.

El agente se lanza con estas carpetas como directorios adicionales (`--add-dir`), así que tiene acceso completo incluso en modo `acceptEdits`.

### Consumo

Cada ejecución del agente queda registrada como un *run* en `task_runs`. Una tarea reanudada tras una pregunta tiene varios. La pestaña **Consumo** de la tarea muestra:

- Totales: coste estimado (precio de lista de la API), tokens de entrada, salida y caché, número de ejecuciones y tiempo.
- Desglose por modelo y tabla de ejecuciones (estado, duración, turnos, tokens y coste).
- Cuota del plan: uso de las ventanas de 5 h y 7 días y su hora de reinicio, según el último `rate_limit_event`. Es de toda la cuenta, no solo de la tarea.

Claude Code informa del coste, del desglose por modelo y del tiempo de API acumulados por sesión. En los runs reanudados (`--resume`) se resta lo que ya está registrado en los runs anteriores de la misma sesión, para que no se cuente dos veces. Codex solo informa de tokens, sin coste ni modelo.

### Preguntas al usuario

Si el agente necesita una decisión, llama a `ask_user` y termina su turno. La tarea pasa a `WaitingForInput` y la pregunta aparece en la ficha. Se pueden adjuntar ficheros a la respuesta. Al responder, la tarea vuelve a `Pending` y el agente se reanuda en la misma sesión (`--resume`) con la respuesta.

Cuando una tarea pasa a `Done`, la aplicación reproduce un aviso sonoro.

### Estados

`Created → Pending → InProgress → (WaitingForInput ↔ Pending) → Done`

Transiciones manuales: detener (`Stopped`, que mata el proceso), cancelar (`Cancelled`) y volver a encolar una tarea detenida.

**Una tarea solo puede modificarse en `Created`.** Eso incluye título, prompt, agente, procedimientos y recursos. Al encolarla queda bloqueada para siempre: no hay transición de vuelta a `Created`, y el backend rechaza cualquier modificación.

**Las tareas canceladas se pueden borrar.** Se elimina la tarea con su historial, consumo y vínculos a procedimientos, y también sus carpetas internas (recursos, adjuntos y outputs). Los commits ya hechos en el proyecto no se tocan, y los códigos de tarea no se reutilizan. Si el agente termina sin llamar a `complete_task`, la tarea queda en `Stopped`.

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
    storage.ts         carpetas internas por tarea (recursos, adjuntos, outputs, workspace)
    agents/            detección y adaptadores (claude, codex)
  preload/             puente IPC
  renderer/            UI React
```

## Estado actual / pendiente

- Claude Code: probado de extremo a extremo, incluidas las preguntas y la reanudación.
- Codex (codex-cli 0.162): probado de extremo a extremo (MCP, preguntas, reanudación con `exec resume`, procedimientos, outputs y commit). Sandbox y carpetas con escritura se pasan con `-c` porque `exec resume` no acepta `-s` ni `--add-dir`. Las tools del MCP se aprueban con `default_tools_approval_mode="approve"`.
  - En modo `acceptEdits` Codex usa su sandbox de Windows (`workspace-write`). Si `codex doctor` informa de un fallo en el sandbox, no podrá ejecutar comandos ni escribir ficheros; usa `bypassPermissions` o repara el sandbox de Codex.
  - Codex no informa de coste ni de modelo, solo de tokens.
- Editor del prompt: textarea Markdown con vista previa. Pendiente un editor enriquecido (TipTap o MDXEditor).
- Visor de diff simple. Pendiente un Monaco DiffEditor.
- Pendiente: borrar o editar proyectos, empaquetado (electron-builder).
