import { useState } from 'react'

interface Props {
  onPaths: (paths: string[]) => void
  disabled?: boolean
}

/** Accepts files/folders dragged from the OS (or picked) and reports their absolute paths. */
export default function DropZone({ onPaths, disabled }: Props) {
  const [over, setOver] = useState(false)

  async function pick() {
    const path = await window.api.pickPath('file')
    if (path) onPaths([path])
  }

  return (
    <div
      className={`dropzone${over ? ' over' : ''}${disabled ? ' disabled' : ''}`}
      onDragOver={(e) => {
        if (disabled) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (disabled) return
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => window.api.getPathForFile(f))
          .filter(Boolean)
        if (paths.length > 0) onPaths(paths)
      }}
    >
      Arrastra aquí ficheros o carpetas
      <button type="button" disabled={disabled} onClick={pick}>
        Examinar…
      </button>
    </div>
  )
}
