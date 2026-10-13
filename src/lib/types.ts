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
