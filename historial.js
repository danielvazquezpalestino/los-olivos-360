'use strict';

// Historial de videollamadas. El servidor devuelve las horas en ISO 8601 (UTC);
// aquí se formatean en la zona horaria local del usuario.

const el = {
  cuerpo: document.getElementById('cuerpo'),
  estado: document.getElementById('estado'),
  paginacion: document.getElementById('paginacion'),
  btnAnterior: document.getElementById('btnAnterior'),
  btnSiguiente: document.getElementById('btnSiguiente'),
  paginaInfo: document.getElementById('paginaInfo'),
  modal: document.getElementById('modal'),
  modalTitulo: document.getElementById('modalTitulo'),
  modalContenido: document.getElementById('modalContenido'),
  btnCerrarModal: document.getElementById('btnCerrarModal'),
  logoutBtn: document.getElementById('logoutBtn'),
};

let pagina = 1;
const PAGE_SIZE = 20;
let totalPaginas = 1;

// --- Formato ------------------------------------------------------------------

/**
 * Fecha local: "12/03/2026".
 * @param {string|null} iso
 * @returns {string}
 */
function formatearFecha(iso) {
  if (!iso) return '—';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleDateString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Hora local: "18:42:07".
 * @param {string|null} iso
 * @returns {string}
 */
function formatearHora(iso) {
  if (!iso) return '—';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Duración en hh:mm:ss.
 * @param {number|null|undefined} segundos
 * @param {boolean} enCurso Si no ha terminado, marca "…" en lugar de horas.
 * @returns {string}
 */
function formatearDuracion(segundos, enCurso) {
  if (segundos === null || segundos === undefined) return enCurso ? 'En curso…' : '—';
  const total = Math.max(0, Math.floor(Number(segundos)));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Escapa texto antes de insertarlo como HTML.
 * @param {unknown} valor
 * @returns {string}
 */
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (caracter) => {
    switch (caracter) {
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

// --- Datos --------------------------------------------------------------------

async function apiFetch(url, options = {}) {
  return fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
}

function mostrarEstado(texto, esError = false) {
  el.estado.textContent = texto || '';
  el.estado.className = 'estado' + (esError ? ' error' : '');
}

async function cargarHistorial() {
  mostrarEstado('Cargando historial…');

  try {
    const res = await apiFetch(`/api/calls/history?page=${pagina}&page_size=${PAGE_SIZE}`);

    if (res.status === 401) {
      window.location.replace('/login.html');
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error((data.errors || ['No se pudo cargar el historial.']).join(' '));
    }

    totalPaginas = data.total_pages || 1;
    pintarFilas(data.calls || []);
    pintarPaginacion(data);
    mostrarEstado(data.total === 0 ? '' : `${data.total} llamada(s) en total.`);
  } catch (error) {
    pintarFilas([]);
    mostrarEstado(error.message || 'Error al cargar el historial.', true);
  }
}

/**
 * Pinta las filas de la tabla.
 * @param {Array<object>} calls
 */
function pintarFilas(calls) {
  if (calls.length === 0) {
    el.cuerpo.innerHTML =
      '<tr><td class="vacio" colspan="8">Todavía no hay llamadas registradas.</td></tr>';
    return;
  }

  el.cuerpo.innerHTML = calls
    .map((call) => {
      const activa = call.status === 'active';
      const participantes = (call.participants || [])
        .map(
          (p) =>
            `<li>${esc(p.nombre)} <span class="tiempo">(${formatearDuracion(
              p.duration_seconds,
              !p.left_at
            )})</span></li>`
        )
        .join('');

      return `<tr data-id="${Number(call.id)}">
        <td><strong>${esc(call.room_name)}</strong></td>
        <td>${formatearFecha(call.started_at)}</td>
        <td>${formatearHora(call.started_at)}</td>
        <td>${activa ? '—' : formatearHora(call.ended_at)}</td>
        <td>${formatearDuracion(call.duration_seconds, activa)}</td>
        <td><ul class="participantes">${participantes || '<li>—</li>'}</ul></td>
        <td><span class="badge ${activa ? 'badge-activa' : 'badge-finalizada'}">${activa ? 'Activa' : 'Finalizada'
        }</span></td>
        <td><button type="button" class="btn btn-detalle" data-detalle="${Number(call.id)}">Detalle</button></td>
      </tr>`;
    })
    .join('');
}

/**
 * Configura los controles de paginación.
 * @param {{ page: number, total_pages: number, total: number }} data
 */
function pintarPaginacion(data) {
  const hayVarias = data.total_pages > 1;
  el.paginacion.hidden = !hayVarias;
  if (!hayVarias) return;

  el.paginaInfo.textContent = `Página ${data.page} de ${data.total_pages}`;
  el.btnAnterior.disabled = data.page <= 1;
  el.btnSiguiente.disabled = data.page >= data.total_pages;
}

// --- Detalle ------------------------------------------------------------------

async function abrirDetalle(callId) {
  el.modal.hidden = false;
  el.modalTitulo.textContent = 'Detalle de la llamada';
  el.modalContenido.innerHTML = '<p class="detalle-linea">Cargando…</p>';

  try {
    const res = await apiFetch(`/api/calls/${encodeURIComponent(callId)}`);
    if (res.status === 401) {
      window.location.replace('/login.html');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error((data.errors || ['No se pudo cargar el detalle.']).join(' '));
    }

    const call = data.call;
    el.modalTitulo.textContent = `Sala ${call.room_name}`;

    const filas = (call.participants || [])
      .map(
        (p) => `<tr>
          <td>${esc(p.nombre)}</td>
          <td>${formatearHora(p.joined_at)}</td>
          <td>${p.left_at ? formatearHora(p.left_at) : '—'}</td>
          <td>${formatearDuracion(p.duration_seconds, !p.left_at)}</td>
        </tr>`
      )
      .join('');

    el.modalContenido.innerHTML = `
      <p class="detalle-linea"><strong>Inicio:</strong> ${formatearFecha(call.started_at)} ${formatearHora(call.started_at)}</p>
      <p class="detalle-linea"><strong>Fin:</strong> ${call.ended_at ? `${formatearFecha(call.ended_at)} ${formatearHora(call.ended_at)}` : 'En curso'}</p>
      <p class="detalle-linea"><strong>Duración:</strong> ${formatearDuracion(call.duration_seconds, call.status === 'active')}</p>
      <table>
        <thead><tr><th>Participante</th><th>Entrada</th><th>Salida</th><th>Tiempo</th></tr></thead>
        <tbody>${filas || '<tr><td class="vacio" colspan="4">Sin participantes registrados.</td></tr>'}</tbody>
      </table>`;
  } catch (error) {
    el.modalContenido.innerHTML = `<p class="detalle-linea">${esc(error.message)}</p>`;
  }
}

function cerrarModal() {
  el.modal.hidden = true;
}

// --- Eventos ------------------------------------------------------------------

el.cuerpo.addEventListener('click', (event) => {
  const boton = event.target.closest('[data-detalle]');
  if (boton) abrirDetalle(boton.dataset.detalle);
});

el.btnCerrarModal.addEventListener('click', cerrarModal);
el.modal.addEventListener('click', (event) => {
  if (event.target === el.modal) cerrarModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el.modal.hidden) cerrarModal();
});

el.btnAnterior.addEventListener('click', () => {
  if (pagina > 1) {
    pagina -= 1;
    cargarHistorial();
  }
});

el.btnSiguiente.addEventListener('click', () => {
  if (pagina < totalPaginas) {
    pagina += 1;
    cargarHistorial();
  }
});

el.logoutBtn.addEventListener('click', async () => {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.replace('/login.html');
  }
});

cargarHistorial();
