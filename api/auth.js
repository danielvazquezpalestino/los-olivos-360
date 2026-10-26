'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');

const JWT_SECRET = process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion';
const JWT_EXPIRES_IN = '24h';

/**
 * Genera un token JWT para un usuario.
 * @param {Object} user - Datos del usuario
 * @returns {string}
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, rol: user.rol },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Verifica un token JWT.
 * @param {string} token
 * @returns {Object|null}
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Middleware para verificar que el usuario está autenticado.
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ ok: false, errors: ['No autenticado.'] });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ ok: false, errors: ['Sesión inválida o expirada.'] });
  }

  req.user = decoded;
  next();
}

/**
 * Inicia sesión con email y contraseña.
 */
async function login(req, res, next) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ ok: false, errors: ['Email y contraseña son obligatorios.'] });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, nombre, email, password_hash, rol, activo
       FROM usuarios
       WHERE email = ? AND activo = 1
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ ok: false, errors: ['Credenciales inválidas.'] });
    }

    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ ok: false, errors: ['Credenciales inválidas.'] });
    }

    // Actualizar último acceso
    await pool.execute(
      `UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?`,
      [user.id]
    );

    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 horas
    });

    res.json({
      ok: true,
      user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Cierra la sesión del usuario.
 */
function logout(req, res) {
  res.clearCookie('token');
  res.json({ ok: true, mensaje: 'Sesión cerrada.' });
}

/**
 * Obtiene el usuario autenticado actual.
 */
async function me(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, nombre, email, rol, ultimo_acceso
       FROM usuarios
       WHERE id = ? AND activo = 1
       LIMIT 1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, errors: ['Usuario no encontrado.'] });
    }

    res.json({ ok: true, user: rows[0] });
  } catch (error) {
    next(error);
  }
}

module.exports = { requireAuth, login, logout, me, generateToken, verifyToken };
