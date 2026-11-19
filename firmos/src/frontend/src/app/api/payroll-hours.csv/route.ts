import { AuthError, requireRole } from '@/server/auth/guards'
import { getFirmPayrollHoursCsv, PayrollExportError } from '@/server/payroll-export'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireRole('owner', 'admin')
    const search = new URL(request.url).searchParams
    const result = await getFirmPayrollHoursCsv({
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
