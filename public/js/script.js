// script.js - Núcleo compartido de la Suite PdM v2 (RBAC + JWT)

// ── Sesión ────────────────────────────────────────────────────────
const SESSION_KEY  = 'pdm_session_token';
const SESSION_USER = 'pdm_session_user';

function getToken()  { return localStorage.getItem(SESSION_KEY); }
function setToken(t) { localStorage.setItem(SESSION_KEY, t); }
function clearToken() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_USER);
}

// Guardar y recuperar datos del usuario actual
function setUserData(data) { localStorage.setItem(SESSION_USER, JSON.stringify(data)); }
function getUserData() {
    try { return JSON.parse(localStorage.getItem(SESSION_USER) || 'null'); }
    catch { return null; }
}

// ── Feature flags (cargados desde /api/me) ─────────────────────
function getFeatures() {
    try { return JSON.parse(localStorage.getItem('pdm_features') || '{}'); }
    catch { return {}; }
}
function setFeatures(f) { localStorage.setItem('pdm_features', JSON.stringify(f || {})); }
function hasFeature(name) { return getFeatures()[name] === true; }

// ── RBAC helpers ──────────────────────────────────────────────────
const ROLE_LEVEL = { sysadmin: 4, admin: 3, tecnico: 2, visor: 1 };
function getRol()    { return getUserData()?.rol || 'visor'; }
function getPlantas() { return getUserData()?.plantas || []; }
function canDo(minRol) { return (ROLE_LEVEL[getRol()] || 0) >= (ROLE_LEVEL[minRol] || 0); }

// ── Fetch autenticado ─────────────────────────────────────────────
async function apiFetch(url, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['x-session-token'] = token;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) { clearToken(); window.location.href = 'login.html'; return null; }
    if (res.status === 403) {
        showToast('Sin permisos para esta acción.', 'error');
        return res; // devolver para que el llamador lo maneje
    }
    return res;
}

// ── Verificar sesión al cargar ────────────────────────────────────
if (!window.location.pathname.endsWith('login.html')) {
    const tok = getToken();
    if (!tok) {
        window.location.href = 'login.html';
    } else {
        fetch('/api/me', { headers: { 'x-session-token': tok } })
            .then(async r => {
                if (r.status === 401) { clearToken(); window.location.href = 'login.html'; return; }
                if (r.ok) {
                    const data = await r.json();
                    setUserData(data);
                    if (data.features) setFeatures(data.features);
                    // Ocultar elementos que el rol actual no puede usar
                    applyRoleUI();
                    // Ocultar módulos desactivados
                    applyFeatureUI();
                }
            })
            .catch(() => {});
    }
}

// ── Aplicar visibilidad según rol ─────────────────────────────────
function applyRoleUI() {
    const rol = getRol();
    // [data-min-rol="admin"] → oculto para técnico y visor
    document.querySelectorAll('[data-min-rol]').forEach(el => {
        const min = el.dataset.minRol;
        if ((ROLE_LEVEL[rol] || 0) < (ROLE_LEVEL[min] || 0)) {
            el.style.display = 'none';
        }
    });
    // Mostrar nombre de usuario en header si existe
    const userSpan = document.getElementById('current-user-display');
    const userData = getUserData();
    if (userSpan && userData) {
        const rolLabel = { sysadmin:'Admin Sistema', admin:'Admin Planta', tecnico:'Técnico', visor:'Visor' }[rol] || rol;
        userSpan.textContent = `${userData.nombre || userData.usuario} (${rolLabel})`;
    }
}

// ── Ocultar módulos según feature flags ──────────────────────────
function applyFeatureUI() {
    const f = getFeatures();
    // Elementos con data-feature="nombre" se ocultan si el módulo está desactivado
    document.querySelectorAll('[data-feature]').forEach(el => {
        const feat = el.dataset.feature;
        if (f[feat] === false) el.style.display = 'none';
    });
}

// ── Toast ─────────────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3500) {
    let container = document.getElementById('toast-container');
    if (!container) { container = document.createElement('div'); container.id = 'toast-container'; document.body.appendChild(container); }
    const toast = document.createElement('div');
    toast.className = 'pdm-toast pdm-toast-' + type;
    toast.innerHTML = `<span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, duration);
}

// ── Exportar API globalmente ──────────────────────────────────────
window.PdM = { apiFetch, getToken, setToken, setUserData, getUserData, clearToken, showToast, canDo, getRol, getPlantas, getFeatures, hasFeature, setFeatures };

document.addEventListener('DOMContentLoaded', function () {

    // ── Apariencia ────────────────────────────────────────────────
    const themeSelect = document.getElementById('themeSelect');
    const customColorPicker = document.getElementById('customColorPicker');
    const fontSelect = document.getElementById('fontSelect');

    function applyTheme(name) {
        document.body.dataset.theme = name;
        if (customColorPicker) customColorPicker.style.display = (name === 'custom') ? 'block' : 'none';
        if (name !== 'custom') document.documentElement.style.removeProperty('--primary-color');
        else if (customColorPicker) document.documentElement.style.setProperty('--primary-color', customColorPicker.value);
    }

    function initTheme() {
        const t = localStorage.getItem('userPreferredTheme') || 'default';
        if (themeSelect) themeSelect.value = t;
        if (customColorPicker) customColorPicker.value = localStorage.getItem('userCustomColor') || '#005f73';
        applyTheme(t);
    }

    function applyFont(f) {
        const map = { system: 'var(--font-family-system)', 'sans-serif': 'var(--font-family-sans-serif)', serif: 'var(--font-family-serif)', monospace: 'var(--font-family-monospace)', arial: 'var(--font-family-arial)' };
        document.documentElement.style.setProperty('--font-family', map[f] || map.system);
    }

    function initFont() {
        const f = localStorage.getItem('userPreferredFont') || 'system';
        if (fontSelect) fontSelect.value = f;
        applyFont(f);
    }

    if (themeSelect) themeSelect.addEventListener('change', e => { applyTheme(e.target.value); localStorage.setItem('userPreferredTheme', e.target.value); });
    if (customColorPicker) customColorPicker.addEventListener('input', e => { document.documentElement.style.setProperty('--primary-color', e.target.value); localStorage.setItem('userCustomColor', e.target.value); });
    if (fontSelect) fontSelect.addEventListener('change', e => { applyFont(e.target.value); localStorage.setItem('userPreferredFont', e.target.value); });

    initTheme();
    initFont();

    // ── Modal de Configuración ────────────────────────────────────
    const btnOpenConfig = document.getElementById('btn-open-config');
    const configModal = document.getElementById('config-modal');
    const btnCloseConfig = document.querySelector('.close-modal-config');

    if (btnOpenConfig && configModal) {
        btnOpenConfig.addEventListener('click', e => { e.preventDefault(); configModal.style.display = 'flex'; });
        if (btnCloseConfig) btnCloseConfig.addEventListener('click', () => configModal.style.display = 'none');
        window.addEventListener('click', e => { if (e.target === configModal) configModal.style.display = 'none'; });
    }

    // ── Logos y datos del analista ────────────────────────────────
    function setupLogoUpload(inputId, storageKey, previewId) {
        const input = document.getElementById(inputId);
        const preview = document.getElementById(previewId);
        const saved = localStorage.getItem(storageKey);
        if (saved && preview) preview.src = saved;

        if (!input) return;
        input.addEventListener('change', function () {
            if (!this.files?.[0]) return;
            const reader = new FileReader();
            reader.onload = e => {
                const img = new Image();
                img.src = e.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX = 150;
                    const scale = MAX / img.height;
                    canvas.width = img.width * scale; canvas.height = MAX;
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    const dataUrl = canvas.toDataURL('image/png');
                    localStorage.setItem(storageKey, dataUrl);
                    if (preview) preview.src = dataUrl;
                    applyLogos();
                };
            };
            reader.readAsDataURL(this.files[0]);
        });
    }

    function applyLogos() {
        const L = localStorage.getItem('defaultLogoLeft');
        const R = localStorage.getItem('defaultLogoRight');
        const imgL = document.querySelector('#logo-left-container .static-logo, #logo-left-container .image-preview');
        const imgR = document.querySelector('#logo-right-container .static-logo, #logo-right-container .image-preview');
        if (imgL && L) { imgL.src = L; imgL.style.display = 'block'; }
        if (imgR && R) { imgR.src = R; imgR.style.display = 'block'; }
    }

    function applyDefaultData() {
        applyLogos();
        const name = localStorage.getItem('defaultAnalystName');
        const role = localStorage.getItem('defaultAnalystRole');
        if (name) document.querySelectorAll('.cargo-analista').forEach(el => { if (!el.value) el.value = name + (role ? ' - ' + role : ''); });
        const cfgName = document.getElementById('cfg-analyst-name');
        const cfgRole = document.getElementById('cfg-analyst-role');
        if (cfgName) cfgName.value = name || '';
        if (cfgRole) cfgRole.value = role || '';
    }

    const cfgName = document.getElementById('cfg-analyst-name');
    const cfgRole = document.getElementById('cfg-analyst-role');
    if (cfgName) cfgName.addEventListener('input', e => localStorage.setItem('defaultAnalystName', e.target.value));
    if (cfgRole) cfgRole.addEventListener('input', e => localStorage.setItem('defaultAnalystRole', e.target.value));

    setupLogoUpload('cfg-logo-left', 'defaultLogoLeft', 'preview-cfg-left');
    setupLogoUpload('cfg-logo-right', 'defaultLogoRight', 'preview-cfg-right');
    applyDefaultData();

    // ── Logout ────────────────────────────────────────────────────
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await apiFetch('/api/logout', { method: 'POST' });
            clearToken();
            window.location.href = 'login.html';
        });
    }

    // ── Imágenes (lógica compartida de reportes) ──────────────────
    const mainContent = document.querySelector('main.content-container');

    const imgTpl = `<div class="image-container">
        <button class="delete-image-btn" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
        <div class="image-preview-wrapper"><img src="" class="image-preview" style="display:none;"></div>
        <label class="image-input-label"><i class="fa-solid fa-upload"></i> Seleccionar
            <input type="file" accept="image/*" class="image-input" style="display:none;">
        </label>
        <input type="text" class="image-caption" placeholder="Descripción (opcional)">
    </div>`;

    function addImageToArea(area) {
        if (!area) return;
        const d = document.createElement('div');
        d.innerHTML = imgTpl.trim();
        area.appendChild(d.firstChild);
    }

    if (mainContent) {
        mainContent.addEventListener('click', e => {
            const container = e.target.closest('.image-container');
            if (!container) return;
            if (e.target.closest('.delete-image-btn')) {
                const img = container.querySelector('.image-preview');
                const lbl = container.querySelector('.image-input-label');
                const inp = container.querySelector('.image-input');
                if (container.id === 'logo-left-container' || container.id === 'logo-right-container') {
                    if (img) { img.src = ''; img.style.display = 'none'; }
                    if (lbl) lbl.style.display = 'flex';
                    if (inp) inp.value = '';
                } else { container.remove(); }
            } else if (e.target.closest('.image-preview-wrapper') || e.target.closest('.image-input-label')) {
                container.querySelector('.image-input')?.click();
            }
        });

        mainContent.addEventListener('change', e => {
            if (!e.target.classList.contains('image-input')) return;
            const container = e.target.closest('.image-container');
            if (!container || !e.target.files?.[0]) return;
            const reader = new FileReader();
            reader.onload = ev => {
                const img = container.querySelector('.image-preview');
                const lbl = container.querySelector('.image-input-label');
                if (img) { img.src = ev.target.result; img.style.display = 'block'; }
                if (lbl) lbl.style.display = 'none';
            };
            reader.readAsDataURL(e.target.files[0]);
        });

        mainContent.addEventListener('paste', e => {
            const container = e.target.closest('.image-container');
            if (!container) return;
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    const blob = item.getAsFile();
                    const reader = new FileReader();
                    reader.onload = ev => {
                        const img = container.querySelector('.image-preview');
                        const lbl = container.querySelector('.image-input-label');
                        if (img) { img.src = ev.target.result; img.style.display = 'block'; }
                        if (lbl) lbl.style.display = 'none';
                    };
                    reader.readAsDataURL(blob);
                    e.preventDefault();
                    break;
                }
            }
        });
    }

    const addImgBtn = document.getElementById('add-image-btn');
    if (addImgBtn) addImgBtn.addEventListener('click', () => addImageToArea(document.getElementById('image-container-area')));

    window.addImageToArea = addImageToArea;
    window.addImageContainerToArea = addImageToArea;

    // ── Info General (tabla editable con etiquetas) ───────────────
    const infoTableBody = document.querySelector('#info-table tbody');
    const addRowBtn = document.getElementById('add-row-btn');
    const editToggle = document.getElementById('editModeToggle');

    if (infoTableBody) {
        // Cargar etiquetas guardadas
        infoTableBody.querySelectorAll('label[data-label-id]').forEach(l => {
            const saved = localStorage.getItem('label_' + l.dataset.labelId);
            if (saved) l.innerText = saved;
        });

        infoTableBody.addEventListener('click', e => {
            if (e.target.closest('.delete-row-btn')) e.target.closest('tr').remove();
        });
    }

    if (addRowBtn && infoTableBody) {
        addRowBtn.addEventListener('click', () => {
            const last = infoTableBody.querySelector('tr:last-child');
            if (!last) return;
            const row = last.cloneNode(true);
            row.querySelectorAll('input').forEach(i => i.value = '');
            row.querySelector('.delete-row-btn')?.removeAttribute('onclick');
            infoTableBody.appendChild(row);
        });
    }

    if (editToggle && infoTableBody) {
        editToggle.addEventListener('change', function () {
            const on = this.checked;
            infoTableBody.querySelectorAll('label[data-label-id]').forEach(l => {
                l.setAttribute('contenteditable', on);
                l.classList.toggle('editable-active', on);
                if (!on) localStorage.setItem('label_' + l.dataset.labelId, l.innerText);
            });
        });
    }

    // ── Guardar / cargar reportes ─────────────────────────────────
    function setupReporteSave(tecnica, collectFn) {
        const saveBtn = document.getElementById('btn-guardar-reporte');
        const loadBtn = document.getElementById('btn-cargar-reporte');
        const nuevoBtn = document.getElementById('btn-nuevo-reporte');

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const datos = collectFn();
                const titulo = document.querySelector('.report-title')?.textContent?.trim() || `Reporte ${tecnica}`;
                const reporteId = sessionStorage.getItem('reporteActualId');
                let res;
                if (reporteId) {
                    res = await apiFetch(`/api/reportes/${reporteId}`, { method: 'PUT', body: JSON.stringify({ titulo, datos }) });
                } else {
                    res = await apiFetch('/api/reportes', { method: 'POST', body: JSON.stringify({ tecnica, titulo, datos }) });
                    if (res?.ok) {
                        const data = await res.json();
                        sessionStorage.setItem('reporteActualId', data.id);
                    }
                }
                if (res?.ok) showToast('✅ Reporte guardado correctamente.', 'success');
                else showToast('❌ Error al guardar el reporte.', 'error');
            });
        }

        if (nuevoBtn) {
            nuevoBtn.addEventListener('click', () => {
                if (confirm('¿Iniciar un reporte nuevo? Se perderán los cambios no guardados.')) {
                    sessionStorage.removeItem('reporteActualId');
                    location.reload();
                }
            });
        }

        if (loadBtn) {
            loadBtn.addEventListener('click', async () => {
                const res = await apiFetch(`/api/reportes?tecnica=${tecnica}`);
                if (!res?.ok) return showToast('Error al cargar lista de reportes', 'error');
                const lista = await res.json();
                if (!lista.length) return showToast('No hay reportes guardados para esta técnica.', 'info');
                mostrarModalReportes(lista, tecnica);
            });
        }
    }

    function mostrarModalReportes(lista, tecnica) {
        let modal = document.getElementById('modal-reportes-guardados');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-reportes-guardados';
            modal.className = 'modal-overlay';
            modal.innerHTML = `<div class="modal-content config-modal-box" style="max-width:600px; width:95%;">
                <div class="modal-header">
                    <h3><i class="fa-solid fa-folder-open"></i> Reportes Guardados</h3>
                    <span class="close-modal-rg" style="cursor:pointer; font-size:1.5em;">&times;</span>
                </div>
                <div id="lista-reportes-guardados" style="max-height:400px; overflow-y:auto;"></div>
            </div>`;
            document.body.appendChild(modal);
            modal.querySelector('.close-modal-rg').addEventListener('click', () => modal.style.display = 'none');
            modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
        }

        const lista_div = modal.querySelector('#lista-reportes-guardados');
        lista_div.innerHTML = lista.map(r => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 15px; border-bottom:1px solid #eee;">
                <div>
                    <strong>${r.titulo}</strong>
                    <div style="font-size:0.8em; color:#666;">${new Date(r.fecha_modificacion).toLocaleString('es')}</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn-cargar-este" data-id="${r.id}" style="padding:6px 12px; background:var(--primary-color); color:white; border:none; border-radius:4px; cursor:pointer;">
                        <i class="fa-solid fa-folder-open"></i> Cargar
                    </button>
                    <button class="btn-borrar-este" data-id="${r.id}" style="padding:6px 12px; background:#dc3545; color:white; border:none; border-radius:4px; cursor:pointer;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>`).join('');

        lista_div.querySelectorAll('.btn-cargar-este').forEach(btn => {
            btn.addEventListener('click', async () => {
                const res = await apiFetch(`/api/reportes/${btn.dataset.id}`);
                if (!res?.ok) return showToast('Error al cargar reporte', 'error');
                const reporte = await res.json();
                sessionStorage.setItem('reporteActualId', reporte.id);
                sessionStorage.setItem('reporteDatos', JSON.stringify(reporte.datos));
                modal.style.display = 'none';
                showToast('✅ Reporte cargado. Recargando...', 'success');
                setTimeout(() => location.reload(), 800);
            });
        });

        lista_div.querySelectorAll('.btn-borrar-este').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('¿Eliminar este reporte?')) return;
                const res = await apiFetch(`/api/reportes/${btn.dataset.id}`, { method: 'DELETE' });
                if (res?.ok) { btn.closest('div[style]').remove(); showToast('Reporte eliminado.', 'info'); }
            });
        });

        modal.style.display = 'flex';
    }

    window.PdM.setupReporteSave = setupReporteSave;

    // ══════════════════════════════════════════════════════════════
    // SISTEMA DE FIRMAS GLOBALES
    // ══════════════════════════════════════════════════════════════
    const FIRMAS_KEY = 'pdm_firmas';

    function getFirmas() {
        try { return JSON.parse(localStorage.getItem(FIRMAS_KEY) || '[]'); } catch { return []; }
    }
    function saveFirmas(arr) { localStorage.setItem(FIRMAS_KEY, JSON.stringify(arr)); }

    function renderFirmasManager() {
        const container = document.getElementById('firmas-manager-container');
        if (!container) return;
        const firmas = getFirmas();
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${firmas.map((f, i) => `
                    <div class="firma-manager-row" data-idx="${i}">
                        <div class="firma-manager-preview">
                            ${f.imagen
                                ? `<img src="${f.imagen}" style="height:44px;max-width:110px;object-fit:contain;border-radius:4px;">`
                                : `<div style="width:60px;height:44px;background:var(--bg-surface);border:1px dashed var(--border);border-radius:4px;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-user-tie" style="color:var(--text-muted);font-size:1.2em;"></i></div>`}
                        </div>
                        <div style="flex:1;display:flex;flex-direction:column;gap:5px;">
                            <input type="text" class="fm-nombre" value="${escHtml(f.nombre||'')}" placeholder="Nombre completo" data-idx="${i}"
                                style="padding:6px 9px;border:1px solid var(--border);border-radius:4px;font-size:0.85em;background:var(--bg-surface);color:var(--text-primary);font-family:inherit;width:100%;">
                            <input type="text" class="fm-cargo" value="${escHtml(f.cargo||'')}" placeholder="Cargo / Certificación" data-idx="${i}"
                                style="padding:6px 9px;border:1px solid var(--border);border-radius:4px;font-size:0.85em;background:var(--bg-surface);color:var(--text-primary);font-family:inherit;width:100%;">
                        </div>
                        <div style="display:flex;flex-direction:column;gap:5px;align-items:center;flex-shrink:0;">
                            <label style="cursor:pointer;padding:5px 10px;background:var(--primary-light);color:var(--primary);border:1px solid var(--primary);border-radius:var(--radius-sm);font-size:0.75em;font-weight:700;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;">
                                <i class="fa-solid fa-image"></i> Imagen
                                <input type="file" accept="image/*" hidden data-idx="${i}" class="fm-img-input">
                            </label>
                            <button type="button" class="fm-delete-btn" data-idx="${i}"
                                style="padding:5px 10px;background:var(--danger-light);color:var(--danger);border:1px solid var(--danger);border-radius:var(--radius-sm);font-size:0.75em;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:4px;">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>`).join('')}
                <button type="button" id="fm-add-btn"
                    style="display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px;background:var(--bg-muted);border:1.5px dashed var(--border);border-radius:var(--radius-md);cursor:pointer;font-size:0.85em;font-weight:600;color:var(--text-secondary);font-family:inherit;width:100%;transition:all .15s;">
                    <i class="fa-solid fa-plus"></i> Agregar Firma
                </button>
            </div>`;

        container.querySelectorAll('.fm-nombre,.fm-cargo').forEach(inp => {
            inp.addEventListener('input', () => {
                const idx = parseInt(inp.dataset.idx);
                const arr = getFirmas();
                if (inp.classList.contains('fm-nombre')) arr[idx].nombre = inp.value;
                else arr[idx].cargo = inp.value;
                saveFirmas(arr);
            });
        });

        container.querySelectorAll('.fm-img-input').forEach(inp => {
            inp.addEventListener('change', function () {
                if (!this.files?.[0]) return;
                const idx = parseInt(this.dataset.idx);
                const reader = new FileReader();
                reader.onload = ev => {
                    const arr = getFirmas();
                    arr[idx].imagen = ev.target.result;
                    saveFirmas(arr);
                    renderFirmasManager();
                };
                reader.readAsDataURL(this.files[0]);
            });
        });

        container.querySelectorAll('.fm-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                const arr = getFirmas();
                arr.splice(idx, 1);
                saveFirmas(arr);
                renderFirmasManager();
            });
        });

        document.getElementById('fm-add-btn')?.addEventListener('click', () => {
            const arr = getFirmas();
            arr.push({ id: Date.now(), nombre: '', cargo: '', imagen: '' });
            saveFirmas(arr);
            renderFirmasManager();
        });
    }

    function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

    // Renderizar selector de firmas en cada firma-box de los reportes
    function renderFirmaSelectors() {
        document.querySelectorAll('.firma-box').forEach(box => {
            // Remove old wrap if exists
            box.querySelector('.firma-selector-wrap')?.remove();

            const firmas = getFirmas();
            if (!firmas.length) return;

            const wrap = document.createElement('div');
            wrap.className = 'firma-selector-wrap no-print';
            wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:14px;';

            firmas.forEach((f, i) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'firma-sel-btn';
                btn.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 14px;border:2px solid var(--border);border-radius:var(--radius-md);cursor:pointer;background:var(--bg-surface);font-family:inherit;transition:all .15s;min-width:100px;max-width:160px;';
                btn.innerHTML = `
                    ${f.imagen
                        ? `<img src="${f.imagen}" style="height:40px;max-width:100px;object-fit:contain;">`
                        : `<div style="width:44px;height:44px;background:var(--bg-muted);border-radius:50%;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-user-tie" style="font-size:1.3em;color:var(--text-muted);"></i></div>`}
                    <span style="font-size:0.75em;font-weight:700;color:var(--text-secondary);text-align:center;line-height:1.3;word-break:break-word;">${escHtml(f.nombre || 'Firma ' + (i+1))}</span>
                    <span style="font-size:0.68em;color:var(--text-muted);text-align:center;">${escHtml(f.cargo || '')}</span>`;

                btn.addEventListener('click', () => {
                    wrap.querySelectorAll('.firma-sel-btn').forEach(b => {
                        b.style.borderColor = 'var(--border)';
                        b.style.background  = 'var(--bg-surface)';
                    });
                    btn.style.borderColor = 'var(--primary)';
                    btn.style.background  = 'var(--primary-light)';

                    // Fill text input
                    const input = box.querySelector('.cargo-analista');
                    if (input) input.value = f.nombre + (f.cargo ? ' — ' + f.cargo : '');

                    // Show image in slot
                    const imgEl = box.querySelector('.firma-img-preview');
                    if (imgEl) {
                        imgEl.src = f.imagen || '';
                        imgEl.style.display = f.imagen ? 'block' : 'none';
                    }
                });

                wrap.appendChild(btn);
            });

            // Insert at very top of firma-box (before everything)
            box.insertBefore(wrap, box.firstChild);
        });
    }

    window.PdM.getFirmas             = getFirmas;
    window.PdM.renderFirmaSelectors  = renderFirmaSelectors;
    window.PdM.renderFirmasManager   = renderFirmasManager;

    // Render on config open
    document.getElementById('btn-open-config')?.addEventListener('click', () => {
        setTimeout(renderFirmasManager, 60);
    });

    // Render selectors on load
    renderFirmaSelectors();

    // Inject CSS
    if (!document.getElementById('firma-sys-css')) {
        const s = document.createElement('style');
        s.id = 'firma-sys-css';
        s.textContent = `
            .firma-manager-row {
                display:flex; align-items:center; gap:10px; padding:10px 12px;
                background:var(--bg-muted); border:1px solid var(--border);
                border-radius:var(--radius-md);
            }
            .firma-manager-preview { flex-shrink:0; width:80px; display:flex; justify-content:center; align-items:center; }
            .firma-sel-btn:hover { border-color:var(--primary) !important; background:var(--primary-light) !important; }
            @media print { .firma-selector-wrap { display:none !important; } }
        `;
        document.head.appendChild(s);
    }

});