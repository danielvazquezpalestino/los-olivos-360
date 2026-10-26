// La clase real del botón es .menu-toggle (no existe #menuToggle en index.html).
// Se usa el id si está y, si no, la clase, para que la home nunca se rompa.
const menuToggle = document.querySelector('#menuToggle, .menu-toggle');
const sidebar = document.querySelector('#sidebar');

function closeMenu() {
  if (sidebar) sidebar.classList.remove('open');
  if (menuToggle) {
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Abrir menú');
  }
}

if (menuToggle && sidebar) {
  menuToggle.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? 'Cerrar menú' : 'Abrir menú');
  });

  sidebar.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sidebar.classList.contains('open')) closeMenu();
  });
}

// --- Vídeos: lightbox accesible con iframe de YouTube ---
const VIDEO_BASE = 'https://www.youtube-nocookie.com/embed/';

const videoModal = document.createElement('div');
videoModal.className = 'video-modal';
videoModal.hidden = true;
videoModal.innerHTML = `
  <div class="video-modal-inner" role="dialog" aria-modal="true" aria-label="Reproductor de vídeo">
    <button class="video-close" type="button" aria-label="Cerrar vídeo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>
    <iframe title="Vídeo" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
  </div>`;
document.body.appendChild(videoModal);

const modalIframe = videoModal.querySelector('iframe');
const modalClose = videoModal.querySelector('.video-close');
let lastFocused = null;

function openVideo(videoId) {
  lastFocused = document.activeElement;
  modalIframe.src = `${VIDEO_BASE}${videoId}?autoplay=1&rel=0`;
  videoModal.hidden = false;
  document.body.style.overflow = 'hidden';
  modalClose.focus();
}

function closeVideo() {
  videoModal.hidden = true;
  modalIframe.src = '';
  document.body.style.overflow = '';
  if (lastFocused) lastFocused.focus();
}

modalClose.addEventListener('click', closeVideo);
videoModal.addEventListener('click', (event) => {
  if (event.target === videoModal) closeVideo();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !videoModal.hidden) closeVideo();
});

// --- Formularios: envío a la API -------------------------------------------

/**
 * Envía un formulario a la API y refleja el resultado en la interfaz.
 * @param {HTMLFormElement} form
 * @param {string} endpoint
 * @param {string} okMessage
 */
function wireForm(form, endpoint, okMessage) {
  if (!form) return;

  const status = form.querySelector('.form-status');
  const submit = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.className = 'form-status';
    status.textContent = '';
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));

    if (!form.checkValidity()) {
      form.querySelectorAll(':invalid').forEach((el) => el.setAttribute('aria-invalid', 'true'));
      status.className = 'form-status error';
      status.textContent = 'Revisa los campos marcados: faltan datos obligatorios o el formato no es correcto.';
      form.reportValidity();
      return;
    }

    const payload = Object.fromEntries(new FormData(form).entries());
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        form.querySelectorAll(':invalid').forEach((el) => el.setAttribute('aria-invalid', 'true'));
        status.className = 'form-status error';
        status.textContent = (data.errors || ['No se pudo enviar. Inténtalo de nuevo.']).join(' ');
        return;
      }

      status.className = 'form-status ok';
      status.textContent = data.mensaje || okMessage;
      form.reset();
    } catch (error) {
      status.className = 'form-status error';
      status.textContent = 'No hay conexión con el servidor. Inténtalo de nuevo en unos minutos.';
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  });
}

// wireForm ya ignora formularios ausentes: las páginas de administración
// cargan este mismo script y no tienen estos formularios.
wireForm(document.querySelector('#formVisita'), '/api/visitas', 'Solicitud enviada. Te llamaremos para confirmar la visita.');
wireForm(document.querySelector('#formContacto'), '/api/contacto', 'Mensaje enviado. Te responderemos lo antes posible.');

// --- Cargar vídeos desde la API -------------------------------------------
async function loadVideos() {
  const videoGrid = document.getElementById('videoGrid');
  if (!videoGrid) return;

  try {
    const response = await fetch('/api/videos');
    const data = await response.json();

    if (!data.ok || data.videos.length === 0) {
      videoGrid.innerHTML = '<div class="loading">No hay vídeos disponibles.</div>';
      return;
    }

    const videoCards = data.videos.map(v => `
      <figure class="video-card">
        <div class="video-frame" data-video="${v.video_id}" data-title="${v.titulo}">
          <span class="video-poster" aria-hidden="true"><span class="video-play"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></span></span>
          <figcaption class="video-title">${escapeHtml(v.titulo)}</figcaption>
        </div>
        <figcaption>${escapeHtml(v.titulo)}</figcaption>
      </figure>
    `).join('');

    videoGrid.innerHTML = videoCards;

    // Re-inicializar los eventos de click para los nuevos videos
    initVideoFrames();
  } catch (error) {
    videoGrid.innerHTML = '<div class="loading">Error al cargar vídeos. Inténtalo de nuevo.</div>';
    console.error('Error cargando vídeos:', error);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function initVideoFrames() {
  document.querySelectorAll('.video-frame').forEach((frame) => {
    frame.setAttribute('role', 'button');
    frame.setAttribute('tabindex', '0');
    frame.setAttribute('aria-label', `Reproducir vídeo: ${frame.dataset.title || 'vídeo'}`);

    const play = () => {
      const id = frame.dataset.video;
      if (id) openVideo(id);
    };

    frame.addEventListener('click', play);
    frame.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        play();
      }
    });
  });
}

// Cargar vídeos al iniciar la página (las páginas de admin no tienen la sección)
document.addEventListener('DOMContentLoaded', loadVideos);

// --- PWA: registro del service worker ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(() => console.log('Service Worker registrado'))
      .catch((error) => console.error('Error SW:', error));
  });
}
