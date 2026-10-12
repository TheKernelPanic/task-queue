import type { TaskStatus } from '@shared/types'

export const STATUS_LABELS: Record<TaskStatus, string> = {
  Created: 'Creada',
  Pending: 'Pendiente',
  Blocked: 'Bloqueada',
  InProgress: 'En curso',
  WaitingForInput: 'Esperando respuesta',
  Stopped: 'Detenida',
  Done: 'Hecha',
  Cancelled: 'Cancelada'
}

export default function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>
}
