'use strict';

// Gestión de videollamadas: crear una sala eligiendo a quién se invita, ver las
// salas propias y entrar en ellas. No crea tokens de LiveKit: eso lo hace
// sala.html al entrar, comprobando la membresía en el servidor.

const el = {
  form: document.getElementById('formNueva'),
  nombre: document.getElementById('sala-nombre'),
  btnAzar: document.getElementById('btnAzar'),
  buscar: document.getElementById('buscarPersona'),
  listaPersonas: document.getElementById('listaPersonas'),
  contador: document.getElementById('contadorPersonas'),
  btnCrear: document.getElementById('btnCrear'),
  estadoForm: document.getElementById('estadoForm'),
  listaSalas: document.getElementById('listaSalas'),
  logoutBtn: document.getElementById('logoutBtn'),
  modal: document.getElementById('modal'),
  enlace: document.getElementById('enlace'),
  btnCopiar: document.getElementById('btnCopiar'),
  detalleInvitados: document.getElementById('detalleInvitados'),
  btnCerrarModal: document.getElementById('btnCerrarModal'),
  btnEntrarAhora: document.getElementById('btnEntrarAhora'),
  modalTitulo: document.getElementById('modalTitulo'),
};

const MAX_MIEMBROS = 10;

// --- Utilidades ---------------------------------------------------------------

async function apiFetch(url, options = {}) {
  return fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
}

function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/**
 * Fecha corta para la lista de salas.
 * @param {string|null} iso
 * @returns {string}
 */
function fechaCorta(iso) {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Enlace a la sala, absoluto para poder compartirlo.
 * @param {number} roomId
 * @returns {string}
 */
function enlaceSala(roomId) {
  return `${window.location.origin}/sala.html?room_id=${Number(roomId)}`;
}

/**
 * Nombre de sala por defecto: fácil de leer y difícil de repetir.
 * @returns {string}
 */
function nombreAleatorio() {
  const palabras = ['familia', 'reunion', 'visita', 'saludo', 'encuentro', 'charla', 'tarde'];
  const palabra = palabras[Math.floor(Math.random() * palabras.length)];
  const numero = Math.floor(1000 + Math.random() * 9000);
  return `${palabra}-${numero}`;
}

// --- Personas -----------------------------------------------------------------

let personas = [];

async function cargarPersonas() {
  try {
    const res = await apiFetch('/api/users');
    if (res.status === 401) return redirigirALogin();

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error('No se pudo cargar la lista de personas.');

    personas = data.users || [];
    pintarPersonas();
  } catch (error) {
    el.listaPersonas.innerHTML = `<p class="vacio">${esc(error.message)}</p>`;
  }
}

function pintarPersonas() {
  if (personas.length === 0) {
    el.listaPersonas.innerHTML =
      '<p class="vacio">No hay otras personas activas a las que invitar.</p>';
    actualizarContador();
    return;
  }

  el.listaPersonas.innerHTML = personas
    .map(
      (p) => `<label class="persona" data-buscar="${esc(`${p.nombre} ${p.email}`.toLowerCase())}">
        <input type="checkbox" value="${Number(p.id)}" name="miembro">
        <span class="datos">
          <span>${esc(p.nombre)}</span>
          <span class="email">${esc(p.email)}</span>
        </span>
        <span class="rol">${esc(p.rol)}</span>
      </label>`
    )
    .join('');

  el.listaPersonas.querySelectorAll('input[name="miembro"]').forEach((input) => {
    input.addEventListener('change', actualizarContador);
  });
  actualizarContador();
}

function seleccionados() {
  return [...el.listaPersonas.querySelectorAll('input[name="miembro"]:checked')].map((i) =>
    Number(i.value)
  );
}

function actualizarContador() {
  const total = seleccionados().length;
  // +1 por quien crea la llamada.
  el.contador.textContent = total
    ? `${total} invitado(s) · ${total + 1} de ${MAX_MIEMBROS} participantes`
    : `Nadie seleccionado · sólo entrarás tú (1 de ${MAX_MIEMBROS})`;
}

el.buscar.addEventListener('input', () => {
  const texto = el.buscar.value.trim().toLowerCase();
  el.listaPersonas.querySelectorAll('.persona').forEach((nodo) => {
    nodo.hidden = texto !== '' && !nodo.dataset.buscar.includes(texto);
  });
});

// --- Crear sala ---------------------------------------------------------------

el.btnAzar.addEventListener('click', () => {
  el.nombre.value = nombreAleatorio();
  el.nombre.focus();
});

el.nombre.addEventListener('input', () => {
  el.nombre.value = el.nombre.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
});

el.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.estadoForm.textContent = '';

  const name = el.nombre.value.trim();
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(name)) {
    el.estadoForm.textContent =
      'El nombre debe tener entre 3 y 64 caracteres: minúsculas, números y guiones.';
    el.nombre.focus();
    return;
  }

  const memberIds = seleccionados();
  el.btnCrear.disabled = true;
  el.btnCrear.textContent = 'Creando…';

  try {
    const res = await apiFetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, member_ids: memberIds }),
    });

    if (res.status === 401) return redirigirALogin();

    const data = await res.json().catch(() => ({}));

    if (res.status === 409) {
      // Ya existía: si el usuario es miembro, se le ofrece entrar directamente.
      el.estadoForm.textContent = 'Ya existe una sala con ese nombre. Prueba con otro.';
      return;
    }

    if (!res.ok || !data.ok) {
      el.estadoForm.textContent = (data.errors || ['No se pudo crear la sala.']).join(' ');
      return;
    }

    const sala = data.room;
    abrirModal(sala, memberIds);
    await cargarSalas();
    el.form.reset();
    el.buscar.value = '';
    el.listaPersonas
      .querySelectorAll('.persona')
      .forEach((nodo) => (nodo.hidden = false));
    actualizarContador();
  } catch (error) {
    el.estadoForm.textContent = 'Error de conexión. Inténtalo de nuevo.';
  } finally {
    el.btnCrear.disabled = false;
    el.btnCrear.textContent = 'Crear videollamada y entrar';
  }
});

// --- Mis salas ----------------------------------------------------------------

async function cargarSalas() {
  try {
    const res = await apiFetch('/api/rooms');
    if (res.status === 401) return redirigirALogin();

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error('No se pudieron cargar tus salas.');

    pintarSalas(data.rooms || []);
  } catch (error) {
    el.listaSalas.innerHTML = `<p class="vacio">${esc(error.message)}</p>`;
  }
}

/**
 * @param {Array<object>} salas
 */
function pintarSalas(salas) {
  if (salas.length === 0) {
    el.listaSalas.innerHTML =
      '<p class="vacio">Todavía no tienes salas. Crea una videollamada a la izquierda.</p>';
    return;
  }

  el.listaSalas.innerHTML = salas
    .map(
      (sala) => `<div class="sala-item">
        <div class="info">
          <div class="nombre">${esc(sala.name)}</div>
          <div class="meta">${Number(sala.member_count)} persona(s) · creada el ${esc(
        fechaCorta(sala.created_at)
      )}</div>
        </div>
        <div class="sala-acciones">
          <button type="button" class="btn btn-outline btn-sm" data-copiar="${Number(sala.id)}">Copiar enlace</button>
          <a class="btn btn-primario btn-sm" href="${esc(enlaceSala(sala.id))}">Entrar</a>
        </div>
      </div>`
    )
    .join('');
}

el.listaSalas.addEventListener('click', async (event) => {
  const boton = event.target.closest('[data-copiar]');
  if (!boton) return;

  const enlace = enlaceSala(boton.dataset.copiar);
  const copiado = await copiarAlPortapapeles(enlace);
  const textoOriginal = boton.textContent;
  boton.textContent = copiado ? '¡Copiado!' : 'Copia el enlace del modal';
  if (!copiado) {
    el.enlace.value = enlace;
    el.modalTitulo.textContent = 'Enlace de la videollamada';
    el.detalleInvitados.textContent = '';
    el.btnEntrarAhora.href = enlace;
    el.modal.hidden = false;
  }
  setTimeout(() => (boton.textContent = textoOriginal), 1800);
});

// --- Modal --------------------------------------------------------------------

/**
 * Copia texto al portapapeles con fallback para contextos no seguros.
 * @param {string} texto
 * @returns {Promise<boolean>}
 */
async function copiarAlPortapapeles(texto) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch (error) {
    // Se intenta el fallback.
  }
  try {
    el.enlace.value = texto;
    el.enlace.select();
    return document.execCommand('copy');
  } catch (error) {
    return false;
  }
}

/**
 * Muestra el enlace de la sala recién creada.
 * @param {{ id: number, name: string }} sala
 * @param {number[]} memberIds
 */
function abrirModal(sala, memberIds) {
  const enlace = enlaceSala(sala.id);
  el.modalTitulo.textContent = `Sala «${sala.name}» creada`;
  el.enlace.value = enlace;
  el.btnEntrarAhora.href = enlace;

  const nombres = memberIds
    .map((id) => personas.find((p) => Number(p.id) === Number(id)))
    .filter(Boolean)
    .map((p) => p.nombre);

  el.detalleInvitados.textContent = nombres.length
    ? `Invitados: ${nombres.join(', ')}. Verán la sala en “Mis salas”.`
    : 'No invitaste a nadie: de momento sólo puedes entrar tú.';

  el.modal.hidden = false;
  el.btnCopiar.focus();
}

el.btnCopiar.addEventListener('click', async () => {
  const enlace = el.enlace.value;
  el.enlace.select();
  const copiado = await copiarAlPortapapeles(enlace);
  el.btnCopiar.textContent = copiado ? '¡Copiado!' : 'Selecciona y copia';
  setTimeout(() => (el.btnCopiar.textContent = 'Copiar'), 1800);
});

function cerrarModal() {
  el.modal.hidden = true;
}

el.btnCerrarModal.addEventListener('click', cerrarModal);
el.modal.addEventListener('click', (event) => {
  if (event.target === el.modal) cerrarModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el.modal.hidden) cerrarModal();
});

// --- Sesión -------------------------------------------------------------------

function redirigirALogin() {
  window.location.replace('/login.html');
}

el.logoutBtn.addEventListener('click', async () => {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    redirigirALogin();
  }
});

// --- Arranque -----------------------------------------------------------------

el.nombre.value = nombreAleatorio();
cargarPersonas();
cargarSalas();
