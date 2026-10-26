# Asilo 360

Sitio informativo de Asilo 360 para presentar una plataforma de administración, comunicación y cuidado para residencias de adultos mayores. El proyecto incluye una landing page, páginas informativas, una API de contacto local y una configuración PWA.

## Módulos del proyecto

### Interfaz web

- `index.html`: landing page principal y punto de entrada del sitio.
- `pages/nosotros.html`: información sobre el proyecto y el equipo.
- `pages/funcionamiento.html`: descripción de cómo funciona la propuesta.
- `pages/contacto.html`: página informativa de contacto.

### Estilos

- `css/styles.css`: estilos y componentes visuales principales.
- `css/responsive.css`: adaptación de la interfaz a distintos tamaños de pantalla.
- `css/visibility.css`: reglas de visibilidad y contraste disponibles como hoja auxiliar.

### JavaScript del navegador

- `js/main.js`: navegación móvil, avisos, formulario de contacto, instalación PWA y registro del service worker.
- `js/carousel.js`: controles, indicadores y avance automático del carrusel.
- `js/animations.js`: animaciones al entrar elementos en pantalla, desplazamiento suave y efectos visuales.
- `js/enhanced.js`: contadores, preguntas frecuentes, efectos de botones y mejoras de interacción/accesibilidad.

Los scripts se cargan desde `index.html`. Las páginas de `pages/` son documentos HTML informativos independientes.

### Backend de contacto

- `backend/server.py`: servidor HTTP para desarrollo, publicación de archivos permitidos y endpoint `POST /api/contact`.
- `backend/tests/test_server.py`: pruebas unitarias del servidor y del guardado de mensajes.
- `backend/data/`: ubicación generada para la base de datos SQLite; no se debe publicar ni editar manualmente.

El formulario de la página principal envía los mensajes a la API, que valida los datos y los guarda en SQLite. No se envían correos electrónicos.

### PWA

- `manifest.json`: nombre, colores, pantalla de inicio e iconos de la aplicación instalable.
- `service-worker.js`: caché de recursos del sitio, estrategia de red y página de respaldo sin conexión.
- `assets/images/`: logo e iconos usados por la web y la PWA.

Para probar las funciones PWA, sirve el sitio desde `localhost` o mediante HTTPS.

### Data Connect (esquema de referencia)

- `dataconnect/schema/schema.gql`: modelos de referencia para residentes, usuarios, signos vitales, medicamentos y comunicaciones.
- `dataconnect/dataconnect.yaml`: configuración del servicio.
- `dataconnect/example/`: conector y consultas de ejemplo.
- `dataconnect/seed_data.gql`: datos iniciales de ejemplo.

Esta configuración de Data Connect no está conectada al flujo actual del sitio. El formulario de contacto usa el backend Python y SQLite.

## Estructura

```text
Asilo360/
├── assets/
│   └── images/
├── backend/
│   ├── data/                 # SQLite creada al ejecutar el backend
│   ├── tests/
│   └── server.py
├── css/
├── dataconnect/
│   ├── example/
│   └── schema/
├── js/
├── pages/
├── index.html
├── manifest.json
└── service-worker.js
```

## Requisitos

- Python 3.14 o superior.
- No se requieren dependencias de Python externas; el backend usa la biblioteca estándar.

## Ejecutar localmente en Windows

Desde la carpeta raíz del proyecto, crea un entorno virtual si todavía no existe:

```powershell
python -m venv .venv
```

Inicia el servidor:

```powershell
.\.venv\Scripts\python.exe backend\server.py
```

Abre <http://localhost:8000>. La base de datos se crea automáticamente en `backend/data/messages.sqlite3`.

Configuración opcional mediante variables de entorno:

| Variable | Valor predeterminado | Descripción |
| --- | --- | --- |
| `ASILO360_HOST` | `127.0.0.1` | Dirección en la que escucha el servidor. |
| `ASILO360_PORT` | `8000` | Puerto HTTP. |
| `ASILO360_DATABASE_PATH` | `backend/data/messages.sqlite3` | Ruta de la base de datos SQLite. |

## API de contacto

`POST /api/contact` recibe JSON con estos cuatro campos obligatorios:

```json
{
  "name": "Nombre",
  "email": "persona@example.com",
  "subject": "Asunto",
  "message": "Mensaje"
}
```

Una respuesta exitosa usa el estado `201` e incluye el identificador del mensaje. Los errores de validación se devuelven como JSON con un campo `error`. El backend valida el formato del correo, la longitud de los campos y el tamaño de la solicitud.

## Pruebas

Ejecuta las pruebas del backend desde la raíz:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend\tests -v
```

## Documentación adicional

## Videollamadas

El sitio incluye videollamadas con LiveKit: páginas `sala.html` y
`historial.html`, endpoints en `api/rooms.js` y el webhook firmado en
`api/livekit-webhook.js`. Para configurarlas (variables de entorno, migraciones,
webhook y pruebas) consulta [README_VIDEOLLAMADAS.md](./README_VIDEOLLAMADAS.md).

- [DOCUMENTATION.md](./DOCUMENTATION.md): arquitectura y documentación técnica general.
- [BACKEND_DOCUMENTATION.md](./BACKEND_DOCUMENTATION.md): API, almacenamiento y detalles del backend.

## Alcance y despliegue

El sitio es informativo; no incluye autenticación, panel administrativo ni gestión de residentes conectada a una base de datos. Data Connect es solo una estructura de referencia en esta versión.

El servidor incluido es para desarrollo local, no para producción. Para publicar el proyecto, usa un servidor de producción, HTTPS y una configuración segura para el almacenamiento de datos.
