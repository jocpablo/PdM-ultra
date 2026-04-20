// termografia.js — Reporte de Termografía con persistencia en BD

document.addEventListener('DOMContentLoaded', function () {
    const toast = (m, t = 'info') => window.PdM?.showToast(m, t) || console.log(m);

    const tbody       = document.getElementById('termografia-results-tbody');
    const addRowBtn   = document.getElementById('termografia-add-row');
    const deleteBtn   = document.getElementById('termografia-delete-rows');
    const selectAll   = document.getElementById('termografia-select-all');
    const importBtn   = document.getElementById('termografia-import-csv');
    const csvInput    = document.getElementById('termografia-csv-input');

    const STATUS_COLORS = { B:'#22c55e', A:'#FFFF00', C:'#b81414', N:'#94a3b8', '':'#e2e8f0' };
    const STATUS_TEXT   = { B:'#fff', A:'#6b5a00', C:'#fff', N:'#fff', '':'#666' };

    // ── Fechas ────────────────────────────────────────────────────
    const hoy = new Date().toISOString().split('T')[0];
    ['fecha-inspeccion-1','fecha-reporte-1'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = hoy;
    });

    // ── Código consecutivo ────────────────────────────────────────
    async function generarCodigo() {
        const el = document.getElementById('visual-report-id');
        const hidden = document.getElementById('current_report_id');
        if (!el) return;
        if (hidden?.value?.startsWith('Ter-')) { el.textContent = hidden.value; return; }
        try {
            const res = await PdM.apiFetch('/api/reportes/next-code?tecnica=termografia');
            if (res?.ok) {
                const d = await res.json();
                el.textContent = d.code;
                if (hidden) hidden.value = d.code;
            }
        } catch {
            const now = new Date();
            const dd  = String(now.getDate()).padStart(2,'0');
            const m   = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][now.getMonth()];
            const yy  = String(now.getFullYear()).slice(-2);
            const code = `Ter-${dd}-${m}-${yy}-${String(Math.floor(Math.random()*9999)+1).padStart(4,'0')}`;
            el.textContent = code;
            if (hidden) hidden.value = code;
        }
    }

    // ── Badge de severidad (igual que vibraciones) ────────────────
    function sevBadge(val) {
        const cls = val==='B' ? 'sev-b' : val==='A' ? 'sev-a' : val==='C' ? 'sev-c' : 'sev-empty';
        return `<span class="sev-badge-table ${cls}">${val||'—'}</span>`;
    }

    function setSeverityRow(tr, val) {
        val = (val||'').toUpperCase();
        const cell = tr.querySelector('.sev-cell');
        if (cell) cell.innerHTML = sevBadge(val);
        tr.dataset.sev = val;
        // Update active btn
        tr.querySelectorAll('.termo-sev-btn').forEach(b => {
            b.classList.remove('active-b','active-a','active-c');
            if (b.dataset.sev === val) b.classList.add(`active-${val.toLowerCase()}`);
        });
    }

    // ── Crear fila ────────────────────────────────────────────────
    function createRow(data = {}) {
        const tr = document.createElement('tr');
        const val = (data.severidad || '').toUpperCase();
        tr.dataset.sev = val;

        tr.innerHTML = `
            <td class="termografia-select-col no-print" style="text-align:center;">
                <input type="checkbox" class="row-checkbox">
            </td>
            <td>
                <input type="text" class="termografia-input" value="${data.equipo || ''}" placeholder="Ej: Motor Bomba P-101">
            </td>
            <td>
                <input type="text" class="termografia-input" value="${data.mes || ''}" placeholder="Ej: Marzo 2026">
            </td>
            <td>
                <input type="text" class="termografia-input" value="${data.ubicacion || ''}" placeholder="Ej: Sala de Máquinas">
            </td>
            <td>
                <textarea class="termografia-input" placeholder="Acciones recomendadas..." style="min-height:38px;">${data.acciones || ''}</textarea>
            </td>
            <td style="text-align:center;vertical-align:middle;">
                <div style="display:flex;flex-direction:column;align-items:center;gap:5px;">
                    <div class="sev-cell">${sevBadge(val)}</div>
                    <div class="termo-sev-picker no-print">
                        <button type="button" class="sev-btn termo-sev-btn ${val==='B'?'active-b':''}" data-sev="B">B</button>
                        <button type="button" class="sev-btn termo-sev-btn ${val==='A'?'active-a':''}" data-sev="A">A</button>
                        <button type="button" class="sev-btn termo-sev-btn ${val==='C'?'active-c':''}" data-sev="C">C</button>
                    </div>
                </div>
            </td>`;

        tr.querySelectorAll('.termo-sev-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const current = tr.dataset.sev;
                setSeverityRow(tr, current === btn.dataset.sev ? '' : btn.dataset.sev);
            });
        });
        return tr;
    }

    // ── Botones tabla ─────────────────────────────────────────────
    addRowBtn?.addEventListener('click', () => { tbody.appendChild(createRow()); });

    deleteBtn?.addEventListener('click', () => {
        tbody.querySelectorAll('.row-checkbox:checked').forEach(cb => cb.closest('tr').remove());
    });

    selectAll?.addEventListener('change', function () {
        tbody.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = this.checked);
    });

    // ── CSV import ────────────────────────────────────────────────
    importBtn?.addEventListener('click', () => csvInput?.click());
    csvInput?.addEventListener('change', function () {
        if (!this.files?.[0]) return;
        const reader = new FileReader();
        reader.onload = e => {
            const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
            if (lines.length < 2) { toast('El CSV parece vacío.','warning'); return; }
            tbody.innerHTML = '';
            lines.slice(1).forEach(line => {
                const cols = line.split(',').map(c => c.replace(/^"|"$/g,'').trim());
                tbody.appendChild(createRow({ equipo: cols[0], mes: cols[1], ubicacion: cols[2], acciones: cols[3], severidad: cols[4] }));
            });
        };
        reader.readAsText(this.files[0]);
        this.value = '';
    });



    // ── Pre-cargar equipos desde BD ───────────────────────────────
    async function loadEquiposFromDB() {
        try {
            const res = await window.PdM?.apiFetch('/api/equipos');
            if (!res?.ok) return;
            const equipos = await res.json();
            if (!equipos.length || (tbody.children.length > 1)) return;
            tbody.innerHTML = '';
            equipos.forEach(eq => tbody.appendChild(createRow({
                equipo: eq.asset_id + ' — ' + (eq.descripcion || ''),
                ubicacion: eq.ubicacion || ''
            })));
            toast(`✅ ${equipos.length} equipos cargados desde la base de datos.`, 'info');
        } catch { /* silently fail */ }
    }

    // ── Recolectar datos para guardar ─────────────────────────────
    function collectData() {
        const filas = [];
        tbody.querySelectorAll('tr').forEach(tr => {
            const inputs = [...tr.querySelectorAll('input.termografia-input, textarea.termografia-input')];
            filas.push([...inputs.map(i => i.value), tr.dataset.sev || '']);
        });
        const infoRows = [];
        document.querySelectorAll('#info-table tbody tr').forEach(tr => {
            infoRows.push([...tr.querySelectorAll('input')].map(i => ({ id: i.id||'', v: i.value })));
        });
        const firmas = [...document.querySelectorAll('.cargo-analista')].map(i => i.value);
        return {
            codigo:   document.getElementById('current_report_id')?.value || '',
            infoRows, firmas, filas
        };
    }

    // ── Restaurar datos ───────────────────────────────────────────
    function restoreData(datos) {
        if (!datos) return;
        if (datos.codigo) {
            const el = document.getElementById('visual-report-id');
            if (el) el.textContent = datos.codigo;
            const h = document.getElementById('current_report_id');
            if (h) h.value = datos.codigo;
        }
        if (datos.infoRows?.length) {
            datos.infoRows.forEach(row => row.forEach(f => {
                if (f.id) { const el = document.getElementById(f.id); if (el) el.value = f.v; }
            }));
        }
        if (datos.firmas?.length) {
            document.querySelectorAll('.cargo-analista').forEach((el, i) => {
                if (datos.firmas[i] !== undefined) el.value = datos.firmas[i];
            });
        }
        if (datos.filas?.length) {
            tbody.innerHTML = '';
            datos.filas.forEach(fila => {
                const tr = createRow({ equipo: fila[0]||'', mes: fila[1]||'', ubicacion: fila[2]||'', acciones: fila[3]||'', severidad: fila[4]||'' });
                tbody.appendChild(tr);
            });
        }
        if (window.PdM?.renderFirmaSelectors) PdM.renderFirmaSelectors();
    }

    // ── Guardar en BD ─────────────────────────────────────────────
    async function guardarReporte() {
        const datos    = collectData();
        const codigo   = datos.codigo;
        let dbId       = document.getElementById('db_report_id')?.value;
        const estadoEl = document.getElementById('reporte-estado');
        if (estadoEl) estadoEl.textContent = 'Guardando...';
        try {
            let res;
            if (dbId) {
                res = await PdM.apiFetch(`/api/reportes/${dbId}`, { method:'PUT', body: JSON.stringify({ titulo: codigo, datos }) });
                // Si el reporte fue eliminado desde otro lado, hacer fallback a POST
                if (res?.status === 404) {
                    dbId = '';
                    const h = document.getElementById('db_report_id');
                    if (h) h.value = '';
                }
            }
            if (!dbId) {
                res = await PdM.apiFetch('/api/reportes', { method:'POST', body: JSON.stringify({ tecnica:'termografia', titulo: codigo, datos, codigo_reporte: codigo }) });
                if (res?.ok) {
                    const d = await res.json();
                    const h = document.getElementById('db_report_id');
                    if (h) h.value = d.id;
                }
            }
            if (res?.ok) {
                toast(`✅ Reporte guardado: ${codigo}`, 'success');
                if (estadoEl) estadoEl.textContent = '✓ Guardado ' + new Date().toLocaleTimeString('es');
            } else {
                const errBody = await res?.json().catch(() => ({}));
                toast('❌ Error al guardar: ' + (errBody?.error || res?.status || 'desconocido'), 'error');
                if (estadoEl) estadoEl.textContent = '';
            }
        } catch {
            toast('❌ Error de conexión.', 'error');
            if (estadoEl) estadoEl.textContent = '';
        }
    }

    // ── Cargar desde BD ───────────────────────────────────────────
    async function mostrarListaReportes() {
        try {
            const res = await PdM.apiFetch('/api/reportes?tecnica=termografia');
            if (!res?.ok) return toast('Error al obtener lista.', 'error');
            const lista = await res.json();
            if (!lista.length) return toast('No hay reportes de termografía guardados.', 'info');

            let modal = document.getElementById('modal-reportes-lista');
            if (modal) modal.remove();
            modal = document.createElement('div');
            modal.id = 'modal-reportes-lista';
            modal.className = 'modal-overlay';
            modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="modal-content config-modal-box" style="max-width:600px;width:95%;">
                    <div class="modal-header">
                        <h3><i class="fa-solid fa-folder-open"></i> Reportes Guardados — Termografía</h3>
                        <span style="cursor:pointer;font-size:1.4em;color:var(--text-muted);" id="close-rl">&times;</span>
                    </div>
                    <div id="lista-rl" style="max-height:420px;overflow-y:auto;"></div>
                </div>`;
            document.body.appendChild(modal);
            document.getElementById('close-rl').onclick = () => modal.remove();
            modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

            document.getElementById('lista-rl').innerHTML = lista.map(r => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);">
                    <div>
                        <div style="font-weight:700;color:var(--primary);font-size:0.95em;">${r.codigo_reporte || r.titulo || 'Sin código'}</div>
                        <div style="font-size:0.78em;color:var(--text-muted);">${new Date(r.fecha_modificacion).toLocaleString('es')}</div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button class="termografia-button save-button btn-abrir" data-id="${r.id}" style="padding:6px 12px;font-size:0.82em;"><i class="fa-solid fa-folder-open"></i> Abrir</button>
                        <button class="termografia-button delete-button btn-borrar" data-id="${r.id}" style="padding:6px 10px;font-size:0.82em;"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>`).join('');

            document.querySelectorAll('.btn-abrir').forEach(btn => {
                btn.onclick = async () => {
                    const r2 = await PdM.apiFetch(`/api/reportes/${btn.dataset.id}`);
                    if (!r2?.ok) return toast('Error al cargar.', 'error');
                    const rep = await r2.json();
                    const h = document.getElementById('db_report_id');
                    if (h) h.value = rep.id;
                    restoreData(rep.datos);
                    modal.remove();
                    toast(`✅ Reporte ${rep.datos?.codigo || ''} cargado.`, 'success');
                };
            });

            document.querySelectorAll('.btn-borrar').forEach(btn => {
                btn.onclick = async () => {
                    if (!confirm('¿Eliminar este reporte?')) return;
                    const r2 = await PdM.apiFetch(`/api/reportes/${btn.dataset.id}`, { method:'DELETE' });
                    if (r2?.ok) { btn.closest('div[style]').remove(); toast('Eliminado.','info'); }
                };
            });
        } catch { toast('Error de conexión.','error'); }
    }

    // ── Buscar por código ─────────────────────────────────────────
    async function buscarPorCodigo() {
        const codigo = document.getElementById('buscar-codigo-input')?.value?.trim();
        if (!codigo) { toast('Ingresa un código. Ej: Ter-19-mar-26-0001','info'); return; }
        try {
            const res = await PdM.apiFetch(`/api/reportes/by-code/${encodeURIComponent(codigo)}`);
            if (!res?.ok) { toast(`No se encontró el reporte "${codigo}".`, 'error'); return; }
            const rep = await res.json();
            const h = document.getElementById('db_report_id');
            if (h) h.value = rep.id;
            restoreData(rep.datos);
            document.getElementById('buscar-codigo-input').value = '';
            toast(`✅ Reporte ${codigo} cargado.`, 'success');
        } catch { toast('Error de conexión.','error'); }
    }

    // ── Nuevo reporte ─────────────────────────────────────────────
    document.getElementById('btn-nuevo-reporte')?.addEventListener('click', () => {
        if (!confirm('¿Iniciar un reporte nuevo? Los cambios no guardados se perderán.')) return;
        const h1 = document.getElementById('db_report_id'); if (h1) h1.value = '';
        const h2 = document.getElementById('current_report_id'); if (h2) h2.value = '';
        tbody.innerHTML = '';
        tbody.appendChild(createRow());
        ['equipo-utilizado-1','equipo-inspeccionado-1','asset-1','analista-1','extra1-1','extra2-1'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        const hoy2 = new Date().toISOString().split('T')[0];
        ['fecha-inspeccion-1','fecha-reporte-1'].forEach(id => { const el=document.getElementById(id); if(el) el.value=hoy2; });
        generarCodigo();
        toast('Nuevo reporte iniciado.','info');
    });

    // ── Listeners ─────────────────────────────────────────────────
    document.getElementById('btn-guardar-reporte')?.addEventListener('click', guardarReporte);
    document.getElementById('btn-cargar-reporte')?.addEventListener('click', mostrarListaReportes);
    document.getElementById('btn-buscar-codigo')?.addEventListener('click', buscarPorCodigo);
    document.getElementById('buscar-codigo-input')?.addEventListener('keydown', e => { if (e.key==='Enter') buscarPorCodigo(); });

    // Título del PDF
    window.addEventListener('beforeprint', () => {
        const codigo = document.getElementById('visual-report-id')?.textContent?.trim();
        if (codigo && !codigo.includes('Generando')) document.title = 'Reporte de Termografía — ' + codigo;
    });

    // ── Init ──────────────────────────────────────────────────────
    if (tbody.children.length === 0) tbody.appendChild(createRow());
    generarCodigo();
    loadEquiposFromDB();
    if (window.PdM?.renderFirmaSelectors) PdM.renderFirmaSelectors();
});
