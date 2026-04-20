// ultra_condicion.js — Módulo de Tendencias de Ultrasonido
// Suite PdM | Edwards

(function () {
    'use strict';

    const toast    = (m, t = 'info') => window.PdM?.showToast(m, t) || console.log(m);
    const apiFetch = (...a) => window.PdM?.apiFetch(...a);

    // ── Estado global ──────────────────────────────────────────
    let allEquipos    = [];
    let currentEquipo = null;
    let componentes   = [];
    let lecturas      = [];
    let editingCompId = null;
    let editingLecId  = null;

    const ORDEN_SEV = { C: 3, A: 2, B: 1 };

    // ── Tipos de defecto (del estándar y reporte de ultrasonido) ──
    const TIPOS_DEFECTO = [
        { id: 'Rodamiento',                label: 'Rodamiento',                        icon: 'fa-circle-nodes',    hint: 'Fatiga, fallas incipientes en pistas o elementos rodantes. ΔdB +8 = Alerta, +16 = Alarma (ISO 29821).' },
        { id: 'Fuga de Presión',           label: 'Fuga de Presión',                   icon: 'fa-wind',            hint: 'Fugas en sistemas de aire comprimido, vapor o gas a presión.' },
        { id: 'Fuga de Vacío',             label: 'Fuga de Vacío',                     icon: 'fa-vacuum',          hint: 'Fugas en sistemas de vacío industrial.' },
        { id: 'Eléctrico (Corona/Arco)',   label: 'Eléctrico — Corona / Arco',         icon: 'fa-bolt',            hint: 'Descarga corona, arco eléctrico, tracking en equipos de alta tensión.' },
        { id: 'Lubricación',               label: 'Lubricación',                       icon: 'fa-droplet',         hint: 'Deficiencia o exceso de lubricante en rodamientos.' },
        { id: 'Válvula',                   label: 'Válvula',                           icon: 'fa-gear',            hint: 'Fuga interna en válvulas de control, retención o alivio.' },
        { id: 'Cavitación',                label: 'Cavitación — Bomba/Compresor',      icon: 'fa-water',           hint: 'Cavitación en rodete de bomba o cabeza de compresor.' },
        { id: 'Engranaje',                 label: 'Engranaje / Caja reductora',        icon: 'fa-gears',           hint: 'Desgaste, desalineación o rotura de dientes en cajas de engranajes.' },
        { id: 'Acople',                    label: 'Acople / Transmisión',              icon: 'fa-link',            hint: 'Juego excesivo, desgaste o falla en acoples flexibles o rígidos.' },
        { id: 'Motor Eléctrico',           label: 'Motor eléctrico — bobinado',        icon: 'fa-plug',            hint: 'Descarga en devanados, falla de aislamiento.' },
        { id: 'Trampa de Vapor',           label: 'Trampa de vapor',                   icon: 'fa-temperature-high',hint: 'Falla en trampas de vapor (abierta en frío o cerrada en caliente).' },
        { id: 'Otro',                      label: 'Otro',                              icon: 'fa-circle-question', hint: 'Tipo no categorizado. Describir en notas.' },
    ];

    // ── Helpers ────────────────────────────────────────────────
    function sevBadge(estado) {
        if (!estado) return `<span class="sev-badge-table sev-empty">—</span>`;
        const map    = { C: 'sev-c', A: 'sev-a', B: 'sev-b' };
        const labels = { C: 'Alarma', A: 'Alerta', B: 'Bueno' };
        return `<span class="sev-badge-table ${map[estado] || 'sev-empty'}">${labels[estado] || estado}</span>`;
    }

    function fmtFecha(val) {
        if (!val) return '—';
        const s = String(val).split('T')[0];
        const [y, m, d] = s.split('-').map(Number);
        const M = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        return `${String(d).padStart(2,'0')}-${M[m-1]}-${String(y).slice(-2)}`;
    }

    function calcularEstadoLocal(comp, nivelDb) {
        if (!comp || isNaN(parseFloat(nivelDb))) return null;
        const ndb    = parseFloat(nivelDb);
        const alerta = parseFloat(comp.nivel_alerta);
        const alarma = parseFloat(comp.nivel_alarma);
        const base   = parseFloat(comp.nivel_base);
        if (!isNaN(alarma) && ndb >= alarma) return 'C';
        if (!isNaN(alerta) && ndb >= alerta) return 'A';
        if (!isNaN(alerta)) return 'B';
        if (!isNaN(base)) {
            const delta = ndb - base;
            if (delta >= 16) return 'C';
            if (delta >= 8)  return 'A';
            return 'B';
        }
        return null;
    }

    function calcularDelta(comp, lec) {
        const ndb  = parseFloat(lec.nivel_db);
        const base = parseFloat(lec.nivel_base_lec) || parseFloat(comp.nivel_base);
        if (isNaN(ndb) || isNaN(base)) return null;
        return +(ndb - base).toFixed(1);
    }

    function tipoData(id) { return TIPOS_DEFECTO.find(t => t.id === id) || TIPOS_DEFECTO[TIPOS_DEFECTO.length-1]; }

    // ══════════════════════════════════════════════════════════
    // ÁRBOL DE EQUIPOS
    // ══════════════════════════════════════════════════════════
    async function loadEquipos() {
        const tree   = document.getElementById('ultra-asset-tree');
        const search = document.getElementById('ultra-sidebar-search');
        if (!tree) return;

        tree.innerHTML = `<div class="cond-tree-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Cargando...</span></div>`;
        try {
            const res = await apiFetch('/api/equipos');
            if (!res?.ok) throw new Error();
            allEquipos = (await res.json()).filter(e => e.aplica_ultrasonido);
            renderTree(allEquipos);
        } catch {
            tree.innerHTML = `<div class="cond-tree-loading" style="color:var(--danger);">
                <i class="fa-solid fa-triangle-exclamation"></i><span>Error al cargar activos</span></div>`;
        }
        search?.addEventListener('input', () => renderTree(allEquipos, search.value.toLowerCase().trim()));
    }

    function renderTree(equipos, query = '') {
        const tree = document.getElementById('ultra-asset-tree');
        if (!tree) return;
        if (!equipos.length) {
            tree.innerHTML = `<div class="cond-tree-loading"><i class="fa-solid fa-circle-info"></i>
                <span style="text-align:center;">No hay activos con<br>ultrasonido habilitado</span></div>`;
            return;
        }
        const grupos = {};
        equipos.forEach(eq => {
            const p = (eq.ubicacion || 'Sin Ubicación').split('/')[0].trim() || 'Sin Ubicación';
            if (!grupos[p]) grupos[p] = [];
            grupos[p].push(eq);
        });
        let html = '', haMatch = false;
        Object.keys(grupos).sort().forEach(planta => {
            const items = query ? grupos[planta].filter(e =>
                e.asset_id.toLowerCase().includes(query) ||
                (e.descripcion||'').toLowerCase().includes(query) ||
                (e.ubicacion||'').toLowerCase().includes(query)) : grupos[planta];
            if (!items.length) return;
            haMatch = true;
            html += `<div class="cond-tree-planta" data-planta="${planta}">
                <div class="cond-tree-planta-header">
                    <i class="fa-solid fa-industry" style="font-size:.8em;opacity:.6;"></i>
                    <span>${planta}</span>
                    <span class="cond-planta-count">${items.length}</span>
                    <i class="fa-solid fa-chevron-down chevron"></i>
                </div>
                <div class="cond-tree-activos">${items.map(e => {
                    const s  = e.ultimo_estado_ultrasonido;
                    const sc = s ? `sema-${s}` : 'sema-null';
                    return `<div class="cond-tree-activo ${currentEquipo?.asset_id === e.asset_id ? 'active' : ''}" data-id="${e.asset_id}">
                        <div class="cond-semaforo-mini ${sc}"></div>
                        <span class="cond-activo-id">${e.asset_id}</span>
                        <span class="cond-activo-desc" title="${e.descripcion||''}">${e.descripcion||'—'}</span>
                    </div>`;
                }).join('')}</div>
            </div>`;
        });
        if (!haMatch) { tree.innerHTML = `<div class="cond-tree-loading"><i class="fa-solid fa-magnifying-glass"></i><span>Sin resultados</span></div>`; return; }
        tree.innerHTML = html;
        tree.querySelectorAll('.cond-tree-planta-header').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));
        tree.querySelectorAll('.cond-tree-activo').forEach(el => {
            el.addEventListener('click', () => {
                tree.querySelectorAll('.cond-tree-activo').forEach(x => x.classList.remove('active'));
                el.classList.add('active');
                const eq = allEquipos.find(e => e.asset_id === el.dataset.id);
                if (eq) selectEquipo(eq);
            });
        });
    }

    // ══════════════════════════════════════════════════════════
    // SELECCIONAR EQUIPO
    // ══════════════════════════════════════════════════════════
    async function selectEquipo(eq) {
        currentEquipo = eq;
        document.querySelectorAll('#ultra-asset-tree .cond-tree-activo').forEach(el =>
            el.classList.toggle('active', el.dataset.id === eq.asset_id));

        document.getElementById('ultra-panel-empty')?.style && (document.getElementById('ultra-panel-empty').style.display = 'none');
        document.getElementById('ultra-panel-equipo')?.style && (document.getElementById('ultra-panel-equipo').style.display = '');

        // Ficha técnica
        const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = (v != null && v !== '') ? v : '—'; };
        setT('ultra-ficha-id',           eq.asset_id);
        setT('ultra-ficha-desc',         eq.descripcion);
        setT('ultra-ficha-ubicacion',    eq.ubicacion);
        setT('ultra-ficha-marca',        eq.marca);
        setT('ultra-ficha-modelo',       eq.modelo);
        setT('ultra-ficha-tipo-sistema', (eq.tipo_sistema||'').toUpperCase() || '—');
        setT('ultra-ficha-potencia',     eq.potencia_hp ? `${eq.potencia_hp} HP` : '—');
        setT('ultra-ficha-rpm',          eq.rpm ? `${eq.rpm} RPM` : '—');
        setT('ultra-ficha-rodamientos',  [eq.rodamiento_de, eq.rodamiento_ode].filter(Boolean).join(' / ') || '—');
        setT('ultra-ficha-estado-txt',   { B:'Bueno', A:'Alerta', C:'Alarma' }[eq.ultimo_estado_ultrasonido] || 'Sin datos');

        const badge = document.getElementById('ultra-ficha-criticidad-badge');
        if (badge) {
            badge.textContent = eq.criticidad || '—';
            badge.className   = 'cond-ficha-badge';
            if (eq.criticidad === 'Alta')  badge.classList.add('crit-alta');
            if (eq.criticidad === 'Media') badge.classList.add('crit-media');
            if (eq.criticidad === 'Baja')  badge.classList.add('crit-baja');
        }
        const semaforo = document.getElementById('ultra-ficha-semaforo');
        if (semaforo) {
            const s = eq.ultimo_estado_ultrasonido;
            semaforo.className = `cond-semaforo-dot${s ? ' sema-' + s : ''}`;
        }

        await loadComponentes(eq.asset_id);
        loadUltraGap();
        loadUltraChart();
    }

    // ══════════════════════════════════════════════════════════
    // COMPONENTES
    // ══════════════════════════════════════════════════════════
    async function loadComponentes(assetId) {
        try {
            const res = await apiFetch(`/api/ultra/componentes/${assetId}`);
            componentes = res?.ok ? await res.json() : [];
        } catch { componentes = []; }
        await loadLecturas(assetId);
    }

    function renderComponentes() {
        const wrap = document.getElementById('ultra-componentes-wrap');
        if (!wrap) return;
        if (!componentes.length) {
            wrap.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:.9em;">
                <i class="fa-solid fa-plus-circle"></i> Sin puntos de medición. Usa <b>+ Añadir Punto</b> para crear uno.</div>`;
            return;
        }
        wrap.innerHTML = componentes.map(c => {
            const lecsComp = lecturas.filter(l => l.componente_id === c.id);
            const ultima   = lecsComp[lecsComp.length - 1];
            const estado   = ultima?.estado || null;
            const tipo     = tipoData(c.tipo_defecto);
            const nivelInfo = c.nivel_base ? `Base: ${c.nivel_base} dBµV` : '';
            const limitInfo = [c.nivel_alerta ? `Alerta ≥${c.nivel_alerta}` : '', c.nivel_alarma ? `Alarma ≥${c.nivel_alarma}` : ''].filter(Boolean).join(' · ');
            return `<div class="ultra-comp-card ${estado ? 'comp-estado-' + estado.toLowerCase() : ''}" data-comp-id="${c.id}">
                <div class="ultra-comp-header">
                    <div class="ultra-comp-title">
                        <i class="fa-solid ${tipo.icon}"></i>
                        <span>${c.nombre}</span>
                        <span class="ultra-tipo-tag">${c.tipo_defecto}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        ${sevBadge(estado)}
                        <button class="termo-btn-icon btn-edit-comp-u" data-id="${c.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
                        <button class="termo-btn-icon btn-delete-comp-u" data-id="${c.id}" title="Eliminar" style="color:var(--danger);"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div class="ultra-comp-meta">
                    ${nivelInfo ? `<span><i class="fa-solid fa-database"></i> ${nivelInfo} dBµV</span>` : ''}
                    ${limitInfo ? `<span><i class="fa-solid fa-ruler"></i> ${limitInfo} dBµV</span>` : ''}
                    <span><i class="fa-solid fa-wave-square"></i> ${c.frecuencia_sensor || '40 kHz'}</span>
                    ${c.tipo_sensor ? `<span><i class="fa-solid fa-microphone"></i> ${c.tipo_sensor}</span>` : ''}
                    ${ultima ? `<span><i class="fa-solid fa-calendar"></i> Última: ${fmtFecha(ultima.fecha_medicion)}</span>` : ''}
                    ${ultima?.nivel_db != null ? `<span><i class="fa-solid fa-volume-high"></i> Último: ${ultima.nivel_db} dBµV</span>` : ''}
                </div>
                <div class="ultra-comp-actions no-print">
                    <button class="cond-btn btn-add-lec-u" data-comp-id="${c.id}">
                        <i class="fa-solid fa-plus"></i> Nueva Lectura
                    </button>
                    <button class="cond-btn btn-ver-lec-u" data-comp-id="${c.id}">
                        <i class="fa-solid fa-table-list"></i> Ver Lecturas (${lecsComp.length})
                    </button>
                </div>
            </div>`;
        }).join('');

        wrap.querySelectorAll('.btn-edit-comp-u').forEach(btn => btn.addEventListener('click', () => openCompModal(parseInt(btn.dataset.id))));
        wrap.querySelectorAll('.btn-delete-comp-u').forEach(btn => btn.addEventListener('click', () => deleteComponente(parseInt(btn.dataset.id))));
        wrap.querySelectorAll('.btn-add-lec-u').forEach(btn => btn.addEventListener('click', () => openLecturaModal(parseInt(btn.dataset.compId))));
        wrap.querySelectorAll('.btn-ver-lec-u').forEach(btn => btn.addEventListener('click', () => openTablaLecturas(parseInt(btn.dataset.compId))));
    }

    async function deleteComponente(id) {
        if (!confirm('¿Eliminar este punto y todas sus lecturas?')) return;
        const res = await apiFetch(`/api/ultra/componentes/${id}`, { method: 'DELETE' });
        if (res?.ok) { toast('Punto eliminado.', 'info'); await loadComponentes(currentEquipo.asset_id); }
        else toast('Error al eliminar.', 'error');
    }

    // ══════════════════════════════════════════════════════════
    // LECTURAS
    // ══════════════════════════════════════════════════════════
    async function loadLecturas(assetId) {
        try {
            const res = await apiFetch(`/api/ultra/lecturas/${assetId}`);
            lecturas = res?.ok ? await res.json() : [];
        } catch { lecturas = []; }
        renderComponentes();
        renderTablaGlobal();
    }

    function renderTablaGlobal() {
        const tbody = document.getElementById('ultra-tabla-tbody');
        if (!tbody) return;
        if (!lecturas.length) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">Sin lecturas registradas</td></tr>`;
            return;
        }
        const sorted = [...lecturas].sort((a,b) => b.fecha_medicion > a.fecha_medicion ? 1 : -1).slice(0, 50);
        tbody.innerHTML = sorted.map(l => {
            const comp  = componentes.find(c => c.id === l.componente_id) || {};
            const delta = l.delta_db != null ? l.delta_db : calcularDelta(comp, l);
            const deltaColor = delta == null ? 'var(--text-muted)' : delta >= 16 ? 'var(--danger)' : delta >= 8 ? '#d97706' : '#16a34a';
            const metaStr = [l.rpm ? `${l.rpm} RPM` : '', l.carga_pct ? `Carga: ${l.carga_pct}%` : '', l.temp_c ? `${l.temp_c}°C` : ''].filter(Boolean).join(' · ');
            return `<tr>
                <td style="white-space:nowrap;">${fmtFecha(l.fecha_medicion)}</td>
                <td style="font-weight:600;">${l.comp_nombre || '—'}</td>
                <td style="font-size:.82em;color:var(--text-muted);">${l.tipo_defecto || '—'}</td>
                <td style="font-weight:700;font-size:.95em;">${l.nivel_db} <small style="font-weight:400;color:var(--text-muted);">dBµV</small></td>
                <td style="font-weight:600;color:${deltaColor};">${delta != null ? (delta >= 0 ? '+' : '') + delta + ' dB' : '—'}</td>
                <td style="font-size:.82em;color:var(--text-muted);">${metaStr || '—'}</td>
                <td>${sevBadge(l.estado)}</td>
                <td class="no-print" style="white-space:nowrap;">
                    <button class="termo-btn-icon btn-edit-lec-g" data-id="${l.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
                    <button class="termo-btn-icon btn-del-lec-g" data-id="${l.id}" title="Eliminar" style="color:var(--danger);"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('.btn-edit-lec-g').forEach(btn => btn.addEventListener('click', () => editLectura(parseInt(btn.dataset.id))));
        tbody.querySelectorAll('.btn-del-lec-g').forEach(btn => btn.addEventListener('click', () => deleteLectura(parseInt(btn.dataset.id))));
    }

    async function deleteLectura(id) {
        if (!confirm('¿Eliminar esta lectura?')) return;
        const res = await apiFetch(`/api/ultra/lecturas/${id}`, { method: 'DELETE' });
        if (res?.ok) { toast('Lectura eliminada.', 'info'); await loadLecturas(currentEquipo.asset_id); refreshTreeEstado(); }
        else toast('Error al eliminar.', 'error');
    }

    function editLectura(id) {
        const lec  = lecturas.find(l => l.id === id);
        const comp = componentes.find(c => c.id === lec?.componente_id);
        if (lec && comp) openLecturaModal(comp.id, lec);
    }

    // ══════════════════════════════════════════════════════════
    // MODAL COMPONENTE
    // ══════════════════════════════════════════════════════════
    function buildTiposOptions(selected) {
        return TIPOS_DEFECTO.map(t =>
            `<option value="${t.id}" ${t.id === selected ? 'selected' : ''} data-hint="${t.hint}">${t.label}</option>`
        ).join('');
    }

    function openCompModal(compId = null) {
        const comp = compId ? componentes.find(c => c.id === compId) : null;
        editingCompId = compId;
        const modal = document.getElementById('ultra-modal-comp');
        if (!modal) return;

        modal.querySelector('#umc-titulo').textContent = comp ? 'Editar Punto de Medición' : 'Nuevo Punto de Medición';
        modal.querySelector('#umc-nombre').value        = comp?.nombre || '';
        modal.querySelector('#umc-tipo').innerHTML      = buildTiposOptions(comp?.tipo_defecto || 'Rodamiento');
        modal.querySelector('#umc-nivel-base').value    = comp?.nivel_base || '';
        modal.querySelector('#umc-nivel-alerta').value  = comp?.nivel_alerta || '';
        modal.querySelector('#umc-nivel-alarma').value  = comp?.nivel_alarma || '';
        modal.querySelector('#umc-frecuencia').value    = comp?.frecuencia_sensor || '40 kHz';
        modal.querySelector('#umc-sensor').value        = comp?.tipo_sensor || '';
        modal.querySelector('#umc-notas').value         = comp?.notas_config || '';
        updateTipoHint();
        modal.style.display = 'flex';
    }

    function updateTipoHint() {
        const modal = document.getElementById('ultra-modal-comp');
        if (!modal) return;
        const sel  = modal.querySelector('#umc-tipo');
        const opt  = sel?.options[sel.selectedIndex];
        const hint = modal.querySelector('#umc-tipo-hint');
        if (hint && opt) { hint.textContent = opt.dataset.hint || ''; hint.style.display = opt.dataset.hint ? '' : 'none'; }
    }

    async function saveComp() {
        const modal = document.getElementById('ultra-modal-comp');
        const body = {
            asset_id:         currentEquipo.asset_id,
            nombre:           modal.querySelector('#umc-nombre').value.trim(),
            tipo_defecto:     modal.querySelector('#umc-tipo').value,
            nivel_base:       parseFloat(modal.querySelector('#umc-nivel-base').value) || null,
            nivel_alerta:     parseFloat(modal.querySelector('#umc-nivel-alerta').value) || null,
            nivel_alarma:     parseFloat(modal.querySelector('#umc-nivel-alarma').value) || null,
            frecuencia_sensor:modal.querySelector('#umc-frecuencia').value.trim() || '40 kHz',
            tipo_sensor:      modal.querySelector('#umc-sensor').value.trim() || null,
            notas_config:     modal.querySelector('#umc-notas').value.trim() || null,
        };
        if (!body.nombre) { toast('El nombre es obligatorio.', 'error'); return; }
        const url    = editingCompId ? `/api/ultra/componentes/${editingCompId}` : '/api/ultra/componentes';
        const method = editingCompId ? 'PUT' : 'POST';
        const res    = await apiFetch(url, { method, body: JSON.stringify(body) });
        if (res?.ok) {
            toast(editingCompId ? '✅ Punto actualizado.' : '✅ Punto creado.', 'success');
            modal.style.display = 'none';
            await loadComponentes(currentEquipo.asset_id);
        } else toast('Error al guardar.', 'error');
    }

    // ══════════════════════════════════════════════════════════
    // MODAL LECTURA
    // ══════════════════════════════════════════════════════════
    function openLecturaModal(compId, lectura = null) {
        const comp = componentes.find(c => c.id === compId);
        if (!comp) return;
        editingLecId = lectura?.id || null;
        const modal = document.getElementById('ultra-modal-lectura');
        if (!modal) return;

        modal.querySelector('#uml-titulo').textContent      = lectura ? 'Editar Lectura' : 'Nueva Lectura';
        modal.querySelector('#uml-comp-nombre').textContent = `${comp.nombre} — ${comp.tipo_defecto}`;
        modal.querySelector('#uml-comp-base').textContent   = comp.nivel_base ? `Nivel base configurado: ${comp.nivel_base} dBµV` : 'Sin nivel base — se usará ΔdB ISO 29821';
        modal.querySelector('#uml-fecha').value       = lectura ? String(lectura.fecha_medicion).split('T')[0] : new Date().toISOString().split('T')[0];
        modal.querySelector('#uml-nivel-db').value    = lectura?.nivel_db || '';
        modal.querySelector('#uml-nivel-base').value  = lectura?.nivel_base_lec ?? comp.nivel_base ?? '';
        modal.querySelector('#uml-rpm').value         = lectura?.rpm || '';
        modal.querySelector('#uml-carga').value       = lectura?.carga_pct || '';
        modal.querySelector('#uml-temp').value        = lectura?.temp_c || '';
        modal.querySelector('#uml-ruido').value       = lectura?.ruido_amb || '';
        modal.querySelector('#uml-carac').value       = lectura?.caracteristicas || '';
        modal.querySelector('#uml-imagen').value      = lectura?.no_imagen || '';
        modal.querySelector('#uml-notas').value       = lectura?.notas || '';
        modal.dataset.compId = compId;

        // Live preview
        const updatePreview = () => updateLecturaPreview(comp);
        modal.querySelectorAll('#uml-nivel-db, #uml-nivel-base').forEach(el => el.addEventListener('input', updatePreview));
        updateLecturaPreview(comp);
        modal.style.display = 'flex';
    }

    function updateLecturaPreview(comp) {
        const modal   = document.getElementById('ultra-modal-lectura');
        const prev    = document.getElementById('uml-preview');
        if (!modal || !prev) return;
        const ndb     = parseFloat(modal.querySelector('#uml-nivel-db')?.value);
        const baseLec = parseFloat(modal.querySelector('#uml-nivel-base')?.value);
        const base    = !isNaN(baseLec) ? baseLec : parseFloat(comp.nivel_base);
        if (isNaN(ndb)) { prev.innerHTML = ''; return; }

        const delta  = !isNaN(base) ? +(ndb - base).toFixed(1) : null;
        const estado = calcularEstadoLocal(comp, ndb);
        const deltaColor = delta == null ? '' : delta >= 16 ? 'var(--danger)' : delta >= 8 ? '#d97706' : '#16a34a';
        const alerta = comp.nivel_alerta ?? (isNaN(base) ? null : base + 8);
        const alarma = comp.nivel_alarma ?? (isNaN(base) ? null : base + 16);

        prev.innerHTML = `<div class="tml-prev-wrap">
            <div class="tml-prev-row">
                Nivel medido: <b>${ndb} dBµV</b>
                ${delta != null ? `&nbsp;·&nbsp; ΔdB: <b style="color:${deltaColor};">${delta >= 0 ? '+' : ''}${delta} dB</b>` : ''}
            </div>
            ${alerta != null ? `<div class="tml-prev-row" style="font-size:.8em;color:var(--text-muted);">Alerta ≥ ${alerta} dBµV · Alarma ≥ ${alarma ?? '—'} dBµV</div>` : ''}
            <div class="tml-prev-global">Estado: ${sevBadge(estado)}</div>
        </div>`;
    }

    async function saveLectura() {
        const modal   = document.getElementById('ultra-modal-lectura');
        const compId  = parseInt(modal?.dataset.compId);
        const comp    = componentes.find(c => c.id === compId);
        if (!comp) return;

        const body = {
            componente_id:  compId,
            asset_id:       currentEquipo.asset_id,
            fecha_medicion: modal.querySelector('#uml-fecha')?.value,
            nivel_db:       parseFloat(modal.querySelector('#uml-nivel-db')?.value),
            nivel_base_lec: parseFloat(modal.querySelector('#uml-nivel-base')?.value) || null,
            rpm:            parseFloat(modal.querySelector('#uml-rpm')?.value) || null,
            carga_pct:      parseFloat(modal.querySelector('#uml-carga')?.value) || null,
            temp_c:         parseFloat(modal.querySelector('#uml-temp')?.value) || null,
            ruido_amb:      parseFloat(modal.querySelector('#uml-ruido')?.value) || null,
            caracteristicas:modal.querySelector('#uml-carac')?.value?.trim() || null,
            no_imagen:      modal.querySelector('#uml-imagen')?.value?.trim() || null,
            notas:          modal.querySelector('#uml-notas')?.value?.trim() || null,
        };

        if (!body.fecha_medicion)   { toast('Ingresa la fecha.', 'error'); return; }
        if (isNaN(body.nivel_db))   { toast('Ingresa el nivel dBµV medido.', 'error'); return; }

        // Validación estadística
        try {
            const vr = await apiFetch('/api/ultra/validar-lectura', { method: 'POST',
                body: JSON.stringify({ componente_id: compId, nivel_db: body.nivel_db }) });
            if (vr?.ok) {
                const { advertencias } = await vr.json();
                if (advertencias?.length) {
                    const msgs = advertencias.map(a => `• ${a.mensaje}`).join('\n');
                    if (!confirm(`⚠️ Valor inusual detectado:\n\n${msgs}\n\n¿Confirmar y guardar?`)) return;
                }
            }
        } catch {}

        const url    = editingLecId ? `/api/ultra/lecturas/${editingLecId}` : '/api/ultra/lecturas';
        const method = editingLecId ? 'PUT' : 'POST';
        const res    = await apiFetch(url, { method, body: JSON.stringify(body) });
        if (res?.ok) {
            toast(editingLecId ? '✅ Lectura actualizada.' : '✅ Lectura guardada.', 'success');
            modal.style.display = 'none';
            await loadLecturas(currentEquipo.asset_id);
            refreshTreeEstado();
            loadUltraChart();
        } else toast('Error al guardar lectura.', 'error');
    }

    // ══════════════════════════════════════════════════════════
    // MODAL TABLA LECTURAS POR COMPONENTE
    // ══════════════════════════════════════════════════════════
    function openTablaLecturas(compId) {
        const comp     = componentes.find(c => c.id === compId);
        if (!comp) return;
        const lecsComp = lecturas.filter(l => l.componente_id === compId);
        const modal    = document.getElementById('ultra-modal-tabla-lec');
        if (!modal) return;
        modal.querySelector('#umtl-titulo').textContent = `Lecturas — ${comp.nombre}`;
        const tbody = modal.querySelector('#umtl-tbody');
        if (!lecsComp.length) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--text-muted);">Sin lecturas</td></tr>`;
        } else {
            tbody.innerHTML = lecsComp.sort((a,b) => b.fecha_medicion > a.fecha_medicion ? 1 : -1).map(l => {
                const delta = l.delta_db != null ? l.delta_db : calcularDelta(comp, l);
                const deltaColor = delta == null ? '' : delta >= 16 ? 'var(--danger)' : delta >= 8 ? '#d97706' : '#16a34a';
                const meta = [l.rpm ? `${l.rpm} RPM` : '', l.carga_pct ? `${l.carga_pct}%` : '', l.temp_c ? `${l.temp_c}°C` : ''].filter(Boolean).join(' · ');
                return `<tr>
                    <td style="white-space:nowrap;">${fmtFecha(l.fecha_medicion)}</td>
                    <td style="font-weight:700;">${l.nivel_db} <small style="font-weight:400;color:var(--text-muted);">dBµV</small></td>
                    <td style="font-weight:600;color:${deltaColor};">${delta != null ? (delta >= 0 ? '+' : '') + delta + ' dB' : '—'}</td>
                    <td style="font-size:.82em;color:var(--text-muted);">${meta || '—'}</td>
                    <td style="font-size:.82em;color:var(--text-muted);">${l.caracteristicas || ''}</td>
                    <td>${sevBadge(l.estado)}</td>
                    <td class="no-print" style="white-space:nowrap;">
                        <button class="termo-btn-icon umtl-edit" data-id="${l.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
                        <button class="termo-btn-icon umtl-del" data-id="${l.id}" title="Eliminar" style="color:var(--danger);"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>`;
            }).join('');
            tbody.querySelectorAll('.umtl-edit').forEach(btn => btn.addEventListener('click', () => { modal.style.display = 'none'; editLectura(parseInt(btn.dataset.id)); }));
            tbody.querySelectorAll('.umtl-del').forEach(btn => btn.addEventListener('click', async () => { await deleteLectura(parseInt(btn.dataset.id)); openTablaLecturas(compId); }));
        }
        modal.style.display = 'flex';
    }

    // ══════════════════════════════════════════════════════════
    // REFRESCAR ÁRBOL
    // ══════════════════════════════════════════════════════════
    async function refreshTreeEstado() {
        try {
            const res = await apiFetch('/api/equipos');
            if (!res?.ok) return;
            allEquipos = (await res.json()).filter(e => e.aplica_ultrasonido);
            renderTree(allEquipos);
            if (currentEquipo) {
                const eq = allEquipos.find(e => e.asset_id === currentEquipo.asset_id);
                if (eq) {
                    currentEquipo = eq;
                    const sem = document.getElementById('ultra-ficha-semaforo');
                    if (sem) { const s = eq.ultimo_estado_ultrasonido; sem.className = `cond-semaforo-dot${s ? ' sema-' + s : ''}`; }
                }
            }
        } catch {}
    }

    // ══════════════════════════════════════════════════════════
    // INIT
    // ══════════════════════════════════════════════════════════
    window.ultraCondicionInit = async function () {
        await loadEquipos();

        document.getElementById('ultra-btn-add-comp')?.addEventListener('click', () => {
            if (!currentEquipo) { toast('Selecciona un equipo primero.', 'error'); return; }
            openCompModal(null);
        });

        // Modal componente
        const mc = document.getElementById('ultra-modal-comp');
        if (mc) {
            mc.querySelector('#umc-tipo')?.addEventListener('change', updateTipoHint);
            mc.querySelectorAll('#umc-btn-save').forEach(b => b.addEventListener('click', saveComp));
            mc.querySelectorAll('#umc-btn-cancel, #umc-btn-close-x').forEach(b => b.addEventListener('click', () => mc.style.display = 'none'));
            mc.addEventListener('click', e => { if (e.target === mc) mc.style.display = 'none'; });
        }

        // Modal lectura
        const ml = document.getElementById('ultra-modal-lectura');
        if (ml) {
            ml.querySelectorAll('#uml-btn-save').forEach(b => b.addEventListener('click', saveLectura));
            ml.querySelectorAll('#uml-btn-cancel, #uml-btn-close-x').forEach(b => b.addEventListener('click', () => ml.style.display = 'none'));
            ml.addEventListener('click', e => { if (e.target === ml) ml.style.display = 'none'; });
        }

        // Export Excel
        document.getElementById('ultra-btn-export')?.addEventListener('click', exportarExcelUltra);

        // Modal tabla
        const mtl = document.getElementById('ultra-modal-tabla-lec');
        if (mtl) {
            mtl.querySelectorAll('#umtl-btn-close').forEach(b => b.addEventListener('click', () => mtl.style.display = 'none'));
            mtl.addEventListener('click', e => { if (e.target === mtl) mtl.style.display = 'none'; });
        }
    };


    // ════════════════════════════════════════════════════════════
    // GRÁFICO DE TENDENCIA — ULTRASONIDO
    // ════════════════════════════════════════════════════════════
    let ultraChartInstance = null;

    async function loadUltraChart() {
        if (!currentEquipo || !lecturas.length) return;
        if (typeof Chart === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
            });
        }
        const container = document.getElementById('ultra-chart-container');
        if (!container) return;

        const COLORS = ['#2563eb','#dc2626','#16a34a','#d97706','#7c3aed','#0891b2'];
        const todasFechas = [...new Set(lecturas.map(l => String(l.fecha_medicion).split('T')[0]))].sort();
        const M = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        const labels = todasFechas.map(f => { const [y,m,d] = f.split('-'); return `${d}-${M[+m-1]}-${String(y).slice(-2)}`; });

        const datasets = componentes.map((comp, ci) => {
            const lecsComp = lecturas.filter(l => l.componente_id === comp.id);
            const mapa = {};
            lecsComp.forEach(l => { mapa[String(l.fecha_medicion).split('T')[0]] = parseFloat(l.nivel_db); });
            const ds = {
                label: comp.nombre,
                data: todasFechas.map(f => mapa[f] ?? null),
                borderColor: COLORS[ci % COLORS.length],
                backgroundColor: COLORS[ci % COLORS.length] + '22',
                borderWidth: 2, pointRadius: 3, tension: 0.3, spanGaps: true,
            };
            // Línea de nivel base
            if (comp.nivel_base) datasets.push({
                label: `Base ${comp.nombre}`,
                data: todasFechas.map(() => parseFloat(comp.nivel_base)),
                borderColor: COLORS[ci % COLORS.length],
                borderWidth: 1, borderDash: [5,4], pointRadius: 0, fill: false, tension: 0,
            });
            return ds;
        }).filter(Boolean);

        // Líneas de límites ISO (+8, +16 sobre base global si existe)
        const baseGlobal = componentes[0]?.nivel_base;
        if (baseGlobal) {
            [8, 16].forEach((delta, i) => {
                datasets.push({
                    label: `+${delta} dB (${i === 0 ? 'Alerta' : 'Alarma'})`,
                    data: todasFechas.map(() => parseFloat(baseGlobal) + delta),
                    borderColor: i === 0 ? '#f59e0b' : '#dc2626',
                    borderWidth: 1.5, borderDash: [6,4], pointRadius: 0, fill: false, tension: 0,
                });
            });
        }

        container.style.display = '';
        if (ultraChartInstance) { ultraChartInstance.destroy(); ultraChartInstance = null; }
        const canvas = document.getElementById('ultra-tendencia-chart');
        if (!canvas) return;

        // Tendencia del servidor
        let trendText = '';
        try {
            const tr = await apiFetch(`/api/ultra/tendencia/${currentEquipo.asset_id}`);
            if (tr?.ok) {
                const data = await tr.json();
                const partes = Object.values(data).filter(t => t.suficiente).map(t => {
                    const iconos = { estable: '→', creciente: '↗', creciente_rapido: '⚠ ↑↑', descendente: '↘' };
                    return `${t.comp_nombre}: ${iconos[t.clasificacion]} ${t.slope_mes >= 0 ? '+' : ''}${t.slope_mes} dB/mes`;
                });
                trendText = partes.join('  |  ');
            }
        } catch {}
        const banner = document.getElementById('ultra-chart-banner');
        if (banner) { banner.textContent = trendText; banner.style.display = trendText ? '' : 'none'; }

        ultraChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
                scales: {
                    x: { ticks: { maxTicksLimit: 12, font: { size: 10 } } },
                    y: { title: { display: true, text: 'dBµV', font: { size: 11 } } }
                }
            }
        });
    }

    // ════════════════════════════════════════════════════════════
    // GAP + EXPORTAR EXCEL — ULTRASONIDO
    // ════════════════════════════════════════════════════════════
    async function loadUltraGap() {
        if (!currentEquipo) return;
        try {
            const res = await apiFetch(`/api/condicion/gap/${currentEquipo.asset_id}`);
            if (!res?.ok) return;
            const gap = (await res.json()).ultrasonido;
            const banner = document.getElementById('ultra-gap-banner');
            if (!banner) return;
            if (!gap || gap.nivel === 'ok') { banner.style.display = 'none'; return; }
            const col = { atrasado: '#fef3c7', critico: '#fee2e2' };
            const txt = { atrasado: '#92400e', critico: '#991b1b' };
            banner.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:8px;
                margin-bottom:10px;font-size:.84em;font-weight:600;background:${col[gap.nivel]};color:${txt[gap.nivel]};`;
            banner.innerHTML = `<span>${gap.nivel==='critico'?'🚨':'⚠'}</span>
                <span>${gap.dias} días sin medición de ultrasonido — Última: ${gap.ultima || 'nunca'}</span>`;
        } catch {}
    }

    async function exportarExcelUltra() {
        if (!currentEquipo || !lecturas.length) { toast('No hay datos.', 'info'); return; }
        if (typeof XLSX === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
                s.onload = res; s.onerror = rej; document.head.appendChild(s);
            });
        }
        const wb = XLSX.utils.book_new();
        const eq = currentEquipo;
        const M  = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        const fmtF = s => { const [y,m,d] = String(s).split('T')[0].split('-'); return `${d}-${M[+m-1]}-${y.slice(-2)}`; };

        componentes.forEach(comp => {
            const lecsComp = lecturas.filter(l => l.componente_id === comp.id)
                .sort((a,b) => a.fecha_medicion > b.fecha_medicion ? 1 : -1);
            const rows = [
                [`Ultrasonido — ${comp.nombre} — ${comp.tipo_defecto}`],
                [`Equipo: ${eq.asset_id}  |  Base: ${comp.nivel_base ?? '—'} dBµV  |  Sensor: ${comp.frecuencia_sensor || '40 kHz'}`],
                [],
                ['Fecha','Nivel (dBµV)','Nivel Base','ΔdB','RPM','Carga%','Temp °C','Ruido Amb','Características','No. Imagen','Estado','Notas']
            ];
            lecsComp.forEach(l => {
                const delta = l.delta_db ?? (l.nivel_base_lec != null ? +(l.nivel_db - l.nivel_base_lec).toFixed(1) :
                    comp.nivel_base != null ? +(l.nivel_db - comp.nivel_base).toFixed(1) : '');
                rows.push([fmtF(l.fecha_medicion), l.nivel_db, l.nivel_base_lec ?? comp.nivel_base ?? '',
                    delta, l.rpm ?? '', l.carga_pct ?? '', l.temp_c ?? '', l.ruido_amb ?? '',
                    l.caracteristicas || '', l.no_imagen || '',
                    {B:'Bueno',A:'Alerta',C:'Alarma'}[l.estado] || '', l.notas || '']);
            });
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = Array(12).fill({ wch: 14 });
            XLSX.utils.book_append_sheet(wb, ws, comp.nombre.slice(0, 31));
        });

        XLSX.writeFile(wb, `Ultrasonido_${eq.asset_id}_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast('✅ Excel ultrasonido exportado.', 'success');
    }

})();
