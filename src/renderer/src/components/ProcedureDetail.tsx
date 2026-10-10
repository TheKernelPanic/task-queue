import { useState } from 'react'
import type { Procedure } from '@shared/types'
import Markdown from './Markdown'
import ProcedureForm from './ProcedureForm'

interface Props {
  procedure: Procedure
  onUpdated: (procedure: Procedure) => void
  onDeleted: (code: string) => void
}

function ipcMessage(err: unknown): string {
  return (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export default function ProcedureDetail({ procedure, onUpdated, onDeleted }: Props) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (!window.confirm(`¿Eliminar ${procedure.code} · ${procedure.title}?`)) return
    setError(null)
    try {
      await window.api.deleteProcedure(procedure.code)
      onDeleted(procedure.code)
    } catch (err) {
      setError(ipcMessage(err))
    }
  }

  if (editing) {
    return (
      <>
        <h2>Editar {procedure.code}</h2>
        <ProcedureForm
          initial={procedure}
          submitLabel="Guardar"
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            try {
              onUpdated(await window.api.updateProcedure(procedure.code, values))
              setEditing(false)
            } catch (err) {
              throw new Error(ipcMessage(err))
            }
          }}
        />
      </>
    )
  }

  return (
    <div className="task-detail">
      <header>
        <div className="title-row">
          <code>{procedure.code}</code>
          <h2>{procedure.title}</h2>
        </div>
        <div className="meta">Actualizado: {procedure.updatedAt}</div>
        <div className="actions">
          <button onClick={() => setEditing(true)}>Editar</button>
          <button className="danger" onClick={remove}>
            Eliminar
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </header>
      <Markdown>{procedure.prompt}</Markdown>
    </div>
  )
}
