import { EmptyState } from './ui'

export function ComingSoon({ title }: { title: string }) {
  return <div className="mx-auto max-w-3xl p-6"><EmptyState title={title}>Coming in a later stage.</EmptyState></div>
}
