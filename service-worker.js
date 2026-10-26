const CACHE = 'los-olivos-v8';

// App shell: se precachea en la instalacion.
const ASSETS = [
  './index.html',
  './admin.html',
  './contactos.html',
  './login.html',
  './historial.html',
  './llamadas.html',
  './styles.css',
  './script.js',
  './historial.js',
  './historial.css',
  './llamadas.js',
  './llamadas.css',
  './manifest.JSON',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * App shell (HTML, CSS, JS, iconos): stale-while-revalidate.
 * Sirve la copia cacheada de inmediato (carga instantánea) y actualiza
 * la caché en segundo plano con la respuesta de la red.
 */
function staleWhileRevalidate(request) {
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API: siempre red. Los datos de visitas/contactos son dinámicos;
  // nunca se sirven respuestas viejas desde la caché del navegador.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Navegaciones (abrir /, /login.html, instalar la PWA...): siempre red.
  // Servir el HTML desde caché puede dejar una página vieja o la raíz antigua,
  // que es justo lo que provocaba entrar al panel sin pasar por el login.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(url.pathname === '/' ? './login.html' : request)
          .then((response) => response || caches.match('./login.html'))
      )
    );
    return;
  }

  // Resto (CSS, JS, iconos): stale-while-revalidate.
  // Sin red y sin caché se devuelve 404 para el asset, no el HTML del login.
  event.respondWith(
    staleWhileRevalidate(request).catch(() => new Response('', { status: 404 }))
  );
});
