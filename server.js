const express = require('express');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

// ── Feature flags (configurables en .env) ─────────────────────
const FEATURES = {
    ot:             (process.env.MODULO_OT            || 'true') !== 'false',
    lubricacion:    (process.env.MODULO_LUBRICACION   || 'true') !== 'false',
    notificaciones: (process.env.MODULO_NOTIFICACIONES|| 'true') !== 'false',
    kpi_historico:  (process.env.MODULO_KPI_HISTORICO || 'true') !== 'false',
};

// Limpiar posibles \r de variables .env (originado por CRLF en Windows)
const envStr = v => (process.env[v] || '').replace(/\r/g, '').trim();

const net  = require('net');
const app  = express();
const preferredPort = parseInt(envStr('PORT')) || 3000;

function findFreePort(startPort) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.unref();
        server.on('error', () => resolve(findFreePort(startPort + 1)));
        server.listen(startPort, () => server.close(() => resolve(startPort)));
    });
}

const pool = new Pool({
    user:     envStr('DB_USER'),
    host:     envStr('DB_HOST'),
    database: envStr('DB_DATABASE'),
    password: envStr('DB_PASSWORD'),
    port:     parseInt(envStr('DB_PORT')) || 5432,
});

pool.connect((err) => {
    if (err) console.error('⚠️  Error BD:', err.message);
    else console.log('✅ Conectado a PostgreSQL.');
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ════════════════════════════════════════════════════════════════
// AUTH — JWT con crypto nativo (sin dependencias externas)
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const JWT_SECRET = envStr('JWT_SECRET') || 'pdm_suite_jwt_secret_2026_change_in_production';
const JWT_EXPIRY = 8 * 60 * 60; // 8 horas en segundos

// ── Password hashing con scrypt ────────────────────────────────
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    try {
        const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
    } catch { return false; }
}

// ── JWT mínimo (header.payload.signature) ─────────────────────
function signJWT(payload) {
    const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body    = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + JWT_EXPIRY })).toString('base64url');
    const sig     = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
}
function verifyJWT(token) {
    try {
        const [header, body, sig] = token.split('.');
        if (!header || !body || !sig) return null;
        const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (payload.exp < Math.floor(Date.now()/1000)) return null;
        return payload;
    } catch { return null; }
}

// ── Rate limiting en login ─────────────────────────────────────
const loginAttempts = new Map(); // ip -> { count, resetAt }
function checkRateLimit(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry || entry.resetAt < now) {
        loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 }); // 15 min window
        return true;
    }
    if (entry.count >= 10) return false; // 10 intentos max
    entry.count++;
    return true;
}

// ── RBAC — jerarquía de roles ──────────────────────────────────
const ROLES = { sysadmin: 4, admin: 3, tecnico: 2, visor: 1 };
function roleAtLeast(minRole) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'No autenticado.' });
        if ((ROLES[req.user.rol] || 0) >= ROLES[minRole]) return next();
        res.status(403).json({ error: 'Sin permisos suficientes.' });
    };
}

// ── Middleware de autenticación JWT ────────────────────────────
function requireAuth(req, res, next) {
    const token = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autenticado.' });
    const payload = verifyJWT(token);
    if (!payload) return res.status(401).json({ error: 'Sesión expirada o inválida.' });
    req.user = payload;
    next();
}

// ── Helper: verificar acceso a una planta ─────────────────────
function canAccessPlanta(user, planta) {
    if (user.rol === 'sysadmin') return true;
    return (user.plantas || []).includes(planta);
}

// ── Helper: filtrar activos por plantas del usuario ───────────
function plantaFilter(user, alias = '') {
    if (user.rol === 'sysadmin') return { sql: '', params: [] };
    const plantas = user.plantas || [];
    if (!plantas.length) return { sql: 'AND 1=0', params: [] }; // sin acceso
    const col = alias ? `${alias}.ubicacion` : 'ubicacion';
    const placeholders = plantas.map((_, i) => `$${i + 1}`).join(',');
    // Busca que la planta esté al inicio de ubicacion (formato "Planta / Zona" o solo "Planta")
    const conditions = plantas.map((_, i) => `(${col} = $${i+1} OR ${col} LIKE $${i+1} || ' /%' OR ${col} LIKE $${i+1} || '/%')`).join(' OR ');
    return { sql: `AND (${conditions})`, params: plantas };
}

// ── Archivos estáticos (sin auth) ───────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

const handleError = (res, err, msg = 'Error interno') => {
    console.error('❌', msg, err.message);
    res.status(500).json({ error: msg, detail: err.message });
};

// ════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════════
app.post('/api/login', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    }

    const { usuario, password } = req.body;
    if (!usuario || !password) return res.status(400).json({ error: 'Credenciales requeridas.' });

    // 1. Comprobar si es el Admin Sistema (credentials en .env)
    const SYS_USER = envStr('APP_USER') || 'admin';
    const SYS_PASS = envStr('APP_PASSWORD') || 'pdm2026';

    if (usuario === SYS_USER && password === SYS_PASS) {
        const token = signJWT({ id: 0, usuario: SYS_USER, nombre: 'Admin Sistema', rol: 'sysadmin', plantas: [] });
        return res.json({ success: true, token, rol: 'sysadmin', nombre: 'Admin Sistema' });
    }

    // 2. Buscar en tabla de usuarios
    try {
        const r = await pool.query(
            'SELECT id, usuario, nombre, password_hash, rol, activo FROM usuarios WHERE usuario=$1',
            [usuario.toLowerCase().trim()]
        );
        if (!r.rows.length) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
        const u = r.rows[0];
        if (!u.activo) return res.status(401).json({ error: 'Usuario inactivo. Contacta al administrador.' });
        if (!verifyPassword(password, u.password_hash)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });

        // Obtener plantas asignadas
        const pr = await pool.query('SELECT planta FROM usuario_plantas WHERE usuario_id=$1', [u.id]);
        const plantas = pr.rows.map(x => x.planta);

        const token = signJWT({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, plantas });
        // Registrar en audit log
        pool.query('INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1,$2,$3)',
            [u.id, 'login', `IP: ${ip}`]).catch(() => {});

        res.json({ success: true, token, rol: u.rol, nombre: u.nombre, plantas });
    } catch (err) { handleError(res, err, 'Error al autenticar'); }
});

app.post('/api/logout', requireAuth, async (req, res) => {
    if (req.user?.id) {
        pool.query('INSERT INTO audit_log (usuario_id, accion) VALUES ($1,$2)', [req.user.id, 'logout']).catch(() => {});
    }
    res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({
    ok: true,
    usuario: req.user.usuario,
    nombre: req.user.nombre,
    rol: req.user.rol,
    plantas: req.user.plantas || [],
    features: FEATURES,
}));

// ════════════════════════════════════════════════════════════════
// GESTIÓN DE PLANTAS (solo sysadmin)
// ════════════════════════════════════════════════════════════════
app.get('/api/plantas', requireAuth, async (req, res) => {
    try {
        if (req.user.rol === 'sysadmin') {
            const r = await pool.query('SELECT * FROM plantas ORDER BY nombre ASC');
            return res.json(r.rows);
        }
        // Otros roles: solo sus plantas
        const plantas = req.user.plantas || [];
        if (!plantas.length) return res.json([]);
        const r = await pool.query(
            `SELECT * FROM plantas WHERE nombre = ANY($1) ORDER BY nombre ASC`,
            [plantas]
        );
        res.json(r.rows);
    } catch (err) { handleError(res, err, 'Error al obtener plantas'); }
});

app.post('/api/plantas', requireAuth, roleAtLeast('sysadmin'), async (req, res) => {
    const { nombre, descripcion } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre de planta requerido.' });
    try {
        const r = await pool.query(
            `INSERT INTO plantas (nombre, descripcion) VALUES ($1,$2) ON CONFLICT (nombre) DO UPDATE SET descripcion=EXCLUDED.descripcion RETURNING *`,
            [nombre.trim(), descripcion || null]
        );
        pool.query('INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1,$2,$3)',
            [0, 'crear_planta', nombre.trim()]).catch(() => {});
        res.json({ success: true, planta: r.rows[0] });
    } catch (err) { handleError(res, err, 'Error al crear planta'); }
});

app.delete('/api/plantas/:nombre', requireAuth, roleAtLeast('sysadmin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM plantas WHERE nombre=$1', [decodeURIComponent(req.params.nombre)]);
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al eliminar planta'); }
});

// ════════════════════════════════════════════════════════════════
// GESTIÓN DE USUARIOS
// ════════════════════════════════════════════════════════════════
app.get('/api/usuarios', requireAuth, roleAtLeast('admin'), async (req, res) => {
    try {
        let q, params = [];
        if (req.user.rol === 'sysadmin') {
            q = `SELECT u.id, u.usuario, u.nombre, u.rol, u.activo, u.created_at,
                 ARRAY_AGG(up.planta ORDER BY up.planta) FILTER (WHERE up.planta IS NOT NULL) AS plantas
                 FROM usuarios u LEFT JOIN usuario_plantas up ON u.id=up.usuario_id
                 GROUP BY u.id ORDER BY u.nombre`;
        } else {
            // Admin planta: solo usuarios de sus plantas
            const plantas = req.user.plantas || [];
            q = `SELECT u.id, u.usuario, u.nombre, u.rol, u.activo, u.created_at,
                 ARRAY_AGG(up.planta ORDER BY up.planta) FILTER (WHERE up.planta IS NOT NULL) AS plantas
                 FROM usuarios u
                 JOIN usuario_plantas up ON u.id=up.usuario_id
                 WHERE up.planta = ANY($1)
                 GROUP BY u.id ORDER BY u.nombre`;
            params = [plantas];
        }
        const r = await pool.query(q, params);
        res.json(r.rows);
    } catch (err) { handleError(res, err, 'Error al listar usuarios'); }
});

app.post('/api/usuarios', requireAuth, roleAtLeast('admin'), async (req, res) => {
    const { usuario, nombre, password, rol, plantas } = req.body;
    if (!usuario || !nombre || !password || !rol) return res.status(400).json({ error: 'Todos los campos son obligatorios.' });

    // Admin planta solo puede crear técnicos y visores, no otros admins
    if (req.user.rol === 'admin' && ['sysadmin','admin'].includes(rol)) {
        return res.status(403).json({ error: 'No puedes crear usuarios con ese rol.' });
    }
    // Admin planta solo puede asignar sus propias plantas
    if (req.user.rol === 'admin') {
        const invalid = (plantas || []).filter(p => !req.user.plantas.includes(p));
        if (invalid.length) return res.status(403).json({ error: `Sin acceso a planta(s): ${invalid.join(', ')}` });
    }

    try {
        const exists = await pool.query('SELECT id FROM usuarios WHERE usuario=$1', [usuario.toLowerCase().trim()]);
        if (exists.rows.length) return res.status(409).json({ error: 'Nombre de usuario ya existe.' });

        const hash = hashPassword(password);
        const r = await pool.query(
            `INSERT INTO usuarios (usuario, nombre, password_hash, rol) VALUES ($1,$2,$3,$4) RETURNING id`,
            [usuario.toLowerCase().trim(), nombre.trim(), hash, rol]
        );
        const uid = r.rows[0].id;

        if (plantas?.length) {
            for (const p of plantas) {
                await pool.query('INSERT INTO usuario_plantas (usuario_id, planta) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, p]);
            }
        }
        pool.query('INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1,$2,$3)',
            [req.user.id || 0, 'crear_usuario', `${usuario} (${rol})`]).catch(() => {});
        res.json({ success: true, id: uid });
    } catch (err) { handleError(res, err, 'Error al crear usuario'); }
});

app.put('/api/usuarios/:id', requireAuth, roleAtLeast('admin'), async (req, res) => {
    const { nombre, password, rol, plantas, activo } = req.body;
    const uid = parseInt(req.params.id);
    if (isNaN(uid)) return res.status(400).json({ error: 'ID inválido.' });

    // Admin planta: no puede editar admins o sysadmins
    if (req.user.rol === 'admin') {
        const target = await pool.query('SELECT rol FROM usuarios WHERE id=$1', [uid]);
        if (!target.rows.length) return res.status(404).json({ error: 'No encontrado.' });
        if (['admin','sysadmin'].includes(target.rows[0].rol)) {
            return res.status(403).json({ error: 'No puedes editar ese usuario.' });
        }
        if (rol && ['sysadmin','admin'].includes(rol)) {
            return res.status(403).json({ error: 'No puedes asignar ese rol.' });
        }
    }

    try {
        const updates = [], vals = [];
        if (nombre)         { updates.push(`nombre=$${vals.push(nombre.trim())}`); }
        if (rol)            { updates.push(`rol=$${vals.push(rol)}`); }
        if (activo !== undefined) { updates.push(`activo=$${vals.push(!!activo)}`); }
        if (password?.trim()) { updates.push(`password_hash=$${vals.push(hashPassword(password))}`); }
        if (updates.length) {
            vals.push(uid);
            await pool.query(`UPDATE usuarios SET ${updates.join(',')} WHERE id=$${vals.length}`, vals);
        }
        if (plantas !== undefined) {
            await pool.query('DELETE FROM usuario_plantas WHERE usuario_id=$1', [uid]);
            for (const p of (plantas || [])) {
                await pool.query('INSERT INTO usuario_plantas (usuario_id, planta) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, p]);
            }
        }
        pool.query('INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1,$2,$3)',
            [req.user.id || 0, 'editar_usuario', `id:${uid}`]).catch(() => {});
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al editar usuario'); }
});

app.delete('/api/usuarios/:id', requireAuth, roleAtLeast('sysadmin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM usuarios WHERE id=$1', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al eliminar usuario'); }
});

// ════════════════════════════════════════════════════════════════
// AUDIT LOG (solo sysadmin)
// ════════════════════════════════════════════════════════════════
app.get('/api/audit', requireAuth, roleAtLeast('sysadmin'), async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT a.id, a.accion, a.detalle, a.created_at,
                   COALESCE(u.nombre, 'Admin Sistema') AS usuario_nombre,
                   COALESCE(u.rol, 'sysadmin') AS usuario_rol
            FROM audit_log a LEFT JOIN usuarios u ON a.usuario_id = u.id
            ORDER BY a.created_at DESC LIMIT 200`);
        res.json(r.rows);
    } catch (err) { handleError(res, err, 'Error al obtener audit log'); }
});

// ══════════════════════════════════════════════════════════════════
// EQUIPOS
// ══════════════════════════════════════════════════════════════════
app.get('/api/equipos', requireAuth, async (req, res) => {
    try {
        const { ubicacion, criticidad, tipo_sistema, q } = req.query;
        const pf = plantaFilter(req.user);
        const params = [...pf.params], filters = [];

        // Filtro de plantas del usuario (RBAC)
        if (pf.sql) filters.push(pf.sql.replace('AND ', ''));

        if (ubicacion) { params.push('%'+ubicacion+'%'); filters.push(`ubicacion ILIKE $${params.length}`); }
        if (criticidad) { params.push(criticidad); filters.push(`criticidad = $${params.length}`); }
        if (tipo_sistema) { params.push(tipo_sistema); filters.push(`tipo_sistema = $${params.length}`); }
        if (q) {
            params.push('%'+q+'%');
            const n = params.length;
            filters.push(`(asset_id ILIKE $${n} OR descripcion ILIKE $${n} OR marca ILIKE $${n} OR ubicacion ILIKE $${n})`);
        }

        let query = 'SELECT * FROM equipos';
        if (filters.length) query += ' WHERE ' + filters.join(' AND ');
        query += ' ORDER BY asset_id ASC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) { handleError(res, err, 'Error al obtener equipos'); }
});

app.get('/api/equipos/:id', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM equipos WHERE asset_id=$1', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
        const eq = result.rows[0];
        // Verificar acceso por planta
        const planta = (eq.ubicacion || '').split('/')[0].trim() || (eq.ubicacion || '');
        if (!canAccessPlanta(req.user, planta)) return res.status(403).json({ error: 'Sin acceso a este activo.' });
        res.json(eq);
    } catch (err) { handleError(res, err, 'Error al obtener equipo'); }
});

app.post('/api/equipos', requireAuth, roleAtLeast('admin'), async (req, res) => {
    const { asset_id, descripcion, criticidad, marca, modelo, ubicacion, planta,
        potencia_hp, voltaje, rpm, amperaje, frame, clase_aislamiento,
        rodamiento_de, rodamiento_ode, tipo_sistema, transmision_tipo,
        modelo_faja, diametro_turbina, diametro_polea_conductora,
        diametro_polea_conducida, num_alabes_turbina, orientacion,
        tipo_acople, num_alabes_impeler, foto1, foto2, foto3, foto4,
        mes_inspeccion, ultimo_estado_vibraciones, ultimo_estado_termografia,
        ultimo_estado_ultrasonido, notas,
        aplica_vibraciones, aplica_termografia, aplica_ultrasonido,
        caudal_nominal, presion_nominal, tipo_sello,
        tipo_compresor, presion_max_comp, caudal_comp, refrig_comp, aceite_comp, cap_aceite_comp,
        tipo_ventilador, transmision_tipo_vent, caudal_vent, presion_vent, diam_rodete, num_alabes_vent,
        motor_primario, potencia_kva, voltaje_salida, frecuencia_gen, fp_gen, combustible_gen,
        tipo_reductor, relacion_reduccion, rpm_salida, torque_salida, aceite_reductor, cap_aceite_red,
        ancho_banda, longitud_banda, velocidad_banda, capacidad_banda, material_banda, accionamiento_banda
    } = req.body;

    if (!asset_id) return res.status(400).json({ error: 'asset_id es obligatorio.' });

    // Helper: convierte '' o undefined a null (evita error NUMERIC en PostgreSQL)
    const n  = v => { const x = parseFloat(v); return isNaN(x) ? null : x; };
    // Helper: string vacío → null
    const s  = v => (v === '' || v == null) ? null : String(v).trim();
    // Helper: CHAR(1) — solo acepta exactamente 1 caracter o null
    const c1 = v => (v && String(v).trim().length === 1) ? String(v).trim() : null;

    const aplyVib    = !!aplica_vibraciones;
    const aplyTer    = !!aplica_termografia;
    const aplyUlt    = !!aplica_ultrasonido;
    const nAlabesVent = parseInt(num_alabes_vent)    || 0;
    const nAlabesTurb = parseInt(num_alabes_turbina) || 0;
    const nAlabesImp  = parseInt(num_alabes_impeler) || 0;

    // Construir ubicacion completa: planta + ubicacion específica
    const plantaVal    = s(planta);
    const ubicacionVal = s(ubicacion);
    const ubicacionFull = plantaVal && ubicacionVal
        ? `${plantaVal} / ${ubicacionVal}`
        : (plantaVal || ubicacionVal || null);

    try {
        await pool.query(`
            INSERT INTO equipos (asset_id,descripcion,criticidad,marca,modelo,ubicacion,potencia_hp,voltaje,rpm,amperaje,frame,clase_aislamiento,rodamiento_de,rodamiento_ode,tipo_sistema,transmision_tipo,modelo_faja,diametro_turbina,diametro_polea_conductora,diametro_polea_conducida,num_alabes_turbina,orientacion,tipo_acople,num_alabes_impeler,foto1,foto2,foto3,foto4,mes_inspeccion,ultimo_estado_vibraciones,ultimo_estado_termografia,ultimo_estado_ultrasonido,notas,aplica_vibraciones,aplica_termografia,aplica_ultrasonido,caudal_nominal,presion_nominal,tipo_sello,tipo_compresor,presion_max_comp,caudal_comp,refrig_comp,aceite_comp,cap_aceite_comp,tipo_ventilador,transmision_tipo_vent,caudal_vent,presion_vent,diam_rodete,num_alabes_vent,motor_primario,potencia_kva,voltaje_salida,frecuencia_gen,fp_gen,combustible_gen,tipo_reductor,relacion_reduccion,rpm_salida,torque_salida,aceite_reductor,cap_aceite_red,ancho_banda,longitud_banda,velocidad_banda,capacidad_banda,material_banda,accionamiento_banda)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67,$68,$69)
            ON CONFLICT (asset_id) DO UPDATE SET
                descripcion=COALESCE(EXCLUDED.descripcion,equipos.descripcion),
                criticidad=COALESCE(EXCLUDED.criticidad,equipos.criticidad),
                marca=COALESCE(EXCLUDED.marca,equipos.marca),
                modelo=COALESCE(EXCLUDED.modelo,equipos.modelo),
                ubicacion=COALESCE(EXCLUDED.ubicacion,equipos.ubicacion),
                potencia_hp=COALESCE(EXCLUDED.potencia_hp,equipos.potencia_hp),
                voltaje=COALESCE(EXCLUDED.voltaje,equipos.voltaje),
                rpm=COALESCE(EXCLUDED.rpm,equipos.rpm),
                amperaje=COALESCE(EXCLUDED.amperaje,equipos.amperaje),
                frame=COALESCE(EXCLUDED.frame,equipos.frame),
                clase_aislamiento=COALESCE(EXCLUDED.clase_aislamiento,equipos.clase_aislamiento),
                rodamiento_de=COALESCE(EXCLUDED.rodamiento_de,equipos.rodamiento_de),
                rodamiento_ode=COALESCE(EXCLUDED.rodamiento_ode,equipos.rodamiento_ode),
                tipo_sistema=COALESCE(EXCLUDED.tipo_sistema,equipos.tipo_sistema),
                transmision_tipo=COALESCE(EXCLUDED.transmision_tipo,equipos.transmision_tipo),
                modelo_faja=COALESCE(EXCLUDED.modelo_faja,equipos.modelo_faja),
                diametro_turbina=COALESCE(EXCLUDED.diametro_turbina,equipos.diametro_turbina),
                diametro_polea_conductora=COALESCE(EXCLUDED.diametro_polea_conductora,equipos.diametro_polea_conductora),
                diametro_polea_conducida=COALESCE(EXCLUDED.diametro_polea_conducida,equipos.diametro_polea_conducida),
                num_alabes_turbina=COALESCE(EXCLUDED.num_alabes_turbina,equipos.num_alabes_turbina),
                orientacion=COALESCE(EXCLUDED.orientacion,equipos.orientacion),
                tipo_acople=COALESCE(EXCLUDED.tipo_acople,equipos.tipo_acople),
                num_alabes_impeler=COALESCE(EXCLUDED.num_alabes_impeler,equipos.num_alabes_impeler),
                foto1=COALESCE(EXCLUDED.foto1,equipos.foto1),
                foto2=COALESCE(EXCLUDED.foto2,equipos.foto2),
                foto3=COALESCE(EXCLUDED.foto3,equipos.foto3),
                foto4=COALESCE(EXCLUDED.foto4,equipos.foto4),
                mes_inspeccion=COALESCE(EXCLUDED.mes_inspeccion,equipos.mes_inspeccion),
                ultimo_estado_vibraciones=COALESCE(EXCLUDED.ultimo_estado_vibraciones,equipos.ultimo_estado_vibraciones),
                ultimo_estado_termografia=COALESCE(EXCLUDED.ultimo_estado_termografia,equipos.ultimo_estado_termografia),
                ultimo_estado_ultrasonido=COALESCE(EXCLUDED.ultimo_estado_ultrasonido,equipos.ultimo_estado_ultrasonido),
                notas=COALESCE(EXCLUDED.notas,equipos.notas),
                aplica_vibraciones=EXCLUDED.aplica_vibraciones,
                aplica_termografia=EXCLUDED.aplica_termografia,
                aplica_ultrasonido=EXCLUDED.aplica_ultrasonido,
                caudal_nominal=EXCLUDED.caudal_nominal,presion_nominal=EXCLUDED.presion_nominal,tipo_sello=EXCLUDED.tipo_sello,
                tipo_compresor=EXCLUDED.tipo_compresor,presion_max_comp=EXCLUDED.presion_max_comp,caudal_comp=EXCLUDED.caudal_comp,
                refrig_comp=EXCLUDED.refrig_comp,aceite_comp=EXCLUDED.aceite_comp,cap_aceite_comp=EXCLUDED.cap_aceite_comp,
                tipo_ventilador=EXCLUDED.tipo_ventilador,transmision_tipo_vent=EXCLUDED.transmision_tipo_vent,
                caudal_vent=EXCLUDED.caudal_vent,presion_vent=EXCLUDED.presion_vent,
                diam_rodete=EXCLUDED.diam_rodete,num_alabes_vent=EXCLUDED.num_alabes_vent,
                motor_primario=EXCLUDED.motor_primario,potencia_kva=EXCLUDED.potencia_kva,
                voltaje_salida=EXCLUDED.voltaje_salida,frecuencia_gen=EXCLUDED.frecuencia_gen,
                fp_gen=EXCLUDED.fp_gen,combustible_gen=EXCLUDED.combustible_gen,
                tipo_reductor=EXCLUDED.tipo_reductor,relacion_reduccion=EXCLUDED.relacion_reduccion,
                rpm_salida=EXCLUDED.rpm_salida,torque_salida=EXCLUDED.torque_salida,
                aceite_reductor=EXCLUDED.aceite_reductor,cap_aceite_red=EXCLUDED.cap_aceite_red,
                ancho_banda=EXCLUDED.ancho_banda,longitud_banda=EXCLUDED.longitud_banda,
                velocidad_banda=EXCLUDED.velocidad_banda,capacidad_banda=EXCLUDED.capacidad_banda,
                material_banda=EXCLUDED.material_banda,accionamiento_banda=EXCLUDED.accionamiento_banda`,
        [
            s(asset_id), s(descripcion), s(criticidad), s(marca), s(modelo),
            ubicacionFull,                                      // $6  ubicacion (planta + zona)
            n(potencia_hp), s(voltaje), n(rpm), n(amperaje),   // $7–$10
            s(frame), s(clase_aislamiento),                     // $11–$12
            s(rodamiento_de), s(rodamiento_ode),                // $13–$14
            s(tipo_sistema), s(transmision_tipo), s(modelo_faja), // $15–$17
            n(diametro_turbina), n(diametro_polea_conductora), n(diametro_polea_conducida), // $18–$20
            nAlabesTurb, s(orientacion), s(tipo_acople), nAlabesImp, // $21–$24
            s(foto1), s(foto2), s(foto3), s(foto4),            // $25–$28
            s(mes_inspeccion),                                  // $29
            c1(ultimo_estado_vibraciones), c1(ultimo_estado_termografia), c1(ultimo_estado_ultrasonido), // $30–$32
            s(notas),                                           // $33
            aplyVib, aplyTer, aplyUlt,                         // $34–$36
            s(caudal_nominal), s(presion_nominal), s(tipo_sello), // $37–$39
            s(tipo_compresor), s(presion_max_comp), s(caudal_comp), s(refrig_comp), s(aceite_comp), s(cap_aceite_comp), // $40–$45
            s(tipo_ventilador), s(transmision_tipo_vent), s(caudal_vent), s(presion_vent), s(diam_rodete), nAlabesVent, // $46–$51
            s(motor_primario), s(potencia_kva), s(voltaje_salida), s(frecuencia_gen), s(fp_gen), s(combustible_gen),   // $52–$57
            s(tipo_reductor), s(relacion_reduccion), n(rpm_salida), s(torque_salida), s(aceite_reductor), s(cap_aceite_red), // $58–$63
            s(ancho_banda), s(longitud_banda), s(velocidad_banda), s(capacidad_banda), s(material_banda), s(accionamiento_banda) // $64–$69
        ]);
        res.json({ success: true, asset_id });
    } catch (err) {
        console.error('\n[ERROR] POST /api/equipos:');
        console.error('  Message:', err.message);
        console.error('  Detail:', err.detail);
        console.error('  Code:', err.code);
        handleError(res, err, 'Error al guardar equipo');
    }
});

app.patch('/api/equipos/:id/estado', requireAuth, roleAtLeast('tecnico'), async (req, res) => {
    const { ultimo_estado_vibraciones, ultimo_estado_termografia, ultimo_estado_ultrasonido, mes_inspeccion, notas } = req.body;
    try {
        // Verificar acceso por planta
        const eq = await pool.query('SELECT ubicacion FROM equipos WHERE asset_id=$1', [req.params.id]);
        if (!eq.rows.length) return res.status(404).json({ error: 'No encontrado' });
        const planta = (eq.rows[0].ubicacion || '').split('/')[0].trim();
        if (!canAccessPlanta(req.user, planta)) return res.status(403).json({ error: 'Sin acceso.' });

        await pool.query(`UPDATE equipos SET
            ultimo_estado_vibraciones=COALESCE($1,ultimo_estado_vibraciones),
            ultimo_estado_termografia=COALESCE($2,ultimo_estado_termografia),
            ultimo_estado_ultrasonido=COALESCE($3,ultimo_estado_ultrasonido),
            mes_inspeccion=COALESCE($4,mes_inspeccion),notas=COALESCE($5,notas)
            WHERE asset_id=$6`,
        [ultimo_estado_vibraciones,ultimo_estado_termografia,ultimo_estado_ultrasonido,mes_inspeccion,notas,req.params.id]);
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al actualizar estado'); }
});

app.delete('/api/equipos/:id', requireAuth, roleAtLeast('admin'), async (req, res) => {
    try {
        const eq = await pool.query('SELECT ubicacion FROM equipos WHERE asset_id=$1', [req.params.id]);
        if (!eq.rows.length) return res.status(404).json({ error: 'No encontrado' });
        const planta = (eq.rows[0].ubicacion || '').split('/')[0].trim();
        if (!canAccessPlanta(req.user, planta)) return res.status(403).json({ error: 'Sin acceso.' });
        await pool.query('DELETE FROM equipos WHERE asset_id=$1', [req.params.id]);
        pool.query('INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1,$2,$3)',
            [req.user.id || 0, 'eliminar_equipo', req.params.id]).catch(() => {});
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al eliminar'); }
});

// KPIs para dashboard
app.get('/api/kpis', requireAuth, async (req, res) => {
    try {
        const { planta } = req.query;
        const pf = plantaFilter(req.user);

        // Build WHERE clause combining RBAC plant filter + optional specific planta
        let whereClause = '';
        let params = [];

        if (pf.params.length > 0) {
            // RBAC filter already returns conditions without AND prefix, rebuild
            const plantaConditions = pf.params.map((_, i) =>
                `(ubicacion = $${i+1} OR ubicacion LIKE $${i+1} || ' /%' OR ubicacion LIKE $${i+1} || '/%')`
            ).join(' OR ');
            whereClause = `WHERE (${plantaConditions})`;
            params = [...pf.params];
        }

        // Additionally filter by specific planta if requested
        if (planta) {
            const idx = params.length + 1;
            const plantaCondition = `(ubicacion = $${idx} OR ubicacion LIKE $${idx} || ' /%' OR ubicacion LIKE $${idx} || '/%')`;
            whereClause = whereClause
                ? whereClause + ` AND ${plantaCondition}`
                : `WHERE ${plantaCondition}`;
            params.push(planta);
        }

        const w = whereClause;
        const p = params;

        const [summary, byUbicacion, byTipo, byEstado] = await Promise.all([
            pool.query(`SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE criticidad='Alta') AS criticos,
                COUNT(*) FILTER (WHERE ultimo_estado_vibraciones='C' OR ultimo_estado_termografia='C' OR ultimo_estado_ultrasonido='C') AS en_falla,
                COUNT(*) FILTER (WHERE ultimo_estado_vibraciones IS NULL AND ultimo_estado_termografia IS NULL AND ultimo_estado_ultrasonido IS NULL) AS sin_inspeccion,
                COUNT(*) FILTER (WHERE ultimo_estado_vibraciones='B' AND ultimo_estado_termografia='B' AND ultimo_estado_ultrasonido='B') AS todos_buenos,
                COUNT(*) FILTER (WHERE criticidad='Media') AS media,
                COUNT(*) FILTER (WHERE criticidad='Baja') AS baja,
                COUNT(*) FILTER (WHERE ultimo_estado_vibraciones='A' OR ultimo_estado_termografia='A' OR ultimo_estado_ultrasonido='A') AS en_alerta,
                COUNT(*) FILTER (WHERE aplica_vibraciones) AS con_vibraciones,
                COUNT(*) FILTER (WHERE aplica_termografia) AS con_termografia,
                COUNT(*) FILTER (WHERE aplica_ultrasonido) AS con_ultrasonido
                FROM equipos ${w}`, p),
            pool.query(`SELECT ubicacion, COUNT(*) as total,
                COUNT(*) FILTER (WHERE ultimo_estado_vibraciones='C' OR ultimo_estado_termografia='C' OR ultimo_estado_ultrasonido='C') AS criticos,
                COUNT(*) FILTER (WHERE ultimo_estado_vibraciones='A' OR ultimo_estado_termografia='A' OR ultimo_estado_ultrasonido='A') AS alertas,
                COUNT(*) FILTER (WHERE ultimo_estado_vibraciones='B' AND ultimo_estado_termografia='B' AND ultimo_estado_ultrasonido='B') AS buenos
                FROM equipos ${w ? w + ' AND' : 'WHERE'} ubicacion IS NOT NULL AND ubicacion != ''
                GROUP BY ubicacion ORDER BY total DESC LIMIT 10`, p),
            pool.query(`SELECT tipo_sistema, COUNT(*) as total FROM equipos ${w ? w + ' AND' : 'WHERE'} tipo_sistema IS NOT NULL GROUP BY tipo_sistema ORDER BY total DESC`, p),
            pool.query(`SELECT
                SUM(CASE WHEN aplica_vibraciones AND ultimo_estado_vibraciones='B' THEN 1 ELSE 0 END) as vib_b,
                SUM(CASE WHEN aplica_vibraciones AND ultimo_estado_vibraciones='A' THEN 1 ELSE 0 END) as vib_a,
                SUM(CASE WHEN aplica_vibraciones AND ultimo_estado_vibraciones='C' THEN 1 ELSE 0 END) as vib_c,
                SUM(CASE WHEN aplica_vibraciones AND ultimo_estado_vibraciones='N' THEN 1 ELSE 0 END) as vib_n,
                SUM(CASE WHEN aplica_vibraciones AND ultimo_estado_vibraciones IS NULL THEN 1 ELSE 0 END) as vib_null,
                SUM(CASE WHEN aplica_termografia AND ultimo_estado_termografia='B' THEN 1 ELSE 0 END) as ter_b,
                SUM(CASE WHEN aplica_termografia AND ultimo_estado_termografia='A' THEN 1 ELSE 0 END) as ter_a,
                SUM(CASE WHEN aplica_termografia AND ultimo_estado_termografia='C' THEN 1 ELSE 0 END) as ter_c,
                SUM(CASE WHEN aplica_termografia AND ultimo_estado_termografia='N' THEN 1 ELSE 0 END) as ter_n,
                SUM(CASE WHEN aplica_termografia AND ultimo_estado_termografia IS NULL THEN 1 ELSE 0 END) as ter_null,
                SUM(CASE WHEN aplica_ultrasonido AND ultimo_estado_ultrasonido='B' THEN 1 ELSE 0 END) as ult_b,
                SUM(CASE WHEN aplica_ultrasonido AND ultimo_estado_ultrasonido='A' THEN 1 ELSE 0 END) as ult_a,
                SUM(CASE WHEN aplica_ultrasonido AND ultimo_estado_ultrasonido='C' THEN 1 ELSE 0 END) as ult_c,
                SUM(CASE WHEN aplica_ultrasonido AND ultimo_estado_ultrasonido='N' THEN 1 ELSE 0 END) as ult_n,
                SUM(CASE WHEN aplica_ultrasonido AND ultimo_estado_ultrasonido IS NULL THEN 1 ELSE 0 END) as ult_null
                FROM equipos ${w}`, p)
        ]);
        res.json({
            ...summary.rows[0],
            por_ubicacion: byUbicacion.rows,
            por_tipo: byTipo.rows,
            por_tecnica: byEstado.rows[0]
        });
    } catch (err) { handleError(res, err, 'Error KPIs'); }
});

// ══════════════════════════════════════════════════════════════════
// REPORTES (guardar/cargar por técnica)
// ══════════════════════════════════════════════════════════════════
app.get('/api/reportes', requireAuth, async (req, res) => {
    try {
        const { tecnica } = req.query;
        let q = 'SELECT id, tecnica, titulo, codigo_reporte, fecha_creacion, fecha_modificacion FROM reportes';
        const params = [];
        if (tecnica) { params.push(tecnica); q += ' WHERE tecnica=$1'; }
        q += ' ORDER BY fecha_modificacion DESC';
        const r = await pool.query(q, params);
        res.json(r.rows);
    } catch (err) { handleError(res, err, 'Error al listar reportes'); }
});

// Generate consecutive code: VIB-DD-MMM-YY-XXXX
async function generarCodigo(tecnica) {
    const now = new Date();
    const dd  = String(now.getDate()).padStart(2,'0');
    const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const mmm = meses[now.getMonth()];
    const yy  = String(now.getFullYear()).slice(-2);
    const prefixMap = { termografia:'Ter', ultrasonido:'Ult', generales:'Gen' };
    const p = prefixMap[tecnica] || 'Vib';
    const prefix = `${p}-${dd}-${mmm}-${yy}-`;
    const r = await pool.query(
        `SELECT COUNT(*) FROM reportes WHERE codigo_reporte LIKE $1`,
        [prefix + '%']
    );
    const seq = String(parseInt(r.rows[0].count) + 1).padStart(4,'0');
    return prefix + seq;
}

app.get('/api/reportes/next-code', requireAuth, async (req, res) => {
    try {
        const tecnica = req.query.tecnica || 'vibraciones';
        const code = await generarCodigo(tecnica);
        res.json({ code });
    } catch (err) { handleError(res, err, 'Error al generar código'); }
});

app.get('/api/reportes/by-code/:code', requireAuth, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM reportes WHERE codigo_reporte=$1', [req.params.code]);
        if (!r.rows.length) return res.status(404).json({ error: 'Reporte no encontrado' });
        res.json({ ...r.rows[0], datos: JSON.parse(r.rows[0].datos) });
    } catch (err) { handleError(res, err, 'Error al cargar reporte'); }
});

// ── Reportes de un equipo específico (para hoja de vida) ──────────
// IMPORTANTE: debe estar ANTES de /:id para evitar que Express capture "equipo" como id
app.get('/api/reportes/equipo/:asset_id', requireAuth, async (req, res) => {
    try {
        const assetId = req.params.asset_id;
        const r = await pool.query(`
            SELECT id, tecnica, titulo, codigo_reporte, fecha_modificacion,
                   datos::json->>'asset_id' as asset_id_dato
            FROM reportes
            WHERE datos::text ILIKE $1
            ORDER BY fecha_modificacion DESC
            LIMIT 50`,
            [`%${assetId}%`]
        );
        res.json(r.rows);
    } catch (err) { handleError(res, err, 'Error al buscar reportes del equipo'); }
});

app.get('/api/reportes/:id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM reportes WHERE id=$1', [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
        res.json({ ...r.rows[0], datos: JSON.parse(r.rows[0].datos) });
    } catch (err) { handleError(res, err, 'Error al cargar reporte'); }
});


// ── Helper: extraer severidad global de un reporte ──────────────
function extraerSeveridadGlobal(datos, tecnica) {
    try {
        // Vibraciones: tabla resultado con dataset.sev en filas
        if (tecnica === 'vibraciones' && datos.resultadoTabla) {
            const sevs = (datos.resultadoTabla || []).map(r => r.sev || '').filter(Boolean);
            if (sevs.includes('C')) return 'C';
            if (sevs.includes('A')) return 'A';
            if (sevs.length) return 'B';
        }
        // Termografía / Ultrasonido: filas con sev al final
        if ((tecnica === 'termografia' || tecnica === 'ultrasonido') && datos.filas) {
            const sevs = (datos.filas || []).map(f => Array.isArray(f) ? f[f.length-1] : '').filter(Boolean);
            if (sevs.includes('C')) return 'C';
            if (sevs.includes('A')) return 'A';
            if (sevs.length) return 'B';
        }
        // Anexos: puntos con .sev
        if ((tecnica === 'anexo_termo' || tecnica === 'anexo_ultra') && datos.puntos) {
            const sevs = (datos.puntos || []).map(p => p.sev || '').filter(Boolean);
            if (sevs.includes('C')) return 'C';
            if (sevs.includes('A')) return 'A';
            if (sevs.length) return 'B';
        }
        return null;
    } catch { return null; }
}

// ── Helper: actualizar semáforo del equipo si el reporte tiene asset_id ──
async function actualizarSemaforoEquipo(datos, tecnica) {
    try {
        const assetId = datos?.asset_id || datos?.info?.['au-equipo']?.split('—')[0]?.trim()
                      || datos?.info?.['at-equipo']?.split('—')[0]?.trim();
        if (!assetId) return;
        const sev = extraerSeveridadGlobal(datos, tecnica);
        if (!sev) return;
        const colMap = {
            vibraciones: 'ultimo_estado_vibraciones',
            termografia: 'ultimo_estado_termografia',
            ultrasonido: 'ultimo_estado_ultrasonido',
            anexo_termo: 'ultimo_estado_termografia',
            anexo_ultra: 'ultimo_estado_ultrasonido',
        };
        const col = colMap[tecnica];
        if (!col) return;
        await pool.query(
            `UPDATE equipos SET ${col}=$1, updated_at=NOW() WHERE asset_id=$2`,
            [sev, assetId]
        );
        console.log(`  [AUTO] Semáforo ${assetId} → ${col}=${sev}`);
    } catch (e) { console.warn('  [WARN] No se pudo actualizar semáforo:', e.message); }
}

app.post('/api/reportes', requireAuth, async (req, res) => {
    const { tecnica, titulo, datos, codigo_reporte } = req.body;
    if (!tecnica || !datos) return res.status(400).json({ error: 'tecnica y datos son obligatorios' });
    try {
        const codigo = codigo_reporte || await generarCodigo(tecnica);
        const r = await pool.query(
            `INSERT INTO reportes (tecnica, titulo, datos, codigo_reporte) VALUES ($1,$2,$3,$4) RETURNING id, codigo_reporte`,
            [tecnica, titulo || codigo, JSON.stringify(datos), codigo]
        );
        // Auto-actualizar semáforo del equipo
        await actualizarSemaforoEquipo(datos, tecnica);
        res.json({ success: true, id: r.rows[0].id, codigo_reporte: r.rows[0].codigo_reporte });
    } catch (err) { handleError(res, err, 'Error al guardar reporte'); }
});

app.put('/api/reportes/:id', requireAuth, async (req, res) => {
    const { titulo, datos } = req.body;
    try {
        // Verificar que el reporte existe antes de actualizar
        const existing = await pool.query('SELECT tecnica FROM reportes WHERE id=$1', [req.params.id]);
        if (!existing.rows.length) {
            return res.status(404).json({ error: 'Reporte no encontrado' });
        }
        await pool.query(
            'UPDATE reportes SET titulo=$1, datos=$2, fecha_modificacion=NOW() WHERE id=$3',
            [titulo, JSON.stringify(datos), req.params.id]
        );
        await actualizarSemaforoEquipo(datos, existing.rows[0].tecnica);
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al actualizar reporte'); }
});

// ── KPIs enriquecidos: también desde tabla reportes ───────────────
app.get('/api/kpis/reportes', requireAuth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT
                tecnica,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE fecha_modificacion > NOW() - INTERVAL '30 days') as ultimo_mes,
                COUNT(*) FILTER (WHERE fecha_modificacion > NOW() - INTERVAL '7 days')  as ultima_semana,
                MAX(fecha_modificacion) as ultimo_reporte
            FROM reportes
            GROUP BY tecnica
            ORDER BY total DESC
        `);
        res.json(r.rows);
    } catch (err) { handleError(res, err, 'Error al calcular KPIs de reportes'); }
});

app.delete('/api/reportes/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM reportes WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al eliminar reporte'); }
});

// ══════════════════════════════════════════════════════════════════
// MONITOREO DE CONDICIONES — Vibraciones (tendencia overall)
// ══════════════════════════════════════════════════════════════════

// Configuración de puntos y límites por equipo/técnica
app.get('/api/condicion/config/:asset_id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT * FROM condicion_config WHERE asset_id=$1',
            [req.params.asset_id]
        );
        res.json(r.rows[0] || null);
    } catch (err) { handleError(res, err, 'Error al obtener configuración'); }
});

app.post('/api/condicion/config', requireAuth, async (req, res) => {
    const { asset_id, puntos, limites_vel, limites_env, limites_crest, iso_class, system_unit, frecuencia, usar_globales } = req.body;
    if (!asset_id) return res.status(400).json({ error: 'asset_id requerido' });
    try {
        await pool.query(`
            INSERT INTO condicion_config (asset_id, puntos, limites_vel, limites_env, limites_crest, iso_class, system_unit, frecuencia, usar_globales)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (asset_id) DO UPDATE SET
                puntos=EXCLUDED.puntos, limites_vel=EXCLUDED.limites_vel,
                limites_env=EXCLUDED.limites_env, limites_crest=EXCLUDED.limites_crest,
                iso_class=EXCLUDED.iso_class, system_unit=EXCLUDED.system_unit,
                frecuencia=EXCLUDED.frecuencia, usar_globales=EXCLUDED.usar_globales,
                updated_at=NOW()`,
            [asset_id, JSON.stringify(puntos), JSON.stringify(limites_vel), JSON.stringify(limites_env),
             JSON.stringify(limites_crest || {}), iso_class, system_unit, frecuencia,
             usar_globales !== false]
        );
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al guardar configuración'); }
});

// ── Límites globales (default para todos los equipos) ──────────
app.get('/api/condicion/globales', requireAuth, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM condicion_globales WHERE id=1');
        res.json(r.rows[0] || { limites_vel: '{}', limites_env: '{}', limites_crest: '{}' });
    } catch (err) { handleError(res, err, 'Error al obtener límites globales'); }
});

app.post('/api/condicion/globales', requireAuth, async (req, res) => {
    const { limites_vel, limites_env, limites_crest, system_unit, iso_class } = req.body;
    try {
        await pool.query(`
            INSERT INTO condicion_globales (id, limites_vel, limites_env, limites_crest, system_unit, iso_class)
            VALUES (1,$1,$2,$3,$4,$5)
            ON CONFLICT (id) DO UPDATE SET
                limites_vel=EXCLUDED.limites_vel, limites_env=EXCLUDED.limites_env,
                limites_crest=EXCLUDED.limites_crest, system_unit=EXCLUDED.system_unit,
                iso_class=EXCLUDED.iso_class, updated_at=NOW()`,
            [JSON.stringify(limites_vel || {}), JSON.stringify(limites_env || {}),
             JSON.stringify(limites_crest || {}), system_unit || 'mm/seg', iso_class || '']
        );
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al guardar límites globales'); }
});

// Lecturas de medición
app.get('/api/condicion/lecturas/:asset_id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT * FROM condicion_lecturas WHERE asset_id=$1 ORDER BY fecha_medicion ASC',
            [req.params.asset_id]
        );
        res.json(r.rows);
    } catch (err) { handleError(res, err, 'Error al obtener lecturas'); }
});

app.post('/api/condicion/lecturas', requireAuth, async (req, res) => {
    const { asset_id, fecha_medicion, valores_vel, valores_env, valores_temp, notas } = req.body;
    if (!asset_id || !fecha_medicion) return res.status(400).json({ error: 'asset_id y fecha_medicion requeridos' });
    try {
        const r = await pool.query(`
            INSERT INTO condicion_lecturas (asset_id, fecha_medicion, valores_vel, valores_env, valores_temp, notas)
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [asset_id, fecha_medicion, JSON.stringify(valores_vel || {}), JSON.stringify(valores_env || {}), JSON.stringify(valores_temp || {}), notas || null]
        );
        res.json({ success: true, id: r.rows[0].id });
    } catch (err) { handleError(res, err, 'Error al guardar lectura'); }
});

app.put('/api/condicion/lecturas/:id', requireAuth, async (req, res) => {
    const { fecha_medicion, valores_vel, valores_env, valores_temp, notas } = req.body;
    try {
        const existing = await pool.query('SELECT id FROM condicion_lecturas WHERE id=$1', [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ error: 'Lectura no encontrada' });
        await pool.query(`
            UPDATE condicion_lecturas SET
                fecha_medicion=$1, valores_vel=$2, valores_env=$3, valores_temp=$4, notas=$5, updated_at=NOW()
            WHERE id=$6`,
            [fecha_medicion, JSON.stringify(valores_vel || {}), JSON.stringify(valores_env || {}), JSON.stringify(valores_temp || {}), notas || null, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al actualizar lectura'); }
});

app.delete('/api/condicion/lecturas/:id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM condicion_lecturas WHERE id=$1 RETURNING id', [req.params.id]);
        if (!r.rowCount) return res.status(404).json({ error: 'No encontrada' });
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al eliminar lectura'); }
});

// ── Auto-migrate columns on every server start ───────────────
// ════════════════════════════════════════════════════════════════
// ISO 10816 — Límites automáticos por grupo de máquina
// ════════════════════════════════════════════════════════════════

// Tabla de límites ISO 10816-3 (mm/s rms)
// Grupos: 1=Grandes rígidas, 2=Medianas flexibles, 3=Bombas rígidas, 4=Bombas flexibles
const ISO10816 = {
    '1': { desc: 'Grupo 1 — Máq. grandes ≥15kW, montaje rígido',       A: 2.3, B: 4.5, C: 7.1 },
    '2': { desc: 'Grupo 2 — Máq. medianas ≥15kW, montaje flexible',     A: 3.5, B: 7.1, C: 11.0 },
    '3': { desc: 'Grupo 3 — Bombas >15kW, montaje rígido',              A: 2.3, B: 4.5, C: 7.1 },
    '4': { desc: 'Grupo 4 — Bombas >15kW, montaje flexible',            A: 3.5, B: 7.1, C: 11.0 },
    '5': { desc: 'Grupo 5 — Máq. pequeñas <15kW montaje rígido',        A: 1.4, B: 2.8, C: 4.5 },
    '6': { desc: 'Grupo 6 — Máq. pequeñas <15kW montaje flexible',      A: 2.3, B: 4.5, C: 7.1 },
};

// Retorna los grupos ISO disponibles
app.get('/api/condicion/iso10816', requireAuth, (req, res) => {
    res.json(Object.entries(ISO10816).map(([k,v]) => ({ grupo: k, ...v })));
});

// Calcula límites ISO para un equipo/grupo dado (vel en mm/s)
app.get('/api/condicion/iso10816/:grupo', requireAuth, (req, res) => {
    const g = ISO10816[req.params.grupo];
    if (!g) return res.status(404).json({ error: 'Grupo ISO no encontrado.' });
    // Genera estructura de límites para N puntos del equipo
    const puntos = req.query.puntos ? req.query.puntos.split(',') : ['1H','2H','3H','4H'];
    const limites_vel = {};
    puntos.forEach(p => {
        limites_vel[p] = { ulc: g.C, med: g.B, lcl: g.A };
    });
    res.json({ grupo: req.params.grupo, descripcion: g.desc, limites_vel, zonas: { A: g.A, B: g.B, C: g.C } });
});

// ── Cálculo estadístico de alarmas por historial ───────────────
// Método 1: Media ± 2 desviaciones estándar
// Método 2: Percentiles 75 / 90 / 95
app.get('/api/condicion/alarmas-estadisticas/:asset_id', requireAuth, async (req, res) => {
    const { metodo = 'stddev', min_lecturas = 10 } = req.query;
    try {
        const rows = await pool.query(
            'SELECT valores_vel, valores_env, valores_temp FROM condicion_lecturas WHERE asset_id=$1 ORDER BY fecha_medicion ASC',
            [req.params.asset_id]
        );
        if (rows.rows.length < parseInt(min_lecturas)) {
            return res.json({
                suficiente: false,
                lecturas: rows.rows.length,
                minimo: parseInt(min_lecturas),
                mensaje: `Se necesitan al menos ${min_lecturas} mediciones. Actualmente: ${rows.rows.length}.`
            });
        }

        // Agrupar valores por punto
        const byPunto = {};
        rows.rows.forEach(r => {
            const vel = typeof r.valores_vel === 'object' ? r.valores_vel : JSON.parse(r.valores_vel || '{}');
            Object.entries(vel).forEach(([p, v]) => {
                if (v == null) return;
                if (!byPunto[p]) byPunto[p] = [];
                byPunto[p].push(parseFloat(v));
            });
        });

        const resultVel = {};
        Object.entries(byPunto).forEach(([p, vals]) => {
            vals.sort((a,b) => a-b);
            if (metodo === 'percentil') {
                const pct = (arr, p) => {
                    const idx = Math.ceil(arr.length * p / 100) - 1;
                    return Math.round(arr[Math.max(0, idx)] * 100) / 100;
                };
                resultVel[p] = {
                    lcl: pct(vals, 75),
                    med: pct(vals, 90),
                    ulc: pct(vals, 95),
                };
            } else {
                // stddev
                const mean = vals.reduce((a,b) => a+b, 0) / vals.length;
                const std  = Math.sqrt(vals.reduce((a,b) => a + (b-mean)**2, 0) / vals.length);
                resultVel[p] = {
                    lcl: Math.round((mean + std)   * 100) / 100,
                    med: Math.round((mean + 1.5*std) * 100) / 100,
                    ulc: Math.round((mean + 2*std)  * 100) / 100,
                };
            }
        });

        res.json({
            suficiente: true,
            lecturas: rows.rows.length,
            metodo,
            limites_vel: resultVel,
            nota: metodo === 'stddev'
                ? 'Alarmas calculadas por Media + 1σ (Alerta), +1.5σ (Atención), +2σ (Crítico)'
                : 'Alarmas calculadas por percentil P75 (Alerta), P90 (Atención), P95 (Crítico)'
        });
    } catch (err) { handleError(res, err, 'Error al calcular alarmas'); }
});


// ════════════════════════════════════════════════════════════════
// API — TERMOGRAFÍA DE CONDICIÓN
// ════════════════════════════════════════════════════════════════

// ── Componentes ─────────────────────────────────────────────────
app.get('/api/termo/componentes/:asset_id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT * FROM termo_componentes WHERE asset_id=$1 ORDER BY orden, id',
            [req.params.asset_id]
        );
        res.json(r.rows);
    } catch (err) { handleError(res, err, 'Error al obtener componentes'); }
});

app.post('/api/termo/componentes', requireAuth, async (req, res) => {
    const { asset_id, nombre, tipo_componente, criterio, num_fases,
            corriente_nominal, corriente_nominal_r, corriente_nominal_s, corriente_nominal_t,
            temp_max_abs, temp_rise_rated, temp_amb_rated,
            delta_t_alerta, delta_t_alarma, emisividad, distancia_tipica,
            notas_config, orden } = req.body;
    if (!asset_id || !nombre || !tipo_componente)
        return res.status(400).json({ error: 'asset_id, nombre y tipo_componente son obligatorios' });
    try {
        const r = await pool.query(
            `INSERT INTO termo_componentes
             (asset_id, nombre, tipo_componente, criterio, num_fases,
              corriente_nominal, corriente_nominal_r, corriente_nominal_s, corriente_nominal_t,
              temp_max_abs, temp_rise_rated, temp_amb_rated,
              delta_t_alerta, delta_t_alarma, emisividad, distancia_tipica,
              notas_config, orden)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
             RETURNING *`,
            [asset_id, nombre, tipo_componente, criterio || 'delta_t', num_fases || 1,
             corriente_nominal || null, corriente_nominal_r || null,
             corriente_nominal_s || null, corriente_nominal_t || null,
             temp_max_abs || null, temp_rise_rated || null, temp_amb_rated || 40,
             delta_t_alerta || null, delta_t_alarma || null,
             emisividad || 0.95, distancia_tipica || null,
             notas_config || null, orden || 0]
        );
        res.json(r.rows[0]);
    } catch (err) { handleError(res, err, 'Error al crear componente'); }
});

app.put('/api/termo/componentes/:id', requireAuth, async (req, res) => {
    const { nombre, tipo_componente, criterio, num_fases,
            corriente_nominal, corriente_nominal_r, corriente_nominal_s, corriente_nominal_t,
            temp_max_abs, temp_rise_rated, temp_amb_rated,
            delta_t_alerta, delta_t_alarma, emisividad, distancia_tipica,
            notas_config, orden } = req.body;
    try {
        const r = await pool.query(
            `UPDATE termo_componentes SET
             nombre=$1, tipo_componente=$2, criterio=$3, num_fases=$4,
             corriente_nominal=$5, corriente_nominal_r=$6, corriente_nominal_s=$7, corriente_nominal_t=$8,
             temp_max_abs=$9, temp_rise_rated=$10, temp_amb_rated=$11,
             delta_t_alerta=$12, delta_t_alarma=$13, emisividad=$14, distancia_tipica=$15,
             notas_config=$16, orden=$17, updated_at=NOW()
             WHERE id=$18 RETURNING *`,
            [nombre, tipo_componente, criterio, num_fases,
             corriente_nominal || null, corriente_nominal_r || null,
             corriente_nominal_s || null, corriente_nominal_t || null,
             temp_max_abs || null, temp_rise_rated || null, temp_amb_rated || 40,
             delta_t_alerta || null, delta_t_alarma || null,
             emisividad || 0.95, distancia_tipica || null,
             notas_config || null, orden || 0, req.params.id]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Componente no encontrado' });
        res.json(r.rows[0]);
    } catch (err) { handleError(res, err, 'Error al actualizar componente'); }
});

app.delete('/api/termo/componentes/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM termo_componentes WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al eliminar componente'); }
});

// ── Lecturas ─────────────────────────────────────────────────────
app.get('/api/termo/lecturas/:asset_id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT tl.*, tc.nombre as comp_nombre, tc.tipo_componente, tc.criterio,
                    tc.num_fases, tc.corriente_nominal, tc.temp_max_abs,
                    tc.temp_rise_rated, tc.temp_amb_rated,
                    tc.delta_t_alerta, tc.delta_t_alarma
             FROM termo_lecturas tl
             JOIN termo_componentes tc ON tc.id = tl.componente_id
             WHERE tl.asset_id=$1
             ORDER BY tl.fecha_medicion ASC, tc.orden, tl.componente_id`,
            [req.params.asset_id]
        );
        res.json(r.rows.map(row => ({ ...row, fases: safeJSONparse(row.fases, []) })));
    } catch (err) { handleError(res, err, 'Error al obtener lecturas'); }
});

app.get('/api/termo/lecturas/componente/:comp_id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT * FROM termo_lecturas WHERE componente_id=$1 ORDER BY fecha_medicion ASC',
            [req.params.comp_id]
        );
        res.json(r.rows.map(row => ({ ...row, fases: safeJSONparse(row.fases, []) })));
    } catch (err) { handleError(res, err, 'Error al obtener lecturas del componente'); }
});

app.post('/api/termo/lecturas', requireAuth, async (req, res) => {
    const { componente_id, asset_id, fecha_medicion, temp_ambiente, fases,
            emisividad, distancia, num_img_ir, num_img_vis, notas } = req.body;
    if (!componente_id || !asset_id || !fecha_medicion || temp_ambiente == null)
        return res.status(400).json({ error: 'componente_id, asset_id, fecha_medicion y temp_ambiente son obligatorios' });
    try {
        const compR = await pool.query('SELECT * FROM termo_componentes WHERE id=$1', [componente_id]);
        const comp = compR.rows[0];
        const estado = comp ? calcularEstadoTermo(comp, parseFloat(temp_ambiente), fases || []) : null;
        const r = await pool.query(
            `INSERT INTO termo_lecturas
             (componente_id, asset_id, fecha_medicion, temp_ambiente, fases,
              emisividad, distancia, num_img_ir, num_img_vis, notas, estado)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [componente_id, asset_id, fecha_medicion, temp_ambiente,
             JSON.stringify(fases || []), emisividad || null, distancia || null,
             num_img_ir || null, num_img_vis || null, notas || null, estado]
        );
        await actualizarSemaforoTermo(asset_id);
        res.json({ ...r.rows[0], fases: fases || [] });
    } catch (err) { handleError(res, err, 'Error al guardar lectura'); }
});

app.put('/api/termo/lecturas/:id', requireAuth, async (req, res) => {
    const { fecha_medicion, temp_ambiente, fases, emisividad, distancia,
            num_img_ir, num_img_vis, notas } = req.body;
    try {
        const existing = await pool.query(
            `SELECT tl.asset_id, tc.criterio, tc.corriente_nominal,
                    tc.corriente_nominal_r, tc.corriente_nominal_s, tc.corriente_nominal_t,
                    tc.temp_max_abs, tc.temp_rise_rated, tc.temp_amb_rated,
                    tc.delta_t_alerta, tc.delta_t_alarma
             FROM termo_lecturas tl JOIN termo_componentes tc ON tc.id=tl.componente_id
             WHERE tl.id=$1`, [req.params.id]
        );
        if (!existing.rows.length) return res.status(404).json({ error: 'Lectura no encontrada' });
        const comp = existing.rows[0];
        const estado = calcularEstadoTermo(comp, parseFloat(temp_ambiente), fases || []);
        const r = await pool.query(
            `UPDATE termo_lecturas SET
             fecha_medicion=$1, temp_ambiente=$2, fases=$3, emisividad=$4, distancia=$5,
             num_img_ir=$6, num_img_vis=$7, notas=$8, estado=$9, updated_at=NOW()
             WHERE id=$10 RETURNING *`,
            [fecha_medicion, temp_ambiente, JSON.stringify(fases || []),
             emisividad || null, distancia || null,
             num_img_ir || null, num_img_vis || null, notas || null,
             estado, req.params.id]
        );
        await actualizarSemaforoTermo(comp.asset_id);
        res.json({ ...r.rows[0], fases: fases || [] });
    } catch (err) { handleError(res, err, 'Error al actualizar lectura'); }
});

app.delete('/api/termo/lecturas/:id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM termo_lecturas WHERE id=$1 RETURNING asset_id', [req.params.id]);
        if (r.rows.length) await actualizarSemaforoTermo(r.rows[0].asset_id);
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al eliminar lectura'); }
});

app.get('/api/termo/resumen/:asset_id', requireAuth, async (req, res) => {
    try {
        const comps = await pool.query(
            'SELECT * FROM termo_componentes WHERE asset_id=$1 ORDER BY orden, id',
            [req.params.asset_id]
        );
        const result = [];
        for (const comp of comps.rows) {
            const lecs = await pool.query(
                'SELECT * FROM termo_lecturas WHERE componente_id=$1 ORDER BY fecha_medicion ASC',
                [comp.id]
            );
            result.push({ ...comp, lecturas: lecs.rows.map(r => ({ ...r, fases: safeJSONparse(r.fases, []) })) });
        }
        res.json(result);
    } catch (err) { handleError(res, err, 'Error al obtener resumen termografía'); }
});

// ── Helpers termografía ────────────────────────────────────────────
function safeJSONparse(val, def) {
    if (def === undefined) def = {};
    if (typeof val === 'object' && val !== null) return val;
    try { return JSON.parse(val || JSON.stringify(def)); } catch { return def; }
}

function calcularEstadoTermo(comp, tempAmb, fases) {
    const criterio      = comp.criterio || 'delta_t';
    const corrNominal   = parseFloat(comp.corriente_nominal) || null;
    const tempRiseRated = parseFloat(comp.temp_rise_rated)   || null;
    const tempMaxAbs    = parseFloat(comp.temp_max_abs)      || null;
    const dtAlerta      = parseFloat(comp.delta_t_alerta)    || null;
    const dtAlarma      = parseFloat(comp.delta_t_alarma)    || null;
    if (!fases || !fases.length) return null;
    const ORDEN = { C: 3, A: 2, B: 1 };
    let peor = null;
    for (const fase of fases) {
        const temp  = parseFloat(fase.temperatura);
        const corrM = parseFloat(fase.corriente) || null;
        if (isNaN(temp)) continue;
        let estado = null;
        if (criterio === 'delta_t') {
            const dt = temp - tempAmb;
            if (dtAlarma != null && dt >= dtAlarma)      estado = 'C';
            else if (dtAlerta != null && dt >= dtAlerta) estado = 'A';
            else                                          estado = 'B';
        } else if (criterio === 'absoluta') {
            if (tempMaxAbs != null) {
                if (temp >= tempMaxAbs)                              estado = 'C';
                else if (temp >= tempMaxAbs - (tempRiseRated || 10)) estado = 'A';
                else                                                  estado = 'B';
            }
        } else if (criterio === 'absoluta_corr') {
            if (corrNominal && corrM && tempRiseRated != null) {
                const ratio    = corrM / corrNominal;
                const tmaxCorr = (ratio * ratio * tempRiseRated) + tempAmb;
                if (temp >= tmaxCorr)             estado = 'C';
                else if (temp >= tmaxCorr * 0.85) estado = 'A';
                else                              estado = 'B';
            } else if (tempMaxAbs != null) {
                if (temp >= tempMaxAbs)                              estado = 'C';
                else if (temp >= tempMaxAbs - (tempRiseRated || 10)) estado = 'A';
                else                                                  estado = 'B';
            }
        }
        if (estado && (ORDEN[estado] || 0) > (ORDEN[peor] || 0)) peor = estado;
    }
    return peor;
}

async function actualizarSemaforoTermo(assetId) {
    try {
        const r = await pool.query(
            `SELECT DISTINCT ON (tl.componente_id) tl.estado
             FROM termo_lecturas tl
             JOIN termo_componentes tc ON tc.id = tl.componente_id
             WHERE tc.asset_id = $1
             ORDER BY tl.componente_id, tl.fecha_medicion DESC`,
            [assetId]
        );
        const ORDEN = { C: 3, A: 2, B: 1 };
        let peor = null;
        r.rows.forEach(row => {
            if (row.estado && (ORDEN[row.estado] || 0) > (ORDEN[peor] || 0)) peor = row.estado;
        });
        await pool.query(
            'UPDATE equipos SET ultimo_estado_termografia=$1 WHERE asset_id=$2',
            [peor, assetId]
        );
    } catch (e) { console.warn('[WARN] actualizarSemaforoTermo:', e.message); }
}


// ════════════════════════════════════════════════════════════════
// API — ULTRASONIDO DE CONDICIÓN
// ════════════════════════════════════════════════════════════════

app.get('/api/ultra/componentes/:asset_id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM ultra_componentes WHERE asset_id=$1 ORDER BY orden, id', [req.params.asset_id]);
        res.json(r.rows);
    } catch (err) { handleError(res, err, 'Error al obtener componentes ultra'); }
});

app.post('/api/ultra/componentes', requireAuth, async (req, res) => {
    const { asset_id, nombre, tipo_defecto, nivel_base, nivel_alerta, nivel_alarma,
            frecuencia_sensor, tipo_sensor, notas_config, orden } = req.body;
    if (!asset_id || !nombre) return res.status(400).json({ error: 'asset_id y nombre son obligatorios' });
    try {
        const r = await pool.query(
            `INSERT INTO ultra_componentes
             (asset_id, nombre, tipo_defecto, nivel_base, nivel_alerta, nivel_alarma,
              frecuencia_sensor, tipo_sensor, notas_config, orden)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [asset_id, nombre, tipo_defecto || 'Rodamiento',
             nivel_base || null, nivel_alerta || null, nivel_alarma || null,
             frecuencia_sensor || '40 kHz', tipo_sensor || null,
             notas_config || null, orden || 0]
        );
        res.json(r.rows[0]);
    } catch (err) { handleError(res, err, 'Error al crear componente ultra'); }
});

app.put('/api/ultra/componentes/:id', requireAuth, async (req, res) => {
    const { nombre, tipo_defecto, nivel_base, nivel_alerta, nivel_alarma,
            frecuencia_sensor, tipo_sensor, notas_config, orden } = req.body;
    try {
        const r = await pool.query(
            `UPDATE ultra_componentes SET
             nombre=$1, tipo_defecto=$2, nivel_base=$3, nivel_alerta=$4, nivel_alarma=$5,
             frecuencia_sensor=$6, tipo_sensor=$7, notas_config=$8, orden=$9, updated_at=NOW()
             WHERE id=$10 RETURNING *`,
            [nombre, tipo_defecto || 'Rodamiento',
             nivel_base || null, nivel_alerta || null, nivel_alarma || null,
             frecuencia_sensor || '40 kHz', tipo_sensor || null,
             notas_config || null, orden || 0, req.params.id]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'Componente no encontrado' });
        res.json(r.rows[0]);
    } catch (err) { handleError(res, err, 'Error al actualizar componente ultra'); }
});

app.delete('/api/ultra/componentes/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM ultra_componentes WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al eliminar componente ultra'); }
});

app.get('/api/ultra/lecturas/:asset_id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT ul.*, uc.nombre as comp_nombre, uc.tipo_defecto,
                    uc.nivel_base as nivel_base_comp, uc.nivel_alerta, uc.nivel_alarma,
                    uc.frecuencia_sensor, uc.tipo_sensor
             FROM ultra_lecturas ul
             JOIN ultra_componentes uc ON uc.id = ul.componente_id
             WHERE ul.asset_id=$1
             ORDER BY ul.fecha_medicion ASC, uc.orden, ul.componente_id`,
            [req.params.asset_id]
        );
        res.json(r.rows);
    } catch (err) { handleError(res, err, 'Error al obtener lecturas ultra'); }
});

app.post('/api/ultra/lecturas', requireAuth, async (req, res) => {
    const { componente_id, asset_id, fecha_medicion, nivel_db, nivel_base_lec,
            rpm, carga_pct, temp_c, ruido_amb, caracteristicas, no_imagen, notas } = req.body;
    if (!componente_id || !asset_id || !fecha_medicion || nivel_db == null)
        return res.status(400).json({ error: 'componente_id, asset_id, fecha_medicion y nivel_db son obligatorios' });
    try {
        const compR = await pool.query('SELECT * FROM ultra_componentes WHERE id=$1', [componente_id]);
        const comp = compR.rows[0];
        const delta = (nivel_base_lec != null && !isNaN(parseFloat(nivel_base_lec)))
            ? +(parseFloat(nivel_db) - parseFloat(nivel_base_lec)).toFixed(1)
            : (comp?.nivel_base != null ? +(parseFloat(nivel_db) - parseFloat(comp.nivel_base)).toFixed(1) : null);
        const estado = calcularEstadoUltra(comp, parseFloat(nivel_db));

        const r = await pool.query(
            `INSERT INTO ultra_lecturas
             (componente_id, asset_id, fecha_medicion, nivel_db, nivel_base_lec, delta_db,
              rpm, carga_pct, temp_c, ruido_amb, caracteristicas, no_imagen, notas, estado)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [componente_id, asset_id, fecha_medicion, nivel_db,
             nivel_base_lec || null, delta,
             rpm || null, carga_pct || null, temp_c || null,
             ruido_amb || null, caracteristicas || null,
             no_imagen || null, notas || null, estado]
        );
        await actualizarSemaforoUltra(asset_id);
        res.json(r.rows[0]);
    } catch (err) { handleError(res, err, 'Error al guardar lectura ultra'); }
});

app.put('/api/ultra/lecturas/:id', requireAuth, async (req, res) => {
    const { fecha_medicion, nivel_db, nivel_base_lec, rpm, carga_pct,
            temp_c, ruido_amb, caracteristicas, no_imagen, notas } = req.body;
    try {
        const ex = await pool.query(
            `SELECT ul.asset_id, uc.nivel_base, uc.nivel_alerta, uc.nivel_alarma
             FROM ultra_lecturas ul JOIN ultra_componentes uc ON uc.id=ul.componente_id
             WHERE ul.id=$1`, [req.params.id]
        );
        if (!ex.rows.length) return res.status(404).json({ error: 'Lectura no encontrada' });
        const comp = ex.rows[0];
        const delta = (nivel_base_lec != null && !isNaN(parseFloat(nivel_base_lec)))
            ? +(parseFloat(nivel_db) - parseFloat(nivel_base_lec)).toFixed(1)
            : (comp.nivel_base != null ? +(parseFloat(nivel_db) - parseFloat(comp.nivel_base)).toFixed(1) : null);
        const estado = calcularEstadoUltra(comp, parseFloat(nivel_db));

        const r = await pool.query(
            `UPDATE ultra_lecturas SET
             fecha_medicion=$1, nivel_db=$2, nivel_base_lec=$3, delta_db=$4,
             rpm=$5, carga_pct=$6, temp_c=$7, ruido_amb=$8,
             caracteristicas=$9, no_imagen=$10, notas=$11, estado=$12, updated_at=NOW()
             WHERE id=$13 RETURNING *`,
            [fecha_medicion, nivel_db, nivel_base_lec || null, delta,
             rpm || null, carga_pct || null, temp_c || null,
             ruido_amb || null, caracteristicas || null,
             no_imagen || null, notas || null, estado, req.params.id]
        );
        await actualizarSemaforoUltra(comp.asset_id);
        res.json(r.rows[0]);
    } catch (err) { handleError(res, err, 'Error al actualizar lectura ultra'); }
});

app.delete('/api/ultra/lecturas/:id', requireAuth, async (req, res) => {
    try {
        const r = await pool.query('DELETE FROM ultra_lecturas WHERE id=$1 RETURNING asset_id', [req.params.id]);
        if (r.rows.length) await actualizarSemaforoUltra(r.rows[0].asset_id);
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al eliminar lectura ultra'); }
});

app.get('/api/ultra/resumen/:asset_id', requireAuth, async (req, res) => {
    try {
        const comps = await pool.query('SELECT * FROM ultra_componentes WHERE asset_id=$1 ORDER BY orden, id', [req.params.asset_id]);
        const result = [];
        for (const comp of comps.rows) {
            const lecs = await pool.query('SELECT * FROM ultra_lecturas WHERE componente_id=$1 ORDER BY fecha_medicion ASC', [comp.id]);
            result.push({ ...comp, lecturas: lecs.rows });
        }
        res.json(result);
    } catch (err) { handleError(res, err, 'Error al obtener resumen ultra'); }
});

function calcularEstadoUltra(comp, nivelDb) {
    if (!comp || isNaN(nivelDb)) return null;
    const alerta = parseFloat(comp.nivel_alerta);
    const alarma = parseFloat(comp.nivel_alarma);
    const base   = parseFloat(comp.nivel_base || comp.nivel_base_comp);
    // Si hay límites absolutos configurados
    if (!isNaN(alarma) && nivelDb >= alarma) return 'C';
    if (!isNaN(alerta) && nivelDb >= alerta) return 'A';
    if (!isNaN(alerta)) return 'B';
    // Sin límites: usar delta relativo a base (+8dB=Alerta, +16dB=Alarma - ISO 29821)
    if (!isNaN(base)) {
        const delta = nivelDb - base;
        if (delta >= 16) return 'C';
        if (delta >= 8)  return 'A';
        return 'B';
    }
    return null;
}

async function actualizarSemaforoUltra(assetId) {
    try {
        const r = await pool.query(
            `SELECT DISTINCT ON (ul.componente_id) ul.estado
             FROM ultra_lecturas ul
             JOIN ultra_componentes uc ON uc.id = ul.componente_id
             WHERE uc.asset_id = $1
             ORDER BY ul.componente_id, ul.fecha_medicion DESC`,
            [assetId]
        );
        const ORDEN = { C: 3, A: 2, B: 1 };
        let peor = null;
        r.rows.forEach(row => {
            if (row.estado && (ORDEN[row.estado] || 0) > (ORDEN[peor] || 0)) peor = row.estado;
        });
        await pool.query('UPDATE equipos SET ultimo_estado_ultrasonido=$1 WHERE asset_id=$2', [peor, assetId]);
    } catch (e) { console.warn('[WARN] actualizarSemaforoUltra:', e.message); }
}


// ════════════════════════════════════════════════════════════════
// API — MEJORAS PdM: TENDENCIA, GAP, VALIDACIÓN, SIMILARES
// ════════════════════════════════════════════════════════════════

// ── 1. Tendencia por punto (regresión lineal via PostgreSQL) ────
// Devuelve slope (unidades/día), proyección de cruce de límite,
// y clasificación: estable / creciente / creciente_rapido / descendente
app.get('/api/condicion/tendencia/:asset_id', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT fecha_medicion, valores_vel, valores_env, valores_temp FROM condicion_lecturas WHERE asset_id=$1 ORDER BY fecha_medicion ASC',
            [req.params.asset_id]
        );
        if (rows.length < 3) return res.json({ suficiente: false, min: 3, actual: rows.length });

        const cfgR = await pool.query('SELECT * FROM condicion_config WHERE asset_id=$1', [req.params.asset_id]);
        const cfg  = cfgR.rows[0] || {};
        const puntos = JSON.parse(cfg.puntos || '[]');
        const limVel = JSON.parse(cfg.limites_vel || '{}');

        const resultado = {};

        for (const punto of puntos) {
            // Extraer serie temporal para velocidad overall
            const serie = rows
                .map(r => {
                    const vals = JSON.parse(r.valores_vel || '{}');
                    const v = parseFloat(vals[punto]);
                    const t = new Date(r.fecha_medicion).getTime() / 86400000; // días epoch
                    return isNaN(v) ? null : { t, v };
                })
                .filter(Boolean);

            if (serie.length < 3) { resultado[punto] = { suficiente: false }; continue; }

            // Regresión lineal mínimos cuadrados
            const n   = serie.length;
            const sumT  = serie.reduce((a, p) => a + p.t, 0);
            const sumV  = serie.reduce((a, p) => a + p.v, 0);
            const sumTV = serie.reduce((a, p) => a + p.t * p.v, 0);
            const sumT2 = serie.reduce((a, p) => a + p.t * p.t, 0);
            const denom = n * sumT2 - sumT * sumT;
            if (Math.abs(denom) < 1e-10) { resultado[punto] = { suficiente: false }; continue; }

            const slope     = (n * sumTV - sumT * sumV) / denom; // unidades/día
            const intercept = (sumV - slope * sumT) / n;
            const slopeMes  = +(slope * 30).toFixed(4); // unidades/mes

            // R² (calidad del ajuste)
            const meanV = sumV / n;
            const ssTot = serie.reduce((a, p) => a + Math.pow(p.v - meanV, 2), 0);
            const ssRes = serie.reduce((a, p) => a + Math.pow(p.v - (slope * p.t + intercept), 2), 0);
            const r2    = ssTot > 0 ? +(1 - ssRes / ssTot).toFixed(3) : 0;

            // Proyección de cruce de ULC
            let diasAlArco = null;
            const ulc = limVel[punto]?.ulc;
            if (ulc && slope > 0.0001) {
                const tHoy   = Date.now() / 86400000;
                const vHoy   = slope * tHoy + intercept;
                diasAlArco   = Math.round((parseFloat(ulc) - vHoy) / slope);
                if (diasAlArco < 0) diasAlArco = 0;
            }

            // Clasificación de tendencia
            const umbralCrecRapido = 0.03; // >0.03 mm/s por día = creciente rápido
            const umbralCrec       = 0.005;
            let clasificacion = 'estable';
            if (slope >  umbralCrecRapido) clasificacion = 'creciente_rapido';
            else if (slope >  umbralCrec)  clasificacion = 'creciente';
            else if (slope < -umbralCrec)  clasificacion = 'descendente';

            resultado[punto] = {
                suficiente:    true,
                slope_dia:     +slope.toFixed(5),
                slope_mes:     slopeMes,
                r2,
                clasificacion,
                dias_al_ulc:   diasAlArco,
                n_lecturas:    serie.length,
                ultimo_valor:  +serie[serie.length - 1].v.toFixed(3),
                primer_valor:  +serie[0].v.toFixed(3),
            };
        }

        res.json({ suficiente: true, puntos: resultado });
    } catch (err) { handleError(res, err, 'Error al calcular tendencia'); }
});

// Tendencia para termografía (por componente y fase)
app.get('/api/termo/tendencia/:asset_id', requireAuth, async (req, res) => {
    try {
        const compsR = await pool.query('SELECT * FROM termo_componentes WHERE asset_id=$1', [req.params.asset_id]);
        const result = {};
        for (const comp of compsR.rows) {
            const lecsR = await pool.query(
                'SELECT fecha_medicion, fases, temp_ambiente FROM termo_lecturas WHERE componente_id=$1 ORDER BY fecha_medicion ASC',
                [comp.id]
            );
            if (lecsR.rows.length < 3) { result[comp.id] = { suficiente: false }; continue; }
            // Slope por fase (temperatura máxima de la fase)
            const serie = lecsR.rows.map(r => {
                const fases = JSON.parse(r.fases || '[]');
                const tMax  = fases.reduce((mx, f) => Math.max(mx, parseFloat(f.temperatura) || 0), 0);
                return { t: new Date(r.fecha_medicion).getTime() / 86400000, v: tMax };
            }).filter(p => p.v > 0);
            if (serie.length < 3) { result[comp.id] = { suficiente: false }; continue; }
            const n = serie.length;
            const sumT = serie.reduce((a, p) => a + p.t, 0);
            const sumV = serie.reduce((a, p) => a + p.v, 0);
            const sumTV = serie.reduce((a, p) => a + p.t * p.v, 0);
            const sumT2 = serie.reduce((a, p) => a + p.t * p.t, 0);
            const denom = n * sumT2 - sumT * sumT;
            if (Math.abs(denom) < 1e-10) { result[comp.id] = { suficiente: false }; continue; }
            const slope = (n * sumTV - sumT * sumV) / denom;
            const slopeMes = +(slope * 30).toFixed(3);
            let clasificacion = 'estable';
            if (slope > 0.05) clasificacion = 'creciente_rapido';
            else if (slope > 0.01) clasificacion = 'creciente';
            else if (slope < -0.01) clasificacion = 'descendente';
            result[comp.id] = { suficiente: true, slope_mes: slopeMes, clasificacion, n_lecturas: n,
                               comp_nombre: comp.nombre, ultimo_valor: +serie[n-1].v.toFixed(1) };
        }
        res.json(result);
    } catch (err) { handleError(res, err, 'Error al calcular tendencia termo'); }
});

// Tendencia para ultrasonido (por componente)
app.get('/api/ultra/tendencia/:asset_id', requireAuth, async (req, res) => {
    try {
        const compsR = await pool.query('SELECT * FROM ultra_componentes WHERE asset_id=$1', [req.params.asset_id]);
        const result = {};
        for (const comp of compsR.rows) {
            const lecsR = await pool.query(
                'SELECT fecha_medicion, nivel_db FROM ultra_lecturas WHERE componente_id=$1 ORDER BY fecha_medicion ASC',
                [comp.id]
            );
            if (lecsR.rows.length < 3) { result[comp.id] = { suficiente: false }; continue; }
            const serie = lecsR.rows.map(r => ({
                t: new Date(r.fecha_medicion).getTime() / 86400000,
                v: parseFloat(r.nivel_db)
            })).filter(p => !isNaN(p.v));
            if (serie.length < 3) { result[comp.id] = { suficiente: false }; continue; }
            const n = serie.length;
            const sumT = serie.reduce((a,p)=>a+p.t, 0), sumV = serie.reduce((a,p)=>a+p.v, 0);
            const sumTV = serie.reduce((a,p)=>a+p.t*p.v, 0), sumT2 = serie.reduce((a,p)=>a+p.t*p.t, 0);
            const denom = n*sumT2 - sumT*sumT;
            if (Math.abs(denom) < 1e-10) { result[comp.id] = { suficiente: false }; continue; }
            const slope = (n*sumTV - sumT*sumV) / denom;
            const slopeMes = +(slope*30).toFixed(3);
            let clasificacion = 'estable';
            if (slope > 0.1) clasificacion = 'creciente_rapido';
            else if (slope > 0.02) clasificacion = 'creciente';
            else if (slope < -0.02) clasificacion = 'descendente';
            result[comp.id] = { suficiente: true, slope_mes: slopeMes, clasificacion, n_lecturas: n,
                               comp_nombre: comp.nombre, ultimo_valor: +serie[n-1].v.toFixed(1) };
        }
        res.json(result);
    } catch (err) { handleError(res, err, 'Error al calcular tendencia ultra'); }
});

// ── 2. Gap de inspección (días sin datos vs frecuencia configurada) ──
app.get('/api/condicion/gap/:asset_id', requireAuth, async (req, res) => {
    try {
        const [lecVib, lecTermo, lecUltra, cfgR, eq] = await Promise.all([
            pool.query('SELECT MAX(fecha_medicion) as ultima FROM condicion_lecturas WHERE asset_id=$1', [req.params.asset_id]),
            pool.query('SELECT MAX(ul.fecha_medicion) as ultima FROM termo_lecturas ul JOIN termo_componentes uc ON uc.id=ul.componente_id WHERE uc.asset_id=$1', [req.params.asset_id]),
            pool.query('SELECT MAX(ul.fecha_medicion) as ultima FROM ultra_lecturas ul JOIN ultra_componentes uc ON uc.id=ul.componente_id WHERE uc.asset_id=$1', [req.params.asset_id]),
            pool.query('SELECT frecuencia FROM condicion_config WHERE asset_id=$1', [req.params.asset_id]),
            pool.query('SELECT aplica_vibraciones, aplica_termografia, aplica_ultrasonido FROM equipos WHERE asset_id=$1', [req.params.asset_id]),
        ]);

        const FRECUENCIAS = { 'Semanal': 7, 'Quincenal': 15, 'Mensual': 30, 'Bi-mensual': 60, 'Trimestral': 90 };
        const frecDias = FRECUENCIAS[cfgR.rows[0]?.frecuencia] || 30;
        const hoy = new Date();

        const calcGap = (ultima) => {
            if (!ultima) return null;
            const d = Math.floor((hoy - new Date(ultima)) / 86400000);
            let nivel = 'ok';
            if (d > frecDias * 2) nivel = 'critico';
            else if (d > frecDias) nivel = 'atrasado';
            return { dias: d, frecuencia_dias: frecDias, nivel, ultima: String(ultima).split('T')[0] };
        };

        const equipo = eq.rows[0] || {};
        res.json({
            vibraciones: equipo.aplica_vibraciones  ? calcGap(lecVib.rows[0]?.ultima)   : null,
            termografia: equipo.aplica_termografia   ? calcGap(lecTermo.rows[0]?.ultima) : null,
            ultrasonido: equipo.aplica_ultrasonido   ? calcGap(lecUltra.rows[0]?.ultima) : null,
            frecuencia:  cfgR.rows[0]?.frecuencia || 'Mensual',
        });
    } catch (err) { handleError(res, err, 'Error al calcular gap'); }
});

// Gap en árbol: para todos los equipos de una técnica (render en sidebar)
app.get('/api/condicion/gaps-flota', requireAuth, async (req, res) => {
    try {
        const equipos = await pool.query('SELECT asset_id, aplica_vibraciones, aplica_termografia, aplica_ultrasonido FROM equipos');
        const FREC = { 'Semanal': 7, 'Quincenal': 15, 'Mensual': 30, 'Bi-mensual': 60, 'Trimestral': 90 };
        const hoy = new Date();
        const result = {};
        for (const eq of equipos.rows) {
            const cfg = await pool.query('SELECT frecuencia FROM condicion_config WHERE asset_id=$1', [eq.asset_id]);
            const fd  = FREC[cfg.rows[0]?.frecuencia] || 30;
            const lv  = await pool.query('SELECT MAX(fecha_medicion) as u FROM condicion_lecturas WHERE asset_id=$1', [eq.asset_id]);
            const ultima = lv.rows[0]?.u;
            const dias = ultima ? Math.floor((hoy - new Date(ultima)) / 86400000) : 9999;
            result[eq.asset_id] = { dias, nivel: dias > fd*2 ? 'critico' : dias > fd ? 'atrasado' : 'ok' };
        }
        res.json(result);
    } catch (err) { handleError(res, err, 'Error al calcular gaps flota'); }
});

// ── 3. Validación estadística de entrada ──────────────────────
// El frontend llama esto ANTES de guardar para detectar valores anómalos
app.post('/api/condicion/validar-lectura', requireAuth, async (req, res) => {
    try {
        const { asset_id, valores_vel, valores_env, valores_temp } = req.body;
        // Obtener historial para calcular media y stddev por punto
        const { rows } = await pool.query(
            'SELECT valores_vel, valores_env, valores_temp FROM condicion_lecturas WHERE asset_id=$1 ORDER BY fecha_medicion DESC LIMIT 50',
            [asset_id]
        );
        if (rows.length < 5) return res.json({ advertencias: [] }); // Sin suficiente historial

        const advertencias = [];
        const SIGMA = 3; // alertar si > 3 desviaciones estándar

        const validarCampo = (campo, valoresNuevos, label) => {
            if (!valoresNuevos) return;
            Object.entries(valoresNuevos).forEach(([punto, vNuevo]) => {
                const vN = parseFloat(vNuevo);
                if (isNaN(vN)) return;
                const hist = rows
                    .map(r => parseFloat(JSON.parse(r[campo] || '{}')[punto]))
                    .filter(v => !isNaN(v));
                if (hist.length < 5) return;
                const mean = hist.reduce((a, v) => a + v, 0) / hist.length;
                const std  = Math.sqrt(hist.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / hist.length);
                if (std < 0.001) return; // equipos con valores muy constantes
                const zScore = Math.abs((vN - mean) / std);
                if (zScore > SIGMA) {
                    advertencias.push({
                        punto,
                        campo: label,
                        valor_nuevo: vN,
                        media_historica: +mean.toFixed(3),
                        std: +std.toFixed(3),
                        z_score: +zScore.toFixed(1),
                        mensaje: `${label} ${punto}: valor ${vN} es ${zScore.toFixed(1)}σ del promedio histórico (${mean.toFixed(2)} ± ${std.toFixed(2)})`
                    });
                }
            });
        };

        validarCampo('valores_vel',  valores_vel,  'Velocidad');
        validarCampo('valores_env',  valores_env,  'Envolvente');
        validarCampo('valores_temp', valores_temp, 'Factor Cresta');

        res.json({ advertencias });
    } catch (err) { handleError(res, err, 'Error al validar lectura'); }
});

// Validación para termografía
app.post('/api/termo/validar-lectura', requireAuth, async (req, res) => {
    try {
        const { componente_id, fases } = req.body;
        const { rows } = await pool.query(
            'SELECT fases FROM termo_lecturas WHERE componente_id=$1 ORDER BY fecha_medicion DESC LIMIT 30',
            [componente_id]
        );
        if (rows.length < 5) return res.json({ advertencias: [] });
        const advertencias = [];
        const SIGMA = 3;
        (fases || []).forEach((f, i) => {
            const vN = parseFloat(f.temperatura);
            if (isNaN(vN)) return;
            const hist = rows.map(r => parseFloat(JSON.parse(r.fases || '[]')[i]?.temperatura)).filter(v => !isNaN(v));
            if (hist.length < 5) return;
            const mean = hist.reduce((a, v) => a + v, 0) / hist.length;
            const std  = Math.sqrt(hist.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / hist.length);
            if (std < 0.1) return;
            const z = Math.abs((vN - mean) / std);
            if (z > SIGMA) advertencias.push({
                fase: i, valor_nuevo: vN,
                media_historica: +mean.toFixed(1), std: +std.toFixed(1),
                mensaje: `Fase ${['R','S','T'][i] || i+1}: ${vN}°C es ${z.toFixed(1)}σ del promedio histórico (${mean.toFixed(1)} ± ${std.toFixed(1)}°C)`
            });
        });
        res.json({ advertencias });
    } catch (err) { handleError(res, err, 'Error al validar lectura termo'); }
});

// Validación para ultrasonido
app.post('/api/ultra/validar-lectura', requireAuth, async (req, res) => {
    try {
        const { componente_id, nivel_db } = req.body;
        const { rows } = await pool.query(
            'SELECT nivel_db FROM ultra_lecturas WHERE componente_id=$1 ORDER BY fecha_medicion DESC LIMIT 30',
            [componente_id]
        );
        if (rows.length < 5) return res.json({ advertencias: [] });
        const vN = parseFloat(nivel_db);
        if (isNaN(vN)) return res.json({ advertencias: [] });
        const hist = rows.map(r => parseFloat(r.nivel_db)).filter(v => !isNaN(v));
        const mean = hist.reduce((a, v) => a + v, 0) / hist.length;
        const std  = Math.sqrt(hist.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / hist.length);
        const z    = std > 0.1 ? Math.abs((vN - mean) / std) : 0;
        const adv  = z > 3 ? [{
            valor_nuevo: vN, media_historica: +mean.toFixed(1), std: +std.toFixed(1),
            mensaje: `Nivel ${vN} dBµV es ${z.toFixed(1)}σ del promedio histórico (${mean.toFixed(1)} ± ${std.toFixed(1)} dBµV)`
        }] : [];
        res.json({ advertencias: adv });
    } catch (err) { handleError(res, err, 'Error al validar lectura ultra'); }
});

// ── 4. Comparación entre equipos similares ──────────────────
app.get('/api/condicion/similares/:asset_id', requireAuth, async (req, res) => {
    try {
        const eqR = await pool.query('SELECT tipo_sistema, potencia_hp FROM equipos WHERE asset_id=$1', [req.params.asset_id]);
        const eq  = eqR.rows[0];
        if (!eq) return res.json([]);

        // Buscar equipos del mismo tipo y rango de potencia (±30%)
        const pot = parseFloat(eq.potencia_hp) || 0;
        const simR = await pool.query(
            `SELECT e.asset_id, e.descripcion, e.ubicacion, e.potencia_hp, e.ultimo_estado_vibraciones,
                    cl.valores_vel, cl.fecha_medicion
             FROM equipos e
             LEFT JOIN LATERAL (
                 SELECT valores_vel, fecha_medicion FROM condicion_lecturas
                 WHERE asset_id=e.asset_id ORDER BY fecha_medicion DESC LIMIT 1
             ) cl ON true
             WHERE e.tipo_sistema=$1
               AND e.aplica_vibraciones=true
               AND e.asset_id != $2
               ${pot > 0 ? 'AND e.potencia_hp BETWEEN $3 AND $4' : ''}
             ORDER BY e.asset_id
             LIMIT 10`,
            pot > 0
                ? [eq.tipo_sistema, req.params.asset_id, pot * 0.7, pot * 1.3]
                : [eq.tipo_sistema, req.params.asset_id]
        );

        // Para el equipo actual también tomar la última lectura
        const myLec = await pool.query(
            'SELECT valores_vel, fecha_medicion FROM condicion_lecturas WHERE asset_id=$1 ORDER BY fecha_medicion DESC LIMIT 1',
            [req.params.asset_id]
        );

        const equipoActual = { ...eqR.rows[0], asset_id: req.params.asset_id,
            valores_vel: myLec.rows[0]?.valores_vel, fecha_medicion: myLec.rows[0]?.fecha_medicion, es_actual: true };

        const todos = [equipoActual, ...simR.rows];

        // Calcular para cada equipo: promedio de todos sus puntos de velocidad
        const result = todos.map(e => {
            const vals = e.valores_vel ? JSON.parse(e.valores_vel) : {};
            const nums = Object.values(vals).map(v => parseFloat(v)).filter(v => !isNaN(v));
            const prom = nums.length ? +(nums.reduce((a,v) => a+v, 0) / nums.length).toFixed(3) : null;
            return {
                asset_id:       e.asset_id,
                descripcion:    e.descripcion,
                ubicacion:      e.ubicacion,
                potencia_hp:    e.potencia_hp,
                estado:         e.ultimo_estado_vibraciones,
                prom_vel:       prom,
                ultima_lectura: e.fecha_medicion ? String(e.fecha_medicion).split('T')[0] : null,
                valores:        vals,
                es_actual:      !!e.es_actual,
            };
        });

        res.json(result);
    } catch (err) { handleError(res, err, 'Error al obtener similares'); }
});


// ════════════════════════════════════════════════════════════════
// MÓDULO: ÓRDENES DE TRABAJO (solo si MODULO_OT=true)
// ════════════════════════════════════════════════════════════════
if (FEATURES.ot) {

    // Helper: generar código OT
    async function nextOTCode() {
        const r = await pool.query("SELECT MAX(CAST(SUBSTRING(codigo FROM 4) AS INTEGER)) as n FROM ordenes_trabajo WHERE codigo LIKE 'OT-%'");
        const n = (r.rows[0]?.n || 0) + 1;
        return `OT-${String(n).padStart(5, '0')}`;
    }

    app.get('/api/ot', requireAuth, async (req, res) => {
        try {
            const { asset_id, estado, prioridad } = req.query;
            let q = `SELECT ot.*, e.descripcion as equipo_desc, e.ubicacion
                     FROM ordenes_trabajo ot
                     LEFT JOIN equipos e ON e.asset_id = ot.asset_id
                     WHERE 1=1`;
            const params = [];
            if (asset_id) { params.push(asset_id); q += ` AND ot.asset_id=$${params.length}`; }
            if (estado)   { params.push(estado);   q += ` AND ot.estado=$${params.length}`; }
            if (prioridad){ params.push(prioridad); q += ` AND ot.prioridad=$${params.length}`; }
            q += ' ORDER BY ot.fecha_apertura DESC, ot.id DESC';
            const r = await pool.query(q, params);
            res.json(r.rows);
        } catch (err) { handleError(res, err, 'Error al obtener OTs'); }
    });

    app.get('/api/ot/kpis', requireAuth, async (req, res) => {
        try {
            const r = await pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE estado != 'Cerrada') as abiertas,
                    COUNT(*) FILTER (WHERE estado = 'Pendiente') as pendientes,
                    COUNT(*) FILTER (WHERE estado = 'En Progreso') as en_progreso,
                    COUNT(*) FILTER (WHERE estado = 'Cerrada' AND fecha_cierre >= CURRENT_DATE - 30) as cerradas_mes,
                    COUNT(*) FILTER (WHERE prioridad = 'Urgente' AND estado != 'Cerrada') as urgentes,
                    COUNT(*) FILTER (WHERE fecha_limite < CURRENT_DATE AND estado != 'Cerrada') as vencidas,
                    ROUND(AVG(CASE WHEN estado='Cerrada' AND fecha_cierre IS NOT NULL
                        THEN fecha_cierre - fecha_apertura END)) as mttr_dias
                FROM ordenes_trabajo`);
            res.json(r.rows[0]);
        } catch (err) { handleError(res, err, 'Error al obtener KPIs OT'); }
    });

    app.get('/api/ot/:id', requireAuth, async (req, res) => {
        try {
            const r = await pool.query(
                `SELECT ot.*, e.descripcion as equipo_desc, e.ubicacion, e.tipo_sistema
                 FROM ordenes_trabajo ot LEFT JOIN equipos e ON e.asset_id=ot.asset_id
                 WHERE ot.id=$1`, [req.params.id]);
            if (!r.rows.length) return res.status(404).json({ error: 'OT no encontrada' });
            res.json(r.rows[0]);
        } catch (err) { handleError(res, err, 'Error al obtener OT'); }
    });

    app.post('/api/ot', requireAuth, roleAtLeast('tecnico'), async (req, res) => {
        const { asset_id, titulo, descripcion, tipo, prioridad, tecnico_asignado,
                tecnica_origen, lectura_origen, fecha_limite, costo_estimado } = req.body;
        if (!titulo) return res.status(400).json({ error: 'titulo es obligatorio' });
        try {
            const codigo = await nextOTCode();
            const r = await pool.query(
                `INSERT INTO ordenes_trabajo
                 (codigo, asset_id, titulo, descripcion, tipo, prioridad, tecnico_asignado,
                  tecnica_origen, lectura_origen, fecha_limite, costo_estimado, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
                [codigo, asset_id || null, titulo, descripcion || null,
                 tipo || 'Correctivo', prioridad || 'Normal',
                 tecnico_asignado || null, tecnica_origen || null, lectura_origen || null,
                 fecha_limite || null, costo_estimado || null, req.user.id]
            );
            // Notificación si el módulo está activo
            if (FEATURES.notificaciones && asset_id) {
                await pool.query(
                    `INSERT INTO notificaciones (asset_id, titulo, mensaje, tipo)
                     VALUES ($1,$2,$3,'ot')`,
                    [asset_id, `Nueva OT: ${titulo}`, `${codigo} — Prioridad: ${prioridad || 'Normal'}`]
                ).catch(() => {});
            }
            pool.query('INSERT INTO audit_log (usuario_id,accion,detalle) VALUES ($1,$2,$3)',
                [req.user.id, 'ot_crear', `${codigo} — ${asset_id || 'sin equipo'}`]).catch(() => {});
            res.json(r.rows[0]);
        } catch (err) { handleError(res, err, 'Error al crear OT'); }
    });

    app.put('/api/ot/:id', requireAuth, roleAtLeast('tecnico'), async (req, res) => {
        const { titulo, descripcion, tipo, prioridad, estado, tecnico_asignado,
                fecha_limite, fecha_cierre, resultado, costo_estimado, costo_real } = req.body;
        try {
            const old = await pool.query('SELECT * FROM ordenes_trabajo WHERE id=$1', [req.params.id]);
            if (!old.rows.length) return res.status(404).json({ error: 'OT no encontrada' });
            const r = await pool.query(
                `UPDATE ordenes_trabajo SET
                 titulo=$1, descripcion=$2, tipo=$3, prioridad=$4, estado=$5,
                 tecnico_asignado=$6, fecha_limite=$7, fecha_cierre=$8,
                 resultado=$9, costo_estimado=$10, costo_real=$11, updated_at=NOW()
                 WHERE id=$12 RETURNING *`,
                [titulo, descripcion||null, tipo||'Correctivo', prioridad||'Normal',
                 estado||'Pendiente', tecnico_asignado||null, fecha_limite||null,
                 fecha_cierre||null, resultado||null, costo_estimado||null,
                 costo_real||null, req.params.id]
            );
            // Notificar cierre
            if (FEATURES.notificaciones && estado === 'Cerrada' && old.rows[0].estado !== 'Cerrada') {
                await pool.query(
                    `INSERT INTO notificaciones (asset_id, titulo, mensaje, tipo)
                     VALUES ($1,$2,$3,'ot_cerrada')`,
                    [old.rows[0].asset_id, `OT Cerrada: ${old.rows[0].codigo}`, resultado || '']
                ).catch(() => {});
            }
            pool.query('INSERT INTO audit_log (usuario_id,accion,detalle) VALUES ($1,$2,$3)',
                [req.user.id, 'ot_editar', `ID ${req.params.id} → ${estado}`]).catch(() => {});
            res.json(r.rows[0]);
        } catch (err) { handleError(res, err, 'Error al actualizar OT'); }
    });

    app.delete('/api/ot/:id', requireAuth, roleAtLeast('admin'), async (req, res) => {
        try {
            await pool.query('DELETE FROM ordenes_trabajo WHERE id=$1', [req.params.id]);
            res.json({ success: true });
        } catch (err) { handleError(res, err, 'Error al eliminar OT'); }
    });

} // end FEATURES.ot

// ════════════════════════════════════════════════════════════════
// MÓDULO: LUBRICACIÓN Y PM PREVENTIVO
// ════════════════════════════════════════════════════════════════
if (FEATURES.lubricacion) {

    app.get('/api/lubricacion/config/:asset_id', requireAuth, async (req, res) => {
        try {
            const r = await pool.query(
                'SELECT * FROM lubricacion_config WHERE asset_id=$1 AND activo=true ORDER BY punto',
                [req.params.asset_id]);
            res.json(r.rows);
        } catch (err) { handleError(res, err, 'Error al obtener config lubricación'); }
    });

    app.post('/api/lubricacion/config', requireAuth, roleAtLeast('tecnico'), async (req, res) => {
        const { asset_id, punto, tipo_lubricante, cantidad_cc, intervalo_dias,
                intervalo_horas, metodo, ultimo_servicio, notas } = req.body;
        if (!asset_id || !punto) return res.status(400).json({ error: 'asset_id y punto requeridos' });
        try {
            const r = await pool.query(
                `INSERT INTO lubricacion_config
                 (asset_id, punto, tipo_lubricante, cantidad_cc, intervalo_dias,
                  intervalo_horas, metodo, ultimo_servicio, notas)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                [asset_id, punto, tipo_lubricante||null, cantidad_cc||null,
                 intervalo_dias||30, intervalo_horas||null, metodo||'Manual',
                 ultimo_servicio||null, notas||null]
            );
            res.json(r.rows[0]);
        } catch (err) { handleError(res, err, 'Error al crear config lubricación'); }
    });

    app.put('/api/lubricacion/config/:id', requireAuth, roleAtLeast('tecnico'), async (req, res) => {
        const { punto, tipo_lubricante, cantidad_cc, intervalo_dias,
                intervalo_horas, metodo, ultimo_servicio, notas, activo } = req.body;
        try {
            const r = await pool.query(
                `UPDATE lubricacion_config SET
                 punto=$1, tipo_lubricante=$2, cantidad_cc=$3, intervalo_dias=$4,
                 intervalo_horas=$5, metodo=$6, ultimo_servicio=$7, notas=$8,
                 activo=$9, updated_at=NOW() WHERE id=$10 RETURNING *`,
                [punto, tipo_lubricante||null, cantidad_cc||null, intervalo_dias||30,
                 intervalo_horas||null, metodo||'Manual', ultimo_servicio||null,
                 notas||null, activo !== false, req.params.id]
            );
            if (!r.rows.length) return res.status(404).json({ error: 'Punto no encontrado' });
            res.json(r.rows[0]);
        } catch (err) { handleError(res, err, 'Error al actualizar config'); }
    });

    app.delete('/api/lubricacion/config/:id', requireAuth, roleAtLeast('tecnico'), async (req, res) => {
        try {
            await pool.query('DELETE FROM lubricacion_config WHERE id=$1', [req.params.id]);
            res.json({ success: true });
        } catch (err) { handleError(res, err, 'Error al eliminar punto'); }
    });

    app.get('/api/lubricacion/registros/:asset_id', requireAuth, async (req, res) => {
        try {
            const r = await pool.query(
                `SELECT lr.*, lc.punto, lc.tipo_lubricante as lubricante_config,
                        lc.intervalo_dias, lc.metodo
                 FROM lubricacion_registros lr
                 JOIN lubricacion_config lc ON lc.id = lr.config_id
                 WHERE lr.asset_id=$1
                 ORDER BY lr.fecha_servicio DESC`,
                [req.params.asset_id]);
            res.json(r.rows);
        } catch (err) { handleError(res, err, 'Error al obtener registros'); }
    });

    app.post('/api/lubricacion/registros', requireAuth, roleAtLeast('tecnico'), async (req, res) => {
        const { config_id, asset_id, fecha_servicio, lubricante_usado, cantidad_real,
                tecnico, temperatura_c, nivel_ruido_antes, nivel_ruido_despues, observaciones } = req.body;
        if (!config_id || !asset_id) return res.status(400).json({ error: 'config_id y asset_id requeridos' });
        try {
            const r = await pool.query(
                `INSERT INTO lubricacion_registros
                 (config_id, asset_id, fecha_servicio, lubricante_usado, cantidad_real,
                  tecnico, temperatura_c, nivel_ruido_antes, nivel_ruido_despues, observaciones)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
                [config_id, asset_id, fecha_servicio || new Date().toISOString().split('T')[0],
                 lubricante_usado||null, cantidad_real||null, tecnico||null,
                 temperatura_c||null, nivel_ruido_antes||null, nivel_ruido_despues||null,
                 observaciones||null]
            );
            // Actualizar ultimo_servicio en config
            await pool.query(
                'UPDATE lubricacion_config SET ultimo_servicio=$1, updated_at=NOW() WHERE id=$2',
                [fecha_servicio || new Date().toISOString().split('T')[0], config_id]
            );
            res.json(r.rows[0]);
        } catch (err) { handleError(res, err, 'Error al registrar servicio'); }
    });

    // Resumen vencimientos: todos los puntos con su estado de vencimiento
    app.get('/api/lubricacion/vencimientos', requireAuth, async (req, res) => {
        try {
            const r = await pool.query(`
                SELECT lc.*, e.descripcion as equipo_desc, e.ubicacion,
                    CURRENT_DATE - lc.ultimo_servicio::DATE as dias_desde_servicio,
                    (lc.ultimo_servicio::DATE + lc.intervalo_dias) as proximo_servicio,
                    CASE
                        WHEN lc.ultimo_servicio IS NULL THEN 'sin_datos'
                        WHEN (CURRENT_DATE - lc.ultimo_servicio::DATE) > lc.intervalo_dias * 1.3 THEN 'critico'
                        WHEN (CURRENT_DATE - lc.ultimo_servicio::DATE) > lc.intervalo_dias THEN 'vencido'
                        WHEN (CURRENT_DATE - lc.ultimo_servicio::DATE) > lc.intervalo_dias * 0.85 THEN 'proximo'
                        ELSE 'ok'
                    END as estado_vencimiento
                FROM lubricacion_config lc
                JOIN equipos e ON e.asset_id = lc.asset_id
                WHERE lc.activo = true
                ORDER BY
                    CASE WHEN lc.ultimo_servicio IS NULL THEN 0
                         ELSE (CURRENT_DATE - lc.ultimo_servicio::DATE) - lc.intervalo_dias
                    END DESC`);
            res.json(r.rows);
        } catch (err) { handleError(res, err, 'Error al obtener vencimientos'); }
    });

} // end FEATURES.lubricacion

// ════════════════════════════════════════════════════════════════
// MÓDULO: NOTIFICACIONES (SSE)
// ════════════════════════════════════════════════════════════════
if (FEATURES.notificaciones) {
    const sseClients = new Map(); // userId → res

    app.get('/api/notificaciones/stream', requireAuth, (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        const uid = req.user.id;
        sseClients.set(uid, res);
        // Ping cada 25s para mantener la conexión
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { clearInterval(ping); sseClients.delete(uid); });
    });

    app.get('/api/notificaciones', requireAuth, async (req, res) => {
        try {
            const r = await pool.query(
                `SELECT * FROM notificaciones
                 WHERE (usuario_id IS NULL OR usuario_id=$1)
                 ORDER BY created_at DESC LIMIT 50`,
                [req.user.id]);
            res.json(r.rows);
        } catch (err) { handleError(res, err, 'Error al obtener notificaciones'); }
    });

    app.patch('/api/notificaciones/:id/leer', requireAuth, async (req, res) => {
        try {
            await pool.query('UPDATE notificaciones SET leida=true WHERE id=$1', [req.params.id]);
            res.json({ success: true });
        } catch (err) { handleError(res, err, 'Error al marcar notificación'); }
    });

    app.patch('/api/notificaciones/leer-todas', requireAuth, async (req, res) => {
        try {
            await pool.query('UPDATE notificaciones SET leida=true WHERE leida=false');
            res.json({ success: true });
        } catch (err) { handleError(res, err, 'Error al marcar todas'); }
    });

    // Función global para emitir notificaciones a todos los clientes SSE
    global.emitirNotificacion = async (assetId, titulo, mensaje, tipo = 'alerta') => {
        if (!FEATURES.notificaciones) return;
        try {
            await pool.query(
                `INSERT INTO notificaciones (asset_id, titulo, mensaje, tipo) VALUES ($1,$2,$3,$4)`,
                [assetId || null, titulo, mensaje || '', tipo]
            );
            const payload = JSON.stringify({ asset_id: assetId, titulo, mensaje, tipo, ts: new Date().toISOString() });
            sseClients.forEach(clientRes => {
                clientRes.write(`data: ${payload}\n\n`);
            });
        } catch {}
    };

} // end FEATURES.notificaciones

// ════════════════════════════════════════════════════════════════
// MÓDULO: KPI HISTÓRICO MENSUAL
// ════════════════════════════════════════════════════════════════
if (FEATURES.kpi_historico) {

    // Generar snapshot del mes actual
    app.post('/api/kpi-historico/snapshot', requireAuth, roleAtLeast('admin'), async (req, res) => {
        try {
            const periodo = new Date().toISOString().slice(0, 7); // YYYY-MM
            const eq = await pool.query(`
                SELECT
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE ultimo_estado_vibraciones='C' OR ultimo_estado_termografia='C' OR ultimo_estado_ultrasonido='C') as en_alarma,
                    COUNT(*) FILTER (WHERE (ultimo_estado_vibraciones='A' OR ultimo_estado_termografia='A' OR ultimo_estado_ultrasonido='A')
                        AND ultimo_estado_vibraciones!='C' AND ultimo_estado_termografia!='C' AND ultimo_estado_ultrasonido!='C') as en_alerta,
                    COUNT(*) FILTER (WHERE (ultimo_estado_vibraciones='B' OR ultimo_estado_vibraciones IS NULL)
                        AND (ultimo_estado_termografia='B' OR ultimo_estado_termografia IS NULL)
                        AND (ultimo_estado_ultrasonido='B' OR ultimo_estado_ultrasonido IS NULL)
                        AND (ultimo_estado_vibraciones IS NOT NULL OR ultimo_estado_termografia IS NOT NULL OR ultimo_estado_ultrasonido IS NOT NULL)) as todos_buenos,
                    COUNT(*) FILTER (WHERE ultimo_estado_vibraciones IS NULL AND ultimo_estado_termografia IS NULL AND ultimo_estado_ultrasonido IS NULL) as sin_datos,
                    ROUND(100.0 * COUNT(*) FILTER (WHERE aplica_vibraciones AND ultimo_estado_vibraciones IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE aplica_vibraciones),0), 1) as cob_vib,
                    ROUND(100.0 * COUNT(*) FILTER (WHERE aplica_termografia AND ultimo_estado_termografia IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE aplica_termografia),0), 1) as cob_termo,
                    ROUND(100.0 * COUNT(*) FILTER (WHERE aplica_ultrasonido AND ultimo_estado_ultrasonido IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE aplica_ultrasonido),0), 1) as cob_ultra
                FROM equipos WHERE aplica_vibraciones OR aplica_termografia OR aplica_ultrasonido`);

            const ots = FEATURES.ot
                ? await pool.query(`SELECT COUNT(*) FILTER (WHERE estado!='Cerrada') as ab, COUNT(*) FILTER (WHERE estado='Cerrada' AND updated_at > NOW()-INTERVAL '30 days') as ce FROM ordenes_trabajo`)
                : { rows: [{ ab: 0, ce: 0 }] };
            const lubs = FEATURES.lubricacion
                ? await pool.query(`SELECT COUNT(*) as n FROM lubricacion_registros WHERE fecha_servicio >= DATE_TRUNC('month', CURRENT_DATE)`)
                : { rows: [{ n: 0 }] };

            const snap = eq.rows[0];
            await pool.query(`
                INSERT INTO kpi_historico
                (periodo, total_equipos, en_alarma, en_alerta, todos_buenos, sin_datos,
                 cobertura_vib, cobertura_termo, cobertura_ultra, ots_abiertas, ots_cerradas, lubricaciones)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                ON CONFLICT (periodo, planta) DO UPDATE SET
                    total_equipos=EXCLUDED.total_equipos, en_alarma=EXCLUDED.en_alarma,
                    en_alerta=EXCLUDED.en_alerta, todos_buenos=EXCLUDED.todos_buenos,
                    sin_datos=EXCLUDED.sin_datos, cobertura_vib=EXCLUDED.cobertura_vib,
                    cobertura_termo=EXCLUDED.cobertura_termo, cobertura_ultra=EXCLUDED.cobertura_ultra,
                    ots_abiertas=EXCLUDED.ots_abiertas, ots_cerradas=EXCLUDED.ots_cerradas,
                    lubricaciones=EXCLUDED.lubricaciones`,
                [periodo, snap.total, snap.en_alarma, snap.en_alerta, snap.todos_buenos, snap.sin_datos,
                 snap.cob_vib, snap.cob_termo, snap.cob_ultra,
                 ots.rows[0].ab, ots.rows[0].ce, lubs.rows[0].n]
            );
            res.json({ success: true, periodo, snapshot: snap });
        } catch (err) { handleError(res, err, 'Error al generar snapshot KPI'); }
    });

    app.get('/api/kpi-historico', requireAuth, async (req, res) => {
        try {
            const r = await pool.query('SELECT * FROM kpi_historico ORDER BY periodo ASC');
            res.json(r.rows);
        } catch (err) { handleError(res, err, 'Error al obtener KPI histórico'); }
    });

} // end FEATURES.kpi_historico

async function ensureColumns() {
    // Columns for equipos table
    const equiposCols = [
        'caudal_nominal VARCHAR(50)', 'presion_nominal VARCHAR(50)', 'tipo_sello VARCHAR(100)',
        'tipo_compresor VARCHAR(50)', 'presion_max_comp VARCHAR(50)', 'caudal_comp VARCHAR(50)',
        'refrig_comp VARCHAR(100)', 'aceite_comp VARCHAR(100)', 'cap_aceite_comp VARCHAR(50)',
        'tipo_ventilador VARCHAR(50)', 'transmision_tipo_vent VARCHAR(50)',
        'caudal_vent VARCHAR(50)', 'presion_vent VARCHAR(50)',
        'diam_rodete VARCHAR(50)', 'num_alabes_vent INTEGER DEFAULT 0',
        'motor_primario VARCHAR(50)', 'potencia_kva VARCHAR(50)',
        'voltaje_salida VARCHAR(50)', 'frecuencia_gen VARCHAR(20)',
        'fp_gen VARCHAR(20)', 'combustible_gen VARCHAR(100)',
        'tipo_reductor VARCHAR(50)', 'relacion_reduccion VARCHAR(50)',
        'rpm_salida NUMERIC(10,2)', 'torque_salida VARCHAR(50)',
        'aceite_reductor VARCHAR(100)', 'cap_aceite_red VARCHAR(50)',
        'ancho_banda VARCHAR(50)', 'longitud_banda VARCHAR(50)',
        'velocidad_banda VARCHAR(50)', 'capacidad_banda VARCHAR(50)',
        'material_banda VARCHAR(100)', 'accionamiento_banda VARCHAR(100)',
        'aplica_vibraciones BOOLEAN DEFAULT false',
        'aplica_termografia BOOLEAN DEFAULT false',
        'aplica_ultrasonido BOOLEAN DEFAULT false',
        'kw_nominal NUMERIC(10,2)', 'rpm_nominal NUMERIC(10,2)', 'hp_nominal NUMERIC(10,2)',
        'num_alabes_turbina INTEGER DEFAULT 0',
        'num_alabes_impeler INTEGER DEFAULT 0',
    ];
    // Columns for reportes table
    const reportesCols = [
        "tecnica VARCHAR(50) NOT NULL DEFAULT 'general'",
        'titulo VARCHAR(200)',
        'codigo_reporte VARCHAR(50)',
        "datos TEXT DEFAULT '{}'",
        'fecha_creacion TIMESTAMPTZ DEFAULT NOW()',
        'fecha_modificacion TIMESTAMPTZ DEFAULT NOW()',
    ];
    for (const col of equiposCols) {
        await pool.query(`ALTER TABLE equipos ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    }
    for (const col of reportesCols) {
        await pool.query(`ALTER TABLE reportes ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    }
    console.log('  [OK] Columnas verificadas');

    // Crear tablas de monitoreo de condiciones si no existen
    await pool.query(`
        CREATE TABLE IF NOT EXISTS condicion_config (
            asset_id        VARCHAR(100) PRIMARY KEY REFERENCES equipos(asset_id) ON DELETE CASCADE,
            puntos          TEXT DEFAULT '[]',
            limites_vel     TEXT DEFAULT '{}',
            limites_env     TEXT DEFAULT '{}',
            limites_crest   TEXT DEFAULT '{}',
            iso_class       VARCHAR(20),
            system_unit     VARCHAR(20) DEFAULT 'mm/seg',
            frecuencia      VARCHAR(50),
            usar_globales   BOOLEAN DEFAULT true,
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
    `).catch(e => console.warn('  [WARN] condicion_config:', e.message));

    // Añadir columnas nuevas si la tabla ya existía
    await pool.query(`ALTER TABLE condicion_config ADD COLUMN IF NOT EXISTS limites_crest TEXT DEFAULT '{}'`).catch(() => {});
    await pool.query(`ALTER TABLE condicion_config ADD COLUMN IF NOT EXISTS usar_globales BOOLEAN DEFAULT true`).catch(() => {});

    await pool.query(`
        CREATE TABLE IF NOT EXISTS condicion_globales (
            id              INTEGER PRIMARY KEY DEFAULT 1,
            limites_vel     TEXT DEFAULT '{}',
            limites_env     TEXT DEFAULT '{}',
            limites_crest   TEXT DEFAULT '{}',
            system_unit     VARCHAR(20) DEFAULT 'mm/seg',
            iso_class       VARCHAR(20),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
    `).catch(e => console.warn('  [WARN] condicion_globales:', e.message));

    await pool.query(`
        CREATE TABLE IF NOT EXISTS condicion_lecturas (
            id              SERIAL PRIMARY KEY,
            asset_id        VARCHAR(100) REFERENCES equipos(asset_id) ON DELETE CASCADE,
            fecha_medicion  DATE NOT NULL,
            valores_vel     TEXT DEFAULT '{}',
            valores_env     TEXT DEFAULT '{}',
            valores_temp    TEXT DEFAULT '{}',
            notas           TEXT,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
    `).catch(e => console.warn('  [WARN] condicion_lecturas:', e.message));

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_condicion_lecturas_asset ON condicion_lecturas(asset_id)`).catch(() => {});
    console.log('  [OK] Tablas de monitoreo de condiciones verificadas');

    // ── Tablas de Termografía ────────────────────────────────────
    await pool.query(`
        CREATE TABLE IF NOT EXISTS termo_componentes (
            id              SERIAL PRIMARY KEY,
            asset_id        VARCHAR(100) REFERENCES equipos(asset_id) ON DELETE CASCADE,
            nombre          VARCHAR(200) NOT NULL,
            tipo_componente VARCHAR(100) NOT NULL,
            criterio        VARCHAR(20)  NOT NULL DEFAULT 'delta_t',
            num_fases       INTEGER      NOT NULL DEFAULT 1,
            corriente_nominal NUMERIC(10,2),
            corriente_nominal_r NUMERIC(10,2),
            corriente_nominal_s NUMERIC(10,2),
            corriente_nominal_t NUMERIC(10,2),
            temp_max_abs    NUMERIC(8,2),
            temp_rise_rated NUMERIC(8,2),
            temp_amb_rated  NUMERIC(8,2) DEFAULT 40,
            delta_t_alerta  NUMERIC(8,2),
            delta_t_alarma  NUMERIC(8,2),
            emisividad      NUMERIC(5,3) DEFAULT 0.95,
            distancia_tipica NUMERIC(6,2),
            notas_config    TEXT,
            orden           INTEGER DEFAULT 0,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
    `).catch(e => console.warn('  [WARN] termo_componentes:', e.message));
    // Add new columns if table already exists
    const newCompCols = [
        'corriente_nominal_r NUMERIC(10,2)',
        'corriente_nominal_s NUMERIC(10,2)',
        'corriente_nominal_t NUMERIC(10,2)',
        'emisividad NUMERIC(5,3) DEFAULT 0.95',
        'distancia_tipica NUMERIC(6,2)',
    ];
    for (const col of newCompCols) {
        await pool.query(`ALTER TABLE termo_componentes ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    }

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_termo_comp_asset ON termo_componentes(asset_id)`).catch(() => {});

    await pool.query(`
        CREATE TABLE IF NOT EXISTS termo_lecturas (
            id              SERIAL PRIMARY KEY,
            componente_id   INTEGER REFERENCES termo_componentes(id) ON DELETE CASCADE,
            asset_id        VARCHAR(100) REFERENCES equipos(asset_id) ON DELETE CASCADE,
            fecha_medicion  DATE NOT NULL,
            temp_ambiente   NUMERIC(8,2) NOT NULL,
            fases           TEXT DEFAULT '[]',
            emisividad      NUMERIC(5,3),
            distancia       NUMERIC(6,2),
            num_img_ir      VARCHAR(100),
            num_img_vis     VARCHAR(100),
            notas           TEXT,
            estado          CHAR(1),
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
    `).catch(e => console.warn('  [WARN] termo_lecturas:', e.message));
    // Add new columns if table already exists
    const newLecCols = [
        'emisividad NUMERIC(5,3)',
        'distancia NUMERIC(6,2)',
        'num_img_ir VARCHAR(100)',
        'num_img_vis VARCHAR(100)',
    ];
    for (const col of newLecCols) {
        await pool.query(`ALTER TABLE termo_lecturas ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    }

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_termo_lec_comp ON termo_lecturas(componente_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_termo_lec_asset ON termo_lecturas(asset_id)`).catch(() => {});
    console.log('  [OK] Tablas de termografía verificadas');
    // ── Tablas de Ultrasonido ────────────────────────────────────
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ultra_componentes (
            id                  SERIAL PRIMARY KEY,
            asset_id            VARCHAR(100) REFERENCES equipos(asset_id) ON DELETE CASCADE,
            nombre              VARCHAR(200) NOT NULL,
            tipo_defecto        VARCHAR(100) NOT NULL DEFAULT 'Rodamiento',
            nivel_base          NUMERIC(8,2),
            nivel_alerta        NUMERIC(8,2),
            nivel_alarma        NUMERIC(8,2),
            frecuencia_sensor   VARCHAR(50)  DEFAULT '40 kHz',
            tipo_sensor         VARCHAR(100),
            notas_config        TEXT,
            orden               INTEGER DEFAULT 0,
            created_at          TIMESTAMPTZ DEFAULT NOW(),
            updated_at          TIMESTAMPTZ DEFAULT NOW()
        )
    `).catch(e => console.warn('  [WARN] ultra_componentes:', e.message));
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ultra_comp_asset ON ultra_componentes(asset_id)`).catch(() => {});
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ultra_lecturas (
            id              SERIAL PRIMARY KEY,
            componente_id   INTEGER REFERENCES ultra_componentes(id) ON DELETE CASCADE,
            asset_id        VARCHAR(100) REFERENCES equipos(asset_id) ON DELETE CASCADE,
            fecha_medicion  DATE NOT NULL,
            nivel_db        NUMERIC(8,2) NOT NULL,
            nivel_base_lec  NUMERIC(8,2),
            delta_db        NUMERIC(8,2),
            rpm             NUMERIC(8,1),
            carga_pct       NUMERIC(5,1),
            temp_c          NUMERIC(7,2),
            ruido_amb       NUMERIC(8,2),
            caracteristicas TEXT,
            no_imagen       VARCHAR(100),
            notas           TEXT,
            estado          CHAR(1),
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
    `).catch(e => console.warn('  [WARN] ultra_lecturas:', e.message));
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ultra_lec_comp  ON ultra_lecturas(componente_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ultra_lec_asset ON ultra_lecturas(asset_id)`).catch(() => {});
    console.log('  [OK] Tablas de ultrasonido verificadas');

    // ── Tablas de usuarios y seguridad ──────────────────────────
    await pool.query(`
        CREATE TABLE IF NOT EXISTS plantas (
            nombre      VARCHAR(100) PRIMARY KEY,
            descripcion TEXT,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `).catch(e => console.warn('  [WARN] plantas:', e.message));

    await pool.query(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id            SERIAL PRIMARY KEY,
            usuario       VARCHAR(60) UNIQUE NOT NULL,
            nombre        VARCHAR(150) NOT NULL,
            password_hash TEXT NOT NULL,
            rol           VARCHAR(20) NOT NULL DEFAULT 'visor',
            activo        BOOLEAN DEFAULT true,
            created_at    TIMESTAMPTZ DEFAULT NOW()
        )
    `).catch(e => console.warn('  [WARN] usuarios:', e.message));

    await pool.query(`
        CREATE TABLE IF NOT EXISTS usuario_plantas (
            usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
            planta      VARCHAR(100) REFERENCES plantas(nombre) ON DELETE CASCADE,
            PRIMARY KEY (usuario_id, planta)
        )
    `).catch(e => console.warn('  [WARN] usuario_plantas:', e.message));

    await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id          SERIAL PRIMARY KEY,
            usuario_id  INTEGER,
            accion      VARCHAR(80),
            detalle     TEXT,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `).catch(e => console.warn('  [WARN] audit_log:', e.message));

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(created_at DESC)`).catch(() => {});

    // ── Tablas opcionales según feature flags ────────────────────
    if (FEATURES.ot) {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ordenes_trabajo (
                id              SERIAL PRIMARY KEY,
                codigo          VARCHAR(30) UNIQUE NOT NULL,
                asset_id        VARCHAR(100) REFERENCES equipos(asset_id) ON DELETE SET NULL,
                titulo          VARCHAR(300) NOT NULL,
                descripcion     TEXT,
                tipo            VARCHAR(50)  NOT NULL DEFAULT 'Correctivo',
                prioridad       VARCHAR(20)  NOT NULL DEFAULT 'Normal',
                estado          VARCHAR(30)  NOT NULL DEFAULT 'Pendiente',
                tecnico_asignado VARCHAR(100),
                tecnica_origen  VARCHAR(20),
                lectura_origen  INTEGER,
                fecha_apertura  DATE NOT NULL DEFAULT CURRENT_DATE,
                fecha_limite    DATE,
                fecha_cierre    DATE,
                resultado       TEXT,
                costo_estimado  NUMERIC(12,2),
                costo_real      NUMERIC(12,2),
                created_by      INTEGER REFERENCES usuarios(id),
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW()
            )
        `).catch(e => console.warn('  [WARN] ordenes_trabajo:', e.message));
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ot_asset   ON ordenes_trabajo(asset_id)`).catch(() => {});
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ot_estado  ON ordenes_trabajo(estado)`).catch(() => {});
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ot_fecha   ON ordenes_trabajo(fecha_apertura DESC)`).catch(() => {});
        console.log('  [OK] Módulo OT habilitado');
    }

    if (FEATURES.lubricacion) {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS lubricacion_config (
                id              SERIAL PRIMARY KEY,
                asset_id        VARCHAR(100) REFERENCES equipos(asset_id) ON DELETE CASCADE,
                punto           VARCHAR(200) NOT NULL,
                tipo_lubricante VARCHAR(150),
                cantidad_cc     NUMERIC(8,2),
                intervalo_dias  INTEGER NOT NULL DEFAULT 30,
                intervalo_horas INTEGER,
                metodo          VARCHAR(50)  DEFAULT 'Manual',
                ultimo_servicio DATE,
                notas           TEXT,
                activo          BOOLEAN DEFAULT true,
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW()
            )
        `).catch(e => console.warn('  [WARN] lubricacion_config:', e.message));
        await pool.query(`
            CREATE TABLE IF NOT EXISTS lubricacion_registros (
                id              SERIAL PRIMARY KEY,
                config_id       INTEGER REFERENCES lubricacion_config(id) ON DELETE CASCADE,
                asset_id        VARCHAR(100) REFERENCES equipos(asset_id) ON DELETE CASCADE,
                fecha_servicio  DATE NOT NULL DEFAULT CURRENT_DATE,
                lubricante_usado VARCHAR(150),
                cantidad_real   NUMERIC(8,2),
                tecnico         VARCHAR(100),
                temperatura_c   NUMERIC(6,1),
                nivel_ruido_antes NUMERIC(8,2),
                nivel_ruido_despues NUMERIC(8,2),
                observaciones   TEXT,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            )
        `).catch(e => console.warn('  [WARN] lubricacion_registros:', e.message));
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_lub_cfg_asset ON lubricacion_config(asset_id)`).catch(() => {});
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_lub_reg_asset ON lubricacion_registros(asset_id)`).catch(() => {});
        console.log('  [OK] Módulo Lubricación habilitado');
    }

    if (FEATURES.notificaciones) {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notificaciones (
                id          SERIAL PRIMARY KEY,
                asset_id    VARCHAR(100),
                titulo      VARCHAR(300) NOT NULL,
                mensaje     TEXT,
                tipo        VARCHAR(30) DEFAULT 'alerta',
                leida       BOOLEAN DEFAULT false,
                usuario_id  INTEGER REFERENCES usuarios(id),
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )
        `).catch(e => console.warn('  [WARN] notificaciones:', e.message));
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notificaciones(usuario_id, leida)`).catch(() => {});
        console.log('  [OK] Módulo Notificaciones habilitado');
    }

    if (FEATURES.kpi_historico) {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS kpi_historico (
                id              SERIAL PRIMARY KEY,
                periodo         VARCHAR(7) NOT NULL,
                planta          VARCHAR(100) DEFAULT 'Todas',
                total_equipos   INTEGER DEFAULT 0,
                en_alarma       INTEGER DEFAULT 0,
                en_alerta       INTEGER DEFAULT 0,
                todos_buenos    INTEGER DEFAULT 0,
                sin_datos       INTEGER DEFAULT 0,
                cobertura_vib   NUMERIC(5,2),
                cobertura_termo NUMERIC(5,2),
                cobertura_ultra NUMERIC(5,2),
                ots_abiertas    INTEGER DEFAULT 0,
                ots_cerradas    INTEGER DEFAULT 0,
                lubricaciones   INTEGER DEFAULT 0,
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(periodo, planta)
            )
        `).catch(e => console.warn('  [WARN] kpi_historico:', e.message));
        console.log('  [OK] Módulo KPI Histórico habilitado');
    }
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_usuario ON usuarios(usuario)`).catch(() => {});
    console.log('  [OK] Tablas de usuarios y seguridad verificadas');
}

// ════════════════════════════════════════════════════════════════
// RESPALDO Y RESTAURACIÓN (solo sysadmin)
// ════════════════════════════════════════════════════════════════
const { exec }  = require('child_process');
const fs_native = require('fs');

function getBackupDir() {
    return envStr('BACKUP_DIR') || 'C:\\Respaldos\\PDM';
}
function getPgBin() {
    return envStr('PG_BIN') || 'C:\\Program Files\\PostgreSQL\\16\\bin';
}

// Listar respaldos disponibles
app.get('/api/admin/backups', requireAuth, roleAtLeast('sysadmin'), (req, res) => {
    const dir = getBackupDir();
    try {
        if (!fs_native.existsSync(dir)) return res.json([]);
        const files = fs_native.readdirSync(dir)
            .filter(f => f.endsWith('.backup'))
            .map(f => {
                const full = require('path').join(dir, f);
                const stat = fs_native.statSync(full);
                return {
                    nombre:    f,
                    tamaño_kb: (stat.size / 1024).toFixed(1),
                    fecha:     stat.mtime.toISOString(),
                };
            })
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha)); // más reciente primero
        res.json(files);
    } catch (err) { handleError(res, err, 'Error al listar respaldos'); }
});

// Crear respaldo manual
app.post('/api/admin/backup', requireAuth, roleAtLeast('sysadmin'), (req, res) => {
    const backupDir = getBackupDir();
    const pgBin     = getPgBin();
    const now       = new Date();
    const stamp     = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    const outFile   = require('path').join(backupDir, `pdm_${stamp}.backup`);

    try {
        if (!fs_native.existsSync(backupDir)) fs_native.mkdirSync(backupDir, { recursive: true });
    } catch (e) {
        return res.status(500).json({ error: `No se pudo crear el directorio: ${e.message}` });
    }

    // Usar comillas para manejar espacios en rutas de Windows
    const pgDump = require('path').join(pgBin, 'pg_dump.exe');
    const cmd    = `"${pgDump}" -U ${envStr('DB_USER')} -h ${envStr('DB_HOST')} -p ${envStr('DB_PORT') || 5432} -d ${envStr('DB_DATABASE')} -F c -f "${outFile}"`;
    const env    = { ...process.env, PGPASSWORD: envStr('DB_PASSWORD') };

    exec(cmd, { env }, (err, stdout, stderr) => {
        if (err) {
            console.error('❌ Backup error:', stderr);
            return res.status(500).json({ error: 'Error al generar respaldo.', detail: stderr.trim() });
        }
        try {
            const size = fs_native.statSync(outFile).size;
            pool.query('INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1,$2,$3)',
                [req.user.id || 0, 'backup_manual', require('path').basename(outFile)]).catch(() => {});
            console.log(`✅ Backup: ${outFile} (${(size/1024).toFixed(1)} KB)`);
            res.json({ success: true, archivo: require('path').basename(outFile), tamaño_kb: (size/1024).toFixed(1) });
        } catch (e) {
            res.status(500).json({ error: 'Backup ejecutado pero no se pudo verificar el archivo.', detail: e.message });
        }
    });
});

// Eliminar respaldo
app.delete('/api/admin/backups/:nombre', requireAuth, roleAtLeast('sysadmin'), (req, res) => {
    const nombre = req.params.nombre;
    // Seguridad: solo permitir nombres de archivo sin rutas
    if (nombre.includes('/') || nombre.includes('\\') || nombre.includes('..')) {
        return res.status(400).json({ error: 'Nombre de archivo inválido.' });
    }
    if (!nombre.endsWith('.backup')) {
        return res.status(400).json({ error: 'Solo se pueden eliminar archivos .backup' });
    }
    const fullPath = require('path').join(getBackupDir(), nombre);
    try {
        if (!fs_native.existsSync(fullPath)) return res.status(404).json({ error: 'Archivo no encontrado.' });
        fs_native.unlinkSync(fullPath);
        pool.query('INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1,$2,$3)',
            [req.user.id || 0, 'eliminar_backup', nombre]).catch(() => {});
        res.json({ success: true });
    } catch (err) { handleError(res, err, 'Error al eliminar respaldo'); }
});

findFreePort(preferredPort).then(port => {
    app.listen(port, async () => {
        await ensureColumns().catch(e => console.warn('  [WARN] migrate:', e.message));
        if (port !== preferredPort) {
            console.log(`  [INFO] Puerto ${preferredPort} ocupado, usando puerto ${port}`);
        }
        // Write actual port to temp file so INICIAR.bat can open the right URL
        const fs = require('fs');
        const os = require('os');
        const portFile = require('path').join(os.tmpdir(), 'pdm_actual_port.txt');
        fs.writeFileSync(portFile, String(port));
        console.log(`\n  Suite PdM lista en: http://localhost:${port}`);
        console.log(`  Usuario: ${envStr('APP_USER') || 'admin'} | Clave: ${envStr('APP_PASSWORD') || 'pdm2026'}`);
        console.log(`  PDM_PORT=${port}\n`);
    });
});
