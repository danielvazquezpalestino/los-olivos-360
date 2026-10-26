ROL
Eres un ingeniero full-stack senior. Vas a agregar videollamadas a un sistema web existente. Revisa el código existente antes de modificar, trabaja por pasos pequeños y no rompas funcionalidades actuales.

CONTEXTO DEL PROYECTO
- Backend: Node.js (Express).
- Base de datos: MySQL.
- Autenticación: JWT (ya existe; reutiliza su middleware, no crees otro sistema de login).
- Frontend: nativo, solo HTML, CSS y JavaScript vanilla. NO uses React, Vue ni bundlers (webpack/vite).
- Proveedor de video: LiveKit (livekit-server-sdk en el backend y livekit-client en el frontend). No implementes WebRTC desde cero ni servidores STUN/TURN propios.
- Tipo de llamada: 1 a 1 y grupal pequeña (hasta 10 participantes).
- Requisito clave: registrar la hora de inicio, la hora de fin y la duración de cada llamada, y mostrar un historial.

PASOS

1. EXPLORACIÓN
   Revisa estructura de carpetas, rutas, middleware JWT, conexión a MySQL y manejo de variables de entorno. Resume lo que encontraste antes de escribir código.

2. BASE DE DATOS (MySQL)
   Crea las migraciones/SQL para:
   - rooms: id, name, created_by (FK users), created_at.
   - room_members: room_id, user_id (quiénes tienen permiso de entrar).
   - calls: id, room_id, livekit_room_sid, started_at, ended_at, duration_seconds, status ('active' | 'ended').
   - call_participants: id, call_id, user_id, joined_at, left_at, duration_seconds.
   Usa DATETIME en UTC, índices en las FK y en started_at.

3. BACKEND
   Instala livekit-server-sdk. Variables de entorno: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET (nunca en el frontend ni en el repo).
   Endpoints (todos protegidos con el middleware JWT existente):
   - POST /api/rooms: crear sala y agregar miembros.
   - POST /api/video/token: recibe room_id; valida que el usuario sea miembro; genera un AccessToken de LiveKit con identity = id del usuario, name = nombre visible, TTL de 1 hora y permisos mínimos (roomJoin, canPublish, canSubscribe). Devuelve { token, url }.
   - GET /api/calls/history: historial paginado de las llamadas del usuario (sala, fecha y hora de inicio, fin, duración, participantes).
   - GET /api/calls/:id: detalle de una llamada con la lista de participantes y el tiempo de cada uno.

4. REGISTRO DE TIEMPOS (fuente de verdad: webhooks de LiveKit)
   - Crea POST /api/livekit/webhook (SIN middleware JWT; se valida con WebhookReceiver del SDK usando la API key/secret).
   - Este endpoint necesita el body crudo: usa express.raw({ type: 'application/webhook+json' }) solo en esa ruta.
   - Maneja los eventos:
     * room_started -> crea registro en calls (started_at, status 'active').
     * participant_joined -> inserta en call_participants (joined_at).
     * participant_left -> actualiza left_at y duration_seconds del participante.
     * room_finished -> actualiza ended_at, duration_seconds y status 'ended' en calls.
   - Hazlo idempotente (los webhooks pueden repetirse) y no confíes en el cliente para los tiempos.
   - Para desarrollo local, documenta cómo exponer el webhook con ngrok o cloudflared y cómo configurarlo en el panel de LiveKit.
   - Como respaldo opcional: endpoint POST /api/calls/:id/leave que el cliente llame al salir, usando navigator.sendBeacon en beforeunload. Solo como apoyo, nunca sobrescribas datos que ya vengan del webhook.

5. FRONTEND (HTML/CSS/JS vanilla)
   - Carga livekit-client por CDN (build UMD, expone el objeto global LivekitClient): https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js
   - Crea dos páginas:
     * sala.html + sala.js: pide el token a /api/video/token con el JWT en el header Authorization, crea new LivekitClient.Room(), hace room.connect(url, token), activa cámara y micrófono con room.localParticipant.setCameraEnabled(true) / setMicrophoneEnabled(true).
     * historial.html + historial.js: consume /api/calls/history y muestra una tabla con sala, fecha, hora de inicio, hora de fin, duración (formato hh:mm:ss) y participantes.
   - Maneja los eventos de Room: TrackSubscribed (crear <video>/<audio> y adjuntar con track.attach()), TrackUnsubscribed (remover elementos), ParticipantConnected / ParticipantDisconnected, Disconnected.
   - Cuadrícula de video responsive en CSS (grid), con tu video local en pequeño.
   - Botones: silenciar micrófono, apagar cámara, compartir pantalla (setScreenShareEnabled), colgar.
   - Estados de UI: cargando, permisos de cámara/micrófono denegados, error de conexión, llamada terminada.
   - Debe funcionar en escritorio y móvil (Safari iOS incluido: los <video> necesitan playsinline).
   - Muestra las horas en la zona horaria local del usuario (el servidor guarda UTC).

6. SEGURIDAD
   - HTTPS obligatorio (el navegador lo exige para cámara y micrófono; localhost está exento).
   - Un usuario que no sea miembro de la sala recibe 403 al pedir el token.
   - Valida y sanea todas las entradas, usa consultas parametrizadas en MySQL.
   - El API secret jamás aparece en archivos del frontend.

7. PRUEBAS
   - Prueba manual con dos usuarios en navegadores distintos: audio, video, salir y volver a entrar.
   - Verifica en MySQL que se crearon los registros en calls y call_participants con tiempos coherentes.
   - Pruebas automatizadas del endpoint de token (autenticado, sin JWT, sin permiso) y del webhook (firma válida e inválida, evento repetido).

8. DOCUMENTACIÓN
   README corto con: variables de entorno, cómo correr las migraciones, cómo configurar el webhook, cómo crear una sala y cómo probar con dos usuarios.

REGLAS
- Cambios pequeños y revisables, un commit lógico por paso.
- Si algo es ambiguo, pregunta antes de asumir.
- No agregues dependencias innecesarias.
- Al terminar entrega: lista de archivos creados/modificados, cómo probarlo y limitaciones conocidas.

CRITERIOS DE ÉXITO
- Dos usuarios autenticados entran a la misma sala y se ven y oyen.
- Al terminar la llamada, el historial muestra hora de inicio, hora de fin y duración correctas, y el tiempo de cada participante.
- Un usuario sin permiso recibe 403.
- El API secret no está en el frontend ni en el repositorio.