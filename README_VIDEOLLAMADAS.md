# Videollamadas (LiveKit) — Residencia Los Olivos 360

Videollamadas 1 a 1 y grupales pequeñas (hasta 10 personas) con **LiveKit**,
registro de la hora de inicio, la hora de fin y la duración de cada llamada, y
un historial por usuario. Sin frameworks ni bundlers: HTML, CSS y JS vanilla.

## 1. Variables de entorno

En `.env` (nunca en el frontend ni en el repositorio):

```env
LIVEKIT_URL=wss://tu-proyecto.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

Se obtienen en LiveKit Cloud → **Settings → Keys**. Si faltan, el arranque
funciona, pero `POST /api/video/token` y el webhook responden `503`.

## 2. Base de datos

```powershell
npm run db:init      # crea la base y las tablas base (si no existen)
npm run db:migrate   # aplica db/migrations/*.sql (tablas de videollamadas)
```

Tablas nuevas: `rooms`, `room_members`, `calls`, `call_participants`
(todas las horas en `DATETIME(3)` **UTC**, con índices en FKs y en `started_at`).

## 3. Cómo se registran los tiempos

La **fuente de verdad es el webhook de LiveKit**, no el navegador:

| Evento               | Efecto                                                              |
| -------------------- | ------------------------------------------------------------------- |
| `room_started`       | crea la fila en `calls` (`started_at`, `status='active'`)           |
| `participant_joined` | inserta en `call_participants` (`joined_at`)                        |
| `participant_left`   | fija `left_at` y `duration_seconds` del participante                |
| `room_finished`      | fija `ended_at`, `duration_seconds` y `status='ended'` en `calls`   |

Los instantes salen de `event.createdAt` (reloj del servidor LiveKit) y de
`room.creationTime`. El endpoint es **idempotente**: un evento repetido no
duplica filas ni reescribe un tiempo ya fijado (también si llegan desordenados).

Como respaldo, `POST /api/calls/:id/leave` (que el navegador llama con
`navigator.sendBeacon` en `beforeunload` y al pulsar *Colgar*) sólo rellena
huecos: **nunca sobrescribe** nada que haya marcado el webhook.

### Configurar el webhook en LiveKit

1. Exponer el servidor local con HTTPS:

   ```powershell
   ngrok http 3000
   # o
   cloudflared tunnel --url http://localhost:3000
   ```

2. En LiveKit Cloud → **Settings → Webhooks → Add endpoint**:
   - URL: `https://<tu-tunel>/api/livekit/webhook`
   - API key: la misma de `LIVEKIT_API_KEY`
   - Eventos: `room_started`, `room_finished`, `participant_joined`,
     `participant_left`

3. En self-hosted, en `config.yaml` del servidor LiveKit:

   ```yaml
   webhook:
     api_key: <LIVEKIT_API_KEY>
     urls:
       - https://<tu-tunel>/api/livekit/webhook
   ```

La firma la valida `WebhookReceiver` del SDK con la API key/secret, por eso la
ruta se registra **antes** de `express.json()` y usa
`express.raw({ type: 'application/webhook+json' })`.

## 4. Endpoints (todos con el JWT existente, salvo el webhook)

| Método | Ruta                     | Descripción                                                      |
| ------ | ------------------------ | ---------------------------------------------------------------- |
| POST   | `/api/rooms`             | crea la sala y añade miembros (`{ name, member_ids }`)           |
| GET    | `/api/rooms`             | salas en las que participa el usuario                            |
| GET    | `/api/rooms/:id/members` | miembros de una sala (403 si no eres miembro)                    |
| GET    | `/api/users`             | directorio mínimo (`id`, `nombre`, `email`, `rol`) para invitar  |
| POST   | `/api/video/token`       | `{ room_id }` → `{ token, url }`; **403** si no es miembro       |
| GET    | `/api/calls/history`     | historial paginado (`?page=&page_size=&room_id=`)                |
| GET    | `/api/calls/:id`         | detalle con el tiempo de cada participante                       |
| POST   | `/api/calls/:id/leave`   | respaldo de salida (nunca sobrescribe al webhook)                |
| POST   | `/api/livekit/webhook`   | webhook de LiveKit, validado por firma (**sin JWT**)             |

El token de LiveKit (`POST /api/video/token`) lleva `identity = id del usuario`,
`name = nombre visible`, TTL de 1 hora y permisos mínimos: `roomJoin`,
`canPublish`, `canSubscribe` (sin `roomAdmin` ni `roomRecord`).

## 5. Crear una sala y acceder a una llamada

### Desde la interfaz (recomendado)

1. Inicia sesión y abre **Administración → Videollamadas** del menú
   (`llamadas.html`).
2. Escribe un nombre para la sala (o pulsa **Generar**) y busca y marca a las
   personas a las que invitas en la lista de usuarios activos.
3. Pulsa **Crear videollamada y entrar**. Se muestra el enlace de la sala para
   copiarlo y compartirlo, y la nueva sala aparece en **Mis salas**.
4. Pulsa **Entrar**: se abre `sala.html?room_id=<id>`.
5. Cada persona invitada verá la sala en su propio **Mis salas** y entra con un
   clic, o con el enlace compartido (debe tener sesión y ser miembro).

`GET /api/users` sólo devuelve `id`, `nombre`, `email` y `rol` (nunca el hash),
y `GET /api/rooms/:id/members` responde **403** a quien no es miembro.

### Entrar tú solo, sin crear nada

Abre `http://localhost:3000/sala.html` con la sesión iniciada: usa tu primera
sala o, si no tienes ninguna, crea `sala-actual` (donde sólo estás tú).

Para la **misma llamada con otra persona**, ambos tenéis que ser **miembros de la
misma sala** y abrir **la misma URL** (`http://localhost:3000/sala.html?room_id=<id>`).
La forma más rápida, sin tocar curl ni JWT a mano:

```powershell
# 1) Crea las cuentas (una vez). Anota el ID que imprime cada una.
node db/create-admin.js ana@losolivos.es "clave-ana" "Ana"
node db/create-admin.js luis@losolivos.es "clave-luis" "Luis"

# 2) Crea la sala con los dos como miembros e imprime la URL común.
npm run db:sala -- reunion-familia ana@losolivos.es luis@losolivos.es
#   Entrad todos a esta misma URL, cada uno con su sesión iniciada:
#   http://localhost:3000/sala.html?room_id=72
```

También vale por API (mismo resultado que usa el frontend):

```powershell
curl.exe -X POST http://localhost:3000/api/rooms ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer <JWT>" ^
  -d "{\"name\":\"reunion-familia\",\"member_ids\":[2,3]}"
```

> Si abres `?room_id=current` (en vez de un id) se crea una sala nueva por
> usuario (`sala-actual`): sirve para una prueba en solitario, **no** para
> encontrarse dos personas.
>
> Pedir el token de una sala en la que no eres miembro devuelve **403**, y la
> página muestra "La sala no existe o no tienes permiso para entrar en ella".

## 6. Cómo probar con dos usuarios

1. `npm start` (el servidor queda en `http://localhost:3000`).
2. Necesitas dos usuarios: créalos con `db/create-admin.js` y añade ambos a la
   misma sala (paso 5). Si abres una sala nueva con `?room_id=current`, sólo
   entra quien la crea.
3. Abre `http://localhost:3000` en **dos navegadores distintos** (o una ventana
   normal y otra de incógnito), inicia sesión con cada uno y abrid **la misma
   URL de sala** que imprime `npm run db:sala` (paso 5).
4. Comprueba audio, vídeo, silenciar, apagar cámara y compartir pantalla.
5. Cuelga y entra otra vez. Mira el **Historial**: hora de inicio, hora de fin,
   duración (`hh:mm:ss`) y tiempo de cada participante. Las horas se muestran en
   la zona horaria local; en la base de datos están en UTC:

```sql
SELECT id, started_at, ended_at, duration_seconds, status FROM calls ORDER BY id DESC;
SELECT call_id, user_id, joined_at, left_at, duration_seconds, time_source
  FROM call_participants ORDER BY id DESC;
```

> Cámara y micrófono requieren **HTTPS** o `localhost`. Un usuario que no sea
> miembro recibe **403** al pedir el token.

## 7. Pruebas automatizadas

```powershell
npm test
```

Cubren: token de un miembro (con los permisos del JWT), sin JWT (401), sin
permiso (403), `room_id` inválido (400); webhook con firma válida, inválida,
sin firma y body manipulado (401); ciclo completo con **eventos
repetidos** (idempotencia), historial y detalle sólo para miembros, y el
respaldo `leave` sin sobrescribir tiempos del webhook. Limpian lo que crean y se
omiten si MySQL no está disponible.

## 8. Archivos

| Archivo                            | Qué hace                                              |
| ---------------------------------- | ----------------------------------------------------- |
| `db/migrations/001_videollamadas.sql` | tablas nuevas                                      |
| `db/migrate.js`                    | runner de migraciones (`npm run db:migrate`)          |
| `db/crear-sala.js`                 | crea una sala con miembros e imprime la URL (`npm run db:sala`) |
| `api/rooms.js`                     | salas, token de LiveKit, historial y respaldo `leave` |
| `api/livekit-webhook.js`           | webhook firmado e idempotente                         |
| `api/time.js`                      | utilidades de tiempo UTC                              |
| `llamadas.html` / `.css` / `.js`   | crear videollamadas, invitar y listar "Mis salas"    |
| `sala.html` / `sala.css` / `sala.js` | sala de videollamada (LiveKit UMD por CDN)          |
| `historial.html` / `historial.css` / `historial.js` | historial y detalle de llamadas     |
| `test/videollamadas.test.js`       | pruebas de integración (`npm test`)                   |

## 9. Limitaciones conocidas

- **Invitaciones por directorio**: `GET /api/users` lista a todos los usuarios
  activos, así que cualquier usuario autenticado puede invitar a cualquier otro
  a una sala nueva. No hay roles de "quién puede convocar".
- Las salas no se pueden borrar ni cambiar sus miembros desde la interfaz (se
  hace por API o `npm run db:sala`).
- No hay notificaciones: el invitado ve la sala la próxima vez que abra
  **Videollamadas**.
- **Historial por membresía**: un usuario ve las llamadas de sus salas; un
  `admin` puede abrir el detalle de cualquier llamada por id.
- Los tiempos se resuelven con la granularidad del webhook (segundos) y la
  `duration_seconds` se redondea al segundo.
- El respaldo `sendBeacon` puede perderse si el navegador muere de golpe; en ese
  caso manda el webhook (`room_finished` cierra las entradas abiertas).
- Compartir pantalla no está disponible en Safari iOS (limitación del
  navegador); iOS exige `playsinline` en los `<video>` y eso ya está aplicado.
- El `room_id` se respeta en el token (`video.room`), así que el JWT de una sala
  no sirve para entrar en otra.
