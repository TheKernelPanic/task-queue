import { useState } from 'react'
import type { PermissionMode, Project } from '@shared/types'

interface Props {
  onCreated: (project: Project) => void
  onCancel: () => void
}

export default function ProjectForm({ onCreated, onCancel }: Props) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [mode, setMode] = useState<PermissionMode>('acceptEdits')
  const [error, setError] = useState<string | null>(null)

  async function pick() {
    const picked = await window.api.pickPath('directory')
    if (!picked) return
    setPath(picked)
    if (!name) setName(picked.split(/[\\/]/).pop() ?? picked)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!path || !name.trim()) {
      setError('Selecciona una carpeta y un nombre')
      return
    }
    try {
      onCreated(await window.api.createProject({ name: name.trim(), path, permissionMode: mode }))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form className="task-form" onSubmit={submit}>
      <label>
        Carpeta
        <div className="row">
          <input value={path} readOnly placeholder="Selecciona la carpeta del proyecto" />
          <button type="button" onClick={pick}>
            Examinar…
          </button>
        </div>
      </label>
      <label>
        Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Permisos del agente
        <select value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)}>
          <option value="acceptEdits">acceptEdits: edita ficheros, comandos restringidos</option>
          <option value="bypassPermissions">bypassPermissions: sin restricciones</option>
        </select>
      </label>
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="primary">
          Añadir proyecto
        </button>
      </div>
    </form>
  )
}
