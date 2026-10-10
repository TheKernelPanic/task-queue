import { useRef, useState } from 'react'
import Markdown from './Markdown'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

/** Markdown textarea with preview and buttons to insert file/folder paths at the cursor. */
export default function MarkdownEditor({ value, onChange, placeholder }: Props) {
  const [preview, setPreview] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)

  async function insertPath(kind: 'file' | 'directory') {
    const path = await window.api.pickPath(kind)
    if (!path) return
    const el = textarea.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const snippet = `\`${path}\``
    onChange(value.slice(0, start) + snippet + value.slice(end))
    setPreview(false)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + snippet.length, start + snippet.length)
    })
  }

  return (
    <div className="prompt-editor">
      <div className="toolbar">
        <button type="button" className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>
          Escribir
        </button>
        <button type="button" className={preview ? 'active' : ''} onClick={() => setPreview(true)}>
          Vista previa
        </button>
        <span className="spacer" />
        <button type="button" onClick={() => insertPath('file')}>
          + Fichero
        </button>
        <button type="button" onClick={() => insertPath('directory')}>
          + Carpeta
        </button>
      </div>
      {preview ? (
        <div className="preview">
          <Markdown>{value || '_Sin contenido_'}</Markdown>
        </div>
      ) : (
        <textarea
          ref={textarea}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}
