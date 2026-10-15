-- Residencia Los Olivos 360 — Esquema de base de datos (MySQL 8)
-- Ejecutar con: npm run db:init

CREATE DATABASE IF NOT EXISTS los_olivos_360
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE los_olivos_360;

-- ---------------------------------------------------------------------------
-- Solicitudes de visita (formulario principal de la web)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitas (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre          VARCHAR(120)  NOT NULL,
  email           VARCHAR(160)  NOT NULL,
  telefono        VARCHAR(30)   NOT NULL,
  fecha_preferida DATE          NULL,
  franja          ENUM('manana','tarde') NULL,
  residente       VARCHAR(120)  NULL,
  mensaje         TEXT          NULL,
  estado          ENUM('pendiente','contactado','visitado','descartado')
                                NOT NULL DEFAULT 'pendiente',
  ip              VARCHAR(45)   NULL,
  creado_en       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_visitas_estado (estado),
  KEY idx_visitas_creado (creado_en)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Mensajes del formulario de contacto
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contactos (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre      VARCHAR(120)  NOT NULL,
  email       VARCHAR(160)  NOT NULL,
  telefono    VARCHAR(30)   NULL,
  asunto      VARCHAR(160)  NOT NULL,
  mensaje     TEXT          NOT NULL,
  leido       TINYINT(1)    NOT NULL DEFAULT 0,
  ip          VARCHAR(45)   NULL,
  creado_en   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contactos_leido (leido),
  KEY idx_contactos_creado (creado_en)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Usuarios del panel de administración
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre        VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol           ENUM('admin','editor') NOT NULL DEFAULT 'editor',
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  ultimo_acceso TIMESTAMP    NULL,
  creado_en     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Vídeos mostrados en la sección "Conoce Los Olivos"
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS videos (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  video_id    VARCHAR(20)   NOT NULL,
  titulo      VARCHAR(160)  NOT NULL,
  descripcion VARCHAR(255)  NULL,
  orden       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  activo      TINYINT(1)    NOT NULL DEFAULT 1,
  creado_en   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- Contenido inicial de la sección de vídeos
INSERT INTO videos (video_id, titulo, descripcion, orden)
SELECT * FROM (
  SELECT 'ScMzIvxBSi4' AS video_id, 'Un día con nosotros' AS titulo, 'Un día en la residencia' AS descripcion, 1 AS orden
  UNION ALL SELECT 'aqz-KE-bpKQ', 'Nuestras instalaciones', 'Un paseo por las instalaciones', 2
  UNION ALL SELECT 'dQw4w9WgXcQ', 'Actividades y rehabilitación', 'Actividades y rehabilitación', 3
) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM videos);
