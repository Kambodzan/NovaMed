import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@fontsource-variable/plus-jakarta-sans/index.css'
import './index.css'
import App from './App'
import { AuthProvider } from './lib/auth'
import { ApiError } from './lib/api'
import { pushToast } from './lib/toast'

const queryClient = new QueryClient({
  // błędy ODCZYTU (useQuery) — zamiast cichego, wiecznego spinnera pokaż toast.
  // 401 pomijamy: wygaśnięcie sesji obsługuje AuthProvider (wylogowanie).
  queryCache: new QueryCache({
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return
      pushToast(err instanceof Error ? err.message : 'Nie udało się wczytać danych.', 'error')
    },
  }),
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
