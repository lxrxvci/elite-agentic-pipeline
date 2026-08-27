import { redirect } from 'next/navigation'

/** /admin lands on the Users surface. */
export default function AdminIndexPage() {
  redirect('/admin/users')
}
