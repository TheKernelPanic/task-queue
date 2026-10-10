import { useEffect, useState } from 'react'
import type { AppInfo, UpdateInfo } from '@shared/types'

/** App version and, when a newer build is in the releases folder, a button to install it. */
export default function UpdateFooter() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.getAppInfo().then(setInfo)
    void window.api.checkForUpdate().then(setUpdate)
    return window.api.onUpdateAvailable(setUpdate)
  }, [])

  async function install() {
    if (!update) return
    const ok = window.confirm(
      `¿Instalar la versión ${update.version}?\n\nTaskQueue se cerrará, se actualizará y se volverá a abrir. ` +
        'Tus proyectos, tareas y ficheros no se modifican (se hace además una copia de la base de datos).'
    )
    if (!ok) return
    setError(null)
    setInstalling(true)
    try {
      await window.api.installUpdate()
    } catch (err) {
      setInstalling(false)
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  if (!info) return null

  return (
    <footer className="app-footer">
      {update && (
        <div className="update-banner">
          <div>Versión {update.version} disponible</div>
          <button className="primary" disabled={installing} onClick={install}>
            {installing ? 'Instalando…' : 'Instalar y reiniciar'}
          </button>
          {error && <div className="error small">{error}</div>}
        </div>
      )}
      <div className="muted small" title={`Datos: ${info.dataDir}\nVersiones: ${info.releasesDir}`}>
        TaskQueue v{info.version}
        {!info.packaged && ' (desarrollo)'}
      </div>
    </footer>
  )
}
