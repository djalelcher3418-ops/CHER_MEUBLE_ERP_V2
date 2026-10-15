import { monthRange } from './payroll'
import { supabase } from './supabase'
import { ORDER_STATUS_LABELS, PAY_LABELS, UNIT_LABELS, type OrderStatus, type PayMethod, type Unit } from './types'

type Row = Record<string, unknown>
type Sheet = { name: string; rows: Row[] }

/** يجلب كل الصفوف (الخادم يعطي 1000 صف في كل مرة) */
async function all(table: string, select: string, filter?: (q: any) => any, order = 'id'): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(select).order(order).range(from, from + 999)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) throw error
    out.push(...((data as unknown as Row[]) ?? []))
    if (!data || data.length < 1000) return out
  }
}

const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const st = (v: unknown) => ORDER_STATUS_LABELS[v as OrderStatus] ?? v
const pm = (v: unknown) => PAY_LABELS[v as PayMethod] ?? v
const un = (v: unknown) => UNIT_LABELS[v as Unit] ?? v
const name = (v: unknown, key = 'name') => (v as Row | null)?.[key] ?? ''

async function download(file: string, sheets: Sheet[]) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ '': 'لا توجد بيانات' }])
    const keys = Object.keys(s.rows[0] ?? { '': '' })
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[k] ?? '').length + 2))) }))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  wb.Workbook = { Views: [{ RTL: true }] }
  XLSX.writeFile(wb, file)
}

/** ملف Excel لشهر واحد: الطلبيات المسلّمة، الدفعات، المصاريف، الرواتب */
export async function exportMonth(month: string) {
  const { from, to } = monthRange(month)
  const between = (col: string) => (q: any) => q.gte(col, from).lte(col, to)
  const [delivered, cpay, spay, exp, payroll, adv] = await Promise.all([
    all('order_totals', '*', (q) => q.eq('status', 'delivered').gte('delivered_on', from).lte('delivered_on', to)),
    all('customer_payments', 'paid_on, amount, method, notes, order_id, customers(name)', between('paid_on')),
    all('supplier_payments', 'paid_on, amount, method, notes, purchase_id, suppliers(name)', between('paid_on')),
    all('expenses', 'spent_on, amount, method, description, expense_categories(name)', between('spent_on')),
    all('payroll_payments', 'paid_on, period_start, period_end, days_worked, daily_wage, gross, advances, amount, employees(full_name)', between('paid_on')),
    all('employee_advances', 'given_on, amount, notes, employees(full_name)', between('given_on')),
  ])
  await download(`CHER-MEUBLE-${month}.xlsx`, [
    { name: 'الطلبيات المسلّمة', rows: delivered.map((o) => ({ 'رقم': o.id, 'التسليم': o.delivered_on, 'الزبون': o.customer_name, 'الطلبية': o.title, 'المبلغ': n(o.total), 'المدفوع': n(o.paid), 'تكلفة المواد': n(o.material_cost), 'الفرق': (n(o.total) ?? 0) - (n(o.material_cost) ?? 0) })) },
    { name: 'دفعات الزبائن', rows: cpay.map((p) => ({ 'التاريخ': p.paid_on, 'الزبون': name(p.customers), 'المبلغ': n(p.amount), 'الطريقة': pm(p.method), 'الطلبية': p.order_id, 'ملاحظة': p.notes })) },
    { name: 'دفعات الموردين', rows: spay.map((p) => ({ 'التاريخ': p.paid_on, 'المورد': name(p.suppliers), 'المبلغ': n(p.amount), 'الطريقة': pm(p.method), 'الشراء': p.purchase_id, 'ملاحظة': p.notes })) },
    { name: 'المصاريف', rows: exp.map((e) => ({ 'التاريخ': e.spent_on, 'الصنف': name(e.expense_categories), 'البيان': e.description, 'المبلغ': n(e.amount), 'الطريقة': pm(e.method) })) },
    { name: 'الرواتب', rows: payroll.map((p) => ({ 'العامل': name(p.employees, 'full_name'), 'من': p.period_start, 'إلى': p.period_end, 'أيام العمل': n(p.days_worked), 'أجر اليوم': n(p.daily_wage), 'المستحق': n(p.gross), 'التسبيقات': n(p.advances), 'المدفوع': n(p.amount), 'تاريخ الدفع': p.paid_on })) },
    { name: 'التسبيقات', rows: adv.map((a) => ({ 'التاريخ': a.given_on, 'العامل': name(a.employees, 'full_name'), 'المبلغ': n(a.amount), 'ملاحظة': a.notes })) },
  ])
}

/** نسخة احتياطية كاملة من البيانات في ملف Excel واحد */
export async function exportBackup(today: string) {
  const [customers, balances, orders, items, materials, suppliers, sbal, purchases, employees, expenses, cpay, spay, moves] = await Promise.all([
    all('customers', '*'),
    all('customer_balances', 'id, balance'),
    all('order_totals', '*'),
    all('order_items', '*'),
    all('materials', '*, material_categories(name)'),
    all('suppliers', '*'),
    all('supplier_balances', 'id, balance'),
    all('purchase_totals', '*, suppliers(name)'),
    all('employees', '*'),
    all('expenses', '*, expense_categories(name)'),
    all('customer_payments', '*, customers(name)'),
    all('supplier_payments', '*, suppliers(name)'),
    all('stock_movements', 'id, type, qty, unit_cost, note, order_id, created_at, materials(name), profiles(full_name)'),
  ])
  const balOf = (rows: Row[], id: unknown) => n(rows.find((r) => r.id === id)?.balance) ?? 0
  const MOVE = { in: 'دخول', out: 'خروج', adjust: 'تصحيح' } as Record<string, string>
  await download(`CHER-MEUBLE-backup-${today}.xlsx`, [
    { name: 'الزبائن', rows: customers.map((c) => ({ 'رقم': c.id, 'الاسم': c.name, 'الهاتف': c.phone, 'العنوان': c.address, 'دين قديم': n(c.opening_balance), 'الباقي عليه': balOf(balances, c.id), 'ملاحظات': c.notes })) },
    { name: 'الطلبيات', rows: orders.map((o) => ({ 'رقم': o.id, 'التاريخ': o.order_date, 'الزبون': o.customer_name, 'الطلبية': o.title, 'التسليم المتوقع': o.due_date, 'الحالة': st(o.status), 'التخفيض': n(o.discount), 'المبلغ': n(o.total), 'المدفوع': n(o.paid), 'تكلفة المواد': n(o.material_cost), 'سُلّمت يوم': o.delivered_on })) },
    { name: 'أسطر الطلبيات', rows: items.map((i) => ({ 'الطلبية': i.order_id, 'البيان': i.description, 'المقاس': i.size ?? '', 'الكمية': n(i.qty), 'سعر الوحدة': n(i.unit_price), 'المجموع': (n(i.qty) ?? 0) * (n(i.unit_price) ?? 0) })) },
    { name: 'المواد', rows: materials.map((m) => ({ 'الباركود': m.barcode, 'المادة': m.name, 'الصنف': name(m.material_categories), 'الوحدة': un(m.unit), 'الكمية': n(m.qty), 'متوسط السعر': n(m.avg_cost), 'القيمة': (n(m.qty) ?? 0) * (n(m.avg_cost) ?? 0), 'حد التنبيه': n(m.min_qty), 'نشطة': m.active ? 'نعم' : 'لا' })) },
    { name: 'الموردون', rows: suppliers.map((s) => ({ 'رقم': s.id, 'الاسم': s.name, 'الهاتف': s.phone, 'العنوان': s.address, 'دين قديم': n(s.opening_balance), 'الباقي لهم': balOf(sbal, s.id) })) },
    { name: 'المشتريات', rows: purchases.map((p) => ({ 'رقم': p.id, 'التاريخ': p.purchase_date, 'المورد': name(p.suppliers), 'المرجع': p.invoice_ref, 'المبلغ': n(p.total), 'المدفوع': n(p.paid) })) },
    { name: 'العمّال', rows: employees.map((e) => ({ 'الاسم': e.full_name, 'الهاتف': e.phone, 'أجر اليوم': n(e.daily_wage), 'تاريخ التوظيف': e.hired_on, 'يعمل': e.active ? 'نعم' : 'لا' })) },
    { name: 'المصاريف', rows: expenses.map((e) => ({ 'التاريخ': e.spent_on, 'الصنف': name(e.expense_categories), 'البيان': e.description, 'المبلغ': n(e.amount), 'الطريقة': pm(e.method) })) },
    { name: 'دفعات الزبائن', rows: cpay.map((p) => ({ 'التاريخ': p.paid_on, 'الزبون': name(p.customers), 'المبلغ': n(p.amount), 'الطريقة': pm(p.method), 'الطلبية': p.order_id, 'ملاحظة': p.notes })) },
    { name: 'دفعات الموردين', rows: spay.map((p) => ({ 'التاريخ': p.paid_on, 'المورد': name(p.suppliers), 'المبلغ': n(p.amount), 'الطريقة': pm(p.method), 'الشراء': p.purchase_id, 'ملاحظة': p.notes })) },
    { name: 'حركات المخزون', rows: moves.map((m) => ({ 'التاريخ': String(m.created_at).slice(0, 16).replace('T', ' '), 'المادة': name(m.materials), 'النوع': MOVE[String(m.type)] ?? m.type, 'الكمية': n(m.qty), 'سعر الوحدة': n(m.unit_cost), 'الطلبية': m.order_id, 'بواسطة': name(m.profiles, 'full_name'), 'ملاحظة': m.note })) },
  ])
}
