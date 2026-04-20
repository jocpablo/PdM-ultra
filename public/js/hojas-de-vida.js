// hojas-de-vida.js — Gestión completa de Activos con persistencia en PostgreSQL

document.addEventListener('DOMContentLoaded', () => {

    // ── Referencias ─────────────────────────────────────────────
    const grid         = document.getElementById('equipos-grid');
    const modal        = document.getElementById('equipo-modal');
    const form         = document.getElementById('equipo-form');
    const modalTitle   = document.getElementById('modal-title');
    const btnNuevo     = document.getElementById('btn-nuevo-equipo');
    const searchInput  = document.getElementById('search-input');
    const filterCrit   = document.getElementById('filter-criticidad');
    const filterTipo   = document.getElementById('filter-tipo');
    const counter      = document.getElementById('hdv-counter');

    const toast = (m, t = 'info') => window.PdM?.showToast(m, t) || console.log(m);

    let equipos  = [];       // todos los equipos cargados
    let editMode = false;    // false = nuevo, true = edición
    let fotosBase64 = { foto1: '', foto2: '', foto3: '', foto4: '' };

    // ── TOGGLE CAMPOS TÉCNICOS ───────────────────────────────────
    window.toggleTechnicalFields = function () {
        const tipo = document.querySelector('input[name="tipo_sistema"]:checked')?.value || 'otro';
        const allFields = ['hvac','bomba','compresor','ventilador','generador','motoreductor','banda'];
        allFields.forEach(t => {
            const el = document.getElementById(`fields-${t}`);
            if (el) el.style.display = tipo === t ? 'grid' : 'none';
        });
    };

    // ── GESTIÓN DE FOTOS ─────────────────────────────────────────
    // ── Clipboard paste + file browse for fotos ─────────────────
    let fotoClickTimer = {};
    window.fotoClick = async function (key) {
        if (fotoClickTimer[key]) { clearTimeout(fotoClickTimer[key]); fotoClickTimer[key] = null; return; }
        fotoClickTimer[key] = setTimeout(async () => {
            fotoClickTimer[key] = null;
            try {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    const t = item.types.find(x => x.startsWith('image/'));
                    if (t) {
                        const blob = await item.getType(t);
                        const file = new File([blob], 'paste.png', { type: t });
                        procesarImagen({ files: [file] }, key);
                        return;
                    }
                }
                window.PdM?.showToast('No hay imagen en el portapapeles.', 'info');
            } catch { window.fotoFile(key); }
        }, 220);
    };
    window.fotoFile = function (key) {
        if (fotoClickTimer[key]) { clearTimeout(fotoClickTimer[key]); fotoClickTimer[key] = null; }
        document.getElementById(`input-${key}`)?.click();
    };

    window.procesarImagen = function (input, key) {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX = 900;
                let w = img.width, h = img.height;
                if (w > h) { if (w > MAX) { h = h * MAX / w; w = MAX; } }
                else       { if (h > MAX) { w = w * MAX / h; h = MAX; } }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
                setFotoPreview(key, dataUrl);
            };
        };
        reader.readAsDataURL(file);
    };

    function setFotoPreview(key, dataUrl) {
        fotosBase64[key] = dataUrl;
        const prev  = document.getElementById(`preview-${key}`);
        const place = document.getElementById(`placeholder-${key}`);
        const clear = document.getElementById(`clear-${key}`);
        if (prev)  { prev.src = dataUrl; prev.style.display = 'block'; }
        if (place) place.style.display = 'none';
        if (clear) clear.style.display = 'flex';
    }

    window.limpiarFoto = function (key) {
        fotosBase64[key] = '';
        const inp   = document.getElementById(`input-${key}`);
        const prev  = document.getElementById(`preview-${key}`);
        const place = document.getElementById(`placeholder-${key}`);
        const clear = document.getElementById(`clear-${key}`);
        if (inp)   inp.value = '';
        if (prev)  { prev.src = ''; prev.style.display = 'none'; }
        if (place) place.style.display = 'flex';
        if (clear) clear.style.display = 'none';
    };

    // ── CARGAR DESDE API ─────────────────────────────────────────
    async function cargarEquipos() {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin" style="font-size:2em;"></i><p style="margin-top:10px;">Cargando equipos...</p></div>';
        try {
            const res = await PdM.apiFetch('/api/equipos');
            if (!res?.ok) throw new Error('Error ' + res?.status);
            equipos = await res.json();
            // Poblar datalist de plantas con valores únicos existentes
            const datalist = document.getElementById('planta-list');
            if (datalist) {
                const plantas = [...new Set(
                    equipos.map(e => (e.ubicacion || '').split(' / ')[0].trim()).filter(Boolean)
                )].sort();
                datalist.innerHTML = plantas.map(p => `<option value="${p}">`).join('');
            }
            aplicarFiltros();
        } catch (err) {
            grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--danger);">
                <i class="fa-solid fa-triangle-exclamation" style="font-size:2em;"></i>
                <p style="margin-top:10px;">No se pudo conectar al servidor.<br><small>${err.message}</small></p>
            </div>`;
        }
    }

    // ── FILTROS Y BÚSQUEDA ───────────────────────────────────────
    function aplicarFiltros() {
        const txt  = searchInput?.value.toLowerCase().trim() || '';
        const crit = filterCrit?.value || '';
        const tipo = filterTipo?.value || '';

        const filtrados = equipos.filter(eq => {
            const matchTxt = !txt || [eq.asset_id, eq.descripcion, eq.marca, eq.ubicacion, eq.modelo]
                .some(v => v?.toLowerCase().includes(txt));
            const matchCrit = !crit || eq.criticidad === crit;
            const matchTipo = !tipo || eq.tipo_sistema === tipo;
            return matchTxt && matchCrit && matchTipo;
        });

        renderizarEquipos(filtrados);
    }

    searchInput?.addEventListener('input', aplicarFiltros);
    filterCrit?.addEventListener('change', aplicarFiltros);
    filterTipo?.addEventListener('change', aplicarFiltros);

    // ── RENDERIZAR GRID ──────────────────────────────────────────
    function renderizarEquipos(lista) {
        if (counter) {
            counter.textContent = `${lista.length} equipo${lista.length !== 1 ? 's' : ''} encontrado${lista.length !== 1 ? 's' : ''}`;
        }

        if (!lista.length) {
            grid.innerHTML = `<div class="hdv-empty-state">
                <i class="fa-solid fa-industry"></i>
                <p>No hay equipos que coincidan con tu búsqueda.</p>
                <button onclick="document.getElementById('search-input').value=''; document.getElementById('filter-criticidad').value=''; document.getElementById('filter-tipo').value=''; aplicarFiltros();" class="primary-btn" style="margin-top:12px; font-size:0.85em;">Limpiar filtros</button>
            </div>`;
            return;
        }

        grid.innerHTML = '';
        lista.forEach(eq => {
            // ── Clases y helpers ──────────────────────────────────
            const critClass = eq.criticidad === 'Alta' ? 'badge-alta' : eq.criticidad === 'Baja' ? 'badge-baja' : 'badge-media';
            const critIcon  = eq.criticidad === 'Alta' ? 'fa-circle-exclamation' : eq.criticidad === 'Baja' ? 'fa-circle-check' : 'fa-circle-minus';
            const estadoVib = eq.ultimo_estado_vibraciones || '';
            const estadoTer = eq.ultimo_estado_termografia  || '';
            const estadoUlt = eq.ultimo_estado_ultrasonido  || '';

            const semaforo = (v, lbl) => {
                const bg  = v === 'B' ? '#16a34a' : v === 'A' ? '#d97706' : v === 'C' ? '#dc2626' : 'var(--gray-300)';
                const txt = v === 'B' ? 'white' : v === 'A' ? 'white' : v === 'C' ? 'white' : 'var(--text-muted)';
                return `<div class="hdv-sem-group">
                    <span class="hdv-sem-group-label">${lbl}</span>
                    <span style="display:inline-flex;align-items:center;justify-content:center;
                        width:24px;height:24px;border-radius:6px;
                        background:${bg};color:${txt};
                        font-size:0.72em;font-weight:900;
                        box-shadow:0 1px 3px rgba(0,0,0,.15);">
                        ${v || '–'}
                    </span>
                </div>`;
            };

            // Tipo sistema icon
            const tipoIcon  = { motor:'fa-bolt', hvac:'fa-snowflake', bomba:'fa-droplet',
                               compresor:'fa-wind', ventilador:'fa-fan', generador:'fa-plug-circle-bolt',
                               motoreductor:'fa-gears', banda:'fa-arrow-right-long', otro:'fa-gear' };
            const tipoLabel = { motor:'Motor', hvac:'HVAC', bomba:'Bomba',
                                compresor:'Compresor', ventilador:'Ventilador', generador:'Generador',
                                motoreductor:'Motoreductor', banda:'Banda', otro:'Equipo' };
            const tipo = eq.tipo_sistema || 'otro';
            const tipoI = tipoIcon[tipo] || 'fa-gear';
            const tipoL = tipoLabel[tipo] || 'Equipo';

            // Chips de info
            const chipMarca = (eq.marca || eq.modelo)
                ? `<span class="hdv-chip"><i class="fa-solid fa-tag"></i>${eq.marca || ''}${eq.modelo ? ' ' + eq.modelo : ''}</span>` : '';
            const chipUbic = eq.ubicacion
                ? `<span class="hdv-chip hdv-chip-loc"><i class="fa-solid fa-map-pin"></i>${eq.ubicacion}</span>` : '';
            const chipRPM = eq.rpm_nominal
                ? `<span class="hdv-chip"><i class="fa-solid fa-rotate"></i>${eq.rpm_nominal} RPM</span>` : '';
            const chipKW = (eq.kw_nominal || eq.hp_nominal)
                ? `<span class="hdv-chip"><i class="fa-solid fa-plug"></i>${eq.kw_nominal ? eq.kw_nominal+' kW' : eq.hp_nominal+' HP'}</span>` : '';

            // Chips de técnicas PdM activas
            const pdmChips = [
                eq.aplica_vibraciones ? `<span class="hdv-chip hdv-chip-pdm" title="Vibraciones"><i class="fa-solid fa-wave-square" style="color:#3b82f6;"></i>Vib</span>` : '',
                eq.aplica_termografia ? `<span class="hdv-chip hdv-chip-pdm" title="Termografía"><i class="fa-solid fa-fire" style="color:#f97316;"></i>Ter</span>` : '',
                eq.aplica_ultrasonido ? `<span class="hdv-chip hdv-chip-pdm" title="Ultrasonido"><i class="fa-solid fa-satellite-dish" style="color:#8b5cf6;"></i>Ult</span>` : '',
            ].join('');

            const card = document.createElement('div');
            card.className = 'hdv-equipo-card';
            card.innerHTML = `
                <div class="hdv-card-foto" onclick="editarEquipo('${eq.asset_id}')">
                    ${eq.foto1
                        ? `<img src="${eq.foto1}" alt="${eq.asset_id}">`
                        : `<div class="hdv-foto-placeholder">
                               <i class="fa-solid ${tipoI}"></i>
                               <span>${tipoL}</span>
                           </div>`}
                    <div class="hdv-foto-overlay">
                        <i class="fa-solid fa-pen"></i> Editar
                    </div>
                    <span class="badge ${critClass} hdv-crit-badge">
                        <i class="fa-solid ${critIcon}"></i> ${eq.criticidad || 'Media'}
                    </span>
                    <span class="hdv-tipo-tag"><i class="fa-solid ${tipoI}"></i> ${tipoL}</span>
                </div>

                <div class="hdv-card-body">
                    <div class="hdv-card-header-row">
                        <div class="hdv-card-id"># ${eq.asset_id}</div>
                        <div class="hdv-card-desc">${eq.descripcion || '—'}</div>
                    </div>

                    <div class="hdv-card-divider"></div>

                    <div class="hdv-card-chips">
                        ${chipMarca}${chipUbic}${chipRPM}${chipKW}
                    </div>
                    ${pdmChips ? `<div class="hdv-card-pdm-chips">${pdmChips}</div>` : ''}

                    <div class="hdv-semaforos-row">
                        <span class="hdv-sem-label"><i class="fa-solid fa-circle-half-stroke"></i></span>
                        ${semaforo(estadoVib, 'VIB')}
                        ${semaforo(estadoTer, 'TER')}
                        ${semaforo(estadoUlt, 'ULT')}
                    </div>
                </div>

                <div class="hdv-card-footer">
                    <div class="hdv-card-footer-left">
                        <i class="fa-regular fa-clock"></i>
                        ${eq.ultima_inspeccion
                            ? new Date(eq.ultima_inspeccion).toLocaleDateString('es', {day:'2-digit',month:'short',year:'2-digit'})
                            : 'Sin inspección'}
                    </div>
                    <div class="hdv-card-footer-right">
                        <button class="hdv-btn-icon hdv-btn-reportes" onclick="verReportesEquipo('${eq.asset_id}')" title="Ver Reportes">
                            <i class="fa-solid fa-file-lines"></i>
                        </button>
                        <button class="hdv-btn-icon hdv-btn-print" onclick="imprimirEquipo('${eq.asset_id}')" title="Imprimir Ficha">
                            <i class="fa-solid fa-print"></i>
                        </button>
                        <button class="hdv-btn-icon hdv-btn-edit" onclick="editarEquipo('${eq.asset_id}')" title="Editar">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button class="hdv-btn-icon hdv-btn-delete" onclick="eliminarEquipo('${eq.asset_id}')" title="Eliminar">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>`;
            grid.appendChild(card);
        });
    }

    // ── ABRIR MODAL NUEVO ────────────────────────────────────────
    btnNuevo?.addEventListener('click', () => {
        editMode = false;
        form.reset();
        modalTitle.innerHTML = '<i class="fa-solid fa-plus"></i> Registrar Nuevo Equipo';
        const inputId = document.getElementById('asset_id');
        inputId.disabled = false;
        inputId.style.background = '';
        fotosBase64 = { foto1: '', foto2: '', foto3: '', foto4: '' };
        ['foto1','foto2','foto3','foto4'].forEach(k => limpiarFoto(k));
        const defaultRadio = document.querySelector('input[name="tipo_sistema"][value="otro"]');
        if (defaultRadio) defaultRadio.checked = true;
        toggleTechnicalFields();
        document.getElementById('notas').value = '';
        ['aplica_vibraciones','aplica_termografia','aplica_ultrasonido'].forEach(id => {
            const el = document.getElementById(id); if (el) el.checked = false;
        });
        modal.style.display = 'flex';
        inputId.focus();
    });

    // ── ABRIR MODAL EDITAR ───────────────────────────────────────
    window.editarEquipo = function (id) {
        const eq = equipos.find(x => x.asset_id === id);
        if (!eq) return;

        editMode = true;
        form.reset();
        modalTitle.innerHTML = `<i class="fa-solid fa-pen"></i> Editar: ${id}`;

        const setVal = (fieldId, val) => {
            const el = document.getElementById(fieldId);
            if (el) el.value = val ?? '';
        };

        setVal('asset_id', eq.asset_id);
        setVal('descripcion', eq.descripcion);
        setVal('criticidad', eq.criticidad || 'Media');
        setVal('marca', eq.marca);
        setVal('modelo', eq.modelo);

        // Separar ubicacion guardada (formato "Planta / Zona") en los dos campos
        const ubicRaw = eq.ubicacion || '';
        const sepIdx  = ubicRaw.indexOf(' / ');
        if (sepIdx !== -1) {
            setVal('planta',   ubicRaw.substring(0, sepIdx).trim());
            setVal('ubicacion', ubicRaw.substring(sepIdx + 3).trim());
        } else {
            // Si no tiene separador, todo va a planta (compatibilidad con datos anteriores)
            setVal('planta',   ubicRaw);
            setVal('ubicacion', '');
        }
        setVal('potencia_hp', eq.potencia_hp);
        setVal('voltaje', eq.voltaje);
        setVal('rpm', eq.rpm);
        setVal('amperaje', eq.amperaje);
        setVal('frame', eq.frame);
        setVal('clase_aislamiento', eq.clase_aislamiento);
        setVal('rodamiento_de', eq.rodamiento_de);
        setVal('rodamiento_ode', eq.rodamiento_ode);
        setVal('transmision_tipo', eq.transmision_tipo);
        setVal('modelo_faja', eq.modelo_faja);
        setVal('diametro_turbina', eq.diametro_turbina);
        setVal('diametro_polea_conductora', eq.diametro_polea_conductora);
        setVal('diametro_polea_conducida', eq.diametro_polea_conducida);
        setVal('num_alabes_turbina', eq.num_alabes_turbina);
        setVal('orientacion', eq.orientacion);
        setVal('tipo_acople', eq.tipo_acople);
        setVal('num_alabes_impeler', eq.num_alabes_impeler);
        setVal('notas', eq.notas);

        // Tipo de sistema
        const tipo = eq.tipo_sistema || 'otro';
        const radio = document.querySelector(`input[name="tipo_sistema"][value="${tipo}"]`);
        if (radio) radio.checked = true;
        toggleTechnicalFields();

        // Campos específicos por tipo
        const setIfExists = (id, val) => { const e = document.getElementById(id); if(e) e.value = val||''; };
        // Compresor
        setIfExists('tipo_compresor', eq.tipo_compresor);
        setIfExists('presion_max_comp', eq.presion_max_comp);
        setIfExists('caudal_comp', eq.caudal_comp);
        setIfExists('refrig_comp', eq.refrig_comp);
        setIfExists('aceite_comp', eq.aceite_comp);
        setIfExists('cap_aceite_comp', eq.cap_aceite_comp);
        // Ventilador
        setIfExists('tipo_ventilador', eq.tipo_ventilador);
        setIfExists('transmision_tipo_vent', eq.transmision_tipo_vent);
        setIfExists('caudal_vent', eq.caudal_vent);
        setIfExists('presion_vent', eq.presion_vent);
        setIfExists('diam_rodete', eq.diam_rodete);
        setIfExists('num_alabes_vent', eq.num_alabes_vent);
        // Generador
        setIfExists('motor_primario', eq.motor_primario);
        setIfExists('potencia_kva', eq.potencia_kva);
        setIfExists('voltaje_salida', eq.voltaje_salida);
        setIfExists('frecuencia_gen', eq.frecuencia_gen);
        setIfExists('fp_gen', eq.fp_gen);
        setIfExists('combustible_gen', eq.combustible_gen);
        // Motoreductor
        setIfExists('tipo_reductor', eq.tipo_reductor);
        setIfExists('relacion_reduccion', eq.relacion_reduccion);
        setIfExists('rpm_salida', eq.rpm_salida);
        setIfExists('torque_salida', eq.torque_salida);
        setIfExists('aceite_reductor', eq.aceite_reductor);
        setIfExists('cap_aceite_red', eq.cap_aceite_red);
        // Banda
        setIfExists('ancho_banda', eq.ancho_banda);
        setIfExists('longitud_banda', eq.longitud_banda);
        setIfExists('velocidad_banda', eq.velocidad_banda);
        setIfExists('capacidad_banda', eq.capacidad_banda);
        setIfExists('material_banda', eq.material_banda);
        setIfExists('accionamiento_banda', eq.accionamiento_banda);
        // Bomba extra
        setIfExists('caudal_nominal', eq.caudal_nominal);
        setIfExists('presion_nominal', eq.presion_nominal);
        setIfExists('tipo_sello', eq.tipo_sello);

        // Fotos
        fotosBase64 = { foto1: eq.foto1 || '', foto2: eq.foto2 || '', foto3: eq.foto3 || '', foto4: eq.foto4 || '' };
        ['foto1','foto2','foto3','foto4'].forEach(k => {
            if (eq[k]) setFotoPreview(k, eq[k]);
            else limpiarFoto(k);
        });

        // Técnicas PdM
        const cbVib = document.getElementById('aplica_vibraciones');
        const cbTer = document.getElementById('aplica_termografia');
        const cbUlt = document.getElementById('aplica_ultrasonido');
        if (cbVib) cbVib.checked = !!eq.aplica_vibraciones;
        if (cbTer) cbTer.checked = !!eq.aplica_termografia;
        if (cbUlt) cbUlt.checked = !!eq.aplica_ultrasonido;

        // Bloquear asset_id en modo edición
        const inputId = document.getElementById('asset_id');
        inputId.disabled = true;
        inputId.style.background = 'var(--gray-100)';

        modal.style.display = 'flex';
    };

    // ── GUARDAR (POST → API → SQL) ───────────────────────────────
    form.addEventListener('submit', async e => {
        e.preventDefault();

        const getVal = id => document.getElementById(id)?.value?.trim() ?? '';
        const getNum = id => { const v = getVal(id); return v === '' ? null : v; };
        const idVal  = getVal('asset_id');

        if (!idVal) { toast('El Asset ID es obligatorio.', 'error'); return; }
        if (!getVal('descripcion')) { toast('La descripción es obligatoria.', 'error'); return; }
        if (!getVal('planta')) { toast('El campo Planta es obligatorio.', 'error'); return; }

        // Verificar duplicado solo en creación
        if (!editMode) {
            const existe = equipos.some(eq => eq.asset_id.toUpperCase() === idVal.toUpperCase());
            if (existe) {
                toast(`El ID "${idVal}" ya existe. Usa el botón Editar.`, 'error');
                return;
            }
        }

        const getRadio = () => document.querySelector('input[name="tipo_sistema"]:checked')?.value || 'otro';

        const payload = {
            asset_id:                  idVal,
            descripcion:               getVal('descripcion'),
            criticidad:                getVal('criticidad'),
            marca:                     getVal('marca'),
            modelo:                    getVal('modelo'),
            planta:                    getVal('planta'),
            ubicacion:                 getVal('ubicacion'),
            potencia_hp:               getNum('potencia_hp'),
            voltaje:                   getVal('voltaje'),
            rpm:                       getNum('rpm'),
            amperaje:                  getNum('amperaje'),
            frame:                     getVal('frame'),
            clase_aislamiento:         getVal('clase_aislamiento'),
            rodamiento_de:             getVal('rodamiento_de'),
            rodamiento_ode:            getVal('rodamiento_ode'),
            tipo_sistema:              getRadio(),
            transmision_tipo:          getVal('transmision_tipo'),
            modelo_faja:               getVal('modelo_faja'),
            diametro_turbina:          getNum('diametro_turbina'),
            diametro_polea_conductora: getNum('diametro_polea_conductora'),
            diametro_polea_conducida:  getNum('diametro_polea_conducida'),
            num_alabes_turbina:        parseInt(getVal('num_alabes_turbina')) || 0,
            orientacion:               getVal('orientacion'),
            tipo_acople:               getVal('tipo_acople'),
            num_alabes_impeler:        parseInt(getVal('num_alabes_impeler')) || 0,
            // Bomba extra
            caudal_nominal:            getVal('caudal_nominal'),
            presion_nominal:           getVal('presion_nominal'),
            tipo_sello:                getVal('tipo_sello'),
            // Compresor
            tipo_compresor:            getVal('tipo_compresor'),
            presion_max_comp:          getVal('presion_max_comp'),
            caudal_comp:               getVal('caudal_comp'),
            refrig_comp:               getVal('refrig_comp'),
            aceite_comp:               getVal('aceite_comp'),
            cap_aceite_comp:           getVal('cap_aceite_comp'),
            // Ventilador
            tipo_ventilador:           getVal('tipo_ventilador'),
            transmision_tipo_vent:     getVal('transmision_tipo_vent'),
            caudal_vent:               getVal('caudal_vent'),
            presion_vent:              getVal('presion_vent'),
            diam_rodete:               getVal('diam_rodete'),
            num_alabes_vent:           parseInt(getVal('num_alabes_vent')) || 0,
            // Generador
            motor_primario:            getVal('motor_primario'),
            potencia_kva:              getVal('potencia_kva'),
            voltaje_salida:            getVal('voltaje_salida'),
            frecuencia_gen:            getVal('frecuencia_gen'),
            fp_gen:                    getVal('fp_gen'),
            combustible_gen:           getVal('combustible_gen'),
            // Motoreductor
            tipo_reductor:             getVal('tipo_reductor'),
            relacion_reduccion:        getVal('relacion_reduccion'),
            rpm_salida:                getNum('rpm_salida'),
            torque_salida:             getVal('torque_salida'),
            aceite_reductor:           getVal('aceite_reductor'),
            cap_aceite_red:            getVal('cap_aceite_red'),
            // Banda
            ancho_banda:               getVal('ancho_banda'),
            longitud_banda:            getVal('longitud_banda'),
            velocidad_banda:           getVal('velocidad_banda'),
            capacidad_banda:           getVal('capacidad_banda'),
            material_banda:            getVal('material_banda'),
            accionamiento_banda:       getVal('accionamiento_banda'),
            notas:                     getVal('notas'),
            foto1: fotosBase64.foto1 || null,
            foto2: fotosBase64.foto2 || null,
            foto3: fotosBase64.foto3 || null,
            foto4: fotosBase64.foto4 || null,
            aplica_vibraciones: document.getElementById('aplica_vibraciones')?.checked || false,
            aplica_termografia: document.getElementById('aplica_termografia')?.checked || false,
            aplica_ultrasonido: document.getElementById('aplica_ultrasonido')?.checked || false,
        };

        const btn = document.getElementById('btn-guardar-equipo');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

        try {
            const res = await PdM.apiFetch('/api/equipos', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (res?.ok) {
                toast(`✅ Equipo "${idVal}" guardado correctamente.`, 'success');
                cerrarModal();
                await cargarEquipos();
            } else {
                const err = await res?.json();
                toast('❌ Error: ' + (err?.error || 'No se pudo guardar.'), 'error');
            }
        } catch (err) {
            toast('❌ Error de conexión al guardar.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar en Base de Datos';
        }
    });

    // ── ELIMINAR ─────────────────────────────────────────────────
    window.eliminarEquipo = async (id) => {
        if (!confirm(`¿Eliminar el equipo "${id}" permanentemente?\nEsta acción no se puede deshacer.`)) return;
        try {
            const res = await PdM.apiFetch(`/api/equipos/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (res?.ok) {
                toast(`Equipo "${id}" eliminado.`, 'info');
                await cargarEquipos();
            } else {
                toast('Error al eliminar el equipo.', 'error');
            }
        } catch (err) {
            toast('Error de conexión al eliminar.', 'error');
        }
    };

    // ── IMPRIMIR FICHA TÉCNICA ───────────────────────────────────
    window.imprimirEquipo = function (id) {
        const eq = equipos.find(x => x.asset_id === id);
        if (!eq) return;

        const critColor = eq.criticidad === 'Alta' ? '#dc2626' : eq.criticidad === 'Baja' ? '#16a34a' : '#d97706';
        const fotoHtml  = key => eq[key] ? `<div class="ph"><img src="${eq[key]}"><span>${({foto1:'Principal',foto2:'Placa Motor',foto3:'Componente',foto4:'Panorámica'}[key])}</span></div>` : '';
        const row       = (l, v) => v ? `<div class="dr"><strong>${l}:</strong> ${v}</div>` : '';

        const w = window.open('', '_blank');
        w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ficha - ${eq.asset_id}</title>
        <style>
            * { box-sizing:border-box; margin:0; padding:0; }
            body { font-family:'Segoe UI',sans-serif; padding:30px; color:#1e293b; font-size:13px; }
            .hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #0369a1; padding-bottom:16px; margin-bottom:20px; }
            .hdr h1 { font-size:1.4em; color:#0369a1; margin-bottom:4px; }
            .hdr .sub { color:#64748b; font-size:0.9em; }
            .badge { display:inline-block; padding:4px 12px; border-radius:20px; background:${critColor}; color:white; font-weight:700; font-size:0.85em; }
            .sec { background:#f8fafc; border-left:3px solid #0369a1; padding:8px 14px; font-weight:700; font-size:0.9em; text-transform:uppercase; letter-spacing:0.4px; margin:14px 0 8px; color:#0369a1; }
            .dg { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:10px; }
            .dr { padding:4px 0; border-bottom:1px solid #e2e8f0; }
            .dr strong { color:#64748b; display:inline-block; min-width:150px; }
            .pg { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px; }
            .ph { border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; }
            .ph img { width:100%; height:180px; object-fit:cover; display:block; }
            .ph span { display:block; text-align:center; padding:4px; font-size:0.8em; color:#64748b; background:#f8fafc; }
            @media print { button { display:none; } }
        </style></head><body>
        <div class="hdr">
            <div><h1><i>Ficha Técnica de Activo</i></h1><div class="sub">${eq.descripcion}</div></div>
            <div style="text-align:right;"><div style="font-size:1.8em;font-weight:800;color:#0369a1;">${eq.asset_id}</div><span class="badge">${eq.criticidad || 'Media'}</span></div>
        </div>
        <div class="sec">Datos Generales</div>
        <div class="dg">
            ${row('Marca', eq.marca)}${row('Modelo', eq.modelo)}
            ${row('Ubicación', eq.ubicacion)}${row('Tipo Sistema', eq.tipo_sistema)}
        </div>
        <div class="sec">Datos de Placa</div>
        <div class="dg">
            ${row('Potencia', eq.potencia_hp ? eq.potencia_hp + ' HP' : '')}
            ${row('Voltaje', eq.voltaje ? eq.voltaje + ' V' : '')}
            ${row('RPM', eq.rpm)}
            ${row('Amperaje', eq.amperaje ? eq.amperaje + ' A' : '')}
            ${row('Frame', eq.frame)}
            ${row('Clase Aisl.', eq.clase_aislamiento)}
            ${row('Rod. DE', eq.rodamiento_de)}
            ${row('Rod. ODE', eq.rodamiento_ode)}
        </div>
        ${eq.tipo_sistema === 'hvac' ? `<div class="sec">Detalles HVAC</div><div class="dg">
            ${row('Transmisión', eq.transmision_tipo)}${row('Faja', eq.modelo_faja)}
            ${row('Ø Polea Motora', eq.diametro_polea_conductora)}${row('Ø Polea Conducida', eq.diametro_polea_conducida)}
            ${row('Ø Turbina', eq.diametro_turbina)}${row('# Álabes', eq.num_alabes_turbina)}
        </div>` : ''}
        ${eq.tipo_sistema === 'bomba' ? `<div class="sec">Detalles Bomba</div><div class="dg">
            ${row('Orientación', eq.orientacion)}${row('Acople', eq.tipo_acople)}
            ${row('# Álabes Impeler', eq.num_alabes_impeler)}
        </div>` : ''}
        ${eq.notas ? `<div class="sec">Notas</div><p style="padding:8px;background:#f8fafc;border-radius:4px;font-size:0.9em;">${eq.notas}</p>` : ''}
        <div class="sec">Registro Fotográfico</div>
        <div class="pg">${fotoHtml('foto1')}${fotoHtml('foto2')}${fotoHtml('foto3')}${fotoHtml('foto4')}</div>
        <script>window.onload=()=>window.print();<\/script>
        </body></html>`);
        w.document.close();
    };

    // ── VER REPORTES DE UN EQUIPO ───────────────────────────────
    window.verReportesEquipo = async function (assetId) {
        const toast = (m,t='info') => window.PdM?.showToast(m,t);
        try {
            const res = await PdM.apiFetch(`/api/reportes/equipo/${encodeURIComponent(assetId)}`);
            if (!res?.ok) return toast('Error al cargar reportes.','error');
            const lista = await res.json();

            let modal = document.getElementById('modal-reportes-equipo');
            if (modal) modal.remove();
            modal = document.createElement('div');
            modal.id = 'modal-reportes-equipo';
            modal.className = 'modal-overlay';
            modal.style.display = 'flex';

            const tecnicaIcon = {
                vibraciones:'fa-wave-square', termografia:'fa-fire',
                ultrasonido:'fa-satellite-dish', generales:'fa-file-contract',
                anexo_termo:'fa-temperature-half', anexo_ultra:'fa-ear-listen'
            };
            const tecnicaLabel = {
                vibraciones:'Vibraciones', termografia:'Termografía',
                ultrasonido:'Ultrasonido', generales:'Rep. General',
                anexo_termo:'Anexo Termo', anexo_ultra:'Anexo Ultra'
            };
            const tecnicaColor = {
                vibraciones:'#3b82f6', termografia:'#f97316',
                ultrasonido:'#8b5cf6', generales:'#0ea5e9',
                anexo_termo:'#f59e0b', anexo_ultra:'#10b981'
            };

            modal.innerHTML = `
                <div class="modal-content config-modal-box" style="max-width:660px;width:95%;">
                    <div class="modal-header">
                        <h3><i class="fa-solid fa-file-lines"></i> Reportes de: <span style="color:var(--primary);">${assetId}</span></h3>
                        <span style="cursor:pointer;font-size:1.4em;color:var(--text-muted);" id="close-rm">&times;</span>
                    </div>
                    <div style="padding:8px 16px 4px;color:var(--text-muted);font-size:0.82em;">
                        ${lista.length ? `${lista.length} reporte(s) encontrado(s)` : 'No hay reportes para este activo.'}
                    </div>
                    <div id="lista-rm" style="max-height:480px;overflow-y:auto;padding:0 0 8px;">
                        ${lista.length === 0 ? `<div style="padding:40px;text-align:center;color:var(--text-muted);">
                            <i class="fa-solid fa-folder-open" style="font-size:2em;opacity:.3;display:block;margin-bottom:10px;"></i>
                            No hay reportes guardados para este equipo.</div>` :
                        lista.map(r => `
                            <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border);">
                                <i class="fa-solid ${tecnicaIcon[r.tecnica]||'fa-file'}"
                                   style="font-size:1.2em;color:${tecnicaColor[r.tecnica]||'var(--primary)'};width:20px;flex-shrink:0;"></i>
                                <div style="flex:1;min-width:0;">
                                    <div style="font-weight:700;color:var(--primary);font-size:0.9em;">${r.codigo_reporte||r.titulo||'Sin código'}</div>
                                    <div style="font-size:0.75em;color:var(--text-muted);">
                                        <span style="background:var(--bg-muted);padding:1px 6px;border-radius:10px;margin-right:6px;">${tecnicaLabel[r.tecnica]||r.tecnica}</span>
                                        ${new Date(r.fecha_modificacion).toLocaleString('es',{day:'2-digit',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'})}
                                    </div>
                                </div>
                                <a href="${r.tecnica}.html" target="_blank"
                                   style="font-size:0.78em;color:var(--primary);text-decoration:none;padding:4px 8px;border:1px solid var(--primary);border-radius:6px;white-space:nowrap;"
                                   title="Abrir módulo">
                                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                                </a>
                            </div>`).join('')}
                    </div>
                </div>`;

            document.body.appendChild(modal);
            document.getElementById('close-rm').onclick = () => modal.remove();
            modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
        } catch(e) { window.PdM?.showToast('Error al cargar reportes.','error'); }
    };

    // ── CERRAR MODAL ─────────────────────────────────────────────
    function cerrarModal() {
        modal.style.display = 'none';
        form.reset();
        fotosBase64 = { foto1: '', foto2: '', foto3: '', foto4: '' };
    }

    document.querySelector('.close-modal')?.addEventListener('click', cerrarModal);
    document.querySelectorAll('.close-modal-btn').forEach(b => b.addEventListener('click', cerrarModal));
    modal?.addEventListener('click', e => { if (e.target === modal) cerrarModal(); });

    // ── URL param: ?highlight=ASSET_ID → scroll y resaltar ───────
    function aplicarHighlight() {
        const urlParams = new URLSearchParams(window.location.search);
        const hlAsset = urlParams.get('highlight');
        if (!hlAsset) return;
        setTimeout(() => {
            const cards = document.querySelectorAll('.hdv-equipo-card');
            cards.forEach(card => {
                const idEl = card.querySelector('.hdv-card-id');
                if (idEl && idEl.textContent.includes(hlAsset)) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    card.style.boxShadow = '0 0 0 3px var(--primary), var(--shadow-lg)';
                    card.style.borderColor = 'var(--primary)';
                    setTimeout(() => {
                        card.style.boxShadow = '';
                        card.style.borderColor = '';
                    }, 3000);
                }
            });
        }, 600);
    }

    // ── INIT ─────────────────────────────────────────────────────
    cargarEquipos().then(aplicarHighlight);
});
