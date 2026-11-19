import { AuthError, requireStaff } from '@/server/auth/guards'
import { getClientPayrollHoursCsv, PayrollExportError } from '@/server/payroll-export'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireStaff()
    const id = Number((await params).id)
    const search = new URL(request.url).searchParams
    const result = await getClientPayrollHoursCsv({
      clientId: id,
      start: search.get('start') ?? '',
      end: search.get('end') ?? '',
    })
    const filename = result.filename.replace(/["\\]/g, '_')
    return new Response(result.csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof AuthError || error instanceof PayrollExportError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
}
