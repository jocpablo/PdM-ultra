// vibraciones_script.js — Lógica completa del Reporte de Vibraciones

document.addEventListener('DOMContentLoaded', function () {

    // ── Referencias ────────────────────────────────────────────────
    const getEl = id => document.getElementById(id);
    const toast = (m, t = 'info') => window.PdM?.showToast(m, t) || console.log(m);

    const tablaResultados   = getEl('resultado-tbody');
    const areaDetalles      = getEl('espectros-details-area');
    const tablaInfoBody     = document.querySelector('#info-table tbody');
    const areaImagenesEq    = getEl('image-container-area');
    const assetInput        = getEl('asset-1');
    const assetSuggestions  = getEl('asset-suggestions');
    const assetNotFound     = getEl('asset-not-found');
    const equipoPanel       = getEl('equipo-data-panel');
    const equipoInfoStrip   = getEl('equipo-info-strip');
    const equipoFotosGrid   = getEl('equipo-fotos-grid');
    const descInput         = getEl('equipo-inspeccionado-1');

    let allEquipos = [];       // cache de equipos para autocomplete
    let currentEquipo = null;  // equipo actualmente cargado

    // ── 1. INICIALIZACIÓN ─────────────────────────────────────────
    async function init() {
        // Fechas de hoy
        const hoy = new Date().toISOString().split('T')[0];
        if (getEl('fecha-inspeccion-1') && !getEl('fecha-inspeccion-1').value) getEl('fecha-inspeccion-1').value = hoy;
        if (getEl('fecha-reporte-1')   && !getEl('fecha-reporte-1').value)    getEl('fecha-reporte-1').value   = hoy;

        // Primer componente vacío
        if (tablaResultados && tablaResultados.children.length === 0) addComponente();

        // Cargar lista de equipos para autocomplete
        await loadEquiposList();

        // Generar código consecutivo desde el servidor
        await generarCodigoReporte();

        // Autocompletar analista desde config
        const analista = localStorage.getItem('defaultAnalystName');
        const cargo    = localStorage.getItem('defaultAnalystRole');
        if (analista && getEl('analista-1') && !getEl('analista-1').value) {
            getEl('analista-1').value = analista + (cargo ? ' — ' + cargo : '');
        }
        // Render firma selectors (from global config)
        if (window.PdM?.renderFirmaSelectors) window.PdM.renderFirmaSelectors();
    }
    async function generarCodigoReporte() {
        const el = getEl('visual-report-id');
        const hidden = getEl('current_report_id');
        if (!el) return;

        // Si ya hay un código asignado (ej: al cargar un reporte existente), no regenerar
        if (hidden && hidden.value && hidden.value.startsWith('Vib-')) {
            el.textContent = hidden.value;
            return;
        }

        try {
            const res = await PdM.apiFetch('/api/reportes/next-code');
            if (res?.ok) {
                const data = await res.json();
                el.textContent = data.code;
                if (hidden) hidden.value = data.code;
            }
        } catch (e) {
            // Fallback local si no hay conexión
            const now = new Date();
            const dd  = String(now.getDate()).padStart(2, '0');
            const m   = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][now.getMonth()];
            const yy  = String(now.getFullYear()).slice(-2);
            const rnd = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0');
            const code = `Vib-${dd}-${m}-${yy}-${rnd}`;
            el.textContent = code;
            if (hidden) hidden.value = code;
        }
    }

    // ── 3. AUTOCOMPLETE DE ACTIVOS ────────────────────────────────
    async function loadEquiposList() {
        try {
            const res = await PdM.apiFetch('/api/equipos');
            if (res?.ok) allEquipos = await res.json();
        } catch (e) { /* silently fail */ }
    }

    function showSuggestions(query) {
        if (!assetSuggestions) return;
        const q = query.toLowerCase().trim();
        if (!q) { assetSuggestions.style.display = 'none'; return; }

        const matches = allEquipos.filter(e =>
            e.asset_id?.toLowerCase().includes(q) ||
            e.descripcion?.toLowerCase().includes(q)
        ).slice(0, 8);

        if (!matches.length) { assetSuggestions.style.display = 'none'; return; }

        assetSuggestions.innerHTML = matches.map(e => `
            <div class="asset-suggestion-item" data-id="${e.asset_id}">
                <div class="asi-id">${e.asset_id}</div>
                <div class="asi-desc">${e.descripcion || ''} · ${e.ubicacion || ''}</div>
            </div>`).join('');
        assetSuggestions.style.display = 'block';

        assetSuggestions.querySelectorAll('.asset-suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                assetInput.value = item.dataset.id;
                assetSuggestions.style.display = 'none';
                loadEquipoData(item.dataset.id);
                mostrarFichaLink(item.dataset.id);
            });
        });
    }

    if (assetInput) {
        assetInput.addEventListener('input', e => showSuggestions(e.target.value));
        assetInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                assetSuggestions.style.display = 'none';
                loadEquipoData(assetInput.value.trim());
            }
        });
        assetInput.addEventListener('blur', () => {
            setTimeout(() => { if (assetSuggestions) assetSuggestions.style.display = 'none'; }, 200);
        });
    }

    // ── 4. CARGAR DATOS DEL EQUIPO (fotos + info) ─────────────────
    function mostrarFichaLink(assetId) {
        let link = document.getElementById('ficha-link-vib');
        if (!link) {
            link = document.createElement('a');
            link.id = 'ficha-link-vib';
            link.target = '_blank';
            link.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:0.78em;color:var(--primary);text-decoration:none;padding:4px 10px;border:1px solid var(--primary);border-radius:20px;margin-left:8px;transition:background .15s;';
            link.innerHTML = '<i class="fa-solid fa-industry"></i> Ver hoja de vida';
            link.onmouseover = () => { link.style.background = 'var(--primary-light)'; };
            link.onmouseout = () => { link.style.background = 'transparent'; };
            const wrap = assetInput?.closest('td') || assetInput?.parentElement;
            if (wrap) wrap.appendChild(link);
        }
        link.href = `hojas-de-vida.html?highlight=${encodeURIComponent(assetId)}`;
    }

    async function loadEquipoData(assetId) {
        if (!assetId) { clearEquipoPanel(); return; }

        try {
            const res = await PdM.apiFetch(`/api/equipos/${encodeURIComponent(assetId)}`);
            if (!res?.ok) {
                clearEquipoPanel();
                if (assetNotFound) assetNotFound.style.display = 'flex';
                return;
            }
            const eq = await res.json();
            currentEquipo = eq;
            if (assetNotFound) assetNotFound.style.display = 'none';
            renderEquipoPanel(eq);
        } catch (e) {
            clearEquipoPanel();
        }
    }

    function clearEquipoPanel() {
        currentEquipo = null;
        if (equipoPanel)     equipoPanel.style.display = 'none';
        if (equipoInfoStrip) equipoInfoStrip.innerHTML = '';
        if (equipoFotosGrid) equipoFotosGrid.innerHTML = '';
    }

    function renderEquipoPanel(eq) {
        if (!equipoPanel) return;

        // Autocompletar descripción en info table
        if (descInput && !descInput.value) descInput.value = eq.descripcion || '';

        // Strip de datos técnicos
        if (equipoInfoStrip) {
            const fields = [
                { l: 'Marca',          v: eq.marca },
                { l: 'Modelo',         v: eq.modelo },
                { l: 'Potencia',       v: eq.potencia_hp ? eq.potencia_hp + ' HP' : null },
                { l: 'Voltaje',        v: eq.voltaje ? eq.voltaje + ' V' : null },
                { l: 'RPM',            v: eq.rpm },
                { l: 'Amperaje',       v: eq.amperaje ? eq.amperaje + ' A' : null },
                { l: 'Rod. DE',        v: eq.rodamiento_de },
                { l: 'Rod. ODE',       v: eq.rodamiento_ode },
                { l: 'Ubicación',      v: eq.ubicacion },
                { l: 'Criticidad',     v: eq.criticidad },
            ].filter(f => f.v);

            equipoInfoStrip.innerHTML = fields.map(f => `
                <div class="eif">
                    <span class="eif-label">${f.l}</span>
                    <span class="eif-value">${f.v}</span>
                </div>`).join('');
        }

        // Fotos del equipo desde BD → bd-foto-card con grid inteligente
        if (equipoFotosGrid) {
            const labels = ['Principal', 'Placa Motor', 'Componente', 'Panorámica'];
            const fotos = [eq.foto1, eq.foto2, eq.foto3, eq.foto4]
                .map((f, i) => ({ src: f, label: labels[i] }))
                .filter(f => f.src);

            equipoFotosGrid.innerHTML = '';

            if (fotos.length) {
                fotos.forEach(f => {
                    const card = document.createElement('div');
                    card.className = 'bd-foto-card';
                    card.innerHTML = `
                        <div class="bd-foto-zona">
                            <img src="${f.src}" alt="${f.label}">
                        </div>
                        <div class="bd-foto-footer">
                            <span class="bd-foto-label">${f.label}</span>
                            <span class="bd-foto-badge"><i class="fa-solid fa-database"></i> Gestión de Activos</span>
                        </div>`;
                    equipoFotosGrid.appendChild(card);
                });
                // Actualizar data-count para que el CSS aplique el layout correcto
                equipoFotosGrid.dataset.count = String(fotos.length);
            } else {
                equipoFotosGrid.innerHTML = '<p style="font-size:0.82em; color:var(--text-muted); padding:8px 0;">Este equipo no tiene fotos registradas en la BD.</p>';
            }
        }

        equipoPanel.style.display = 'block';
    }

    // ── 5. AÑADIR COMPONENTE ──────────────────────────────────────
    function sevBadge(val) {
        const cls = val === 'B' ? 'sev-b' : val === 'A' ? 'sev-a' : val === 'C' ? 'sev-c' : 'sev-empty';
        return `<span class="sev-badge-table ${cls}">${val || '—'}</span>`;
    }

    function setSeverityUI(card, row, val) {
        val = (val || '').toUpperCase();
        // Botones del picker
        card.querySelectorAll('.sev-btn').forEach(b => {
            b.classList.remove('active-b','active-a','active-c');
            if (b.dataset.sev === val) b.classList.add(`active-${val.toLowerCase()}`);
        });
        // Hidden input
        const hidden = card.querySelector('.sync-severity');
        if (hidden) hidden.value = val;
        // Badge del header de la tarjeta
        const badge = card.querySelector('.comp-card-badge');
        if (badge) {
            badge.className = 'comp-card-badge ' + (val === 'B' ? 'comp-badge-b' : val === 'A' ? 'comp-badge-a' : val === 'C' ? 'comp-badge-c' : 'comp-badge-empty');
            badge.textContent = val || '—';
        }
        // Celda de la tabla — badge icono
        if (row) {
            const cell = row.querySelector('.severity-cell');
            if (cell) cell.innerHTML = sevBadge(val);
        }
    }

    function addComponente(data = {}) {
        const id    = data.id || `comp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
        const index = tablaResultados.children.length + 1;
        const nombre = data.nombre || `Componente ${index}`;
        const sev    = (data.severidad || '').toUpperCase();

        // ── Fila en tabla resumen ──
        const tr = document.createElement('tr');
        tr.dataset.compId = id;
        tr.innerHTML = `
            <td>
                <input type="text" class="component-name-input" value="${nombre}"
                    placeholder="Ej: Rodamiento DE Motor">
            </td>
            <td class="status-cell">${data.estado ? data.estado.substring(0,80) + (data.estado.length > 80 ? '…' : '') : '<span style="color:var(--text-muted);font-style:italic;font-size:0.85em;">Sin diagnóstico</span>'}</td>
            <td class="actions-cell">${data.acciones ? data.acciones.substring(0,80) + (data.acciones.length > 80 ? '…' : '') : '<span style="color:var(--text-muted);font-style:italic;font-size:0.85em;">Sin acciones</span>'}</td>
            <td class="severity-cell">${sevBadge(sev)}</td>
            <td class="no-print" style="text-align:center;">
                <button class="delete-row-btn" title="Eliminar componente"><i class="fa-solid fa-trash-can"></i></button>
            </td>`;
        tablaResultados.appendChild(tr);

        // ── Tarjeta de detalles ──
        const card = document.createElement('div');
        card.className = 'component-details-section';
        card.id = `details-${id}`;
        card.dataset.compId = id;

        card.innerHTML = `
            <!-- Header -->
            <div class="comp-card-header">
                <div class="comp-card-title">
                    <i class="fa-solid fa-wave-square"></i>
                    <span class="dynamic-title">${nombre}</span>
                </div>
                <span class="comp-card-badge ${sev === 'B' ? 'comp-badge-b' : sev === 'A' ? 'comp-badge-a' : sev === 'C' ? 'comp-badge-c' : 'comp-badge-empty'}">${sev || '—'}</span>
            </div>

            <!-- Body -->
            <div class="comp-card-body">

                <!-- Estado -->
                <div class="comp-field">
                    <div class="comp-field-label"><i class="fa-solid fa-stethoscope"></i> Estado / Diagnóstico</div>
                    <textarea class="sync-status" rows="4"
                        placeholder="Describa la condición actual del componente, niveles de vibración medidos, comparación con línea base...">${data.estado || ''}</textarea>
                </div>

                <!-- Acciones -->
                <div class="comp-field">
                    <div class="comp-field-label"><i class="fa-solid fa-wrench"></i> Acciones Recomendadas</div>
                    <textarea class="sync-actions" rows="4"
                        placeholder="Acciones correctivas o preventivas recomendadas, prioridad, plazo sugerido...">${data.acciones || ''}</textarea>
                </div>

                <!-- Severidad -->
                <div class="comp-field">
                    <div class="comp-field-label"><i class="fa-solid fa-triangle-exclamation"></i> Severidad</div>
                    <div class="severity-picker">
                        <button type="button" class="sev-btn ${sev === 'B' ? 'active-b' : ''}" data-sev="B">B</button>
                        <button type="button" class="sev-btn ${sev === 'A' ? 'active-a' : ''}" data-sev="A">A</button>
                        <button type="button" class="sev-btn ${sev === 'C' ? 'active-c' : ''}" data-sev="C">C</button>
                        <input type="hidden" class="sync-severity" value="${sev}">
                        <span class="sev-legend">B = Bueno &nbsp;·&nbsp; A = Alerta &nbsp;·&nbsp; C = Crítico</span>
                    </div>
                </div>

                <!-- Espectros -->
                <div class="comp-field span2">
                    <div class="comp-field-label"><i class="fa-solid fa-chart-line"></i> Espectros / Imágenes de Vibración</div>
                    <div class="espectro-grid component-image-area"></div>
                    <button type="button" class="btn-add-espectro add-comp-img-btn no-print">
                        <i class="fa-solid fa-plus"></i> Añadir Espectro o Imagen
                    </button>
                </div>

            </div>`;

        areaDetalles.appendChild(card);

        // Restaurar imágenes guardadas
        if (data.imagenes?.length) {
            const grid = card.querySelector('.component-image-area');
            data.imagenes.forEach(img => crearEspectroCard(grid, img.src, img.caption));
        }

        // ── Eventos ──
        tr.querySelector('.delete-row-btn').onclick = () => {
            if (confirm('¿Eliminar este componente y sus detalles?')) {
                tr.remove(); card.remove();
            }
        };

        // Severity picker buttons
        card.querySelectorAll('.sev-btn').forEach(btn => {
            btn.onclick = () => {
                const current = card.querySelector('.sync-severity').value;
                const newVal = current === btn.dataset.sev ? '' : btn.dataset.sev;
                setSeverityUI(card, tr, newVal);
            };
        });

        // Añadir espectro
        card.querySelector('.add-comp-img-btn').onclick = e => {
            e.preventDefault();
            crearEspectroCard(card.querySelector('.component-image-area'));
        };

        return { tr, card };
    }

    // ── 6. SINCRONIZACIÓN INPUT ───────────────────────────────────
    document.body.addEventListener('input', e => {
        const t = e.target;

        // Nombre del componente — manejo independiente para garantizar sync
        if (t.classList.contains('component-name-input')) {
            const compId = t.closest('tr')?.dataset.compId;
            if (!compId) return;
            const card = document.getElementById(`details-${compId}`);
            const title = card?.querySelector('.dynamic-title');
            if (title) title.textContent = t.value || 'Componente';
            return;
        }

        const compId = t.closest('tr')?.dataset.compId || t.closest('.component-details-section')?.dataset.compId;
        if (!compId) return;

        const row  = (() => { for (const r of document.querySelectorAll('#resultado-tbody tr')) { if (r.dataset.compId === compId) return r; } return null; })();
        const card = document.getElementById(`details-${compId}`);
        if (!card) return;
        if (t.classList.contains('sync-status')) {
            const cell = row.querySelector('.status-cell');
            const txt  = t.value.trim();
            cell.innerHTML = txt
                ? txt.substring(0,80) + (txt.length > 80 ? '…' : '')
                : '<span style="color:var(--text-muted);font-style:italic;font-size:0.85em;">Sin diagnóstico</span>';
        }
        if (t.classList.contains('sync-actions')) {
            const cell = row.querySelector('.actions-cell');
            const txt  = t.value.trim();
            cell.innerHTML = txt
                ? txt.substring(0,80) + (txt.length > 80 ? '…' : '')
                : '<span style="color:var(--text-muted);font-style:italic;font-size:0.85em;">Sin acciones</span>';
        }
    });

    // ── 7. ESPECTROS / IMÁGENES ───────────────────────────────────

    // Actualiza el atributo data-count del grid para que el CSS ajuste columnas
    function updateGridCount(grid) {
        const n = grid.querySelectorAll('.espectro-card').length;
        grid.dataset.count = n <= 6 ? String(n) : 'many';
    }

    function crearEspectroCard(grid, src, caption) {
        const card = document.createElement('div');
        card.className = 'espectro-card';
        const hasSrc = src && src.length > 10;
        card.innerHTML = `
            <div class="espectro-img-zone" tabindex="0" title="Clic: pegar imagen · Doble clic: buscar archivo">
                <img src="${hasSrc ? src : ''}" style="display:${hasSrc ? 'block' : 'none'};">
                <div class="espectro-placeholder" style="${hasSrc ? 'display:none' : ''}">
                    <i class="fa-solid fa-chart-area"></i>
                    <span>Clic para pegar del portapapeles</span>
                    <span class="esp-hint">Doble clic para buscar archivo</span>
                </div>
                <div class="espectro-img-overlay"><i class="fa-solid fa-paste"></i> Pegar / <i class="fa-solid fa-folder-open"></i> Buscar</div>
            </div>
            <input type="file" accept="image/*" style="display:none;" class="esp-file-input">
            <div class="espectro-footer">
                <input type="text" class="espectro-caption image-caption" value="${caption || ''}"
                    placeholder="Ej: Espectro velocidad — Rod. DE — H1">
                <button type="button" class="espectro-delete-btn" title="Eliminar">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>`;

        const imgEl  = card.querySelector('img');
        const place  = card.querySelector('.espectro-placeholder');
        const zone   = card.querySelector('.espectro-img-zone');
        const fileIn = card.querySelector('.esp-file-input');

        function loadFile(file) {
            if (!file?.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = ev => {
                imgEl.src = ev.target.result;
                imgEl.style.display = 'block';
                place.style.display = 'none';
            };
            reader.readAsDataURL(file);
        }

        // ── Un clic: seleccionar la tarjeta para recibir paste ──
        let selected = false;
        zone.addEventListener('click', e => {
            // Deselect all other cards first
            document.querySelectorAll('.espectro-card.esp-selected').forEach(c => {
                if (c !== card) {
                    c.classList.remove('esp-selected');
                    c.querySelector('.espectro-img-zone')?.setAttribute('data-sel', '');
                }
            });
            selected = !selected || true; // always select on click
            card.classList.add('esp-selected');
            zone.focus();
        });

        // ── Doble clic: abrir explorador de archivos ──
        zone.addEventListener('dblclick', e => {
            e.preventDefault();
            fileIn.click();
        });

        fileIn.addEventListener('change', function () {
            if (this.files?.[0]) loadFile(this.files[0]);
        });

        // ── Pegar con Ctrl+V cuando la tarjeta está seleccionada ──
        zone.addEventListener('paste', e => {
            const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
            if (item) { loadFile(item.getAsFile()); e.preventDefault(); }
        });

        // También escuchar paste global cuando esta tarjeta está seleccionada
        zone.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                navigator.clipboard.read().then(items => {
                    for (const item of items) {
                        const imageType = item.types.find(t => t.startsWith('image/'));
                        if (imageType) {
                            item.getType(imageType).then(blob => loadFile(blob));
                            break;
                        }
                    }
                }).catch(() => {}); // fallback: zone's paste event handles it
            }
        });

        // ── Drag & drop ──
        zone.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('esp-drag'); });
        zone.addEventListener('dragleave', () => card.classList.remove('esp-drag'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            card.classList.remove('esp-drag');
            const file = e.dataTransfer?.files?.[0];
            if (file?.type.startsWith('image/')) loadFile(file);
        });

        // ── Eliminar ──
        card.querySelector('.espectro-delete-btn').onclick = () => {
            card.remove();
            updateGridCount(grid);
        };

        // ── Deselect when clicking outside ──
        document.addEventListener('click', e => {
            if (!card.contains(e.target)) card.classList.remove('esp-selected');
        }, { capture: false });

        grid.appendChild(card);
        updateGridCount(grid);
        return card;
    }

    // Alias para compatibilidad con otras partes del código
    function addImageContainer(container) { crearEspectroCard(container); }
    function addImageContainerWithData(container, src, caption) { crearEspectroCard(container, src, caption); }

    // ── 8. RECOLECTAR DATOS PARA GUARDAR ────────────────────────
    function collectData() {
        // Info general
        const infoRows = [];
        document.querySelectorAll('#info-table tbody tr').forEach(tr => {
            const vals = [...tr.querySelectorAll('input[type=text],input[type=date]')].map(i => ({ id: i.id || '', v: i.value }));
            infoRows.push(vals);
        });

        // Firmas
        const firmas = [...document.querySelectorAll('.cargo-analista')].map(i => i.value);

        // Componentes + imágenes
        const componentes = [];
        document.querySelectorAll('#resultado-tbody tr[data-comp-id]').forEach(tr => {
            const compId = tr.dataset.compId;
            const card   = document.getElementById(`details-${compId}`);
            const imagenes = [];
            card?.querySelectorAll('.espectro-card').forEach(ec => {
                const src     = ec.querySelector('img')?.src;
                const caption = ec.querySelector('.image-caption')?.value || '';
                if (src && src.length > 20 && !src.endsWith('#') && src !== window.location.href) imagenes.push({ src, caption });
            });
            componentes.push({
                id:        compId,
                nombre:    tr.querySelector('.component-name-input')?.value || '',
                estado:    card?.querySelector('.sync-status')?.value || '',
                acciones:  card?.querySelector('.sync-actions')?.value || '',
                severidad: (card?.querySelector('.sync-severity')?.value || '').toUpperCase(),
                imagenes,
            });
        });

        // Imágenes generales del equipo (manuales)
        const imagenesGenerales = [];
        document.querySelectorAll('#image-container-area .espectro-card').forEach(ec => {
            const src     = ec.querySelector('img')?.src;
            const caption = ec.querySelector('.image-caption')?.value || '';
            if (src && src.length > 20 && !src.endsWith('#') && src !== window.location.href) imagenesGenerales.push({ src, caption });
        });

        return {
            codigo:      getEl('current_report_id')?.value || '',
            asset_id:    assetInput?.value || '',
            infoRows,
            firmas,
            componentes,
            imagenesGenerales,
        };
    }

    // ── 9. RESTAURAR DATOS DESDE BD ──────────────────────────────
    function restoreData(datos) {
        if (!datos) return;

        // Código
        if (datos.codigo && getEl('visual-report-id')) {
            getEl('visual-report-id').textContent = datos.codigo;
            if (getEl('current_report_id')) getEl('current_report_id').value = datos.codigo;
        }

        // Asset
        if (datos.asset_id && assetInput) {
            assetInput.value = datos.asset_id;
            loadEquipoData(datos.asset_id);
        }

        // Info rows
        if (datos.infoRows?.length) {
            const rows = document.querySelectorAll('#info-table tbody tr');
            datos.infoRows.forEach((rowData, i) => {
                let tr = rows[i];
                if (!tr) {
                    // Add extra row
                    tr = document.createElement('tr');
                    tablaInfoBody.appendChild(tr);
                }
                rowData.forEach(field => {
                    if (field.id) {
                        const el = document.getElementById(field.id);
                        if (el) el.value = field.v;
                    }
                });
            });
        }

        // Firmas
        if (datos.firmas?.length) {
            document.querySelectorAll('.cargo-analista').forEach((el, i) => {
                if (datos.firmas[i] !== undefined) el.value = datos.firmas[i];
            });
        }

        // Componentes
        if (datos.componentes?.length) {
            tablaResultados.innerHTML = '';
            areaDetalles.innerHTML   = '';
            datos.componentes.forEach(comp => addComponente(comp));
        }

        // Imágenes generales
        if (datos.imagenesGenerales?.length && areaImagenesEq) {
            areaImagenesEq.innerHTML = '';
            datos.imagenesGenerales.forEach(img => crearEspectroCard(areaImagenesEq, img.src, img.caption));
        }
    }

    // ── 10. GUARDAR REPORTE EN BD ────────────────────────────────
    async function guardarReporte() {
        const datos       = collectData();
        const codigo      = datos.codigo;
        let dbId          = getEl('db_report_id')?.value;
        const estadoEl    = getEl('reporte-estado');

        if (estadoEl) estadoEl.textContent = 'Guardando...';

        try {
            let res;
            if (dbId) {
                res = await PdM.apiFetch(`/api/reportes/${dbId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ titulo: codigo, datos })
                });
                // Fallback a POST si el reporte fue eliminado externamente
                if (res?.status === 404) {
                    dbId = '';
                    if (getEl('db_report_id')) getEl('db_report_id').value = '';
                }
            }
            if (!dbId) {
                res = await PdM.apiFetch('/api/reportes', {
                    method: 'POST',
                    body: JSON.stringify({ tecnica: 'vibraciones', titulo: codigo, datos, codigo_reporte: codigo })
                });
                if (res?.ok) {
                    const d = await res.json();
                    if (getEl('db_report_id')) getEl('db_report_id').value = d.id;
                }
            }

            if (res?.ok) {
                toast('✅ Reporte guardado: ' + codigo, 'success');
                if (estadoEl) estadoEl.textContent = '✓ Guardado ' + new Date().toLocaleTimeString('es');
            } else {
                const errBody = await res?.json().catch(() => ({}));
                toast('❌ Error al guardar: ' + (errBody?.error || res?.status || 'desconocido'), 'error');
                if (estadoEl) estadoEl.textContent = '';
            }
        } catch (err) {
            toast('❌ Error de conexión al guardar.', 'error');
            if (estadoEl) estadoEl.textContent = '';
        }
    }

    // ── 11. CARGAR REPORTE DESDE BD ──────────────────────────────
    async function mostrarListaReportes() {
        try {
            const res = await PdM.apiFetch('/api/reportes?tecnica=vibraciones');
            if (!res?.ok) return toast('Error al obtener lista de reportes.', 'error');
            const lista = await res.json();

            if (!lista.length) return toast('No hay reportes de vibraciones guardados.', 'info');

            // Crear modal de selección
            let modal = document.getElementById('modal-reportes-lista');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'modal-reportes-lista';
                modal.className = 'modal-overlay';
                modal.style.display = 'flex';
                modal.innerHTML = `
                    <div class="modal-content config-modal-box" style="max-width:600px;width:95%;">
                        <div class="modal-header">
                            <h3><i class="fa-solid fa-folder-open"></i> Reportes Guardados — Vibraciones</h3>
                            <span style="cursor:pointer;font-size:1.4em;color:var(--text-muted);" id="close-rl">&times;</span>
                        </div>
                        <div id="lista-rl" style="max-height:420px;overflow-y:auto;"></div>
                    </div>`;
                document.body.appendChild(modal);
                document.getElementById('close-rl').onclick = () => modal.remove();
                modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
            } else {
                modal.style.display = 'flex';
            }

            const listaEl = document.getElementById('lista-rl');
            listaEl.innerHTML = lista.map(r => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);">
                    <div>
                        <div style="font-weight:700;color:var(--primary);font-size:0.95em;">${r.codigo_reporte || r.titulo || 'Sin código'}</div>
                        <div style="font-size:0.78em;color:var(--text-muted);">${new Date(r.fecha_modificacion).toLocaleString('es')}</div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button class="termografia-button save-button btn-abrir-reporte" data-id="${r.id}" style="padding:6px 12px;font-size:0.82em;">
                            <i class="fa-solid fa-folder-open"></i> Abrir
                        </button>
                        <button class="termografia-button delete-button btn-borrar-reporte" data-id="${r.id}" style="padding:6px 10px;font-size:0.82em;">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>`).join('');

            listaEl.querySelectorAll('.btn-abrir-reporte').forEach(btn => {
                btn.onclick = async () => {
                    const r2 = await PdM.apiFetch(`/api/reportes/${btn.dataset.id}`);
                    if (!r2?.ok) return toast('Error al cargar reporte.', 'error');
                    const rep = await r2.json();
                    // Limpiar y restaurar
                    tablaResultados.innerHTML = '';
                    areaDetalles.innerHTML   = '';
                    if (areaImagenesEq) areaImagenesEq.innerHTML = '';
                    if (getEl('db_report_id')) getEl('db_report_id').value = rep.id;
                    restoreData(rep.datos);
                    modal.remove();
                    toast('✅ Reporte ' + (rep.datos?.codigo || '') + ' cargado.', 'success');
                };
            });

            listaEl.querySelectorAll('.btn-borrar-reporte').forEach(btn => {
                btn.onclick = async () => {
                    if (!confirm('¿Eliminar este reporte permanentemente?')) return;
                    const r2 = await PdM.apiFetch(`/api/reportes/${btn.dataset.id}`, { method: 'DELETE' });
                    if (r2?.ok) { btn.closest('div[style]').remove(); toast('Reporte eliminado.', 'info'); }
                };
            });

        } catch (e) {
            toast('Error de conexión.', 'error');
        }
    }

    // ── 12. LISTENERS PRINCIPALES ────────────────────────────────
    if (getEl('btn-guardar-reporte')) getEl('btn-guardar-reporte').onclick = guardarReporte;
    if (getEl('btn-cargar-reporte'))  getEl('btn-cargar-reporte').onclick  = mostrarListaReportes;

    // Buscar por código consecutivo
    async function buscarPorCodigo() {
        const codigo = getEl('buscar-codigo-input')?.value?.trim();
        if (!codigo) { toast('Ingresa un código para buscar. Ej: Vib-19-mar-26-0001', 'info'); return; }
        try {
            const res = await PdM.apiFetch(`/api/reportes/by-code/${encodeURIComponent(codigo)}`);
            if (!res?.ok) { toast(`No se encontró ningún reporte con el código "${codigo}".`, 'error'); return; }
            const rep = await res.json();
            tablaResultados.innerHTML = '';
            areaDetalles.innerHTML   = '';
            if (areaImagenesEq) areaImagenesEq.innerHTML = '';
            if (getEl('db_report_id')) getEl('db_report_id').value = rep.id;
            restoreData(rep.datos);
            if (getEl('buscar-codigo-input')) getEl('buscar-codigo-input').value = '';
            toast(`✅ Reporte ${codigo} cargado.`, 'success');
        } catch (e) {
            toast('Error de conexión al buscar.', 'error');
        }
    }

    if (getEl('btn-buscar-codigo')) getEl('btn-buscar-codigo').onclick = buscarPorCodigo;
    if (getEl('buscar-codigo-input')) {
        getEl('buscar-codigo-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') buscarPorCodigo();
        });
    }

    if (getEl('btn-nuevo-reporte')) {
        getEl('btn-nuevo-reporte').onclick = () => {
            if (confirm('¿Iniciar un reporte nuevo? Los cambios no guardados se perderán.')) {
                if (getEl('db_report_id')) getEl('db_report_id').value = '';
                if (getEl('current_report_id')) getEl('current_report_id').value = '';
                tablaResultados.innerHTML = '';
                areaDetalles.innerHTML   = '';
                if (areaImagenesEq) areaImagenesEq.innerHTML = '';
                clearEquipoPanel();                // Reset info fields
                ['equipo-utilizado-1','equipo-inspeccionado-1','asset-1','analista-1','extra1-1','extra2-1'].forEach(id => {
                    const el = getEl(id);
                    if (el) el.value = '';
                });
                generarCodigoReporte();
                const hoy = new Date().toISOString().split('T')[0];
                if (getEl('fecha-inspeccion-1')) getEl('fecha-inspeccion-1').value = hoy;
                if (getEl('fecha-reporte-1'))    getEl('fecha-reporte-1').value    = hoy;
                addComponente();
                toast('Reporte nuevo iniciado.', 'info');
            }
        };
    }

    if (getEl('add-resultado-row-btn')) {
        getEl('add-resultado-row-btn').onclick = e => { e.preventDefault(); addComponente(); };
    }

    if (getEl('add-image-btn')) {
        getEl('add-image-btn').onclick = e => {
            e.preventDefault();
            crearEspectroCard(areaImagenesEq);
        };
    }

    // Cerrar sugerencias al hacer clic fuera
    document.addEventListener('click', e => {
        if (!e.target.closest('.asset-lookup-wrap') && assetSuggestions) {
            assetSuggestions.style.display = 'none';
        }
    });

    // ── INICIAR ───────────────────────────────────────────────────
    init();

    // ── Nombre automático del PDF al imprimir ──────────────────
    function actualizarTituloPagina() {
        const codigo = document.getElementById('visual-report-id')?.textContent?.trim();
        if (codigo && codigo !== '—' && !codigo.includes('Generando')) {
            document.title = 'Reporte de Vibraciones — ' + codigo;
        }
    }

    // Actualizar título cuando cambie el código
    const _origGen = generarCodigoReporte;

    // Observar cambios en el span del código
    const _codigoEl = document.getElementById('visual-report-id');
    if (_codigoEl) {
        new MutationObserver(() => actualizarTituloPagina()).observe(_codigoEl, { childList: true, subtree: true, characterData: true });
    }

    // También al imprimir
    window.addEventListener('beforeprint', actualizarTituloPagina);

});