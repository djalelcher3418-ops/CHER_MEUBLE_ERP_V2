// عند الضغط على تنبيه رسالة: نفتح التطبيق على صفحة الرسائل
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate('/messages').catch(() => {})
          return c.focus()
        }
      }
      return self.clients.openWindow('/messages')
    }),
  )
})
