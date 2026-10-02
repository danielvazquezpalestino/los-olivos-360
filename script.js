const menuToggle = document.querySelector('#menuToggle');
const sidebar = document.querySelector('#sidebar');

menuToggle.addEventListener('click', () => {
  const isOpen = sidebar.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Cerrar menú' : 'Abrir menú');
});

sidebar.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    sidebar.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Abrir menú');
  });
});

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

modalClose.addEventListener('click', closeVideo);
videoModal.addEventListener('click', (event) => {
  if (event.target === videoModal) closeVideo();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !videoModal.hidden) closeVideo();
});

// --- PWA: registro del service worker ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(() => console.log('Service Worker registrado'))
      .catch((error) => console.error('Error SW:', error));
  });
}
