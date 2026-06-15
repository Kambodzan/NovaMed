// Globalne potwierdzenie akcji — zamiennik natywnego window.confirm.
// Spójne z designem (komponent Modal), tłumaczalne, z wariantem „danger".
// Użycie: if (await confirm({ title, message, tone: 'danger' })) { ... }
export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
}
export interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

let listener: ((req: ConfirmRequest) => void) | null = null

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    if (listener) listener({ ...opts, resolve })
    else resolve(false)  // brak hosta (np. test) — bezpiecznie odrzuć
  })
}

export function _setConfirmListener(fn: ((req: ConfirmRequest) => void) | null) {
  listener = fn
}
