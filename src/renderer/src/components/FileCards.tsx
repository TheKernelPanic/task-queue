import { useEffect, useRef, useState } from 'react'
import type { TaskFile } from '@shared/types'
import { formatSize } from './FileList'

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico']
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus']
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv']

function extension(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

function kindOf(file: TaskFile): 'image' | 'audio' | 'video' | 'other' {
  const ext = extension(file.name)
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  if (VIDEO_EXT.includes(ext)) return 'video'
  return 'other'
}

/** URL served by the main process (internal storage only); mtime busts the cache when a file changes. */
function fileUrl(file: TaskFile): string {
  return `taskfile://f/?p=${encodeURIComponent(file.path)}&v=${encodeURIComponent(file.modifiedAt)}`
}

function baseName(name: string): string {
  return name.split('/').pop() ?? name
}

/** First frame of a video, loaded only once the card scrolls into view (lists can be long). */
function VideoThumb({ file }: { file: TaskFile }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  return <video ref={ref} src={visible ? `${fileUrl(file)}#t=0.1` : undefined} preload="metadata" muted />
}

interface Props {
  files: TaskFile[]
  empty: string
  showModified?: boolean
  onRemove?: (file: TaskFile) => void
}

/** Files as small cards: image and video thumbnails (click to enlarge/play) and play/stop for audio. */
export default function FileCards({ files, empty, showModified, onRemove }: Props) {
  const [playing, setPlaying] = useState<string | null>(null)
  const [viewing, setViewing] = useState<TaskFile | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  function stop() {
    if (audio.current) {
      audio.current.pause()
      audio.current.currentTime = 0
    }
    setPlaying(null)
  }

  function toggle(file: TaskFile) {
    if (playing === file.path) {
      stop()
      return
    }
    stop()
    const player = new Audio(fileUrl(file))
    player.onended = () => setPlaying(null)
    player.onerror = () => setPlaying(null)
    audio.current = player
    setPlaying(file.path)
    void player.play().catch(() => setPlaying(null))
  }

  // Stop playback when the list goes away (tab change, task change).
  useEffect(() => () => audio.current?.pause(), [])

  useEffect(() => {
    if (!viewing) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setViewing(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewing])

  if (files.length === 0) return <p className="muted small">{empty}</p>

  return (
    <>
      <div className="file-cards">
        {files.map((f) => {
          const kind = kindOf(f)
          const isPlaying = playing === f.path
          return (
            <div key={f.name} className={`file-card${isPlaying ? ' playing' : ''}`} title={f.path}>
              <div className="file-card-preview">
                {kind === 'image' && (
                  <button className="thumb" title="Ver imagen" onClick={() => setViewing(f)}>
                    <img src={fileUrl(f)} alt={f.name} loading="lazy" />
                  </button>
                )}
                {kind === 'video' && (
                  <button className="thumb video" title="Ver vídeo" onClick={() => setViewing(f)}>
                    <VideoThumb file={f} />
                    <span className="thumb-play">▶</span>
                  </button>
                )}
                {kind === 'audio' && (
                  <button
                    className="play"
                    title={isPlaying ? 'Detener' : 'Reproducir'}
                    onClick={() => toggle(f)}
                  >
                    {isPlaying ? '■' : '▶'}
                  </button>
                )}
                {kind === 'other' && <span className="ext">{extension(f.name) || 'file'}</span>}
              </div>
              <div className="file-card-name">{baseName(f.name)}</div>
              {showModified && (
                <div className="file-card-date muted small">
                  {new Date(f.modifiedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                </div>
              )}
              <div className="file-card-meta">
                <span className="muted small">{formatSize(f.size)}</span>
                <span className="file-card-actions">
                  <button className="icon" title="Abrir" onClick={() => window.api.openPath(f.path)}>
                    ↗
                  </button>
                  <button className="icon" title="Mostrar en carpeta" onClick={() => window.api.showInFolder(f.path)}>
                    ⧉
                  </button>
                  {onRemove && (
                    <button className="icon danger" title="Quitar" onClick={() => onRemove(f)}>
                      ×
                    </button>
                  )}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {viewing && (
        <div className="lightbox" onClick={() => setViewing(null)}>
          {kindOf(viewing) === 'video' ? (
            <video src={fileUrl(viewing)} controls autoPlay onClick={(e) => e.stopPropagation()} />
          ) : (
            <img src={fileUrl(viewing)} alt={viewing.name} onClick={(e) => e.stopPropagation()} />
          )}
          <div className="lightbox-caption">
            {viewing.name} · {formatSize(viewing.size)} · Esc para cerrar
          </div>
        </div>
      )}
    </>
  )
}
