import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Profile, Role } from '../../lib/types'
import { errorMessage } from '../../lib/errors'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Button, ErrorBox, Input, Select, Spinner } from '../../components/ui'
import { useToast } from '../../components/Toast'

export function StaffPage() {
  const { profile: me, refreshProfile } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const staff = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name')
      if (error) throw error
      return data as Profile[]
    },
  })

  async function update(p: Profile, patch: Partial<Pick<Profile, 'full_name' | 'role' | 'active'>>) {
    setError(null)
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id)
    if (error) { setError(errorMessage(error)); return }
    toast('Staff updated')
    await qc.invalidateQueries({ queryKey: ['profiles'] })
    if (p.id === me?.id) await refreshProfile()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-2xl font-bold">Staff</h1>
      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sky-900">
        <p className="font-semibold">Adding a new staff member</p>
        <p className="text-sm">
          In Supabase open <b>Authentication → Users → Add user → Create new user</b>, enter their email and a password,
          and tick “Auto confirm user”. They will appear here as a <b>cashier</b>. Promote them to admin below if needed.
        </p>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {staff.isLoading ? <Spinner /> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px]">
            <thead className="bg-slate-50 text-left text-sm text-slate-600">
              <tr><th className="px-4 py-3">Name (printed on receipts)</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody>
              {(staff.data ?? []).map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <Input defaultValue={p.full_name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.full_name) void update(p, { full_name: v }) }} />
                  </td>
                  <td className="px-4 py-2 text-slate-600">{p.email}{p.id === me?.id && <Badge tone="teal" className="ml-2">you</Badge>}</td>
                  <td className="px-4 py-2">
                    <Select value={p.role} onChange={(e) => void update(p, { role: e.target.value as Role })} className="w-36">
                      <option value="cashier">Cashier</option>
                      <option value="admin">Admin</option>
                    </Select>
                  </td>
                  <td className="px-4 py-2">
                    <Button size="sm" variant={p.active ? 'secondary' : 'success'} onClick={() => void update(p, { active: !p.active })}>
                      {p.active ? 'Deactivate' : 'Activate'}
                    </Button>
                    {!p.active && <Badge tone="red" className="ml-2">inactive</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
