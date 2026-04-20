// condicion.js — Módulo de Monitoreo de Condición (Vibraciones)
// Suite PdM | Edwards — v2: Factor de Cresta + Límites Globales

document.addEventListener('DOMContentLoaded', () => {

    const toast    = (m, t = 'info') => window.PdM?.showToast(m, t) || console.log(m);
    const apiFetch = (...a) => window.PdM.apiFetch(...a);

    // ── Estado global ──────────────────────────────────────────
    let allEquipos      = [];
    let currentEquipo   = null;
    let currentConfig   = null;
    let globalesConfig  = null;    // límites globales cargados del servidor
    let currentLecturas = [];
    let editingLecturaId  = null;
    let deletingLecturaId = null;
    let showEnv      = true;
    let showCrest    = false;
    let rowsLimit    = 20;
    let tendenciaData = {};     // cache de tendencias por equipo
    let gapData       = {};     // cache de gaps
    let chartInstance = null;   // instancia Chart.js activa

    // ── Referencias DOM ────────────────────────────────────────
    const assetTree     = document.getElementById('asset-tree');
    const sidebarSearch = document.getElementById('sidebar-search');
    const panelEmpty    = document.getElementById('panel-empty');
    const panelEquipo   = document.getElementById('panel-equipo');
    const sidebar       = document.getElementById('sidebar');

    // ════════════════════════════════════════════════════════════
    // 1. CARGAR Y RENDERIZAR ÁRBOL
    // ════════════════════════════════════════════════════════════
    async function loadEquipos() {
        try {
            const res = await apiFetch('/api/equipos');
            if (!res?.ok) throw new Error('Error ' + res?.status);
            allEquipos = (await res.json()).filter(e => e.aplica_vibraciones);
            renderTree(allEquipos);
        } catch {
            assetTree.innerHTML = `<div class="cond-tree-loading" style="color:var(--danger);">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>No se pudo conectar al servidor</span>
            </div>`;
        }
    }

    function renderTree(equipos, query = '') {
        if (!equipos.length) {
            assetTree.innerHTML = `<div class="cond-tree-loading">
                <i class="fa-solid fa-circle-info"></i>
                <span style="text-align:center;">No hay activos con<br>vibraciones habilitadas</span>
            </div>`;
            return;
        }

        const grupos = {};
        equipos.forEach(eq => {
            const planta = (eq.ubicacion || 'Sin Ubicación').split('/')[0].trim() || 'Sin Ubicación';
            if (!grupos[planta]) grupos[planta] = [];
            grupos[planta].push(eq);
        });

        let html = '';
        let haMatch = false;
        Object.keys(grupos).sort().forEach(planta => {
            const items = query
                ? grupos[planta].filter(e =>
                    e.asset_id?.toLowerCase().includes(query) ||
                    e.descripcion?.toLowerCase().includes(query) ||
                    e.ubicacion?.toLowerCase().includes(query))
                : grupos[planta];
            if (!items.length) return;
            haMatch = true;

            const semItems = items.map(e => {
                const s  = e.ultimo_estado_vibraciones;
                const sc = s ? `sema-${s}` : 'sema-null';
                const isActive = currentEquipo?.asset_id === e.asset_id ? 'active' : '';
                return `<div class="cond-tree-activo ${isActive}" data-id="${e.asset_id}">
                    <div class="cond-semaforo-mini ${sc}"></div>
                    <span class="cond-activo-id">${e.asset_id}</span>
                    <span class="cond-activo-desc" title="${e.descripcion || ''}">${e.descripcion || '—'}</span>
                </div>`;
            }).join('');

            html += `<div class="cond-tree-planta" data-planta="${planta}">
                <div class="cond-tree-planta-header">
                    <i class="fa-solid fa-industry" style="font-size:.8em;opacity:.6;"></i>
                    <span>${planta}</span>
                    <span class="cond-planta-count">${items.length}</span>
                    <i class="fa-solid fa-chevron-down chevron"></i>
                </div>
                <div class="cond-tree-activos">${semItems}</div>
            </div>`;
        });

        if (!haMatch) {
            assetTree.innerHTML = `<div class="cond-tree-loading">
                <i class="fa-solid fa-magnifying-glass"></i><span>Sin resultados</span></div>`;
            return;
        }

        assetTree.innerHTML = html;

        assetTree.querySelectorAll('.cond-tree-planta-header').forEach(h => {
            h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'));
        });

        assetTree.querySelectorAll('.cond-tree-activo').forEach(el => {
            el.addEventListener('click', () => {
                assetTree.querySelectorAll('.cond-tree-activo').forEach(x => x.classList.remove('active'));
                el.classList.add('active');
                const eq = allEquipos.find(e => e.asset_id === el.dataset.id);
                if (eq) selectEquipo(eq);
            });
        });
    }

    sidebarSearch.addEventListener('input', e => renderTree(allEquipos, e.target.value.toLowerCase().trim()));

    // Ambos toggles (sidebar flotante y barra móvil) controlan el mismo sidebar
    const toggleSidebar = () => sidebar.classList.toggle('collapsed');
    document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-toggle-top')?.addEventListener('click', toggleSidebar);

    // ════════════════════════════════════════════════════════════
    // 2. SELECCIONAR EQUIPO
    // ════════════════════════════════════════════════════════════
    async function selectEquipo(eq) {
        currentEquipo = eq;
        panelEmpty.style.display  = 'none';
        panelEquipo.style.display = 'flex';
        panelEquipo.style.flexDirection = 'column';
        panelEquipo.style.gap = '20px';

        fillFicha(eq);

        await Promise.all([
            loadConfig(eq.asset_id),
            loadLecturas(eq.asset_id),
        ]);

        renderTabla();
        loadAndRenderChart();
    }

    function fillFicha(eq) {
        const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || '—'; };

        const badge = document.getElementById('ficha-criticidad-badge');
        if (badge) {
            badge.textContent = eq.criticidad || '—';
            badge.className   = 'cond-ficha-badge';
            if (eq.criticidad === 'Alta')  badge.classList.add('crit-alta');
            if (eq.criticidad === 'Media') badge.classList.add('crit-media');
            if (eq.criticidad === 'Baja')  badge.classList.add('crit-baja');
        }

        const dot = document.getElementById('ficha-semaforo');
        if (dot) {
            const s = eq.ultimo_estado_vibraciones;
            dot.className = 'cond-semaforo-dot' + (s ? ` sema-${s}` : '');
            dot.title = s ? ({ B:'Bueno', A:'Alerta', C:'Crítico', N:'No aplica' }[s] || s) : 'Sin medición';
        }

        setText('ficha-asset-id',     eq.asset_id);
        setText('ficha-descripcion',  eq.descripcion);
        setText('ficha-ubicacion',    eq.ubicacion);
        setText('ficha-marca',        eq.marca);
        setText('ficha-modelo',       eq.modelo);
        setText('ficha-tipo-sistema', (eq.tipo_sistema || '').toUpperCase() || '—');
        setText('ficha-tipo-acople',  eq.tipo_acople);
        setText('ficha-potencia',     eq.potencia_hp ? `${eq.potencia_hp} HP` : '—');
        setText('ficha-rpm',          eq.rpm ? `${eq.rpm} RPM` : '—');
        setText('ficha-rod-de',       eq.rodamiento_de);
        setText('ficha-rod-ode',      eq.rodamiento_ode);
        setText('ficha-frecuencia',   currentConfig?.frecuencia   || '—');
        setText('ficha-system-unit',  currentConfig?.system_unit  || '—');
        setText('ficha-iso-class',    currentConfig?.iso_class    || '—');
    }

    // ════════════════════════════════════════════════════════════
    // 3. LÍMITES GLOBALES
    // ════════════════════════════════════════════════════════════
    async function loadGlobales() {
        try {
            const res = await apiFetch('/api/condicion/globales');
            if (res?.ok) {
                const d = await res.json();
                globalesConfig = {
                    system_unit:  d.system_unit  || 'mm/seg',
                    iso_class:    d.iso_class     || '',
                    limites_vel:  safeJSON(d.limites_vel,   {}),
                    limites_env:  safeJSON(d.limites_env,   {}),
                    limites_crest: safeJSON(d.limites_crest, {}),
                };
            }
        } catch { globalesConfig = null; }
    }

    // Resolver límite: equipo primero, global si equipo vacío
    function resolveLim(limEquipo, limGlobal, punto, usar_globales) {
        const eq = limEquipo?.[punto];
        const gl = limGlobal;  // global es un solo objeto {ulc, med, lcl}

        const ulc = (eq?.ulc != null) ? eq.ulc : (usar_globales && gl?.ulc != null ? gl.ulc : null);
        const med = (eq?.med != null) ? eq.med : (usar_globales && gl?.med != null ? gl.med : null);
        const lcl = (eq?.lcl != null) ? eq.lcl : (usar_globales && gl?.lcl != null ? gl.lcl : null);
        return { ulc, med, lcl };
    }

    // Abrir modal de límites globales
    document.getElementById('btn-globales').addEventListener('click', openGlobalesModal);

    async function openGlobalesModal() {
        await loadGlobales();
        const g = globalesConfig || {};

        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v != null ? v : ''; };
        const su = document.getElementById('glob-system-unit');
        const ic = document.getElementById('glob-iso-class');
        if (su) su.value = g.system_unit || 'mm/seg';
        if (ic) ic.value = g.iso_class   || '';

        setVal('glob-vel-ulc',   g.limites_vel?.ulc);
        setVal('glob-vel-med',   g.limites_vel?.med);
        setVal('glob-vel-lcl',   g.limites_vel?.lcl);
        setVal('glob-env-ulc',   g.limites_env?.ulc);
        setVal('glob-env-med',   g.limites_env?.med);
        setVal('glob-env-lcl',   g.limites_env?.lcl);
        setVal('glob-crest-ulc', g.limites_crest?.ulc);
        setVal('glob-crest-med', g.limites_crest?.med);
        setVal('glob-crest-lcl', g.limites_crest?.lcl);

        document.getElementById('modal-globales').style.display = 'flex';
    }

    document.getElementById('save-globales').addEventListener('click', async () => {
        const pf = id => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? null : v; };
        const payload = {
            system_unit:   document.getElementById('glob-system-unit')?.value || 'mm/seg',
            iso_class:     document.getElementById('glob-iso-class')?.value   || '',
            limites_vel:   { ulc: pf('glob-vel-ulc'),   med: pf('glob-vel-med'),   lcl: pf('glob-vel-lcl') },
            limites_env:   { ulc: pf('glob-env-ulc'),   med: pf('glob-env-med'),   lcl: pf('glob-env-lcl') },
            limites_crest: { ulc: pf('glob-crest-ulc'), med: pf('glob-crest-med'), lcl: pf('glob-crest-lcl') },
        };
        try {
            const res = await apiFetch('/api/condicion/globales', { method: 'POST', body: JSON.stringify(payload) });
            if (res?.ok) {
                globalesConfig = payload;
                document.getElementById('modal-globales').style.display = 'none';
                toast('✅ Límites globales guardados.', 'success');
                if (currentEquipo) renderTabla(); // refrescar tabla si hay equipo activo
            } else {
                toast('❌ Error al guardar.', 'error');
            }
        } catch { toast('❌ Error de conexión.', 'error'); }
    });

    ['close-globales','cancel-globales'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => {
            document.getElementById('modal-globales').style.display = 'none';
        });
    });
    document.getElementById('modal-globales')?.addEventListener('click', e => {
        if (e.target === document.getElementById('modal-globales')) document.getElementById('modal-globales').style.display = 'none';
    });

    // ════════════════════════════════════════════════════════════
    // 4. CONFIG POR EQUIPO
    // ════════════════════════════════════════════════════════════
    async function loadConfig(assetId) {
        try {
            const res = await apiFetch(`/api/condicion/config/${assetId}`);
            if (res?.ok) {
                const data = await res.json();
                if (data) {
                    currentConfig = {
                        ...data,
                        puntos:        safeJSON(data.puntos,        []),
                        limites_vel:   safeJSON(data.limites_vel,   {}),
                        limites_env:   safeJSON(data.limites_env,   {}),
                        limites_crest: safeJSON(data.limites_crest, {}),
                        usar_globales: data.usar_globales !== false,
                    };
                } else {
                    currentConfig = defaultConfig();
                }
            } else {
                currentConfig = defaultConfig();
            }
        } catch { currentConfig = defaultConfig(); }

        const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || '—'; };
        setText('ficha-frecuencia',  currentConfig.frecuencia  || '—');
        setText('ficha-system-unit', currentConfig.system_unit || globalesConfig?.system_unit || '—');
        setText('ficha-iso-class',   currentConfig.iso_class   || globalesConfig?.iso_class   || '—');
    }

    function defaultConfig() {
        return {
            puntos: ['1H', '2H', '3H', '4H'],
            limites_vel: {}, limites_env: {}, limites_crest: {},
            iso_class: '', system_unit: 'mm/seg', frecuencia: 'Mensual',
            usar_globales: true,
        };
    }

    document.getElementById('btn-config-equipo').addEventListener('click', openConfigModal);

    // ── Cargar grupos ISO 10816 en el select ───────────────────
    async function loadISOGrupos() {
        try {
            const res = await apiFetch('/api/condicion/iso10816');
            if (!res?.ok) return;
            const grupos = await res.json();
            const sel = document.getElementById('cfg-iso-grupo');
            if (!sel) return;
            grupos.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g.grupo;
                opt.textContent = `G${g.grupo} — ${g.desc.split('—')[1]?.trim() || g.desc}`;
                opt.dataset.desc = g.desc;
                opt.dataset.a = g.A; opt.dataset.b = g.B; opt.dataset.c = g.C;
                sel.appendChild(opt);
            });
            sel.addEventListener('change', () => {
                const opt = sel.options[sel.selectedIndex];
                const desc = document.getElementById('iso-desc');
                if (desc) desc.textContent = opt.dataset.desc || '';
            });
        } catch {}
    }

    // ── Aplicar límites ISO al formulario de configuración ─────
    document.getElementById('btn-aplicar-iso')?.addEventListener('click', () => {
        const sel   = document.getElementById('cfg-iso-grupo');
        const opt   = sel?.options[sel.selectedIndex];
        if (!opt?.value) { toast('Selecciona un grupo ISO primero.', 'error'); return; }

        const A = parseFloat(opt.dataset.a);
        const B = parseFloat(opt.dataset.b);
        const C = parseFloat(opt.dataset.c);
        const puntos = getPuntosFromForm();

        if (!puntos.length) { toast('Agrega al menos un punto de medición primero.', 'error'); return; }

        // Aplicar a todos los puntos de vel: lcl=A, med=B, ulc=C
        document.querySelectorAll('#limites-vel-list [data-punto]').forEach(row => {
            row.querySelector('.lim-ulc').value = C;
            row.querySelector('.lim-med').value = B;
            row.querySelector('.lim-lcl').value = A;
        });

        toast(`✅ Límites ISO 10816 Grupo ${opt.value} aplicados (ULC=${C}, Med=${B}, LCL=${A} mm/s).`, 'success');
    });

    // ── Calcular alarmas por historial ─────────────────────────
    document.getElementById('btn-aplicar-stats')?.addEventListener('click', async () => {
        if (!currentEquipo) return;
        const metodo = document.getElementById('cfg-stats-metodo')?.value || 'stddev';
        const infoEl = document.getElementById('stats-info');

        if (infoEl) infoEl.textContent = 'Calculando...';
        try {
            const res = await apiFetch(`/api/condicion/alarmas-estadisticas/${currentEquipo.asset_id}?metodo=${metodo}&min_lecturas=5`);
            if (!res?.ok) { toast('Error al calcular alarmas.', 'error'); return; }
            const data = await res.json();

            if (!data.suficiente) {
                toast(`Se necesitan al menos 5 mediciones. Hay ${data.lecturas} actualmente.`, 'info');
                if (infoEl) infoEl.textContent = `${data.lecturas} mediciones — insuficiente (mínimo 5)`;
                return;
            }

            // Aplicar valores calculados al formulario
            let applied = 0;
            document.querySelectorAll('#limites-vel-list [data-punto]').forEach(row => {
                const p = row.dataset.punto;
                const lim = data.limites_vel?.[p];
                if (lim) {
                    if (lim.ulc != null) row.querySelector('.lim-ulc').value = lim.ulc;
                    if (lim.med != null) row.querySelector('.lim-med').value = lim.med;
                    if (lim.lcl != null) row.querySelector('.lim-lcl').value = lim.lcl;
                    applied++;
                }
            });

            const metodoLabel = metodo === 'stddev' ? 'Media±σ' : 'Percentiles';
            toast(`✅ Límites calculados por ${metodoLabel} (${data.lecturas} mediciones).`, 'success');
            if (infoEl) infoEl.textContent = `Calculado con ${data.lecturas} mediciones — ${data.nota}`;
        } catch { toast('Error de conexión.', 'error'); }
    });

    function openConfigModal() {
        if (!currentEquipo) return;
        const cfg = currentConfig || defaultConfig();

        const su = document.getElementById('cfg-system-unit');
        const ic = document.getElementById('cfg-iso-class');
        const fr = document.getElementById('cfg-frecuencia');
        const ug = document.getElementById('cfg-usar-globales');
        if (su) su.value   = cfg.system_unit   || 'mm/seg';
        if (ic) ic.value   = cfg.iso_class     || '';
        if (fr) fr.value   = cfg.frecuencia    || 'Mensual';
        if (ug) ug.checked = cfg.usar_globales !== false;

        renderPuntosList(cfg.puntos);
        renderLimitesConfig(cfg.puntos, cfg.limites_vel, cfg.limites_env, cfg.limites_crest);

        document.getElementById('modal-config').style.display = 'flex';
    }

    function renderPuntosList(puntos) {
        const list = document.getElementById('puntos-list');
        list.innerHTML = puntos.map((p, i) => `
            <div class="cond-punto-item" data-idx="${i}">
                <i class="fa-solid fa-grip-lines cond-punto-handle"></i>
                <input type="text" value="${p}" data-idx="${i}" placeholder="Ej: 1H — Motor DE">
                <button class="cond-punto-del" data-idx="${i}" title="Eliminar"><i class="fa-solid fa-times"></i></button>
            </div>`).join('');

        list.querySelectorAll('.cond-punto-del').forEach(btn => {
            btn.addEventListener('click', () => {
                const pts = getPuntosFromForm();
                pts.splice(parseInt(btn.dataset.idx), 1);
                renderPuntosList(pts);
                const cfg = currentConfig || defaultConfig();
                renderLimitesConfig(pts, cfg.limites_vel, cfg.limites_env, cfg.limites_crest);
            });
        });
    }

    document.getElementById('btn-add-punto').addEventListener('click', () => {
        const pts = getPuntosFromForm();
        pts.push(`P${pts.length + 1}`);
        renderPuntosList(pts);
        const cfg = currentConfig || defaultConfig();
        renderLimitesConfig(pts, cfg.limites_vel, cfg.limites_env, cfg.limites_crest);
    });

    function getPuntosFromForm() {
        return Array.from(document.querySelectorAll('#puntos-list input'))
            .map(i => i.value.trim()).filter(Boolean);
    }

    function renderLimitesConfig(puntos, limVel = {}, limEnv = {}, limCrest = {}) {
        const gl = globalesConfig || {};

        const makeLimRow = (p, obj, prefix, glObj) => {
            const hint = glObj ? ` placeholder="Global: ${glObj.ulc ?? '—'}"` : '';
            const hintM = glObj ? ` placeholder="Global: ${glObj.med ?? '—'}"` : '';
            const hintL = glObj ? ` placeholder="Global: ${glObj.lcl ?? '—'}"` : '';
            return `
            <div class="cond-limite-row" style="grid-template-columns: 80px 1fr 1fr 1fr;" data-punto="${p}" data-prefix="${prefix}">
                <span class="cond-limite-label">${p}</span>
                <div class="cond-config-field">
                    <label style="color:#b81414; font-size:0.75em;">ULC</label>
                    <input type="number" step="0.01" min="0" class="lim-ulc" value="${(obj[p]?.ulc ?? '')}"${hint}>
                </div>
                <div class="cond-config-field">
                    <label style="color:#ca8a04; font-size:0.75em;">Median</label>
                    <input type="number" step="0.01" min="0" class="lim-med" value="${(obj[p]?.med ?? '')}"${hintM}>
                </div>
                <div class="cond-config-field">
                    <label style="color:#16a34a; font-size:0.75em;">LCL</label>
                    <input type="number" step="0.01" min="0" class="lim-lcl" value="${(obj[p]?.lcl ?? '')}"${hintL}>
                </div>
            </div>`;
        };

        const noPoints = '<p style="color:var(--text-muted);font-size:.85em;">Define al menos un punto primero.</p>';
        document.getElementById('limites-vel-list').innerHTML   = puntos.length ? puntos.map(p => makeLimRow(p, limVel,   'vel',   gl.limites_vel)).join('') : noPoints;
        document.getElementById('limites-env-list').innerHTML   = puntos.length ? puntos.map(p => makeLimRow(p, limEnv,   'env',   gl.limites_env)).join('') : noPoints;
        document.getElementById('limites-crest-list').innerHTML = puntos.length ? puntos.map(p => makeLimRow(p, limCrest, 'crest', gl.limites_crest)).join('') : noPoints;
    }

    function getLimitesFromForm(containerId) {
        const obj = {};
        document.querySelectorAll(`#${containerId} [data-punto]`).forEach(row => {
            const p   = row.dataset.punto;
            const ulc = parseFloat(row.querySelector('.lim-ulc')?.value);
            const med = parseFloat(row.querySelector('.lim-med')?.value);
            const lcl = parseFloat(row.querySelector('.lim-lcl')?.value);
            obj[p] = { ulc: isNaN(ulc)?null:ulc, med: isNaN(med)?null:med, lcl: isNaN(lcl)?null:lcl };
        });
        return obj;
    }

    document.getElementById('save-config').addEventListener('click', async () => {
        if (!currentEquipo) return;
        const puntos      = getPuntosFromForm();
        const limVel      = getLimitesFromForm('limites-vel-list');
        const limEnv      = getLimitesFromForm('limites-env-list');
        const limCrest    = getLimitesFromForm('limites-crest-list');
        const systemUnit  = document.getElementById('cfg-system-unit')?.value || 'mm/seg';
        const isoClass    = document.getElementById('cfg-iso-class')?.value   || '';
        const frecuencia  = document.getElementById('cfg-frecuencia')?.value  || 'Mensual';
        const usarGlobal  = document.getElementById('cfg-usar-globales')?.checked !== false;

        try {
            const res = await apiFetch('/api/condicion/config', {
                method: 'POST',
                body: JSON.stringify({
                    asset_id: currentEquipo.asset_id,
                    puntos, limites_vel: limVel, limites_env: limEnv, limites_crest: limCrest,
                    iso_class: isoClass, system_unit: systemUnit, frecuencia, usar_globales: usarGlobal
                })
            });
            if (res?.ok) {
                currentConfig = { puntos, limites_vel: limVel, limites_env: limEnv, limites_crest: limCrest,
                    iso_class: isoClass, system_unit: systemUnit, frecuencia, usar_globales: usarGlobal };
                fillFicha(currentEquipo);
                renderTabla();
                document.getElementById('modal-config').style.display = 'none';
                toast('✅ Configuración guardada.', 'success');
            } else {
                toast('❌ Error al guardar configuración.', 'error');
            }
        } catch { toast('❌ Error de conexión.', 'error'); }
    });

    ['close-config','cancel-config'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => { document.getElementById('modal-config').style.display = 'none'; });
    });
    document.getElementById('modal-config')?.addEventListener('click', e => {
        if (e.target === document.getElementById('modal-config')) document.getElementById('modal-config').style.display = 'none';
    });

    // ════════════════════════════════════════════════════════════
    // 5. LECTURAS
    // ════════════════════════════════════════════════════════════
    async function loadLecturas(assetId) {
        try {
            const res = await apiFetch(`/api/condicion/lecturas/${assetId}`);
            if (res?.ok) {
                const rows = await res.json();
                currentLecturas = rows.map(r => ({
                    ...r,
                    valores_vel:   safeJSON(r.valores_vel,   {}),
                    valores_env:   safeJSON(r.valores_env,   {}),
                    valores_temp:  safeJSON(r.valores_temp,  {}),
                }));
            } else { currentLecturas = []; }
        } catch { currentLecturas = []; }
    }

    document.getElementById('btn-add-lectura').addEventListener('click', () => openLecturaModal(null));

    function openLecturaModal(lecturaId) {
        editingLecturaId = lecturaId;
        const isEdit = lecturaId !== null;

        document.getElementById('modal-lectura-title').innerHTML = isEdit
            ? '<i class="fa-solid fa-pencil"></i> Editar Lectura'
            : '<i class="fa-solid fa-plus"></i> Nueva Lectura';

        const fechaEl = document.getElementById('lec-fecha');
        const lectura = isEdit ? currentLecturas.find(l => l.id === lecturaId) : null;
        if (fechaEl) fechaEl.value = lectura?.fecha_medicion || new Date().toISOString().split('T')[0];

        const notasEl = document.getElementById('lec-notas');
        if (notasEl) notasEl.value = lectura?.notas || '';

        renderLecturaFields(lectura);
        document.getElementById('modal-lectura').style.display = 'flex';
    }

    function renderLecturaFields(lectura = null) {
        const wrap   = document.getElementById('lec-campos-wrap');
        const puntos = currentConfig?.puntos || ['1H', '2H', '3H', '4H'];
        const unidad = currentConfig?.system_unit || 'mm/seg';

        // valores_temp se reutiliza para Factor de Cresta (campo almacenado como "temp" por compatibilidad)
        wrap.innerHTML = puntos.map(p => {
            const velVal   = lectura?.valores_vel?.[p]  ?? '';
            const envVal   = lectura?.valores_env?.[p]  ?? '';
            const crestVal = lectura?.valores_temp?.[p] ?? '';
            return `<div class="lec-punto-section">
                <div class="lec-punto-title"><i class="fa-solid fa-crosshairs"></i> Punto: ${p}</div>
                <div class="lec-campos-grid">
                    <div class="cond-config-field">
                        <label>Vel. Overall (${unidad})</label>
                        <input type="number" step="0.01"  min="0" class="lec-input-vel"   data-punto="${p}" value="${velVal}"   placeholder="0.00">
                    </div>
                    <div class="cond-config-field">
                        <label>Env/Demod (G's rms)</label>
                        <input type="number" step="0.001" min="0" class="lec-input-env"   data-punto="${p}" value="${envVal}"   placeholder="0.000">
                    </div>
                    <div class="cond-config-field">
                        <label>Factor de Cresta</label>
                        <input type="number" step="0.1"   min="0" class="lec-input-crest" data-punto="${p}" value="${crestVal}" placeholder="0.0">
                    </div>
                    <div class="cond-config-field" style="grid-column:1/-1;">
                        <label>Nota para este punto</label>
                        <input type="text" class="lec-input-nota" data-punto="${p}" value="${lectura?.valores_vel?.[p+'_nota'] || ''}" placeholder="Ej: Ruido metálico, vibración periódica...">
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    document.getElementById('save-lectura').addEventListener('click', async () => {
        if (!currentEquipo) return;
        const fecha = document.getElementById('lec-fecha')?.value;
        if (!fecha) { toast('Selecciona la fecha de medición.', 'error'); return; }

        const puntos = currentConfig?.puntos || ['1H', '2H', '3H', '4H'];
        const valoresVel = {}, valoresEnv = {}, valoresCrest = {};

        puntos.forEach(p => {
            const vel   = document.querySelector(`.lec-input-vel[data-punto="${p}"]`)?.value;
            const env   = document.querySelector(`.lec-input-env[data-punto="${p}"]`)?.value;
            const crest = document.querySelector(`.lec-input-crest[data-punto="${p}"]`)?.value;
            const nota  = document.querySelector(`.lec-input-nota[data-punto="${p}"]`)?.value?.trim();
            if (vel   !== '' && vel   != null) valoresVel[p]   = parseFloat(vel) || null;
            if (env   !== '' && env   != null) valoresEnv[p]   = parseFloat(env) || null;
            if (crest !== '' && crest != null) valoresCrest[p] = parseFloat(crest) || null;
            if (nota) valoresVel[p + '_nota'] = nota; // guardar nota embebida en valores_vel
        });

        const payload = {
            asset_id:       currentEquipo.asset_id,
            fecha_medicion: fecha,
            valores_vel:    valoresVel,
            valores_env:    valoresEnv,
            valores_temp:   valoresCrest,   // reutilizamos campo temp para cresta
            notas:          document.getElementById('lec-notas')?.value || null,
        };

        try {
            // Validación estadística antes de guardar
            const valRes = await apiFetch('/api/condicion/validar-lectura', { method: 'POST', body: JSON.stringify({
                asset_id: currentEquipo.asset_id,
                valores_vel: payload.valores_vel,
                valores_env: payload.valores_env,
                valores_temp: payload.valores_temp,
            })});
            if (valRes?.ok) {
                const { advertencias } = await valRes.json();
                if (advertencias?.length) {
                    const msgs = advertencias.map(a => `• ${a.mensaje}`).join('\n');
                    if (!confirm(`⚠️ Valores estadísticamente inusuales detectados:\n\n${msgs}\n\n¿Confirmar y guardar de todas formas?`)) return;
                }
            }

            const res = editingLecturaId !== null
                ? await apiFetch(`/api/condicion/lecturas/${editingLecturaId}`, { method:'PUT',  body: JSON.stringify(payload) })
                : await apiFetch('/api/condicion/lecturas',                      { method:'POST', body: JSON.stringify(payload) });

            if (res?.ok) {
                toast(editingLecturaId !== null ? '✅ Lectura actualizada.' : '✅ Lectura guardada.', 'success');
                document.getElementById('modal-lectura').style.display = 'none';
                await loadLecturas(currentEquipo.asset_id);
                renderTabla();
                await loadEquipos();
            } else {
                const err = await res?.json().catch(() => ({}));
                toast('❌ Error: ' + (err?.error || 'No se pudo guardar.'), 'error');
            }
        } catch { toast('❌ Error de conexión.', 'error'); }
    });

    ['close-lectura','cancel-lectura'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => { document.getElementById('modal-lectura').style.display = 'none'; });
    });
    document.getElementById('modal-lectura')?.addEventListener('click', e => {
        if (e.target === document.getElementById('modal-lectura')) document.getElementById('modal-lectura').style.display = 'none';
    });

    // ── Eliminar lectura ───────────────────────────────────────
    ['close-delete','cancel-delete'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => { document.getElementById('modal-delete').style.display = 'none'; });
    });
    document.getElementById('confirm-delete').addEventListener('click', async () => {
        if (!deletingLecturaId) return;
        try {
            const res = await apiFetch(`/api/condicion/lecturas/${deletingLecturaId}`, { method: 'DELETE' });
            if (res?.ok) {
                toast('Lectura eliminada.', 'info');
                document.getElementById('modal-delete').style.display = 'none';
                deletingLecturaId = null;
                await loadLecturas(currentEquipo.asset_id);
                renderTabla();
                await loadEquipos();
            } else { toast('❌ Error al eliminar.', 'error'); }
        } catch { toast('❌ Error de conexión.', 'error'); }
    });

    // ════════════════════════════════════════════════════════════
    // 6. RENDERIZAR TABLA DE TENDENCIAS
    // ════════════════════════════════════════════════════════════
    function renderTabla() {
        if (!currentEquipo || !currentConfig) return;

        const puntos   = currentConfig.puntos  || ['1H', '2H', '3H', '4H'];
        const limVelEq  = currentConfig.limites_vel   || {};
        const limEnvEq  = currentConfig.limites_env   || {};
        const limCrEq   = currentConfig.limites_crest || {};
        const usarGlob  = currentConfig.usar_globales !== false;
        const unidad    = currentConfig.system_unit || 'mm/seg';
        const lecturas  = currentLecturas;
        const gl        = globalesConfig || {};

        const total    = lecturas.length;
        const visible  = rowsLimit > 0 ? lecturas.slice(-rowsLimit) : lecturas; // más recientes al final
        const countEl  = document.getElementById('lecturas-count');
        if (countEl) {
            countEl.textContent = rowsLimit > 0 && total > rowsLimit
                ? `Mostrando ${visible.length} de ${total} mediciones`
                : `${total} medición${total !== 1 ? 'es' : ''} registrada${total !== 1 ? 's' : ''}`;
        }

        // Conteo en sidebar
        const sidebarCount = document.getElementById('sidebar-equipo-count');
        if (sidebarCount) sidebarCount.textContent = `${total} medición${total !== 1 ? 'es' : ''}`;

        const emptyRows   = document.getElementById('empty-rows');
        const tablaScroll = document.getElementById('tabla-scroll');

        if (!lecturas.length) {
            if (emptyRows)    emptyRows.style.display = 'flex';
            if (tablaScroll)  tablaScroll.style.display = 'none';
            return;
        }
        if (emptyRows)    emptyRows.style.display = 'none';
        if (tablaScroll)  tablaScroll.style.display = '';

        const thead = document.getElementById('cond-thead');
        const tbody = document.getElementById('cond-tbody');

        // ── Encabezado ─────────────────────────────────────────
        const thVel   = puntos.map(p =>
            `<th><div class="cond-th-inner"><span>Vel. Overall</span><span class="cond-th-group">${unidad} — ${p}</span></div></th>`
        ).join('');
        const thEnv   = showEnv   ? puntos.map(p =>
            `<th><div class="cond-th-inner"><span>Env / Demod</span><span class="cond-th-group">G's rms — ${p}</span></div></th>`
        ).join('') : '';
        const thCrest = showCrest ? puntos.map(p =>
            `<th><div class="cond-th-inner"><span>Fc Cresta</span><span class="cond-th-group">Pico/RMS — ${p}</span></div></th>`
        ).join('') : '';

        thead.innerHTML = `<tr>
            <th style="text-align:left;min-width:130px;"><div class="cond-th-inner" style="align-items:flex-start;">Fecha</div></th>
            ${thVel}${thEnv}${thCrest}
            <th style="min-width:80px;"><div class="cond-th-inner">Acciones</div></th>
        </tr>`;

        // ── Filas de límites ────────────────────────────────────
        const totalDataCols = puntos.length * (1 + (showEnv?1:0) + (showCrest?1:0));

        const makeLimitRow = (label, key, cls) => {
            const velCells   = puntos.map(p => {
                const lim = resolveLim(limVelEq, gl.limites_vel, p, usarGlob);
                return `<td>${lim[key] != null ? lim[key] : '—'}</td>`;
            }).join('');
            const envCells   = showEnv   ? puntos.map(p => {
                const lim = resolveLim(limEnvEq, gl.limites_env, p, usarGlob);
                return `<td>${lim[key] != null ? lim[key] : '—'}</td>`;
            }).join('') : '';
            const crestCells = showCrest ? puntos.map(p => {
                const lim = resolveLim(limCrEq, gl.limites_crest, p, usarGlob);
                return `<td>${lim[key] != null ? lim[key] : '—'}</td>`;
            }).join('') : '';
            return `<tr class="limit-row ${cls}">
                <td class="limit-label-cell">${label}</td>
                ${velCells}${envCells}${crestCells}<td></td>
            </tr>`;
        };

        const sepCols = '<td></td>'.repeat(2 + totalDataCols);
        const limitRows = [
            makeLimitRow('ULC',    'ulc', 'limit-row-ulc'),
            makeLimitRow('Median', 'med', 'limit-row-med'),
            makeLimitRow('LCL',    'lcl', 'limit-row-lcl'),
            `<tr class="limit-row limit-row-sep">${sepCols}</tr>`,
        ].join('');

        // ── Filas de datos ──────────────────────────────────────
        const dataRows = visible.map(lec => {
            const fecha = formatFecha(lec.fecha_medicion);

            const velCells   = puntos.map(p => {
                const v   = lec.valores_vel?.[p];
                const lim = resolveLim(limVelEq, gl.limites_vel, p, usarGlob);
                return `<td><span class="cond-val-cell ${colorClass(v, lim)}">${v != null ? v : '—'}</span></td>`;
            }).join('');

            const envCells   = showEnv   ? puntos.map(p => {
                const v   = lec.valores_env?.[p];
                const lim = resolveLim(limEnvEq, gl.limites_env, p, usarGlob);
                return `<td><span class="cond-val-cell ${colorClass(v, lim)}">${v != null ? v : '—'}</span></td>`;
            }).join('') : '';

            const crestCells = showCrest ? puntos.map(p => {
                const v   = lec.valores_temp?.[p];  // cresta guardado en temp
                const lim = resolveLim(limCrEq, gl.limites_crest, p, usarGlob);
                return `<td><span class="cond-val-cell ${colorClass(v, lim)}">${v != null ? v : '—'}</span></td>`;
            }).join('') : '';

            return `<tr class="data-row" data-id="${lec.id}">
                <td class="cond-fecha-cell">
                    ${fecha}
                    ${lec.notas ? `<i class="fa-solid fa-comment-dots" style="color:var(--primary);margin-left:4px;font-size:.8em;" title="${lec.notas}"></i>` : ''}
                </td>
                ${velCells}${envCells}${crestCells}
                <td>
                    <div class="cond-row-actions">
                        <button class="cond-row-btn cond-row-btn-edit btn-edit-lec" data-id="${lec.id}"><i class="fa-solid fa-pencil"></i></button>
                        <button class="cond-row-btn cond-row-btn-del  btn-del-lec"  data-id="${lec.id}"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        tbody.innerHTML = limitRows + dataRows;

        tbody.querySelectorAll('.btn-edit-lec').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); openLecturaModal(parseInt(btn.dataset.id)); });
        });
        tbody.querySelectorAll('.btn-del-lec').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                deletingLecturaId = parseInt(btn.dataset.id);
                document.getElementById('modal-delete').style.display = 'flex';
            });
        });
    }

    // ── Toggles ────────────────────────────────────────────────
    document.getElementById('toggle-env')?.addEventListener('change',   e => { showEnv   = e.target.checked; renderTabla(); });
    document.getElementById('toggle-crest')?.addEventListener('change', e => { showCrest = e.target.checked; renderTabla(); });
    document.getElementById('rows-limit')?.addEventListener('change',   e => { rowsLimit = parseInt(e.target.value) || 0; renderTabla(); });

    // ════════════════════════════════════════════════════════════
    // 7. EXPORTAR CSV
    // ════════════════════════════════════════════════════════════
    document.getElementById('btn-export-csv')?.addEventListener('click', () => exportarExcel());

    async function exportarExcel() {
        if (!currentEquipo || !currentLecturas.length) { toast('No hay datos para exportar.', 'info'); return; }
        const puntos = currentConfig?.puntos || [];
        const unidad = currentConfig?.system_unit || 'mm/seg';
        const limVel = currentConfig?.limites_vel || {};
        const eq     = currentEquipo;

        // Cargar SheetJS dinámicamente si no está disponible
        if (typeof XLSX === 'undefined') {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
                s.onload = resolve; s.onerror = reject;
                document.head.appendChild(s);
            });
        }

        const wb = XLSX.utils.book_new();

        // ── Hoja 1: Historial de mediciones ──
        const COLOR_B = 'C6EFCE', COLOR_A = 'FFFF00', COLOR_C = 'FFC7CE', COLOR_H = '2563EB';

        const wsData = [];
        // Título
        wsData.push([`Historial de Vibraciones — ${eq.asset_id} — ${eq.descripcion || ''}`]);
        wsData.push([`Exportado: ${new Date().toLocaleDateString('es-CR')}   |   Sistema: ${unidad}`]);
        wsData.push([]);

        // Encabezados
        const hdrs = ['Fecha'];
        puntos.forEach(p => hdrs.push(`Vel ${p} (${unidad})`));
        puntos.forEach(p => hdrs.push(`Env ${p} (G's)`));
        puntos.forEach(p => hdrs.push(`Fc ${p}`));
        puntos.forEach(p => hdrs.push(`Nota ${p}`));
        hdrs.push('Notas generales');
        wsData.push(hdrs);

        // Filas de datos
        const dataRows = [...currentLecturas].sort((a,b) => a.fecha_medicion > b.fecha_medicion ? 1 : -1);
        dataRows.forEach(lec => {
            const row = [String(lec.fecha_medicion).split('T')[0]];
            puntos.forEach(p => row.push(lec.valores_vel?.[p] ?? ''));
            puntos.forEach(p => row.push(lec.valores_env?.[p] ?? ''));
            puntos.forEach(p => row.push(lec.valores_temp?.[p] ?? ''));
            puntos.forEach(p => row.push(lec.valores_vel?.[p + '_nota'] || ''));
            row.push(lec.notas || '');
            wsData.push(row);
        });

        const ws1 = XLSX.utils.aoa_to_sheet(wsData);

        // Colores en celdas de velocidad según límites
        if (!ws1['!merges']) ws1['!merges'] = [];
        ws1['!merges'].push({ s:{r:0,c:0}, e:{r:0,c:hdrs.length-1} });

        // Colorear celdas de datos (fila 4 en adelante = índice 3)
        dataRows.forEach((lec, ri) => {
            puntos.forEach((p, pi) => {
                const v   = lec.valores_vel?.[p];
                const lim = limVel[p];
                if (v == null || !lim) return;
                const colIdx = 1 + pi; // columna de velocidad
                const cell   = XLSX.utils.encode_cell({ r: 3 + ri, c: colIdx });
                if (!ws1[cell]) return;
                let fill = null;
                if (lim.ulc != null && v >= lim.ulc)        fill = COLOR_C;
                else if (lim.med != null && v >= lim.med)   fill = COLOR_A;
                else if (v > 0)                              fill = COLOR_B;
                if (fill) ws1[cell].s = { fill: { fgColor: { rgb: fill } }, font: { bold: v >= (lim.ulc || 999) } };
            });
        });

        // Ancho de columnas
        ws1['!cols'] = [{ wch: 12 }, ...puntos.flatMap(() => [{ wch:10},{wch:10},{wch:10},{wch:20}]), { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, ws1, 'Historial');

        // ── Hoja 2: Configuración y límites ──
        const ws2Data = [
            [`Configuración — ${eq.asset_id}`], [],
            ['Equipo', eq.asset_id], ['Descripción', eq.descripcion || ''],
            ['Ubicación', eq.ubicacion || ''], ['Marca', eq.marca || ''],
            ['Modelo', eq.modelo || ''], ['Potencia', eq.potencia_hp ? eq.potencia_hp + ' HP' : ''],
            ['RPM', eq.rpm || ''], ['Sistema de unidades', unidad],
            ['Clase ISO', currentConfig?.iso_class || ''],
            ['Frecuencia inspección', currentConfig?.frecuencia || ''], [],
            ['LÍMITES POR PUNTO'], ['Punto', 'ULC (Alarma)', 'Median (Alerta)', 'LCL'],
        ];
        puntos.forEach(p => {
            const l = limVel[p] || {};
            ws2Data.push([p, l.ulc ?? '—', l.med ?? '—', l.lcl ?? '—']);
        });
        const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
        ws2['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Configuración');

        // ── Hoja 3: Estadísticas ──
        const ws3Data = [['Estadísticas — Velocidad Overall'], [], ['Punto', 'Mínimo', 'Máximo', 'Promedio', 'Última lectura', 'N lecturas']];
        puntos.forEach(p => {
            const vals = dataRows.map(l => l.valores_vel?.[p]).filter(v => v != null).map(Number).filter(v => !isNaN(v));
            if (!vals.length) return;
            const mn   = Math.min(...vals), mx = Math.max(...vals);
            const prom = vals.reduce((a,v) => a+v, 0) / vals.length;
            ws3Data.push([p, +mn.toFixed(3), +mx.toFixed(3), +prom.toFixed(3), vals[vals.length-1], vals.length]);
        });
        const ws3 = XLSX.utils.aoa_to_sheet(ws3Data);
        ws3['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, ws3, 'Estadísticas');

        // Guardar
        XLSX.writeFile(wb, `PdM_${eq.asset_id}_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast(`✅ Excel exportado (${currentLecturas.length} mediciones, 3 hojas).`, 'success');
    }

    // ════════════════════════════════════════════════════════════
    // 8. GRÁFICO DE TENDENCIA (Chart.js)
    // ════════════════════════════════════════════════════════════

    async function loadAndRenderChart() {
        if (!currentEquipo || !currentLecturas.length) return;

        // Cargar Chart.js dinámicamente
        if (typeof Chart === 'undefined') {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
                s.onload = resolve; s.onerror = reject;
                document.head.appendChild(s);
            });
        }

        const puntos = currentConfig?.puntos || [];
        const unidad = currentConfig?.system_unit || 'mm/seg';
        const limVel = currentConfig?.limites_vel || {};
        const gl     = globalesConfig || {};
        const usar   = currentConfig?.usar_globales !== false;

        // Ordenar lecturas cronológicamente
        const lectOrd = [...currentLecturas]
            .filter(l => l.valores_vel && Object.values(l.valores_vel).some(v => typeof v === 'number'))
            .sort((a, b) => a.fecha_medicion > b.fecha_medicion ? 1 : -1);

        if (!lectOrd.length) return;

        const labels = lectOrd.map(l => {
            const s = String(l.fecha_medicion).split('T')[0];
            const [y,m,d] = s.split('-');
            const M = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
            return `${d}-${M[+m-1]}-${String(y).slice(-2)}`;
        });

        const COLORS = ['#2563eb','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2'];

        const datasets = puntos.map((p, i) => ({
            label: `Vel. ${p} (${unidad})`,
            data: lectOrd.map(l => l.valores_vel?.[p] ?? null),
            borderColor: COLORS[i % COLORS.length],
            backgroundColor: COLORS[i % COLORS.length] + '22',
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 6,
            tension: 0.3,
            spanGaps: true,
        }));

        // Líneas de límites (primeras que tengamos definidas para cualquier punto)
        const anotaciones = [];
        for (const p of puntos) {
            const lim = resolveLim(limVel, gl.limites_vel, p, usar);
            if (lim.ulc != null) {
                anotaciones.push({ value: lim.ulc, color: '#dc2626', label: `ULC (${lim.ulc})` });
                break;
            }
        }
        for (const p of puntos) {
            const lim = resolveLim(limVel, gl.limites_vel, p, usar);
            if (lim.med != null) {
                anotaciones.push({ value: lim.med, color: '#f59e0b', label: `Median (${lim.med})` });
                break;
            }
        }

        // Agregar líneas de referencia como datasets punteados
        anotaciones.forEach(an => {
            datasets.push({
                label: an.label,
                data: labels.map(() => an.value),
                borderColor: an.color,
                borderWidth: 1.5,
                borderDash: [6, 4],
                pointRadius: 0,
                fill: false,
                tension: 0,
            });
        });

        // Cargar tendencia del servidor
        let tendInfo = '';
        try {
            const tr = await apiFetch(`/api/condicion/tendencia/${currentEquipo.asset_id}`);
            if (tr?.ok) {
                tendenciaData = await tr.json();
                const puntosTend = tendenciaData.puntos || {};
                const partes = [];
                puntos.forEach(p => {
                    const t = puntosTend[p];
                    if (!t?.suficiente) return;
                    const iconos = { estable: '→', creciente: '↗', creciente_rapido: '⚠ ↑↑', descendente: '↘' };
                    const signo  = t.slope_mes >= 0 ? '+' : '';
                    let msg = `${p}: ${iconos[t.clasificacion]} ${signo}${t.slope_mes} ${unidad}/mes`;
                    if (t.dias_al_ulc != null) msg += ` · ⏱ cruza ULC en ~${t.dias_al_ulc}d`;
                    partes.push(msg);
                });
                if (partes.length) tendInfo = partes.join('  |  ');
            }
        } catch {}

        // Renderizar
        const container = document.getElementById('chart-container');
        if (!container) return;
        container.style.display = '';

        const tendBanner = document.getElementById('chart-trend-banner');
        if (tendBanner) {
            tendBanner.textContent = tendInfo;
            tendBanner.style.display = tendInfo ? '' : 'none';
        }

        // Destruir chart previo
        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

        const canvas = document.getElementById('tendencia-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                    tooltip: {
                        callbacks: {
                            afterBody: (items) => {
                                const lec = lectOrd[items[0]?.dataIndex];
                                const notas = puntos.map(p => lec?.valores_vel?.[p+'_nota']).filter(Boolean);
                                return notas.length ? ['', ...notas.map(n => `📝 ${n}`)] : [];
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { maxTicksLimit: 12, font: { size: 10 } } },
                    y: { beginAtZero: true, title: { display: true, text: unidad, font: { size: 11 } } }
                }
            }
        });
    }

    // ════════════════════════════════════════════════════════════
    // 9. GAP DE INSPECCIÓN
    // ════════════════════════════════════════════════════════════

    async function loadGapAlert() {
        if (!currentEquipo) return;
        try {
            const res = await apiFetch(`/api/condicion/gap/${currentEquipo.asset_id}`);
            if (!res?.ok) return;
            gapData = await res.json();
            renderGapBanner(gapData.vibraciones);
        } catch {}
    }

    function renderGapBanner(gap) {
        const banner = document.getElementById('gap-banner');
        if (!banner) return;
        if (!gap || gap.nivel === 'ok') { banner.style.display = 'none'; return; }
        const iconos = { atrasado: '⚠', critico: '🚨' };
        const colores = { atrasado: 'var(--warning-bg,#fef3c7)', critico: '#fee2e2' };
        const textColor = { atrasado: '#92400e', critico: '#991b1b' };
        banner.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:8px;
            margin-bottom:10px;font-size:.84em;font-weight:600;
            background:${colores[gap.nivel]};color:${textColor[gap.nivel]};`;
        banner.innerHTML = `<span>${iconos[gap.nivel]}</span>
            <span>${gap.dias} días sin medición de vibraciones
            (frecuencia configurada: ${gapData.frecuencia || 'Mensual'})
            — Última: ${gap.ultima || 'nunca'}</span>`;
    }

    // ════════════════════════════════════════════════════════════
    // 10. COMPARACIÓN ENTRE SIMILARES
    // ════════════════════════════════════════════════════════════

    async function loadSimilares() {
        const wrap = document.getElementById('similares-wrap');
        if (!wrap || !currentEquipo) return;
        try {
            const res = await apiFetch(`/api/condicion/similares/${currentEquipo.asset_id}`);
            if (!res?.ok) { wrap.style.display = 'none'; return; }
            const data = await res.json();
            if (data.length < 2) { wrap.style.display = 'none'; return; }

            const puntos = currentConfig?.puntos || [];
            const unidad = currentConfig?.system_unit || 'mm/seg';

            // Calcular promedio general por equipo para colorear outliers
            const promedios = data.map(e => e.prom_vel).filter(v => v != null);
            const mediaFlota = promedios.length ? promedios.reduce((a,v) => a+v, 0) / promedios.length : 0;

            wrap.style.display = '';
            wrap.innerHTML = `<div class="cond-section-title" style="margin-bottom:8px;">
                <i class="fa-solid fa-scale-balanced"></i> Comparación con equipos similares
                (${currentEquipo.tipo_sistema || 'mismo tipo'}${currentEquipo.potencia_hp ? ', ' + currentEquipo.potencia_hp + ' HP' : ''})
            </div>
            <div class="similares-table-wrap">
            <table class="cond-table">
                <thead><tr>
                    <th>Equipo</th><th>Ubicación</th><th>HP</th>
                    ${puntos.map(p => `<th>Vel. ${p}</th>`).join('')}
                    <th>Prom.</th><th>Estado</th><th>Última</th>
                </tr></thead>
                <tbody>${data.map(e => {
                    const diff = e.prom_vel != null ? Math.abs(e.prom_vel - mediaFlota) / (mediaFlota || 1) : 0;
                    const esOutlier = diff > 0.4; // >40% de la media de flota
                    const rowStyle = e.es_actual ? 'font-weight:700;background:var(--primary-light);' : '';
                    const marker = e.es_actual ? ' ◀ este equipo' : '';
                    return `<tr style="${rowStyle}">
                        <td>${e.asset_id}${marker}</td>
                        <td style="font-size:.82em;color:var(--text-muted);">${(e.ubicacion||'').split('/')[0].trim()}</td>
                        <td>${e.potencia_hp || '—'}</td>
                        ${puntos.map(p => {
                            const v = e.valores?.[p];
                            return `<td>${v != null ? v : '—'}</td>`;
                        }).join('')}
                        <td style="${esOutlier ? 'color:#dc2626;font-weight:700;' : ''}">${e.prom_vel ?? '—'}${esOutlier ? ' ⚠' : ''}</td>
                        <td>${e.estado ? `<span class="sev-badge-table sev-${e.estado.toLowerCase()}">${{B:'Bueno',A:'Alerta',C:'Alarma'}[e.estado]||e.estado}</span>` : '—'}</td>
                        <td style="font-size:.82em;">${e.ultima_lectura || '—'}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table></div>`;
        } catch { wrap && (wrap.style.display = 'none'); }
    }

    // ════════════════════════════════════════════════════════════
    // 11. UTILIDADES
    // ════════════════════════════════════════════════════════════
    function safeJSON(v, def) {
        if (typeof v === 'object' && v !== null) return v;
        try { return JSON.parse(v); } catch { return def; }
    }

    function resolveLim(limEquipo, limGlobal, punto, usar_globales) {
        const eq = limEquipo?.[punto] || {};
        const gl = limGlobal || {};
        return {
            ulc: eq.ulc != null ? eq.ulc : (usar_globales && gl.ulc != null ? gl.ulc : null),
            med: eq.med != null ? eq.med : (usar_globales && gl.med != null ? gl.med : null),
            lcl: eq.lcl != null ? eq.lcl : (usar_globales && gl.lcl != null ? gl.lcl : null),
        };
    }

    function colorClass(valor, limites) {
        if (valor == null) return 'val-empty';
        if (!limites)      return 'val-ok';
        const { ulc, med } = limites;
        if (ulc != null && valor >= ulc) return 'val-ulc';
        if (med != null && valor >= med) return 'val-med';
        return 'val-ok';
    }

    function formatFecha(fechaStr) {
        if (!fechaStr) return '—';
        // PostgreSQL DATE devuelve "2024-03-15T00:00:00.000Z" — extraer solo la parte YYYY-MM-DD
        const ymd = String(fechaStr).split('T')[0].trim();
        const parts = ymd.split('-');
        if (parts.length !== 3) return ymd; // fallback: mostrar crudo
        const [y, mo, d] = parts.map(Number);
        const m = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][mo - 1] || '?';
        return `${String(d).padStart(2,'0')}-${m}-${String(y).slice(-2)}`;
    }

    // ════════════════════════════════════════════════════════════
    // 9. INIT
    // ════════════════════════════════════════════════════════════
    Promise.all([loadEquipos(), loadGlobales(), loadISOGrupos()]);

    // ════════════════════════════════════════════════════════════
    // 10. TAB SWITCHING — Vibraciones / Termografía / Ultrasonido
    // ════════════════════════════════════════════════════════════
    let termoInitialized = false;
    let ultraInitialized  = false;

    document.querySelectorAll('.cond-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            // Update active state on ALL tab buttons (both sidebars)
            document.querySelectorAll('.cond-tab').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === tab);
            });

            if (tab === 'vibraciones') {
                // Show vibraciones sidebar + main
                sidebar.style.display            = 'flex';
                const termoSidebar = document.getElementById('termo-sidebar');
                if (termoSidebar) termoSidebar.style.display = 'none';
                const ultraSidebar0 = document.getElementById('ultra-sidebar');
                if (ultraSidebar0) ultraSidebar0.style.display = 'none';
                const mainPanel = document.getElementById('main-panel');
                if (mainPanel) mainPanel.style.display = 'flex';
                const termoMain = document.getElementById('termo-main-panel');
                if (termoMain) termoMain.style.display = 'none';
                const ultraMain0 = document.getElementById('ultra-main-panel');
                if (ultraMain0) ultraMain0.style.display = 'none';

            } else if (tab === 'termografia') {
                // Show termografia sidebar + main
                sidebar.style.display            = 'none';
                const termoSidebar = document.getElementById('termo-sidebar');
                if (termoSidebar) termoSidebar.style.display = 'flex';
                const mainPanel = document.getElementById('main-panel');
                if (mainPanel) mainPanel.style.display = 'none';
                const termoMain = document.getElementById('termo-main-panel');
                if (termoMain) termoMain.style.display = 'flex';
                const ultraSidebar = document.getElementById('ultra-sidebar');
                if (ultraSidebar) ultraSidebar.style.display = 'none';
                const ultraMain = document.getElementById('ultra-main-panel');
                if (ultraMain) ultraMain.style.display = 'none';

                // Initialize thermography module once
                if (!termoInitialized && window.termoCondicionInit) {
                    termoInitialized = true;
                    window.termoCondicionInit();
                }

            } else if (tab === 'ultrasonido') {
                // Show ultrasonido sidebar + main
                sidebar.style.display = 'none';
                const termoSidebar2 = document.getElementById('termo-sidebar');
                if (termoSidebar2) termoSidebar2.style.display = 'none';
                const mainPanel2 = document.getElementById('main-panel');
                if (mainPanel2) mainPanel2.style.display = 'none';
                const termoMain2 = document.getElementById('termo-main-panel');
                if (termoMain2) termoMain2.style.display = 'none';
                const ultraSidebar = document.getElementById('ultra-sidebar');
                if (ultraSidebar) ultraSidebar.style.display = 'flex';
                const ultraMain = document.getElementById('ultra-main-panel');
                if (ultraMain) ultraMain.style.display = 'flex';

                if (!ultraInitialized && window.ultraCondicionInit) {
                    ultraInitialized = true;
                    window.ultraCondicionInit();
                }
            }
        });
    });
});
