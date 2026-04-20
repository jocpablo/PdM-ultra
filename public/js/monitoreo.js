// monitoreo.js — Monitoreo de Condición (formato reporte con tabla)
// Suite PdM | Edwards

document.addEventListener('DOMContentLoaded', () => {
    const toast    = (m, t = 'info') => window.PdM?.showToast(m, t);
    const apiFetch = (...a) => window.PdM.apiFetch(...a);

    // ── Estado ─────────────────────────────────────────────────
    let allEquipos  = [];
    let allPlantas  = [];
    let equiposDePlanta = [];

    // ── Peor estado: C > A > B > N > null ─────────────────────
    const ORDEN_SEV = { C: 4, A: 3, B: 2, N: 1 };
    function peorEstado(arr) {
        let peor = null;
        arr.forEach(s => {
            if (s && (ORDEN_SEV[s] || 0) > (ORDEN_SEV[peor] || 0)) peor = s;
        });
        return peor;
    }

    // ── Badge HTML — igual que sev-badge-table del proyecto ────
    function sevBadge(estado) {
        if (!estado) return `<span class="sev-badge-table sev-empty">—</span>`;
        const map = {
            C: 'sev-c', A: 'sev-a', B: 'sev-b', N: 'sev-empty'
        };
        const labels = { C: 'Alarma', A: 'Alerta', B: 'Bueno', N: 'N/A' };
        return `<span class="sev-badge-table ${map[estado] || 'sev-empty'}">${labels[estado] || estado}</span>`;
    }

    // ════════════════════════════════════════════════════════════
    // 1. INIT — cargar plantas y equipos
    // ════════════════════════════════════════════════════════════
    async function init() {
        // Fecha de hoy
        const fechaEl = document.getElementById('fecha-reporte-monitoreo');
        if (fechaEl && !fechaEl.value) fechaEl.value = new Date().toISOString().split('T')[0];

        // Autocompletar analista
        const analista = localStorage.getItem('defaultAnalystName');
        const cargo    = localStorage.getItem('defaultAnalystRole');
        const cargoEls = document.querySelectorAll('.cargo-analista');
        if (analista && cargoEls[0] && !cargoEls[0].value) {
            cargoEls[0].value = analista + (cargo ? ' — ' + cargo : '');
        }

        try {
            const [rPlantas, rEquipos] = await Promise.all([
                apiFetch('/api/plantas'),
                apiFetch('/api/equipos'),
            ]);
            if (rPlantas?.ok) allPlantas = await rPlantas.json();
            if (rEquipos?.ok) allEquipos = await rEquipos.json();
            populatePlantaSelect();
        } catch (e) {
            toast('Error al conectar con el servidor.', 'error');
        }
    }

    // ════════════════════════════════════════════════════════════
    // 2. POBLAR SELECT DE PLANTAS
    // ════════════════════════════════════════════════════════════
    function populatePlantaSelect() {
        const sel = document.getElementById('planta-monitoreo');
        if (!sel) return;

        // Plantas que tienen al menos 1 equipo con alguna técnica PdM
        const plantasConEquipos = [...new Set(
            allEquipos
                .filter(e => e.aplica_vibraciones || e.aplica_termografia || e.aplica_ultrasonido)
                .map(e => (e.ubicacion || '').split('/')[0].trim())
                .filter(Boolean)
        )].sort();

        sel.innerHTML = '<option value="">— Seleccionar planta —</option>';

        if (!plantasConEquipos.length) {
            const opt = document.createElement('option');
            opt.disabled = true;
            opt.textContent = 'No hay plantas con activos PdM';
            sel.appendChild(opt);
            return;
        }

        plantasConEquipos.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            sel.appendChild(opt);
        });

        sel.addEventListener('change', () => {
            if (sel.value) loadEquiposPlanta(sel.value);
            else clearTabla();
        });
    }

    // ════════════════════════════════════════════════════════════
    // 3. CARGAR EQUIPOS DE LA PLANTA DESDE TENDENCIAS
    // ════════════════════════════════════════════════════════════
    async function loadEquiposPlanta(planta) {
        const wrap    = document.getElementById('mon-tabla-wrap');
        const espera  = document.getElementById('mon-espera');
        const ctrls   = document.getElementById('mon-controles');
        const tbody   = document.getElementById('monitoreo-tbody');

        espera.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="font-size:1.5em;opacity:.4;display:block;margin-bottom:8px;"></i> Cargando equipos...';
        espera.style.display = 'block';
        wrap.style.display   = 'none';
        ctrls.style.display  = 'none';

        // Filtrar equipos de esta planta con técnica PdM habilitada
        equiposDePlanta = allEquipos.filter(e => {
            const p = (e.ubicacion || '').split('/')[0].trim();
            return p === planta && (e.aplica_vibraciones || e.aplica_termografia || e.aplica_ultrasonido);
        });

        if (!equiposDePlanta.length) {
            espera.innerHTML = '<i class="fa-solid fa-circle-info" style="font-size:1.5em;opacity:.3;display:block;margin-bottom:8px;"></i> No hay activos con técnicas PdM en esta planta';
            return;
        }

        // Cargar lecturas de condicion para calcular peor estado real desde tendencias
        // Para cada equipo consultamos /api/condicion/lecturas/:asset_id
        const lecturaMap = {};
        await Promise.all(equiposDePlanta.map(async eq => {
            try {
                const res = await apiFetch(`/api/condicion/lecturas/${encodeURIComponent(eq.asset_id)}`);
                if (res?.ok) {
                    const lecturas = await res.json();
                    lecturaMap[eq.asset_id] = calcularPeoresEstados(eq, lecturas);
                }
            } catch {}
        }));

        // Ordenar: C primero, luego A, B, sin dato
        equiposDePlanta.sort((a, b) => {
            const pa = lecturaMap[a.asset_id] || {};
            const pb = lecturaMap[b.asset_id] || {};
            const wa = ORDEN_SEV[peorEstado([pa.vib, pa.ter, pa.ult])] || 0;
            const wb = ORDEN_SEV[peorEstado([pb.vib, pb.ter, pb.ult])] || 0;
            return wb - wa;
        });

        // Renderizar
        tbody.innerHTML = equiposDePlanta.map(eq => {
            const est  = lecturaMap[eq.asset_id] || {};
            const zona = (eq.ubicacion || '').includes('/')
                ? eq.ubicacion.split('/').slice(1).join('/').trim()
                : (eq.ubicacion || '');

            const notas = eq.notas || '';

            return `<tr data-asset-id="${eq.asset_id}">
                <td style="font-weight:700;white-space:nowrap;">${eq.asset_id}</td>
                <td>${eq.descripcion || ''}</td>
                <td style="font-size:.85em;color:var(--text-muted);">${zona}</td>
                <td style="font-size:.82em;color:var(--text-muted);white-space:nowrap;">${est.ultima_fecha || '—'}</td>
                <td class="estado-cell">${eq.aplica_ultrasonido ? sevBadge(est.ult) : '<span style="color:var(--gray-300);font-size:.8em;">N/A</span>'}</td>
                <td class="estado-cell">${eq.aplica_vibraciones ? sevBadge(est.vib) : '<span style="color:var(--gray-300);font-size:.8em;">N/A</span>'}</td>
                <td class="estado-cell">${eq.aplica_termografia ? sevBadge(est.ter) : '<span style="color:var(--gray-300);font-size:.8em;">N/A</span>'}</td>
                <td><input type="text" class="monitoreo-input notas-input" value="${notas}" placeholder="Comentarios..." style="width:100%;"></td>
            </tr>`;
        }).join('');

        espera.style.display = 'none';
        wrap.style.display   = 'block';
        ctrls.style.display  = 'flex';
    }

    // ════════════════════════════════════════════════════════════
    // 4. CALCULAR PEORES ESTADOS DESDE LECTURAS DE TENDENCIAS
    // ════════════════════════════════════════════════════════════
    function calcularPeoresEstados(eq, lecturas) {
        if (!lecturas || !lecturas.length) {
            return { vib: null, ter: null, ult: null, ultima_fecha: null };
        }

        const parse = v => (typeof v === 'object' && v !== null) ? v : (() => { try { return JSON.parse(v || '{}'); } catch { return {}; } })();

        let peorVib = null, peorTer = null, peorUlt = null;
        let ultimaFecha = null;

        lecturas.forEach(lec => {
            const vel   = parse(lec.valores_vel);
            const env   = parse(lec.valores_env);
            const crest = parse(lec.valores_temp); // factor de cresta guardado en temp

            // Fecha más reciente
            if (!ultimaFecha || lec.fecha_medicion > ultimaFecha) {
                ultimaFecha = lec.fecha_medicion;
            }

            // Para velocidad overall: derivar estado según valores vs límites globales
            // Simplificado: si hay valor en vel → aplica vibraciones
            // Usamos el ultimo_estado guardado en el equipo como referencia primaria
            // y las lecturas para calcular si hay algo peor
        });

        // Peor estado derivado de las lecturas de vel/env/crest
        // Como no tenemos los límites aquí, usamos los estados guardados en el equipo
        // más el hecho de que hay lecturas registradas (hay datos de tendencia)
        peorVib = eq.aplica_vibraciones ? (eq.ultimo_estado_vibraciones || null) : null;
        peorTer = eq.aplica_termografia ? (eq.ultimo_estado_termografia || null) : null;
        peorUlt = eq.aplica_ultrasonido ? (eq.ultimo_estado_ultrasonido || null) : null;

        // Formatear fecha
        let fechaFmt = null;
        if (ultimaFecha) {
            const ymd = String(ultimaFecha).split('T')[0];
            const [y, mo, d] = ymd.split('-').map(Number);
            const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
            fechaFmt = `${String(d).padStart(2,'0')}-${meses[mo-1]}-${String(y).slice(-2)}`;
        }

        return { vib: peorVib, ter: peorTer, ult: peorUlt, ultima_fecha: fechaFmt };
    }

    // ════════════════════════════════════════════════════════════
    // 5. GUARDAR COMENTARIOS
    // ════════════════════════════════════════════════════════════
    document.getElementById('monitoreo-save-btn')?.addEventListener('click', async () => {
        const rows = document.querySelectorAll('#monitoreo-tbody tr[data-asset-id]');
        const updates = [];
        rows.forEach(tr => {
            const id    = tr.dataset.assetId;
            const notas = tr.querySelector('.notas-input')?.value || null;
            if (id) {
                updates.push(apiFetch(`/api/equipos/${encodeURIComponent(id)}/estado`, {
                    method: 'PATCH',
                    body: JSON.stringify({ notas })
                }));
            }
        });
        try {
            await Promise.all(updates);
            toast('✅ Comentarios guardados.', 'success');
        } catch { toast('❌ Error al guardar.', 'error'); }
    });

    // ── Actualizar ─────────────────────────────────────────────
    document.getElementById('btn-refresh-mon')?.addEventListener('click', () => {
        const planta = document.getElementById('planta-monitoreo')?.value;
        if (planta) loadEquiposPlanta(planta);
    });

    // ── Limpiar tabla ──────────────────────────────────────────
    function clearTabla() {
        document.getElementById('mon-tabla-wrap').style.display  = 'none';
        document.getElementById('mon-controles').style.display   = 'none';
        document.getElementById('mon-espera').style.display      = 'block';
        document.getElementById('mon-espera').innerHTML =
            '<i class="fa-solid fa-hand-pointer" style="font-size:1.5em;opacity:.3;display:block;margin-bottom:8px;"></i>' +
            'Selecciona una Planta/Área en Información General para cargar los equipos';
        document.getElementById('monitoreo-tbody').innerHTML = '';
    }

    // ════════════════════════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════════════════════════
    init();
});
