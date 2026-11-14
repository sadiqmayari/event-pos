import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { cx } from './ui'
import { OfflineBanner, OfflineStatus } from '../features/offline/OfflineStatus'
import { StationBadge } from '../features/receipts/StationPanel'


const links: { to: string; label: string; admin?: boolean }[] = [
  { to: '/', label: 'Sell' },
  { to: '/products', label: 'Stock' },
  { to: '/history', label: 'History' },
  { to: '/reports', label: 'Reports', admin: true },
  { to: '/staff', label: 'Staff', admin: true },
  { to: '/settings', label: 'Settings' },
]

export function Layout() {
  const { profile, isAdmin, signOut } = useAuth()

  return (
    <div className="flex h-dvh flex-col">
      <header className="sticky top-0 z-40 flex flex-wrap items-center gap-2 bg-slate-900 px-3 py-2 text-white shadow">
        <div className="mr-2 flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg bg-teal-600 text-sm font-bold">Rs</div>
          <span className="hidden font-bold lg:inline">Event POS</span>
        </div>
        <nav className="flex flex-1 gap-1 overflow-x-auto">
          {links.filter((l) => !l.admin || isAdmin).map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) => cx(
                'flex h-11 items-center rounded-lg px-4 text-base font-semibold whitespace-nowrap',
                isActive ? 'bg-teal-600 text-white' : 'text-slate-300 hover:bg-slate-800',
              )}
            >{l.label}</NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <StationBadge />
          <OfflineStatus />
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-sm font-semibold">{profile?.full_name}</div>
            <div className="text-xs capitalize text-slate-400">{profile?.role}</div>
          </div>
          <button type="button" onClick={() => void signOut()} className="h-11 rounded-lg px-3 text-sm text-slate-300 hover:bg-slate-800">Log out</button>
        </div>
      </header>
      <OfflineBanner />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
