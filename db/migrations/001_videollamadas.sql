-- Residencia Los Olivos 360 — Migración: videollamadas (LiveKit)
-- Ejecutar con: npm run db:migrate
--
-- Reglas de tiempo:
--   * Todas las columnas de fecha/hora son DATETIME(3) en UTC, nunca en la zona
--     horaria del servidor MySQL (no dependemos de @@session.time_zone).
--   * Los tiempos que se guardan aquí vienen SIEMPRE de los webhooks de LiveKit
--     (fuente de verdad), salvo el tiempo del último recurso marcado en cada fila.

USE los_olivos_360;

-- ---------------------------------------------------------------------------
-- Salas de videollamada
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(64)  NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  max_participants TINYINT UNSIGNED NOT NULL DEFAULT 10,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rooms_name (name),
  KEY idx_rooms_created_by (created_by),
  CONSTRAINT fk_rooms_created_by FOREIGN KEY (created_by)
    REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Miembros autorizados a entrar en una sala
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_members (
  room_id  INT UNSIGNED NOT NULL,
  user_id  INT UNSIGNED NOT NULL,
  added_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, user_id),
  KEY idx_room_members_user (user_id),
  CONSTRAINT fk_room_members_room FOREIGN KEY (room_id)
    REFERENCES rooms (id) ON DELETE CASCADE,
  CONSTRAINT fk_room_members_user FOREIGN KEY (user_id)
    REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Llamadas (una por cada vez que la sala se abre en LiveKit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calls (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id          INT UNSIGNED NOT NULL,
  livekit_room_sid VARCHAR(64)  NOT NULL,
  started_at       DATETIME(3)  NOT NULL,
  ended_at         DATETIME(3)  NULL,
  duration_seconds INT UNSIGNED NULL,
  status           ENUM('active','ended') NOT NULL DEFAULT 'active',
  PRIMARY KEY (id),
  UNIQUE KEY uq_calls_sid (livekit_room_sid),
  KEY idx_calls_room (room_id),
  KEY idx_calls_started (started_at),
  CONSTRAINT fk_calls_room FOREIGN KEY (room_id)
    REFERENCES rooms (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Participantes de cada llamada
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_participants (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  call_id          INT UNSIGNED NOT NULL,
  user_id          INT UNSIGNED NOT NULL,
  livekit_identity VARCHAR(64)  NOT NULL,
  joined_at        DATETIME(3)  NOT NULL,
  left_at          DATETIME(3)  NULL,
  duration_seconds INT UNSIGNED NULL,
  -- 'webhook' = tiempo calculado por LiveKit; 'client' = última marca del
  -- endpoint de respaldo (nunca sobrescribe un tiempo del webhook).
  time_source      ENUM('webhook','client') NOT NULL DEFAULT 'webhook',
  PRIMARY KEY (id),
  KEY idx_call_participants_call (call_id),
  KEY idx_call_participants_user (user_id),
  KEY idx_call_participants_joined (joined_at),
  CONSTRAINT fk_call_participants_call FOREIGN KEY (call_id)
    REFERENCES calls (id) ON DELETE CASCADE,
  CONSTRAINT fk_call_participants_user FOREIGN KEY (user_id)
    REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;
