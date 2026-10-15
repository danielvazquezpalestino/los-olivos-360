'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+]?[\d\s().-]{6,25}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Recorta y normaliza un valor de texto recibido del cliente.
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function text(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

/**
 * Valida la solicitud de visita.
 * @param {Record<string, unknown>} body
 * @returns {{ ok: boolean, errors: string[], value: Record<string, unknown> }}
 */
function validateVisita(body = {}) {
  const errors = [];
  const value = {
    nombre: text(body.nombre, 120),
    email: text(body.email, 160).toLowerCase(),
    telefono: text(body.telefono, 30),
    fecha_preferida: text(body.fecha_preferida, 10) || null,
    franja: text(body.franja, 10) || null,
    residente: text(body.residente, 120) || null,
    mensaje: text(body.mensaje, 2000) || null,
  };

  if (value.nombre.length < 2) errors.push('El nombre es obligatorio (mínimo 2 caracteres).');
  if (!EMAIL_RE.test(value.email)) errors.push('El email no tiene un formato válido.');
  if (!PHONE_RE.test(value.telefono)) errors.push('El teléfono no tiene un formato válido.');

  if (value.fecha_preferida) {
    if (!DATE_RE.test(value.fecha_preferida)) {
      errors.push('La fecha no tiene un formato válido.');
    } else if (value.fecha_preferida < new Date().toISOString().slice(0, 10)) {
      errors.push('La fecha de visita no puede estar en el pasado.');
    }
  }

  if (value.franja && !['manana', 'tarde'].includes(value.franja)) {
    errors.push('La franja horaria no es válida.');
  }

  return { ok: errors.length === 0, errors, value };
}

/**
 * Valida el mensaje de contacto.
 * @param {Record<string, unknown>} body
 * @returns {{ ok: boolean, errors: string[], value: Record<string, unknown> }}
 */
function validateContacto(body = {}) {
  const errors = [];
  const value = {
    nombre: text(body.nombre, 120),
    email: text(body.email, 160).toLowerCase(),
    telefono: text(body.telefono, 30) || null,
    asunto: text(body.asunto, 160),
    mensaje: text(body.mensaje, 4000),
  };

  if (value.nombre.length < 2) errors.push('El nombre es obligatorio (mínimo 2 caracteres).');
  if (!EMAIL_RE.test(value.email)) errors.push('El email no tiene un formato válido.');
  if (value.asunto.length < 3) errors.push('El asunto es obligatorio (mínimo 3 caracteres).');
  if (value.mensaje.length < 10) errors.push('El mensaje debe tener al menos 10 caracteres.');
  if (value.telefono && !PHONE_RE.test(value.telefono)) {
    errors.push('El teléfono no tiene un formato válido.');
  }

  return { ok: errors.length === 0, errors, value };
}

module.exports = { validateVisita, validateContacto };
