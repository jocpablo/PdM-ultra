// anexo_termo.js — Anexo de Termografía con persistencia en BD

document.addEventListener('DOMContentLoaded', function () {
    const toast = (m, t = 'info') => window.PdM?.showToast(m, t) || console.log(m);

    let puntos = []; // [{id, nombre, datos, imagenIR, imagenVis, estado, acciones, sev}]

    // ── Fecha de hoy ──────────────────────────────────────────────
    const hoy = new Date().toISOString().split('T')[0];
    const fechaEl = document.getElementById('at-fecha');
    if (fechaEl && !fechaEl.value) fechaEl.value = hoy;

    // ── Autocompletar analista ────────────────────────────────────
    const analistaEl = document.getElementById('at-analista');
    if (analistaEl && !analistaEl.value) {
        const n = localStorage.getItem('defaultAnalystName');
        const c = localStorage.getItem('defaultAnalystRole');
        if (n) analistaEl.value = n + (c ? ' — ' + c : '');
    }

    // ── Código consecutivo ────────────────────────────────────────
    async function generarCodigo() {
        const el     = document.getElementById('visual-report-id');
        const hidden = document.getElementById('current_report_id');
        if (!el) return;
        if (hidden?.value?.startsWith('AnTer-')) { el.textContent = hidden.value; return; }
        try {
            // Use generales endpoint with custom prefix handling
            const now = new Date();
            const dd  = String(now.getDate()).padStart(2,'0');
            const m   = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][now.getMonth()];
            const yy  = String(now.getFullYear()).slice(-2);
            // Try DB for consecutive number
            const res = await PdM.apiFetch('/api/reportes/next-code?tecnica=anexo_termo');
            if (res?.ok) {
                const d = await res.json();
                // Replace prefix
                const num = d.code.split('-').pop();
                const code = `AnTer-${dd}-${m}-${yy}-${num}`;
                el.textContent = code;
                if (hidden) hidden.value = code;
            } else throw new Error();
        } catch {
            const now = new Date();
            const dd  = String(now.getDate()).padStart(2,'0');
            const m   = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][now.getMonth()];
            const yy  = String(now.getFullYear()).slice(-2);
            const code = `AnTer-${dd}-${m}-${yy}-${String(Math.floor(Math.random()*9999)+1).padStart(4,'0')}`;
            el.textContent = code;
            if (hidden) hidden.value = code;
        }
    }

    // ── Severity badge ────────────────────────────────────────────
    function sevBadge(val) {
        const cls = val==='B' ? 'sev-b' : val==='A' ? 'sev-a' : val==='C' ? 'sev-c' : 'sev-empty';
        return `<span class="sev-badge-table ${cls}">${val||'—'}</span>`;
    }

    // ── Comprimir imagen ──────────────────────────────────────────
    function compressImage(file, cb) {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const max = 1100; let w = img.width, h = img.height;
                if (w > max) { h = Math.round(h * max / w); w = max; }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                cb(canvas.toDataURL('image/jpeg', 0.88));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // ── Crear tarjeta de imagen (estilo espectro-card) ────────────
    function createImgCard(src, caption, onChangeSrc, onChangeCaption, onDelete, label) {
        const card = document.createElement('div');
        card.className = 'at-img-card';
        const hasSrc = src && src.length > 10;
        card.innerHTML = `
            <div class="at-img-label-badge">${label}</div>
            <div class="at-img-zone" title="Clic: pegar portapapeles · Doble clic: buscar archivo">
                ${hasSrc
                    ? `<img src="${src}" alt="${label}">
                       <div class="at-img-overlay no-print"><i class="fa-solid fa-paste"></i> Pegar &nbsp;|&nbsp; <i class="fa-solid fa-folder-open"></i> Doble clic</div>`
                    : `<div class="at-img-placeholder">
                           <i class="fa-regular fa-image"></i>
                           <span>Clic: pegar portapapeles</span>
                           <small>Doble clic: buscar en PC</small>
                       </div>`}
            </div>
            <div class="at-img-footer">
                <input type="text" class="at-img-caption" placeholder="Descripción de la imagen..." value="${caption||''}">
                <button type="button" class="at-img-del-btn no-print" title="Eliminar imagen">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>`;

        const zone    = card.querySelector('.at-img-zone');
        const captInp = card.querySelector('.at-img-caption');
        const delBtn  = card.querySelector('.at-img-del-btn');

        function browseFile() {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*';
            inp.onchange = () => { if (inp.files[0]) compressImage(inp.files[0], src2 => { onChangeSrc(src2); refreshZone(src2); }); };
            inp.click();
        }
        async function pasteClipboard() {
            try {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    const t = item.types.find(x => x.startsWith('image/'));
                    if (t) {
                        const blob = await item.getType(t);
                        const file = new File([blob], 'paste.png', { type: t });
                        compressImage(file, src2 => { onChangeSrc(src2); refreshZone(src2); });
                        return;
                    }
                }
                toast('No hay imagen en el portapapeles.', 'info');
            } catch { browseFile(); }
        }
        function refreshZone(newSrc) {
            zone.innerHTML = `<img src="${newSrc}" alt="${label}">
                <div class="at-img-overlay no-print"><i class="fa-solid fa-paste"></i> Pegar &nbsp;|&nbsp; <i class="fa-solid fa-folder-open"></i> Doble clic</div>`;
        }

        let timer = null;
        zone.addEventListener('click', () => {
            if (timer) { clearTimeout(timer); timer = null; return; }
            timer = setTimeout(() => { timer = null; pasteClipboard(); }, 220);
        });
        zone.addEventListener('dblclick', () => { if (timer) { clearTimeout(timer); timer = null; } browseFile(); });
        captInp.addEventListener('input', () => onChangeCaption(captInp.value));
        delBtn.addEventListener('click', () => { card.remove(); onDelete(); });

        return card;
    }

    // ── Crear sección de punto ────────────────────────────────────
    function createPuntoSection(punto) {
        const el = document.createElement('div');
        el.className = 'at-punto-card';
        el.dataset.id = punto.id;

        el.innerHTML = `
            <div class="at-punto-header">
                <div style="display:flex;align-items:center;gap:10px;flex:1;">
                    <i class="fa-solid fa-temperature-half" style="color:#fca5a5;"></i>
                    <input type="text" class="at-punto-name" value="${punto.nombre}" placeholder="Nombre del punto...">
                    <span class="at-sev-cell">${sevBadge(punto.sev)}</span>
                </div>
                <div class="at-punto-header-btns no-print">
                    <button type="button" class="at-sev-btn ${punto.sev==='B'?'active-b':''}" data-sev="B">B</button>
                    <button type="button" class="at-sev-btn ${punto.sev==='A'?'active-a':''}" data-sev="A">A</button>
                    <button type="button" class="at-sev-btn ${punto.sev==='C'?'active-c':''}" data-sev="C">C</button>
                    <button type="button" class="at-del-punto-btn" title="Eliminar punto">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>

            <div class="at-punto-body">
                <!-- Datos termográficos -->
                <div class="at-data-section">
                    <h5><i class="fa-solid fa-table-cells"></i> Datos del Punto</h5>
                    <table class="at-data-table">
                        <tr>
                            <td><label>No. Imagen IR:</label></td>
                            <td><input type="text" class="at-field" data-field="no_ir" value="${punto.datos?.no_ir||''}" placeholder="Ej: IMG_001"></td>
                            <td><label>No. Imagen Visual:</label></td>
                            <td><input type="text" class="at-field" data-field="no_vis" value="${punto.datos?.no_vis||''}" placeholder="Ej: IMG_002"></td>
                        </tr>
                        <tr>
                            <td><label>Temp. Máxima:</label></td>
                            <td><input type="text" class="at-field" data-field="temp_max" value="${punto.datos?.temp_max||''}" placeholder="Ej: 115.08 °C"></td>
                            <td><label>Temp. Referencia:</label></td>
                            <td><input type="text" class="at-field" data-field="temp_ref" value="${punto.datos?.temp_ref||''}" placeholder="Ej: 35.00 °C"></td>
                        </tr>
                        <tr>
                            <td><label>ΔT:</label></td>
                            <td><input type="text" class="at-field" data-field="delta_t" value="${punto.datos?.delta_t||''}" placeholder="Ej: 80.08 °C"></td>
                            <td><label>Emisividad (ε):</label></td>
                            <td><input type="text" class="at-field" data-field="emisividad" value="${punto.datos?.emisividad||'0.95'}" placeholder="Ej: 0.95"></td>
                        </tr>
                        <tr>
                            <td><label>Humedad Rel.:</label></td>
                            <td><input type="text" class="at-field" data-field="humedad" value="${punto.datos?.humedad||''}" placeholder="Ej: 50%"></td>
                            <td><label>Veloc. Viento:</label></td>
                            <td><input type="text" class="at-field" data-field="viento" value="${punto.datos?.viento||''}" placeholder="Ej: N/A"></td>
                        </tr>
                        <tr>
                            <td><label>Distancia:</label></td>
                            <td><input type="text" class="at-field" data-field="distancia" value="${punto.datos?.distancia||''}" placeholder="Ej: 0.50 m"></td>
                            <td><label>Amperaje:</label></td>
                            <td><input type="text" class="at-field" data-field="amperaje" value="${punto.datos?.amperaje||''}" placeholder="Ej: 24 A"></td>
                        </tr>
                    </table>
                </div>

                <!-- Imágenes IR y visible -->
                <div class="at-images-section">
                    <h5><i class="fa-solid fa-images"></i> Imágenes Termográficas</h5>
                    <div class="at-imgs-grid" id="imgs-${punto.id}"></div>
                </div>

                <!-- Estado y acciones -->
                <div class="at-text-section">
                    <div class="at-text-col">
                        <h5><i class="fa-solid fa-circle-info"></i> Estado / Diagnóstico</h5>
                        <textarea class="at-textarea at-field" data-field="estado" rows="3" placeholder="Describa el hallazgo termográfico, temperatura máxima encontrada, componente afectado...">${punto.estado||''}</textarea>
                    </div>
                    <div class="at-text-col">
                        <h5><i class="fa-solid fa-screwdriver-wrench"></i> Acciones Recomendadas</h5>
                        <textarea class="at-textarea at-field" data-field="acciones" rows="3" placeholder="Acciones correctivas o preventivas, prioridad, plazo sugerido...">${punto.acciones||''}</textarea>
                    </div>
                </div>
            </div>`;

        // Inject image cards
        const imgsGrid = el.querySelector(`#imgs-${punto.id}`);
        const irCard = createImgCard(
            punto.imagenIR, punto.captionIR,
            src => { punto.imagenIR = src; },
            cap => { punto.captionIR = cap; },
            () => { punto.imagenIR = ''; punto.captionIR = ''; },
            'Imagen Infrarroja (IR)'
        );
        const visCard = createImgCard(
            punto.imagenVis, punto.captionVis,
            src => { punto.imagenVis = src; },
            cap => { punto.captionVis = cap; },
            () => { punto.imagenVis = ''; punto.captionVis = ''; },
            'Imagen Visual'
        );
        imgsGrid.appendChild(irCard);
        imgsGrid.appendChild(visCard);

        // Listeners
        el.querySelector('.at-punto-name').addEventListener('input', e => { punto.nombre = e.target.value; });

        el.querySelectorAll('.at-sev-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = btn.dataset.sev;
                punto.sev = punto.sev === v ? '' : v;
                el.querySelectorAll('.at-sev-btn').forEach(b => {
                    b.classList.remove('active-b','active-a','active-c');
                    if (b.dataset.sev === punto.sev) b.classList.add(`active-${punto.sev.toLowerCase()}`);
                });
                el.querySelector('.at-sev-cell').innerHTML = sevBadge(punto.sev);
            });
        });

        el.querySelectorAll('.at-field').forEach(inp => {
            inp.addEventListener('input', e => {
                const field = e.target.dataset.field;
                if (['estado','acciones'].includes(field)) {
                    punto[field] = e.target.value;
                } else {
                    if (!punto.datos) punto.datos = {};
                    punto.datos[field] = e.target.value;
                }
            });
        });

        el.querySelector('.at-del-punto-btn').addEventListener('click', () => {
            if (!confirm('¿Eliminar este punto termográfico?')) return;
            puntos = puntos.filter(p => p.id !== punto.id);
            el.remove();
            updateEmptyMsg();
        });

        return el;
    }

    function updateEmptyMsg() {
        const empty = document.getElementById('puntos-empty');
        if (empty) empty.style.display = puntos.length === 0 ? 'block' : 'none';
    }

    function renderPuntos(data) {
        const container = document.getElementById('puntos-container');
        container.innerHTML = '';
        data.forEach(p => container.appendChild(createPuntoSection(p)));
        updateEmptyMsg();
    }

    // ── Añadir nuevo punto ────────────────────────────────────────
    document.getElementById('btn-add-punto')?.addEventListener('click', () => {
        const num = puntos.length + 1;
        const p = { id: Date.now(), nombre: `Punto Termográfico ${num}`, datos: { emisividad: '0.95' },
                    imagenIR: '', captionIR: '', imagenVis: '', captionVis: '', estado: '', acciones: '', sev: '' };
        puntos.push(p);
        const container = document.getElementById('puntos-container');
        container.appendChild(createPuntoSection(p));
        updateEmptyMsg();
        setTimeout(() => p && container.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    });

    // ── Recolectar datos ──────────────────────────────────────────
    function collectData() {
        const info = {};
        ['at-equipo','at-ubicacion','at-fecha','at-analista','at-camara','at-emisividad'].forEach(id => {
            const el = document.getElementById(id); if (el) info[id] = el.value;
        });
        const raEl = document.getElementById('at-reporte-asociado'); if(raEl) info['at-reporte-asociado'] = raEl.value;
        const firma = document.querySelector('.cargo-analista')?.value || '';
        return { codigo: document.getElementById('current_report_id')?.value||'', info, puntos, firma };
    }

    // ── Restaurar datos ───────────────────────────────────────────
    function restoreData(datos) {
        if (!datos) return;
        if (datos.codigo) {
            document.getElementById('visual-report-id').textContent = datos.codigo;
            document.getElementById('current_report_id').value = datos.codigo;
        }
        if (datos.info) {
            Object.entries(datos.info).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.value = val; });
        }
        if (datos.firma) { const el = document.querySelector('.cargo-analista'); if (el) el.value = datos.firma; }
        if (datos.puntos?.length) { puntos = datos.puntos; renderPuntos(puntos); }
        if (window.PdM?.renderFirmaSelectors) PdM.renderFirmaSelectors();
    }

    // ── Guardar en BD ─────────────────────────────────────────────
    async function guardarReporte() {
        const datos = collectData();
        const codigo = datos.codigo;
        let dbId = document.getElementById('db_report_id')?.value;
        const estadoEl = document.getElementById('reporte-estado');
        if (estadoEl) estadoEl.textContent = 'Guardando...';
        try {
            let res;
            if (dbId) {
                res = await PdM.apiFetch(`/api/reportes/${dbId}`, { method:'PUT', body:JSON.stringify({ titulo:codigo, datos }) });
                // Fallback a POST si fue eliminado externamente
                if (res?.status === 404) {
                    dbId = '';
                    const h = document.getElementById('db_report_id');
                    if (h) h.value = '';
                }
            }
            if (!dbId) {
                res = await PdM.apiFetch('/api/reportes', { method:'POST', body:JSON.stringify({ tecnica:'anexo_termo', titulo:codigo, datos, codigo_reporte:codigo }) });
                if (res?.ok) {
                    const d = await res.json();
                    const h = document.getElementById('db_report_id');
                    if (h) h.value = d.id;
                }
            }
            if (res?.ok) {
                toast(`✅ Anexo guardado: ${codigo}`, 'success');
                if (estadoEl) estadoEl.textContent = '✓ Guardado ' + new Date().toLocaleTimeString('es');
            } else {
                const errBody = await res?.json().catch(() => ({}));
                toast('❌ Error al guardar: ' + (errBody?.error || res?.status || 'desconocido'), 'error');
                if (estadoEl) estadoEl.textContent = '';
            }
        } catch { toast('❌ Error de conexión.','error'); }
    }

    // ── Cargar lista ──────────────────────────────────────────────
    async function mostrarLista() {
        try {
            const res = await PdM.apiFetch('/api/reportes?tecnica=anexo_termo');
            if (!res?.ok) return toast('Error al obtener lista.','error');
            const lista = await res.json();
            if (!lista.length) return toast('No hay anexos de termografía guardados.','info');
            let modal = document.getElementById('modal-reportes-lista');
            if (modal) modal.remove();
            modal = document.createElement('div');
            modal.id = 'modal-reportes-lista'; modal.className = 'modal-overlay'; modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="modal-content config-modal-box" style="max-width:600px;width:95%;">
                    <div class="modal-header">
                        <h3><i class="fa-solid fa-folder-open"></i> Anexos Guardados — Termografía</h3>
                        <span style="cursor:pointer;font-size:1.4em;color:var(--text-muted);" id="close-rl">&times;</span>
                    </div>
                    <div id="lista-rl" style="max-height:420px;overflow-y:auto;"></div>
                </div>`;
            document.body.appendChild(modal);
            document.getElementById('close-rl').onclick = () => modal.remove();
            modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
            document.getElementById('lista-rl').innerHTML = lista.map(r => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);">
                    <div>
                        <div style="font-weight:700;color:var(--primary);font-size:0.95em;">${r.codigo_reporte||r.titulo||'Sin código'}</div>
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
                    if (!r2?.ok) return toast('Error al cargar.','error');
                    const rep = await r2.json();
                    const h = document.getElementById('db_report_id'); if(h) h.value=rep.id;
                    restoreData(rep.datos); modal.remove();
                    toast(`✅ Anexo ${rep.datos?.codigo||''} cargado.`,'success');
                };
            });
            document.querySelectorAll('.btn-borrar').forEach(btn => {
                btn.onclick = async () => {
                    if (!confirm('¿Eliminar este anexo?')) return;
                    const r2 = await PdM.apiFetch(`/api/reportes/${btn.dataset.id}`,{method:'DELETE'});
                    if (r2?.ok) { btn.closest('div[style]').remove(); toast('Eliminado.','info'); }
                };
            });
        } catch { toast('Error de conexión.','error'); }
    }

    // ── Buscar por código ─────────────────────────────────────────
    async function buscarPorCodigo() {
        const codigo = document.getElementById('buscar-codigo-input')?.value?.trim();
        if (!codigo) { toast('Ingresa un código. Ej: AnTer-19-mar-26-0001','info'); return; }
        try {
            const res = await PdM.apiFetch(`/api/reportes/by-code/${encodeURIComponent(codigo)}`);
            if (!res?.ok) { toast(`No se encontró "${codigo}".`,'error'); return; }
            const rep = await res.json();
            const h = document.getElementById('db_report_id'); if(h) h.value=rep.id;
            restoreData(rep.datos);
            document.getElementById('buscar-codigo-input').value = '';
            toast(`✅ Anexo ${codigo} cargado.`,'success');
        } catch { toast('Error de conexión.','error'); }
    }

    // ── Nuevo ─────────────────────────────────────────────────────
    document.getElementById('btn-nuevo-reporte')?.addEventListener('click', () => {
        if (!confirm('¿Iniciar un nuevo anexo? Los cambios no guardados se perderán.')) return;
        document.getElementById('db_report_id').value = '';
        document.getElementById('current_report_id').value = '';
        puntos = [];
        document.getElementById('puntos-container').innerHTML = '';
        updateEmptyMsg();
        ['at-equipo','at-ubicacion','at-analista','at-camara'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
        document.getElementById('at-emisividad').value = '';
        document.getElementById('at-fecha').value = new Date().toISOString().split('T')[0];
        document.querySelector('.cargo-analista').value = '';
        // ── Reporte Asociado — lookup en vivo ───────────────────────
    const raInput = document.getElementById('at-reporte-asociado');
    const raLink  = document.getElementById('at-link-reporte');
    if (raInput && raLink) {
        raInput.addEventListener('input', async () => {
            const cod = raInput.value.trim();
            if (cod.length < 6) { raLink.style.display='none'; return; }
            try {
                const r = await PdM.apiFetch(`/api/reportes/by-code/${encodeURIComponent(cod)}`);
                if (r?.ok) {
                    raLink.style.display = 'inline';
                    raLink.innerHTML = `<span style="color:var(--success);font-size:0.78em;font-weight:700;">
                        <i class="fa-solid fa-check-circle"></i> Reporte encontrado</span>`;
                } else {
                    raLink.style.display = 'inline';
                    raLink.innerHTML = `<span style="color:var(--text-muted);font-size:0.78em;">
                        <i class="fa-solid fa-magnifying-glass"></i> No encontrado</span>`;
                }
            } catch { raLink.style.display='none'; }
        });
    }

    generarCodigo();
        toast('Nuevo anexo iniciado.','info');
    });

    // ── Listeners ─────────────────────────────────────────────────
    document.getElementById('btn-guardar-reporte')?.addEventListener('click', guardarReporte);
    document.getElementById('btn-cargar-reporte')?.addEventListener('click', mostrarLista);
    document.getElementById('btn-buscar-codigo')?.addEventListener('click', buscarPorCodigo);
    document.getElementById('buscar-codigo-input')?.addEventListener('keydown', e => { if(e.key==='Enter') buscarPorCodigo(); });

    window.addEventListener('beforeprint', () => {
        const codigo = document.getElementById('visual-report-id')?.textContent?.trim();
        if (codigo && !codigo.includes('Generando')) document.title = 'Anexo Termografía — ' + codigo;
    });

    // ── Init ──────────────────────────────────────────────────────
    generarCodigo();
    if (window.PdM?.renderFirmaSelectors) PdM.renderFirmaSelectors();
    updateEmptyMsg();
});
