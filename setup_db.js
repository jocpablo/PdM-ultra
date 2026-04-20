const { Client } = require('pg');

// Intentar obtener la conexión desde la variable de entorno de Render
const connectionString = process.env.DATABASE_URL;

// Si no hay variable de entorno, intentar leer de los argumentos (para uso local)
const [,, user, password, host, port, database] = process.argv;

async function setup() {
    let db;

    if (connectionString) {
        console.log('  [INFO] Usando DATABASE_URL para la conexión.');
        db = new Client({
            connectionString: connectionString,
            ssl: { rejectUnauthorized: false } // Requerido para conexiones seguras en Render
        });
    } else {
        // Validación para uso local con argumentos
        if (!user || !password || !host || !port || !database) {
            console.error('Uso local: node setup_db.js [user] [password] [host] [port] [database]');
            console.error('Uso en nube: Asegúrese de que DATABASE_URL esté configurada.');
            process.exit(1);
        }
        db = new Client({ user, password, host, port: parseInt(port), database });
    }

    try {
        await db.connect();
        console.log('  [OK] Conectado a la base de datos.');
    } catch (err) {
        console.error('  [ERROR] Conexión fallida:', err.message);
        process.exit(1);
    }

    // 3. Tabla equipos
    try {
        await db.query(`CREATE TABLE IF NOT EXISTS equipos (
            asset_id VARCHAR(100) PRIMARY KEY, descripcion TEXT, criticidad VARCHAR(20),
            marca VARCHAR(100), modelo VARCHAR(100), ubicacion VARCHAR(200),
            potencia_hp NUMERIC(10,2), voltaje VARCHAR(50), rpm NUMERIC(10,2), amperaje NUMERIC(10,2),
            frame VARCHAR(50), clase_aislamiento VARCHAR(10),
            rodamiento_de VARCHAR(100), rodamiento_ode VARCHAR(100),
            tipo_sistema VARCHAR(50), transmision_tipo VARCHAR(50), modelo_faja VARCHAR(100),
            diametro_turbina NUMERIC(10,2), diametro_polea_conductora NUMERIC(10,2),
            diametro_polea_conducida NUMERIC(10,2), num_alabes_turbina INTEGER,
            orientacion VARCHAR(50), tipo_acople VARCHAR(100), num_alabes_impeler INTEGER,
            foto1 TEXT, foto2 TEXT, foto3 TEXT, foto4 TEXT,
            mes_inspeccion VARCHAR(50),
            ultimo_estado_vibraciones CHAR(1), ultimo_estado_termografia CHAR(1), ultimo_estado_ultrasonido CHAR(1),
            notas TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        )`);

        const newCols = [
            'caudal_nominal VARCHAR(50)', 'presion_nominal VARCHAR(50)', 'tipo_sello VARCHAR(100)',
            'tipo_compresor VARCHAR(50)', 'presion_max_comp VARCHAR(50)', 'caudal_comp VARCHAR(50)',
            'refrig_comp VARCHAR(100)', 'aceite_comp VARCHAR(100)', 'cap_aceite_comp VARCHAR(50)',
            'tipo_ventilador VARCHAR(50)', 'transmision_tipo_vent VARCHAR(50)',
            'caudal_vent VARCHAR(50)', 'presion_vent VARCHAR(50)',
            'diam_rodete VARCHAR(50)', 'num_alabes_vent INTEGER',
            'motor_primario VARCHAR(50)', 'potencia_kva VARCHAR(50)',
            'voltaje_salida VARCHAR(50)', 'frecuencia_gen VARCHAR(20)', 'fp_gen VARCHAR(20)', 'combustible_gen VARCHAR(100)',
            'tipo_reductor VARCHAR(50)', 'relacion_reduccion VARCHAR(50)',
            'rpm_salida NUMERIC(10,2)', 'torque_salida VARCHAR(50)',
            'aceite_reductor VARCHAR(100)', 'cap_aceite_red VARCHAR(50)',
            'ancho_banda VARCHAR(50)', 'longitud_banda VARCHAR(50)',
            'velocidad_banda VARCHAR(50)', 'capacidad_banda VARCHAR(50)',
            'material_banda VARCHAR(100)', 'accionamiento_banda VARCHAR(100)',
        ];

        for (const col of newCols) {
            await db.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS ${col}`).catch(()=>{});
        }

        await db.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS aplica_vibraciones BOOLEAN DEFAULT false`).catch(()=>{});
        await db.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS aplica_termografia BOOLEAN DEFAULT false`).catch(()=>{});
        await db.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS aplica_ultrasonido BOOLEAN DEFAULT false`).catch(()=>{});
        await db.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS kw_nominal NUMERIC(10,2)`).catch(()=>{});
        await db.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS rpm_nominal NUMERIC(10,2)`).catch(()=>{});
        await db.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS hp_nominal NUMERIC(10,2)`).catch(()=>{});
        console.log('  [OK] Tabla equipos lista.');
    } catch (err) { console.error('  [ERROR] Tabla equipos:', err.message); await db.end(); process.exit(1); }

    // 4. Tabla reportes
    try {
        await db.query(`CREATE TABLE IF NOT EXISTS reportes (
            id SERIAL PRIMARY KEY, tecnica VARCHAR(50) NOT NULL DEFAULT 'general',
            titulo VARCHAR(200), codigo_reporte VARCHAR(50) UNIQUE,
            datos TEXT NOT NULL DEFAULT '{}',
            fecha_creacion TIMESTAMPTZ DEFAULT NOW(), fecha_modificacion TIMESTAMPTZ DEFAULT NOW()
        )`);
        await db.query(`ALTER TABLE reportes ADD COLUMN IF NOT EXISTS tecnica VARCHAR(50) NOT NULL DEFAULT 'general'`).catch(()=>{});
        await db.query(`ALTER TABLE reportes ADD COLUMN IF NOT EXISTS titulo VARCHAR(200)`).catch(()=>{});
        await db.query(`ALTER TABLE reportes ADD COLUMN IF NOT EXISTS codigo_reporte VARCHAR(50) UNIQUE`).catch(()=>{});
        await db.query(`ALTER TABLE reportes ADD COLUMN IF NOT EXISTS datos TEXT NOT NULL DEFAULT '{}'`).catch(()=>{});
        await db.query(`ALTER TABLE reportes ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMPTZ DEFAULT NOW()`).catch(()=>{});
        await db.query(`ALTER TABLE reportes ADD COLUMN IF NOT EXISTS fecha_modificacion TIMESTAMPTZ DEFAULT NOW()`).catch(()=>{});
        await db.query(`CREATE INDEX IF NOT EXISTS idx_reportes_tecnica ON reportes (tecnica)`).catch(()=>{});
        console.log('  [OK] Tabla reportes lista.');
    } catch (err) { console.error('  [ERROR] Tabla reportes:', err.message); }

    // 5. Trigger updated_at
    try {
        await db.query(`CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
            BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql`);
        await db.query(`DROP TRIGGER IF EXISTS trg_equipos_updated_at ON equipos`);
        await db.query(`CREATE TRIGGER trg_equipos_updated_at BEFORE UPDATE ON equipos
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);
    } catch (err) { console.log('  [AVISO] Trigger:', err.message); }

    // 6. Indices
    try {
        await db.query(`CREATE INDEX IF NOT EXISTS idx_equipos_ubicacion ON equipos (ubicacion)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_equipos_criticidad ON equipos (criticidad)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_equipos_tipo_sistema ON equipos (tipo_sistema)`);
        console.log('  [OK] Indices creados.');
    } catch (err) { console.log('  [AVISO] Indices:', err.message); }

    // 7. Datos de ejemplo
    try {
        await db.query(`INSERT INTO equipos (asset_id,descripcion,criticidad,marca,modelo,ubicacion,potencia_hp,voltaje,rpm,amperaje,tipo_sistema,mes_inspeccion,ultimo_estado_vibraciones,ultimo_estado_termografia,ultimo_estado_ultrasonido) VALUES
            ('M-101','Motor Bomba de Agua','Alta','WEG','W22 Plus','Sala de Maquinas',25,'460',1770,32,'bomba','Enero 2025','B','B','A'),
            ('M-102','Motor Ventilador Torre','Media','WEG','W22','Azotea',10,'460',1170,14,'hvac','Enero 2025','A','B','B'),
            ('M-103','Motor Compresor Aire','Alta','Siemens','1LA7','Cuarto Compresores',50,'460',3550,65,'otro','Enero 2025','B','A','B'),
            ('M-104','Bomba Circulacion','Baja','Grundfos','CM5-4','Planta Baja',5,'230',2900,18,'bomba',NULL,NULL,NULL,NULL)
            ON CONFLICT (asset_id) DO NOTHING`);
        const count = await db.query('SELECT COUNT(*) FROM equipos');
        console.log(`  [OK] Datos de ejemplo listos. Total equipos: ${count.rows[0].count}`);
    } catch (err) { console.log('  [AVISO] Datos ejemplo:', err.message); }

    await db.end();
    console.log('\n  Base de datos lista.\n');
}

setup();