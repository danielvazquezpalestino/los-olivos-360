'use strict';

// Utilidades de tiempo para las llamadas.
// En MySQL guardamos DATETIME(3) en UTC como cadena 'YYYY-MM-DD HH:MM:SS.mmm'.
// Pool está configurado con dateStrings: true, así que lo que entra y sale de la
// base de datos es texto y no depende de la zona horaria del servidor.

const MYSQL_UTC_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/;

/**
 * Convierte una fecha a cadena UTC válida para DATETIME de MySQL.
 * @param {Date|number|string} date
 * @returns {string}
 */
function toMysqlUtc(date) {
  return new Date(date).toISOString().slice(0, 23).replace('T', ' ');
}

/**
 * Fecha actual en formato DATETIME UTC.
 * @returns {string}
 */
function nowUtc() {
  return toMysqlUtc(Date.now());
}

/**
 * Diferencia en segundos redondeados entre dos instantes (> 0).
 * @param {string|Date} start
 * @param {string|Date} end
 * @returns {number}
 */
function secondsBetween(start, end) {
  const diff = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  return diff > 0 ? Math.round(diff) : 0;
}

/**
 * Convierte una cadena DATETIME de MySQL (UTC) al ISO 8601 con sufijo Z.
 * Así el navegador la interpreta como UTC y la muestra en hora local.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function mysqlUtcToIso(value) {
  if (!value) return null;
  const text = String(value);
  if (!MYSQL_UTC_RE.test(text)) return null;
  return `${text.replace(' ', 'T')}Z`;
}

module.exports = { toMysqlUtc, nowUtc, secondsBetween, mysqlUtcToIso };
