-- ============================================================
--  SUITE PdM - Edwards PdM
--  Script de configuración de base de datos PostgreSQL
--  Ejecutar con: psql -U postgres -f database_setup.sql
-- ============================================================

-- 1. Crear la base de datos (si no existe)
--    Nota: en psql no existe "CREATE DATABASE IF NOT EXISTS",
--    por eso se usa este bloque. Si ya existe, simplemente continúa.
SELECT 'CREATE DATABASE edwards_pdm_db'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'edwards_pdm_db')\gexec

-- 2. Conectarse a la base de datos
\c edwards_pdm_db

-- 3. Crear la tabla principal de equipos
CREATE TABLE IF NOT EXISTS equipos (

    -- IDENTIFICACIÓN
    asset_id                    VARCHAR(100)    PRIMARY KEY,
    descripcion                 TEXT,
    criticidad                  VARCHAR(20),        -- 'Alta', 'Media', 'Baja'
    marca                       VARCHAR(100),
    modelo                      VARCHAR(100),
    ubicacion                   VARCHAR(200),

    -- DATOS ELÉCTRICOS / MECÁNICOS
    potencia_hp                 NUMERIC(10,2),
    voltaje                     VARCHAR(50),
    rpm                         NUMERIC(10,2),
    amperaje                    NUMERIC(10,2),
    frame                       VARCHAR(50),
    clase_aislamiento           VARCHAR(10),

    -- RODAMIENTOS
    rodamiento_de               VARCHAR(100),       -- Drive End
    rodamiento_ode              VARCHAR(100),       -- Opposite Drive End

    -- TIPO DE SISTEMA Y TRANSMISIÓN
    tipo_sistema                VARCHAR(50),        -- 'hvac', 'bomba', 'otro'
    transmision_tipo            VARCHAR(50),
    modelo_faja                 VARCHAR(100),
    diametro_turbina            NUMERIC(10,2),
    diametro_polea_conductora   NUMERIC(10,2),
    diametro_polea_conducida    NUMERIC(10,2),
    num_alabes_turbina          INTEGER,
    orientacion                 VARCHAR(50),
    tipo_acople                 VARCHAR(100),
    num_alabes_impeler          INTEGER,

    -- FOTOS (almacenadas como Base64)
    foto1                       TEXT,
    foto2                       TEXT,
    foto3                       TEXT,
    foto4                       TEXT,

    -- ESTADOS DE MONITOREO
    mes_inspeccion              VARCHAR(50),
    ultimo_estado_vibraciones   CHAR(1),            -- 'B', 'A', 'C', 'N'
    ultimo_estado_termografia   CHAR(1),
    ultimo_estado_ultrasonido   CHAR(1),
    notas                       TEXT,

    -- AUDITORÍA
    created_at                  TIMESTAMPTZ         DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ         DEFAULT NOW()
);

-- 4. Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipos_updated_at ON equipos;
CREATE TRIGGER trg_equipos_updated_at
    BEFORE UPDATE ON equipos
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5. Índices útiles para búsquedas frecuentes
CREATE INDEX IF NOT EXISTS idx_equipos_ubicacion    ON equipos (ubicacion);
CREATE INDEX IF NOT EXISTS idx_equipos_criticidad   ON equipos (criticidad);
CREATE INDEX IF NOT EXISTS idx_equipos_tipo_sistema ON equipos (tipo_sistema);

-- 6. Datos de ejemplo (opcional — comentar si no se desean)
INSERT INTO equipos (asset_id, descripcion, criticidad, marca, modelo, ubicacion,
    potencia_hp, voltaje, rpm, amperaje, tipo_sistema,
    mes_inspeccion, ultimo_estado_vibraciones, ultimo_estado_termografia, ultimo_estado_ultrasonido)
VALUES
    ('M-101', 'Motor Bomba de Agua Chilada',  'Alta',  'WEG',     'W22 Plus',  'Sala de Máquinas', 25,  '460', 1770, 32,  'bomba',  'Enero 2025', 'B', 'B', 'A'),
    ('M-102', 'Motor Ventilador Torre Enfr.', 'Media', 'WEG',     'W22',       'Azotea',           10,  '460', 1170, 14,  'hvac',   'Enero 2025', 'A', 'B', 'B'),
    ('M-103', 'Motor Compresor Aire',         'Alta',  'Siemens', '1LA7',      'Cuarto Compresores', 50, '460', 3550, 65, 'otro',   'Enero 2025', 'B', 'A', 'B'),
    ('M-104', 'Bomba Circulación Primaria',   'Baja',  'Grundfos','CM5-4',     'Planta Baja',      5,   '230', 2900, 18,  'bomba',  NULL,         NULL, NULL, NULL)
ON CONFLICT (asset_id) DO NOTHING;

-- 7. Confirmación
SELECT
    'Tabla equipos creada/verificada.' AS estado,
    COUNT(*) AS equipos_registrados
FROM equipos;

-- ── Tabla de reportes guardados ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS reportes (
    id                  SERIAL          PRIMARY KEY,
    tecnica             VARCHAR(50)     NOT NULL,
    titulo              VARCHAR(300),
    datos               TEXT            NOT NULL,
    fecha_creacion      TIMESTAMPTZ     DEFAULT NOW(),
    codigo_reporte      VARCHAR(50)     UNIQUE,
    fecha_modificacion  TIMESTAMPTZ     DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reportes_tecnica ON reportes (tecnica);

-- ── Tabla de historial de inspecciones ──────────────────────────────
CREATE TABLE IF NOT EXISTS inspecciones (
    id                  SERIAL          PRIMARY KEY,
    asset_id            VARCHAR(100)    REFERENCES equipos(asset_id) ON DELETE CASCADE,
    tecnica             VARCHAR(20)     NOT NULL,
    estado              CHAR(1),
    mes_inspeccion      VARCHAR(50),
    notas               TEXT,
    fecha_registro      TIMESTAMPTZ     DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspecciones_asset ON inspecciones (asset_id);
CREATE INDEX IF NOT EXISTS idx_inspecciones_tecnica ON inspecciones (tecnica);

SELECT 'Tablas reportes e inspecciones creadas/verificadas.' AS estado;
