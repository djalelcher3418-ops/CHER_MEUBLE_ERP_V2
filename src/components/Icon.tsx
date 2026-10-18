/** أيقونات خطية بسيطة (SVG) */
const PATHS: Record<string, string> = {
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  orders: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2M9 12h6M9 16h4',
  workshop: 'M14.5 5.5l4 4M3 21l7.5-7.5M12.5 7.5l4 4-6 6-4-4zM15 3l6 6-2 2-6-6z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  more: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  scan: 'M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8',
  pay: 'M3 7h18v12H3zM3 11h18M7 15h4',
  customers: 'M9 8a3.5 3.5 0 1 0 0 .01M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .6 3.2 2.5 3.5 5.5',
  materials: 'M3 8l9-5 9 5-9 5zM3 8v8l9 5 9-5V8M12 13v8',
  purchases: 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 8H6M9 20h.01M18 20h.01',
  suppliers: 'M3 17V7h11v10M14 10h4l3 3v4h-7M7 19a2 2 0 1 0 0-.01M18 19a2 2 0 1 0 0-.01',
  employees: 'M12 8a4 4 0 1 0 0 .01M4 21c.8-4 4-6 8-6s7.2 2 8 6',
  expenses: 'M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  logout: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 16l-4-4 4-4M6 12h10',
  back: 'M9 6l6 6-6 6',
  image: 'M3 5h18v14H3zM8.5 10a1.5 1.5 0 1 0 0 .01M21 16l-5-5-9 9',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  team: 'M9 8a3.5 3.5 0 1 0 0 .01M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .6 3.2 2.5 3.5 5.5',
  close: 'M6 6l12 12M18 6L6 18',
  key: 'M15.5 7.5a3.5 3.5 0 1 0 0 .01M13 10l-9 9M7 16l2 2M10 13l2 2',
  designer: 'M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6',
  status: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7zM9 12l2 2 4-4',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  thanks: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4',
}

export type IconName = keyof typeof PATHS

export default function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
