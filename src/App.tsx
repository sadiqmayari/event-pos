import { HashRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { LoginPage } from './auth/LoginPage'
import { RequireRole } from './auth/RequireRole'
import { Layout } from './components/Layout'
import { ProductsPage } from './features/products/ProductsPage'
import { StaffPage } from './features/staff/StaffPage'
import { SalesPage } from './features/sales/SalesPage'
import { HistoryPage } from './features/history/HistoryPage'
import { ReportsPage } from './features/reports/ReportsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { PrintHost } from './features/receipts/PrintHost'
import { UpdateBanner } from './features/offline/UpdateBanner'
import { supabaseConfigured } from './lib/supabase'

// HashRouter: GitHub Pages has no SPA fallback, so /#/products survives a refresh.
export default function App() {
  if (!supabaseConfigured) return <SetupMissing />
  return (
    <HashRouter>
      <AuthProvider>
        <PrintHost />
        <UpdateBanner />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireRole><Layout /></RequireRole>}>
            <Route index element={<SalesPage />} />
            <Route path="products" element={<RequireRole role="admin"><ProductsPage /></RequireRole>} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="reports" element={<RequireRole role="admin"><ReportsPage /></RequireRole>} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="staff" element={<RequireRole role="admin"><StaffPage /></RequireRole>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </HashRouter>
  )
}

function SetupMissing() {
  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="mb-2 text-2xl font-bold">Supabase is not configured</h1>
      <p className="text-slate-700">
        Copy <code>.env.example</code> to <code>.env.local</code>, fill in <code>VITE_SUPABASE_URL</code> and{' '}
        <code>VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code>. For GitHub Pages, add them as repository
        secrets (see README).
      </p>
    </div>
  )
}
