// Minimalny globalny system toastów — działa też spoza Reacta (QueryCache.onError).
// Subskrypcja przez <Toaster/>; emisja przez pushToast() z dowolnego miejsca.
export type Toast = { id: number; message: string; tone: 'error' | 'success' }

let listeners: Array<(t: Toast[]) => void> = []
let toasts: Toast[] = []
let nextId = 1

const emit = () => listeners.forEach(l => l(toasts))
const drop = (id: number) => { toasts = toasts.filter(t => t.id !== id); emit() }

export function pushToast(message: string, tone: Toast['tone'] = 'error') {
  // dedup — gdy kilka zapytań pada naraz z tym samym błędem, pokaż raz
  if (toasts.some(t => t.message === message)) return
  const id = nextId++
  toasts = [...toasts, { id, message, tone }]
  emit()
  setTimeout(() => drop(id), 5500)
}

export function dismissToast(id: number) { drop(id) }

export function subscribeToasts(fn: (t: Toast[]) => void): () => void {
  listeners.push(fn)
  fn(toasts)
  return () => { listeners = listeners.filter(l => l !== fn) }
}
