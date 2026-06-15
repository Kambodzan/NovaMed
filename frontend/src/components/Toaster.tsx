import { useEffect, useState } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import { cx } from '../ui'
import { subscribeToasts, dismissToast, type Toast } from '../lib/toast'

// Globalny stos toastów (prawy dolny róg) — spójny ze wspólnym systemem designu.
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => subscribeToasts(setToasts), [])
  if (toasts.length === 0) return null

  return (
    <div className="fixed right-4 bottom-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.id} role="status"
          className={cx(
            'fade-up flex items-start gap-2.5 rounded-2xl bg-surface px-4 py-3 shadow-[0_12px_32px_-8px_rgba(16,24,40,0.28)]',
            'border-l-4', t.tone === 'error' ? 'border-red-500' : 'border-emerald-500',
          )}
        >
          <span className={cx('mt-0.5 shrink-0', t.tone === 'error' ? 'text-red-500' : 'text-emerald-500')}>
            {t.tone === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}
          </span>
          <p className="min-w-0 flex-1 text-sm font-bold text-gray-800">{t.message}</p>
          <button onClick={() => dismissToast(t.id)} aria-label="Zamknij"
            className="-mt-0.5 shrink-0 cursor-pointer rounded-full p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-700">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
