// يُضاف إلى عامل الخدمة (Service Worker) الذي يبنيه vite-plugin-pwa

// تنبيه قادم من الخادم: يظهر حتى والتطبيق مغلق
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  event.waitUntil(
    self.registration.showNotification(data.title || 'CHER MEUBLE', {
      body: data.body || '',
      tag: data.tag,
      renotify: !!data.tag,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      dir: 'rtl',
      lang: 'ar',
      data: { url: data.url || '/' },
    }),
  )
})

// الضغط على التنبيه: نفتح التطبيق على الصفحة المعنية
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/messages'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(url).catch(() => {})
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
