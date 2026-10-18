/** بحث بدون اعتبار الهمزات والتاء المربوطة والتشكيل والحروف الكبيرة: «اسفنج» يجد «إسفنج» */
export const fold = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') // é → e
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْ]/g, '')
    .replace(/\s+/g, ' ').trim()

/** أقرب اسم في القائمة: مطابق تمامًا، ثم يحتوي أحدهما الآخر (لأسماء من 3 أحرف فأكثر) */
export function bestMatch<T extends { name: string }>(name: string | null | undefined, list: T[]): T | undefined {
  const f = fold(name ?? '')
  if (f.length < 2) return undefined
  return list.find((x) => fold(x.name) === f)
    ?? list.find((x) => { const g = fold(x.name); return g.length >= 3 && f.length >= 3 && (g.includes(f) || f.includes(g)) })
}
