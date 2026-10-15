// أنواع البيانات — مطابقة لجداول supabase/001_phase1.sql

export type Role = 'admin' | 'worker'
export type Unit = 'piece' | 'sheet' | 'meter' | 'm2' | 'kg' | 'liter' | 'roll' | 'box'
export type MovementType = 'in' | 'out' | 'adjust'
export type PayMethod = 'cash' | 'cheque' | 'transfer'

export interface Profile {
  id: string
  full_name: string
  role: Role
  phone: string | null
  active: boolean
}

export interface Category {
  id: number
  name: string
}

export interface Material {
  id: number
  name: string
  category_id: number | null
  unit: Unit
  barcode: string
  qty: number
  avg_cost: number
  min_qty: number
  notes: string | null
  active: boolean
}

/** ما يراه العامل: بدون أسعار */
export interface MaterialPublic {
  id: number
  name: string
  category: string | null
  unit: Unit
  barcode: string
  qty: number
  min_qty: number
  low_stock: boolean
}

export interface Supplier {
  id: number
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  opening_balance: number
  active: boolean
}

export interface SupplierBalance {
  id: number
  name: string
  phone: string | null
  balance: number
}

export interface PurchaseTotal {
  id: number
  supplier_id: number | null
  purchase_date: string
  invoice_ref: string | null
  total: number
  paid: number
}

export interface PurchaseItemInput {
  material_id: number
  qty: number
  unit_price: number
}

export interface StockMovement {
  id: number
  material_id: number
  type: MovementType
  qty: number
  unit_cost: number | null
  note: string | null
  created_by: string | null
  created_at: string
}

export const UNIT_LABELS: Record<Unit, string> = {
  piece: 'قطعة',
  sheet: 'لوح',
  meter: 'متر',
  m2: 'م²',
  kg: 'كغ',
  liter: 'لتر',
  roll: 'لفّة',
  box: 'علبة',
}

export const PAY_LABELS: Record<PayMethod, string> = {
  cash: 'نقدًا',
  cheque: 'صك',
  transfer: 'تحويل',
}

// ---------- المرحلة 2: الزبائن والطلبيات ----------

export type OrderStatus = 'new' | 'in_production' | 'ready' | 'delivered' | 'cancelled'

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'جديدة',
  in_production: 'في الورشة',
  ready: 'جاهزة',
  delivered: 'سُلّمت',
  cancelled: 'ملغاة',
}

export interface Customer {
  id: number
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  opening_balance: number
  active: boolean
}

export interface CustomerBalance {
  id: number
  name: string
  phone: string | null
  balance: number
}

export interface Order {
  id: number
  customer_id: number
  title: string
  order_date: string
  due_date: string | null
  status: OrderStatus
  discount: number
  notes: string | null
  delivered_on: string | null
  /** عرض سعر لم يُحوَّل بعد إلى طلبية (المرحلة 11) */
  is_quote?: boolean
}

export interface OrderTotal {
  id: number
  customer_id: number
  customer_name: string
  title: string
  order_date: string
  due_date: string | null
  status: OrderStatus
  discount: number
  delivered_on: string | null
  total: number
  paid: number
  material_cost: number
  /** عرض سعر لم يُحوَّل بعد إلى طلبية (المرحلة 11) */
  is_quote?: boolean
}

export interface OrderItem {
  id: number
  order_id: number
  description: string
  qty: number
  unit_price: number
  /** مقاس السرير أو «أريكة» (المرحلة 12) */
  size?: string | null
  /** نوع القماش ونوع الأرجل (المرحلة 13) */
  fabric?: string | null
  legs?: string | null
}

/** مقاسات الأسرّة المعتادة في الورشة */
export const BED_SIZES = ['90/190', '120/190', '140/190', '160/190', '180/200', 'أريكة'] as const

/** وصف السطر كما يُعرض: «سرير — 160/190» */
export const lineLabel = (description: string, size?: string | null) =>
  size ? (description ? `${description} — ${size}` : size) : description

/** تفاصيل السطر: «قماش: قطيفة رمادي · أرجل: خشب» (فارغ إن لم يُحدَّدا) */
export const lineExtras = (fabric?: string | null, legs?: string | null) =>
  [fabric && `قماش: ${fabric}`, legs && `أرجل: ${legs}`].filter(Boolean).join(' · ')

/** ما يراه العامل: الطلبيات الجارية بدون مبالغ */
export interface OrderPublic {
  id: number
  title: string
  customer_name: string
  due_date: string | null
  status: OrderStatus
}

export interface CustomerPayment {
  id: number
  customer_id: number
  order_id: number | null
  amount: number
  paid_on: string
  method: PayMethod
  notes: string | null
}

// ---------- المرحلة 3: العمّال والرواتب والمصاريف ----------

export interface Employee {
  id: number
  full_name: string
  phone: string | null
  daily_wage: number
  profile_id: string | null
  hired_on: string | null
  notes: string | null
  active: boolean
}

export interface Absence {
  id: number
  employee_id: number
  day: string
  half_day: boolean
  note: string | null
}

export interface Advance {
  id: number
  employee_id: number
  amount: number
  given_on: string
  notes: string | null
}

export interface PayrollPayment {
  id: number
  employee_id: number
  period_start: string
  period_end: string
  days_worked: number
  daily_wage: number
  gross: number
  advances: number
  amount: number
  paid_on: string
  notes: string | null
}

export interface ExpenseCategory {
  id: number
  name: string
}

export interface Expense {
  id: number
  category_id: number | null
  amount: number
  spent_on: string
  description: string | null
  method: PayMethod
}
