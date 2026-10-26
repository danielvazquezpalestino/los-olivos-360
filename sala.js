'use strict';

// Videollamada 1 a 1 o grupal (máx. 10) con LiveKit.
// - El token lo emite el backend (/api/video/token) comprobando la membresía.
// - Los tiempos de la llamada los registra el webhook de LiveKit en el servidor;
//   aquí no se calcula ninguna duración.

/* global LivekitClient */

const params = new URLSearchParams(window.location.search);
const roomIdParam = params.get('room_id') || params.get('room');

const el = {
  salaNombre: document.getElementById('salaNombre'),
  salaEstado: document.getElementById('salaEstado'),
  pantallaEstado: document.getElementById('pantallaEstado'),
  spinner: document.getElementById('spinner'),
  estadoTitulo: document.getElementById('estadoTitulo'),
  estadoTexto: document.getElementById('estadoTexto'),
  estadoAcciones: document.getElementById('estadoAcciones'),
  pantallaLlamada: document.getElementById('pantallaLlamada'),
  grid: document.getElementById('gridVideo'),
  estadoVacio: document.getElementById('estadoVacio'),
  videoLocal: document.getElementById('videoLocal'),
  localAvatar: document.getElementById('localAvatar'),
  localNombre: document.getElementById('localNombre'),
  localMudo: document.getElementById('localMudo'),
  btnMicro: document.getElementById('btnMicro'),
  txtMicro: document.getElementById('txtMicro'),
  btnCamara: document.getElementById('btnCamara'),
  txtCamara: document.getElementById('txtCamara'),
  btnPantalla: document.getElementById('btnPantalla'),
  txtPantalla: document.getElementById('txtPantalla'),
  btnColgar: document.getElementById('btnColgar'),
};

let room = null;
let salaActual = null; // { id, name } de la sala abierta
let callId = null; // id en `calls`, para el endpoint de respaldo al salir
let finalizado = false;
let timerCall = null;

// --- UI: estados --------------------------------------------------------------

/**
 * Muestra una pantalla de estado a pantalla completa.
 * @param {string} titulo
 * @param {string} texto
 * @param {{ spinner?: boolean, acciones?: Array<{ texto: string, onClick?: Function, href?: string, primario?: boolean }>, tono?: string }} [opciones]
 */
function mostrarEstado(titulo, texto, opciones = {}) {
  el.pantallaLlamada.hidden = true;
  el.pantallaEstado.hidden = false;
  el.estadoTitulo.textContent = titulo;
  el.estadoTexto.textContent = texto;
  el.spinner.hidden = !opciones.spinner;

  el.estadoAcciones.innerHTML = '';
  for (const accion of opciones.acciones || []) {
    const nodo = accion.href ? document.createElement('a') : document.createElement('button');
    nodo.textContent = accion.texto;
    nodo.className = 'btn' + (accion.primario ? ' btn-primario' : '');
    if (accion.href) nodo.href = accion.href;
    else {
      nodo.type = 'button';
      nodo.addEventListener('click', accion.onClick);
    }
    el.estadoAcciones.appendChild(nodo);
  }

  setEstadoCabecera(opciones.tono || '', opciones.tono === 'error' ? 'Error' : '');
}

/**
 * Texto pequeño del estado en la cabecera.
 * @param {'alerta'|'error'|''} tono
 * @param {string} texto
 */
function setEstadoCabecera(tono, texto) {
  el.salaEstado.className = 'sala-estado' + (tono ? ` ${tono}` : '');
  if (texto) el.salaEstado.textContent = texto;
}

/**
 * Muestra la llamada en marcha.
 */
function mostrarLlamada() {
  el.pantallaEstado.hidden = true;
  el.pantallaLlamada.hidden = false;
}

// --- API ----------------------------------------------------------------------

async function apiFetch(url, options = {}) {
  return fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
}

/**
 * Resuelve qué sala abrir: por ?room_id, por ?room=nombre o la primera del usuario.
 * @returns {Promise<{ id: number, name: string } | null>}
 */
async function resolverSala() {
  if (roomIdParam === 'current' || roomIdParam === '') return abrirSalaActual();

  const res = await apiFetch('/api/rooms');
  if (res.status === 401) {
    window.location.replace('/login.html');
    return null;
  }
  const data = await res.json();
  if (!data.ok) throw new Error('No se pudieron cargar tus salas.');

  const rooms = data.rooms || [];
  if (rooms.length === 0) {
    return {
      vacio: true,
      mensaje:
        'Todavía no perteneces a ninguna sala. Pide a un administrador que te añada a una sala de videollamada.',
    };
  }

  if (!roomIdParam) return rooms[0];

  const buscada = rooms.find(
    (r) => String(r.id) === String(roomIdParam) || r.name === roomIdParam
  );
  if (!buscada) {
    return { vacio: true, mensaje: 'La sala no existe o no tienes permiso para entrar en ella.' };
  }
  return buscada;
}

/**
 * Crea (o reutiliza) la sala personal "actual" con los 10 admins/usuarios
 * más recientes. Es un atajo para tener algo que probar sin panel de salas.
 * @returns {Promise<{ id: number, name: string }>}
 */
async function abrirSalaActual() {
  const nombre = 'sala-actual';
  const res = await apiFetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nombre }),
  });
  const data = await res.json();
  if (data.ok) return data.room;
  if (res.status === 409) {
    const listado = await apiFetch('/api/rooms').then((r) => r.json());
    const existente = (listado.rooms || []).find((r) => r.name === nombre);
    if (existente) return existente;
  }
  throw new Error((data.errors || ['No se pudo crear la sala.']).join(' '));
}

/**
 * Pide el token de LiveKit al backend (JWT por cookie en la misma origen).
 * @param {number} roomId
 * @returns {Promise<{ token: string, url: string } | { error: string }>}
 */
async function pedirToken(roomId) {
  const res = await apiFetch('/api/video/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: roomId }),
  });

  if (res.status === 401) {
    window.location.replace('/login.html');
    return { error: 'Sesión expirada.' };
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 403) {
    return { error: 'No tienes permiso para entrar en esta sala (403).' };
  }
  if (!res.ok || !data.ok) {
    return { error: (data.errors || ['No se pudo obtener el acceso a la sala.']).join(' ') };
  }
  return { token: data.token, url: data.url };
}

// --- Render de participantes --------------------------------------------------

const tiles = new Map(); // participantSid -> elemento .tile

/**
 * Crea el tile de un participante remoto.
 * @param {any} participant
 * @returns {HTMLElement}
 */
function crearTile(participant) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.sid = participant.sid;
  tile.dataset.identity = participant.identity;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true; // obligatorio en Safari iOS
  tile.appendChild(video);

  const avatar = document.createElement('div');
  avatar.className = 'tile-avatar';
  avatar.textContent = inicial(participant.name || participant.identity);
  tile.appendChild(avatar);

  const etiqueta = document.createElement('div');
  etiqueta.className = 'tile-etiqueta';
  etiqueta.textContent = participant.name || participant.identity;
  tile.appendChild(etiqueta);

  const mudo = document.createElement('div');
  mudo.className = 'tile-mudo';
  mudo.textContent = '🔇';
  mudo.hidden = true;
  tile.appendChild(mudo);

  tiles.set(participant.sid, tile);
  el.grid.appendChild(tile);
  actualizarEstadoVacio();
  return tile;
}

/**
 * Primera letra en mayúscula de un nombre.
 * @param {string} texto
 * @returns {string}
 */
function inicial(texto) {
  const limpio = String(texto || '?').trim();
  return limpio ? limpio.charAt(0).toUpperCase() : '?';
}

/**
 * Quita el tile de un participante.
 * @param {string} sid
 */
function quitarTile(sid) {
  const tile = tiles.get(sid);
  if (!tile) return;
  // Detach explícito de las pistas para liberar cámaras/micrófonos remotos.
  tile.querySelectorAll('video, audio').forEach((media) => media.remove());
  tile.remove();
  tiles.delete(sid);
  actualizarEstadoVacio();
}

function actualizarEstadoVacio() {
  const hayRemotos = tiles.size > 0;
  el.estadoVacio.hidden = hayRemotos;
  el.grid.classList.toggle('solo-local', !hayRemotos);
}

/**
 * Muestra u oculta la cámara en el tile y su avatar.
 * @param {HTMLElement|null} tile
 * @param {boolean} visible
 */
function marcarCamara(tile, visible) {
  if (!tile) return;
  const video = tile.querySelector('video');
  const avatar = tile.querySelector('.tile-avatar');
  if (video) video.style.visibility = visible ? 'visible' : 'hidden';
  if (avatar) avatar.hidden = visible;
}

function marcarMicro(tile, silenciado) {
  if (!tile) return;
  const badge = tile.querySelector('.tile-mudo');
  if (badge) badge.hidden = !silenciado;
}

/**
 * Refresca cámara/micro de un tile según el estado del participante.
 * @param {any} participant
 */
function actualizarIndicadores(participant) {
  const tile = tiles.get(participant.sid);
  if (!tile) return;
  const tieneCamara = participant.isCameraEnabled;
  marcarCamara(tile, tieneCamara);
  marcarMicro(tile, !participant.isMicrophoneEnabled);
}

// --- Pistas de audio/vídeo ----------------------------------------------------

/**
 * Adjunta una pista remota al DOM.
 * @param {any} track
 * @param {any} publication
 * @param {any} participant
 */
function adjuntarPista(track, publication, participant) {
  if (!participant || participant === room.localParticipant) return;

  const tile = tiles.get(participant.sid) || crearTile(participant);
  const elemento = track.attach();

  if (track.kind === 'video') {
    if (publication && publication.source === 'screen_share') {
      // La pantalla compartida se muestra en un tile propio, más grande.
      const screenTile = obtenerTilePantalla(participant);
      screenTile.querySelector('video')?.remove();
      elemento.classList.add('video-pantalla');
      screenTile.prepend(elemento);
      screenTile.hidden = false;
    } else {
      const videoActual = tile.querySelector('video');
      videoActual?.replaceWith(elemento);
      elemento.playsInline = true;
      elemento.autoplay = true;
      elemento.style.visibility = 'visible';
    }
  } else if (track.kind === 'audio') {
    // El audio remoto no necesita verse, pero sí estar en el DOM para sonar.
    elemento.autoplay = true;
    elemento.hidden = true;
    tile.appendChild(elemento);
  }
}

function obtenerTilePantalla(participant) {
  const id = `pantalla-${participant.sid}`;
  let tile = document.getElementById(id);
  if (tile) return tile;

  tile = document.createElement('div');
  tile.id = id;
  tile.className = 'tile tile-pantalla';
  const etiqueta = document.createElement('div');
  etiqueta.className = 'tile-etiqueta';
  etiqueta.textContent = `Pantalla de ${participant.name || participant.identity}`;
  tile.appendChild(etiqueta);
  el.grid.prepend(tile);
  return tile;
}

/**
 * Quita la pista remota del DOM.
 * @param {any} track
 * @param {any} publication
 * @param {any} participant
 */
function quitarPista(track, publication, participant) {
  if (track.kind === 'video' && publication && publication.source === 'screen_share') {
    const tile = document.getElementById(`pantalla-${participant?.sid}`);
    if (tile) {
      track.detach().forEach((nodo) => nodo.remove());
      const etiqueta = tile.querySelector('.tile-etiqueta');
      const video = tile.querySelector('video');
      if (video) video.remove();
      // Se queda el tile oculto hasta que otro comparta pantalla.
      tile.hidden = true;
      if (etiqueta) etiqueta.style.display = '';
    }
    return;
  }
  track.detach().forEach((nodo) => nodo.remove());
}

// --- Conexión ---------------------------------------------------------------

/**
 * Traduce errores de conexión/permisos a mensajes accionables.
 * @param {Error} error
 * @returns {{ titulo: string, texto: string }}
 */
function interpretarError(error) {
  const nombre = error?.name || '';
  const mensaje = String(error?.message || error || '');

  if (nombre === 'NotAllowedError' || /permission|denied|not allowed/i.test(mensaje)) {
    return {
      titulo: 'Permisos denegados',
      texto:
        'Necesitamos acceso a tu cámara y micrófono para la videollamada.\n' +
        'Permítelo en el candado de la barra de direcciones (o en los ajustes del navegador) y vuelve a intentarlo.',
    };
  }
  if (nombre === 'NotFoundError' || /device not found|no.*device/i.test(mensaje)) {
    return {
      titulo: 'No encontramos cámara o micrófono',
      texto: 'Conecta un dispositivo de audio/vídeo o comprueba que otro programa no lo esté usando.',
    };
  }
  if (nombre === 'NotReadableError' || /could not start|in use/i.test(mensaje)) {
    return {
      titulo: 'Dispositivo ocupado',
      texto: 'Otra aplicación (o pestaña) está usando la cámara o el micrófono. Ciérrala y reintenta.',
    };
  }
  if (/WebSocket|signal|connection|network|timeout/i.test(mensaje)) {
    return {
      titulo: 'Error de conexión',
      texto: 'No pudimos conectar con el servidor de vídeo. Comprueba tu conexión y vuelve a intentarlo.',
    };
  }
  return {
    titulo: 'No se pudo iniciar la llamada',
    texto: mensaje || 'Ha ocurrido un error inesperado.',
  };
}

async function iniciar() {
  if (typeof LivekitClient === 'undefined') {
    mostrarEstado('Sin conexión al cliente de vídeo', 'No se pudo cargar livekit-client desde el CDN. Revisa tu conexión y recarga la página.', {
      tono: 'error',
      acciones: [{ texto: 'Recargar', onClick: () => window.location.reload(), primario: true }],
    });
    return;
  }

  // Cámara/micrófono sólo funcionan en contextos seguros (HTTPS o localhost).
  if (!window.isSecureContext) {
    mostrarEstado(
      'Necesitas una conexión segura (HTTPS)',
      'El navegador no permite usar cámara ni micrófono fuera de HTTPS o localhost.',
      { tono: 'error' }
    );
    return;
  }

  mostrarEstado('Conectando…', 'Comprobando tu acceso a la sala.', { spinner: true });

  let sala;
  try {
    sala = await resolverSala();
  } catch (error) {
    const { titulo, texto } = interpretarError(error);
    mostrarEstado(titulo, texto, { tono: 'error' });
    return;
  }

  if (!sala || sala.vacio) {
    mostrarEstado('No hay sala disponible', sala?.mensaje || 'No se pudo determinar la sala.', {
      acciones: [{ texto: 'Volver al inicio', href: 'index.html', primario: true }],
    });
    setEstadoCabecera('error', 'Sin acceso');
    return;
  }

  salaActual = sala;
  el.salaNombre.textContent = sala.name;

  const credenciales = await pedirToken(sala.id);
  if (credenciales.error) {
    mostrarEstado('No se pudo entrar', credenciales.error, {
      tono: 'error',
      acciones: [{ texto: 'Volver al inicio', href: 'index.html', primario: true }],
    });
    return;
  }

  mostrarEstado('Pidiendo permiso de cámara y micrófono', 'Acepta el aviso del navegador para entrar en la llamada.', {
    spinner: true,
  });

  room = new LivekitClient.Room({
    adaptiveStream: true,
    dynacast: true,
  });

  registrarEventos();

  try {
    // El navegador pide los permisos aquí (si se paso `autoSubscribe` por defecto).
    await room.connect(credenciales.url, credenciales.token);
  } catch (error) {
    const { titulo, texto } = interpretarError(error);
    mostrarEstado(titulo, texto, {
      tono: 'error',
      acciones: [
        { texto: 'Reintentar', onClick: () => window.location.reload(), primario: true },
        { texto: 'Volver al inicio', href: 'index.html' },
      ],
    });
    return;
  }

  // El token concede canPublish: publicamos cámara y micrófono.
  try {
    await room.localParticipant.setCameraEnabled(true);
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch (error) {
    const { titulo, texto } = interpretarError(error);
    // Ya estamos dentro: se queda en la llamada sin publicar, con aviso.
    mostrarLlamada();
    setEstadoCabecera('alerta', 'Sin cámara/micrófono');
    el.salaNombre.title = `${titulo}: ${texto}`;
    actualizarBotonesLocales();
    await buscarCallActiva(salaActual);
    return;
  }

  mostrarLlamada();
  setEstadoCabecera('', `Conectado como ${room.localParticipant.name || 'tú'}`);

  el.localNombre.textContent = (room.localParticipant.name || 'Tú') + ' (tú)';
  el.localAvatar.textContent = inicial(room.localParticipant.name || 'Tú');

  // Vídeo local.
  const camaraPub = room.localParticipant.getTrackPublication(
    LivekitClient.Track.Source.Camera
  );
  if (camaraPub?.track) el.videoLocal.srcObject = new MediaStream([camaraPub.track.mediaStreamTrack]);
  el.videoLocal.play?.().catch(() => { });

  actualizarBotonesLocales();

  // Participantes que ya estaban dentro cuando entramos.
  room.remoteParticipants.forEach((participant) => {
    crearTile(participant);
    participant.trackPublications.forEach((pub) => {
      if (pub.track) adjuntarPista(pub.track, pub, participant);
    });
    actualizarIndicadores(participant);
  });
  actualizarEstadoVacio();

  await buscarCallActiva(salaActual);
}

/**
 * Guarda el id de la llamada activa de la sala, para el `sendBeacon` al salir.
 * El webhook puede tardar unos segundos en crear el registro, así que si aún
 * no hay llamada activa se reintenta cada 10 s mientras sigamos conectados.
 * @param {{ id: number, name: string }} sala
 */
async function buscarCallActiva(sala) {
  const intentar = async () => {
    if (callId || finalizado) return;
    callId = await consultarCallActiva(sala.id);
    if (callId && timerCall) {
      clearInterval(timerCall);
      timerCall = null;
    }
  };

  await intentar();
  if (!callId && !timerCall) timerCall = setInterval(intentar, 10000);
}

/**
 * Pregunta al historial por la llamada activa más reciente de la sala.
 * @param {number} roomId
 * @returns {Promise<number|null>}
 */
async function consultarCallActiva(roomId) {
  try {
    const res = await apiFetch(`/api/calls/history?room_id=${encodeURIComponent(roomId)}&page_size=1`);
    if (!res.ok) return null;
    const data = await res.json();
    const ultima = (data.calls || [])[0];
    return ultima && ultima.status === 'active' ? ultima.id : null;
  } catch (error) {
    return null;
  }
}

function registrarEventos() {
  const L = LivekitClient;

  room.on(L.RoomEvent.ParticipantConnected, (participant) => {
    crearTile(participant);
    actualizarIndicadores(participant);
  });

  room.on(L.RoomEvent.ParticipantDisconnected, (participant) => {
    quitarTile(participant.sid);
    const pantalla = document.getElementById(`pantalla-${participant.sid}`);
    if (pantalla) pantalla.remove();
  });

  room.on(L.RoomEvent.TrackSubscribed, (track, publication, participant) => {
    adjuntarPista(track, publication, participant);
  });

  room.on(L.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
    quitarPista(track, publication, participant);
  });

  room.on(L.RoomEvent.TrackMuted, (publication, participant) => {
    if (participant === room.localParticipant) return actualizarBotonesLocales();
    const tile = tiles.get(participant.sid);
    if (publication.kind === 'audio') marcarMicro(tile, true);
    if (publication.kind === 'video' && publication.source !== 'screen_share') {
      marcarCamara(tile, false);
    }
  });

  room.on(L.RoomEvent.TrackUnmuted, (publication, participant) => {
    if (participant === room.localParticipant) return actualizarBotonesLocales();
    const tile = tiles.get(participant.sid);
    if (publication.kind === 'audio') marcarMicro(tile, false);
    if (publication.kind === 'video' && publication.source !== 'screen_share') {
      marcarCamara(tile, true);
    }
  });

  room.on(L.RoomEvent.LocalTrackPublished, (publication) => {
    if (publication.source === L.Track.Source.Camera && publication.track) {
      el.videoLocal.srcObject = new MediaStream([publication.track.mediaStreamTrack]);
    }
    actualizarBotonesLocales();
  });

  room.on(L.RoomEvent.LocalTrackUnpublished, (publication) => {
    if (publication.source === L.Track.Source.Camera) el.videoLocal.srcObject = null;
    actualizarBotonesLocales();
  });

  room.on(L.RoomEvent.Disconnected, () => {
    if (finalizado) return; // ya mostramos "llamada terminada"
    mostrarEstado('La llamada ha terminado', 'Se ha cerrado la conexión con la sala.', {
      acciones: [
        { texto: 'Volver a entrar', onClick: () => window.location.reload(), primario: true },
        { texto: 'Ver historial', href: 'historial.html' },
      ],
    });
  });

  room.on(L.RoomEvent.MediaDevicesError, (error) => {
    const { titulo, texto } = interpretarError(error);
    setEstadoCabecera('error', titulo);
    el.salaNombre.title = texto;
  });

  room.on(L.RoomEvent.Reconnecting, () => setEstadoCabecera('alerta', 'Reconectando…'));
  room.on(L.RoomEvent.Reconnected, () => setEstadoCabecera('', 'Conectado'));
}

// --- Controles ---------------------------------------------------------------

function actualizarBotonesLocales() {
  const local = room?.localParticipant;
  if (!local) return;

  const microOn = local.isMicrophoneEnabled;
  const camOn = local.isCameraEnabled;

  el.btnMicro.setAttribute('aria-pressed', String(!microOn));
  el.txtMicro.textContent = microOn ? 'Silenciar' : 'Activar micro';
  el.localMudo.hidden = microOn;

  el.btnCamara.setAttribute('aria-pressed', String(!camOn));
  el.txtCamara.textContent = camOn ? 'Apagar cámara' : 'Encender cámara';
  el.localAvatar.hidden = camOn;
  el.videoLocal.style.visibility = camOn ? 'visible' : 'hidden';

  const pantallaOn = local.isScreenShareEnabled;
  el.btnPantalla.setAttribute('aria-pressed', String(Boolean(pantallaOn)));
  el.txtPantalla.textContent = pantallaOn ? 'Dejar de compartir' : 'Compartir';
}

el.btnMicro.addEventListener('click', async () => {
  const local = room?.localParticipant;
  if (!local) return;
  el.btnMicro.disabled = true;
  try {
    await local.setMicrophoneEnabled(!local.isMicrophoneEnabled);
  } catch (error) {
    setEstadoCabecera('error', 'No se pudo cambiar el micrófono');
  } finally {
    el.btnMicro.disabled = false;
    actualizarBotonesLocales();
  }
});

el.btnCamara.addEventListener('click', async () => {
  const local = room?.localParticipant;
  if (!local) return;
  el.btnCamara.disabled = true;
  const encender = !local.isCameraEnabled;

  try {
    await local.setCameraEnabled(encender);
    if (encender) {
      const pub = local.getTrackPublication(LivekitClient.Track.Source.Camera);
      if (pub?.track) el.videoLocal.srcObject = new MediaStream([pub.track.mediaStreamTrack]);
    }
  } catch (error) {
    const { titulo, texto } = interpretarError(error);
    setEstadoCabecera('error', titulo);
    el.salaNombre.title = texto;
  } finally {
    el.btnCamara.disabled = false;
    actualizarBotonesLocales();
  }
});

el.btnPantalla.addEventListener('click', async () => {
  const local = room?.localParticipant;
  if (!local) return;
  el.btnPantalla.disabled = true;
  try {
    await local.setScreenShareEnabled(!local.isScreenShareEnabled);
  } catch (error) {
    // Algunos navegadores no permiten compartir pantalla (p. ej. Safari iOS).
    setEstadoCabecera('alerta', 'Este navegador no permite compartir pantalla');
  } finally {
    el.btnPantalla.disabled = false;
    actualizarBotonesLocales();
  }
});

el.btnColgar.addEventListener('click', () => colgar());

/**
 * Respaldo: avisa al servidor de que hemos salido. El webhook sigue siendo la
 * fuente de verdad; el servidor no sobrescribe nada ya registrado por él.
 * @param {number|null} id
 */
function enviarSalidaRespaldo(id) {
  if (!id) return;

  const payload = JSON.stringify({ call_id: id });
  const enviado =
    'sendBeacon' in navigator &&
    navigator.sendBeacon(
      `/api/calls/${id}/leave`,
      new Blob([payload], { type: 'text/plain;charset=UTF-8' })
    );

  if (!enviado) {
    // Fallback síncrono (beforeunload no admite promesas).
    try {
      fetch(`/api/calls/${id}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: payload,
        keepalive: true,
        credentials: 'same-origin',
      });
    } catch (error) {
      // Nada que hacer al cerrar la pestaña.
    }
  }
}

function colgar() {
  if (finalizado) return;
  finalizado = true;
  el.btnColgar.disabled = true;
  if (timerCall) clearInterval(timerCall);

  enviarSalidaRespaldo(callId);

  if (room) {
    try {
      room.disconnect();
    } catch (error) {
      // La conexión ya podía estar cerrada.
    }
  }

  mostrarEstado('Llamada finalizada', 'Has salido de la videollamada. La duración queda registrada en el historial.', {
    acciones: [
      { texto: 'Ver historial', href: 'historial.html', primario: true },
      { texto: 'Volver a entrar', onClick: () => window.location.reload() },
    ],
  });
  setEstadoCabecera('', 'Llamada finalizada');
}

// Al cerrar o recargar la pestaña, marcamos la salida como respaldo.
window.addEventListener('beforeunload', () => {
  if (!finalizado && callId) enviarSalidaRespaldo(callId);
});

iniciar();
