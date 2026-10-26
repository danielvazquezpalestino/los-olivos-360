'use strict';

/**
 * Mini-caché en memoria con TTL y límite de entradas (LRU simple).
 * Map conserva el orden de inserción: al tocar una clave se vuelve a
 * insertar para marcarla como recientemente usada, y se expulsa la más vieja.
 */
class MemoryCache {
  /**
   * @param {object} [options]
   * @param {number} [options.ttlMs] Tiempo de vida por entrada (por defecto 60 s).
   * @param {number} [options.maxEntries] Máximo de entradas (por defecto 100).
   */
  constructor({ ttlMs = 60_000, maxEntries = 100 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.hits = 0;
    this.misses = 0;
    this.store = new Map();
  }

  /**
   * Lee una entrada válida (no expirada). La marca como usada recientemente.
   * @param {string} key
   * @returns {*|undefined}
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    // Refrescar posición (LRU): eliminar y reinsertar.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  /**
   * Guarda un valor, expulsando la entrada más antigua si se supera el límite.
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
  }

  /** Elimina una clave concreta. */
  delete(key) {
    this.store.delete(key);
  }

  /** Vacía la caché completa (usado para invalidar tras escrituras). */
  flush() {
    this.store.clear();
  }

  /** Datos para depuración/logs. */
  stats() {
    return { size: this.store.size, hits: this.hits, misses: this.misses };
  }
}

module.exports = MemoryCache;
