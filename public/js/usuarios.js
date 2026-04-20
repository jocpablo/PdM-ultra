// usuarios.js — Gestión de Usuarios y Plantas
// Suite PdM | Edwards

document.addEventListener('DOMContentLoaded', () => {
    const toast    = (m, t = 'info') => window.PdM?.showToast(m, t);
    const apiFetch = (...a) => window.PdM.apiFetch(...a);
    const rol      = window.PdM.getRol();
    const isSys    = rol === 'sysadmin';
    const isAdmin  = rol === 'admin' || rol === 'sysadmin';

    // Redirigir si no tiene permiso de admin
    if (!isAdmin) {
        window.location.href = 'index.html';
        return;
    }

    // ── Estado ─────────────────────────────────────────────────
    let allPlantas  = [];
    let allUsuarios = [];
    let editingUsrId = null;
    let confirmCallback = null;

    // ── Navegación ─────────────────────────────────────────────
    document.querySelectorAll('.usr-nav-item').forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            document.querySelectorAll('.usr-nav-item').forEach(x => x.classList.remove('active'));
            document.querySelectorAll('.usr-page').forEach(x => x.classList.remove('active'));
            item.classList.add('active');
            const page = document.getElementById('page-' + item.dataset.page);
            if (page) page.classList.add('active');
            // Cargar datos al cambiar de sección
            if (item.dataset.page === 'usuarios') loadUsuarios();
            if (item.dataset.page === 'plantas') loadPlantas();
            if (item.dataset.page === 'audit') loadAudit();
            if (item.dataset.page === 'backup') loadBackups();
        });
    });

    // Ocultar opciones que no aplican al rol
    if (!isSys) {
        document.getElementById('rol-sysadmin-opt').style.display = 'none';
        // Ocultar página de auditoría y seguridad para admin planta
        document.querySelector('[data-page="audit"]').style.display = 'none';
        document.querySelector('[data-page="seguridad"]').style.display = 'none';
    }

    // ════════════════════════════════════════════════════════════
    // PLANTAS
    // ════════════════════════════════════════════════════════════
    async function loadPlantas() {
        try {
            const res = await apiFetch('/api/plantas');
            if (!res?.ok) return toast('Error al cargar plantas.', 'error');
            allPlantas = await res.json();
            renderPlantas();
        } catch { toast('Error de conexión.', 'error'); }
    }

    function renderPlantas() {
        const tbody = document.getElementById('plantas-tbody');
        if (!allPlantas.length) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--text-muted);">
                <i class="fa-solid fa-industry" style="font-size:1.5em;opacity:.3;display:block;margin-bottom:8px;"></i>
                No hay plantas creadas. Crea la primera para comenzar.
            </td></tr>`;
            return;
        }
        tbody.innerHTML = allPlantas.map(p => `
            <tr>
                <td><strong>${p.nombre}</strong></td>
                <td style="color:var(--text-secondary);">${p.descripcion || '—'}</td>
                <td style="color:var(--text-muted);font-size:.82em;">${formatTs(p.created_at)}</td>
                <td>
                    ${isSys ? `<button class="usr-btn usr-btn-ghost usr-btn-sm btn-del-planta" data-nombre="${p.nombre}">
                        <i class="fa-solid fa-trash"></i>
                    </button>` : ''}
                </td>
            </tr>`).join('');

        tbody.querySelectorAll('.btn-del-planta').forEach(btn => {
            btn.addEventListener('click', () => {
                openConfirm(`¿Eliminar la planta "<strong>${btn.dataset.nombre}</strong>"? Todos los usuarios perderán acceso a ella.`, async () => {
                    const res = await apiFetch(`/api/plantas/${encodeURIComponent(btn.dataset.nombre)}`, { method: 'DELETE' });
                    if (res?.ok) { toast('Planta eliminada.', 'info'); loadPlantas(); }
                    else toast('Error al eliminar planta.', 'error');
                });
            });
        });
    }

    document.getElementById('btn-nueva-planta').addEventListener('click', () => {
        if (!isSys) { toast('Solo el Admin Sistema puede crear plantas.', 'error'); return; }
        document.getElementById('planta-nombre').value = '';
        document.getElementById('planta-desc').value = '';
        document.getElementById('modal-planta').style.display = 'flex';
    });

    document.getElementById('save-modal-planta').addEventListener('click', async () => {
        const nombre = document.getElementById('planta-nombre').value.trim();
        const desc   = document.getElementById('planta-desc').value.trim();
        if (!nombre) { toast('El nombre es obligatorio.', 'error'); return; }
        const res = await apiFetch('/api/plantas', { method: 'POST', body: JSON.stringify({ nombre, descripcion: desc }) });
        if (res?.ok) {
            toast(`✅ Planta "${nombre}" creada.`, 'success');
            document.getElementById('modal-planta').style.display = 'none';
            loadPlantas();
        } else {
            const e = await res?.json().catch(()=>({}));
            toast('❌ ' + (e.error || 'Error al crear planta.'), 'error');
        }
    });

    ['close-modal-planta','cancel-modal-planta'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => document.getElementById('modal-planta').style.display = 'none');
    });

    // ════════════════════════════════════════════════════════════
    // USUARIOS
    // ════════════════════════════════════════════════════════════
    async function loadUsuarios() {
        try {
            const res = await apiFetch('/api/usuarios');
            if (!res?.ok) return toast('Error al cargar usuarios.', 'error');
            allUsuarios = await res.json();
            renderUsuarios();
        } catch { toast('Error de conexión.', 'error'); }
    }

    function renderUsuarios() {
        const tbody = document.getElementById('usuarios-tbody');
        if (!allUsuarios.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-muted);">
                No hay usuarios registrados.
            </td></tr>`;
            return;
        }
        const rolLabels = { sysadmin:'Admin Sistema', admin:'Admin Planta', tecnico:'Técnico', visor:'Visor' };
        tbody.innerHTML = allUsuarios.map(u => {
            const plantas = (u.plantas || []).map(p => `<span class="planta-chip">${p}</span>`).join('') || '<span style="color:var(--text-muted);font-size:.82em;">Sin planta</span>';
            const badgeCls = `rol-badge rol-${u.rol}`;
            return `<tr>
                <td><code style="font-size:.85em;">${u.usuario}</code></td>
                <td><strong>${u.nombre}</strong></td>
                <td><span class="${badgeCls}"><i class="fa-solid fa-circle" style="font-size:.5em;"></i>${rolLabels[u.rol]||u.rol}</span></td>
                <td>${plantas}</td>
                <td>
                    <span class="activo-badge ${u.activo ? 'activo-si' : 'activo-no'}" title="${u.activo ? 'Activo' : 'Inactivo'}"></span>
                    <span style="font-size:.8em;color:var(--text-muted);margin-left:4px;">${u.activo ? 'Activo' : 'Inactivo'}</span>
                </td>
                <td style="display:flex;gap:4px;">
                    <button class="usr-btn usr-btn-ghost usr-btn-sm btn-edit-usr" data-id="${u.id}" title="Editar">
                        <i class="fa-solid fa-pencil"></i>
                    </button>
                    ${isSys ? `<button class="usr-btn usr-btn-sm btn-del-usr" data-id="${u.id}" data-nombre="${u.usuario}" title="Eliminar" style="background:var(--danger-light);color:var(--danger);">
                        <i class="fa-solid fa-trash"></i>
                    </button>` : ''}
                </td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('.btn-edit-usr').forEach(btn => {
            btn.addEventListener('click', () => openUsuarioModal(parseInt(btn.dataset.id)));
        });
        tbody.querySelectorAll('.btn-del-usr').forEach(btn => {
            btn.addEventListener('click', () => {
                openConfirm(`¿Eliminar el usuario "<strong>${btn.dataset.nombre}</strong>"? Esta acción es irreversible.`, async () => {
                    const res = await apiFetch(`/api/usuarios/${btn.dataset.id}`, { method: 'DELETE' });
                    if (res?.ok) { toast('Usuario eliminado.', 'info'); loadUsuarios(); }
                    else toast('Error al eliminar usuario.', 'error');
                });
            });
        });
    }

    // ── Modal usuario ──────────────────────────────────────────
    function openUsuarioModal(usrId = null) {
        editingUsrId = usrId;
        const isEdit = usrId !== null;
        document.getElementById('modal-usr-title').innerHTML = isEdit
            ? '<i class="fa-solid fa-pencil"></i> Editar Usuario'
            : '<i class="fa-solid fa-user-plus"></i> Nuevo Usuario';

        const u = isEdit ? allUsuarios.find(x => x.id === usrId) : null;
        document.getElementById('usr-usuario').value  = u?.usuario  || '';
        document.getElementById('usr-nombre').value   = u?.nombre   || '';
        document.getElementById('usr-password').value = '';
        document.getElementById('usr-rol').value      = u?.rol      || 'visor';
        document.getElementById('pass-required').style.display = isEdit ? 'none' : '';
        document.getElementById('activo-field').style.display   = isEdit ? '' : 'none';
        if (isEdit) document.getElementById('usr-activo').checked = u?.activo !== false;
        document.getElementById('usr-usuario').disabled = isEdit;

        // Mostrar opción sysadmin solo si el creador es sysadmin
        document.getElementById('rol-sysadmin-opt').style.display = isSys ? '' : 'none';

        // Poblar checkboxes de plantas
        buildPlantasCheckboxes(u?.plantas || []);

        document.getElementById('modal-usuario').style.display = 'flex';
    }

    function buildPlantasCheckboxes(selectedPlantas = []) {
        const wrap = document.getElementById('plantas-checkboxes');
        const plantasDisp = isSys ? allPlantas : allPlantas.filter(p => window.PdM.getPlantas().includes(p.nombre));
        if (!plantasDisp.length) {
            wrap.innerHTML = '<span style="color:var(--text-muted);font-size:.85em;">No hay plantas disponibles. Crea plantas primero.</span>';
            return;
        }
        wrap.innerHTML = plantasDisp.map(p => `
            <label class="planta-cb-label">
                <input type="checkbox" value="${p.nombre}" ${selectedPlantas.includes(p.nombre) ? 'checked' : ''}>
                ${p.nombre}
            </label>`).join('');
    }

    document.getElementById('btn-nuevo-usuario').addEventListener('click', () => openUsuarioModal(null));

    document.getElementById('save-modal-usr').addEventListener('click', async () => {
        const usuario  = document.getElementById('usr-usuario').value.trim().toLowerCase();
        const nombre   = document.getElementById('usr-nombre').value.trim();
        const password = document.getElementById('usr-password').value;
        const rol      = document.getElementById('usr-rol').value;
        const activo   = document.getElementById('usr-activo').checked;
        const plantas  = [...document.querySelectorAll('#plantas-checkboxes input:checked')].map(cb => cb.value);

        if (!usuario || !nombre) { toast('Usuario y nombre son obligatorios.', 'error'); return; }
        if (!editingUsrId && !password) { toast('La contraseña es obligatoria.', 'error'); return; }
        if (password && password.length < 8) { toast('La contraseña debe tener mínimo 8 caracteres.', 'error'); return; }
        if (!plantas.length) { toast('Asigna al menos una planta.', 'error'); return; }

        const payload = { usuario, nombre, rol, plantas };
        if (password) payload.password = password;
        if (editingUsrId) payload.activo = activo;

        const url    = editingUsrId ? `/api/usuarios/${editingUsrId}` : '/api/usuarios';
        const method = editingUsrId ? 'PUT' : 'POST';

        try {
            const res = await apiFetch(url, { method, body: JSON.stringify(payload) });
            if (res?.ok) {
                toast(editingUsrId ? '✅ Usuario actualizado.' : '✅ Usuario creado.', 'success');
                document.getElementById('modal-usuario').style.display = 'none';
                loadUsuarios();
            } else {
                const e = await res?.json().catch(() => ({}));
                toast('❌ ' + (e.error || 'Error al guardar usuario.'), 'error');
            }
        } catch { toast('❌ Error de conexión.', 'error'); }
    });

    ['close-modal-usr','cancel-modal-usr'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => document.getElementById('modal-usuario').style.display = 'none');
    });
    document.getElementById('modal-usuario')?.addEventListener('click', e => {
        if (e.target === document.getElementById('modal-usuario')) document.getElementById('modal-usuario').style.display = 'none';
    });

    // ════════════════════════════════════════════════════════════
    // AUDITORÍA
    // ════════════════════════════════════════════════════════════
    async function loadAudit() {
        if (!isSys) return;
        const list = document.getElementById('audit-list');
        list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i></div>';
        try {
            const res = await apiFetch('/api/audit');
            if (!res?.ok) { list.innerHTML = '<div style="padding:16px;color:var(--danger);">Error al cargar auditoría.</div>'; return; }
            const rows = await res.json();
            if (!rows.length) {
                list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);">Sin registros de auditoría.</div>';
                return;
            }
            list.innerHTML = `
                <div class="audit-row" style="background:var(--gray-800);color:#fff;font-size:.75em;font-weight:700;text-transform:uppercase;letter-spacing:.4px;">
                    <span>Fecha</span><span>Usuario</span><span>Acción</span><span>Detalle</span>
                </div>` +
                rows.map(r => `
                <div class="audit-row">
                    <span class="audit-ts">${formatTs(r.created_at)}</span>
                    <span>${r.usuario_nombre || '—'} <span style="font-size:.75em;color:var(--text-muted);">(${r.usuario_rol})</span></span>
                    <span class="audit-accion">${r.accion}</span>
                    <span style="color:var(--text-muted);font-size:.82em;">${r.detalle || ''}</span>
                </div>`).join('');
        } catch { list.innerHTML = '<div style="padding:16px;color:var(--danger);">Error de conexión.</div>'; }
    }

    document.getElementById('btn-refresh-audit')?.addEventListener('click', loadAudit);

    // ════════════════════════════════════════════════════════════
    // MODAL CONFIRMACIÓN
    // ════════════════════════════════════════════════════════════
    function openConfirm(msg, onConfirm) {
        document.getElementById('confirm-msg').innerHTML = msg;
        confirmCallback = onConfirm;
        document.getElementById('modal-confirm').style.display = 'flex';
    }

    document.getElementById('do-confirm').addEventListener('click', async () => {
        if (confirmCallback) await confirmCallback();
        document.getElementById('modal-confirm').style.display = 'none';
        confirmCallback = null;
    });

    ['close-modal-confirm','cancel-confirm'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => {
            document.getElementById('modal-confirm').style.display = 'none';
            confirmCallback = null;
        });
    });

    // ════════════════════════════════════════════════════════════
    // RESPALDOS
    // ════════════════════════════════════════════════════════════
    async function loadBackups() {
        const tbody   = document.getElementById('backups-tbody');
        const statusEl = document.getElementById('backup-status');
        if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Cargando...</td></tr>`;

        try {
            const res = await apiFetch('/api/admin/backups');
            if (!res?.ok) {
                if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--danger);">Error al cargar la lista de respaldos.</td></tr>`;
                return;
            }
            const backups = await res.json();

            // Actualizar comando de ejemplo con el respaldo más reciente
            const cmdEl = document.getElementById('restore-cmd-example');
            if (cmdEl) {
                const ejemplo = backups[0]?.nombre || 'pdm_AAAAMMDD_HHMM.backup';
                cmdEl.textContent =
                    `"C:\\Program Files\\PostgreSQL\\16\\bin\\pg_restore.exe"\n` +
                    `  -U postgres -d edwards_pdm_db -c -F c\n` +
                    `  "C:\\Respaldos\\PDM\\${ejemplo}"`;
            }

            if (!backups.length) {
                if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--text-muted);">
                    <i class="fa-solid fa-database" style="font-size:1.5em;opacity:.3;display:block;margin-bottom:8px;"></i>
                    No hay respaldos todavía. Haz clic en "Crear Respaldo Ahora" para generar el primero.
                </td></tr>`;
                return;
            }

            if (tbody) {
                tbody.innerHTML = backups.map((b, i) => `
                    <tr>
                        <td>
                            <i class="fa-solid fa-file-zipper" style="color:var(--primary);margin-right:6px;"></i>
                            <code style="font-size:.83em;">${b.nombre}</code>
                            ${i === 0 ? '<span style="background:#dcfce7;color:#16a34a;font-size:.72em;font-weight:700;padding:2px 7px;border-radius:10px;margin-left:6px;">MÁS RECIENTE</span>' : ''}
                        </td>
                        <td style="color:var(--text-secondary);">${b.tamaño_kb} KB</td>
                        <td style="color:var(--text-muted);font-size:.83em;">${formatTs(b.fecha)}</td>
                        <td>
                            <button class="usr-btn usr-btn-ghost usr-btn-sm btn-del-backup" data-nombre="${b.nombre}" title="Eliminar respaldo">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </td>
                    </tr>`).join('');

                tbody.querySelectorAll('.btn-del-backup').forEach(btn => {
                    btn.addEventListener('click', () => {
                        openConfirm(
                            `¿Eliminar el respaldo <strong>${btn.dataset.nombre}</strong>? No se puede recuperar.`,
                            async () => {
                                const r = await apiFetch(`/api/admin/backups/${encodeURIComponent(btn.dataset.nombre)}`, { method: 'DELETE' });
                                if (r?.ok) { toast('Respaldo eliminado.', 'info'); loadBackups(); }
                                else toast('Error al eliminar respaldo.', 'error');
                            }
                        );
                    });
                });
            }
        } catch (e) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--danger);">Error de conexión: ${e.message}</td></tr>`;
        }
    }

    // Crear respaldo
    document.getElementById('btn-crear-backup')?.addEventListener('click', async () => {
        const btn      = document.getElementById('btn-crear-backup');
        const statusEl = document.getElementById('backup-status');
        btn.disabled   = true;
        btn.innerHTML  = '<i class="fa-solid fa-spinner fa-spin"></i> Creando respaldo...';
        if (statusEl)  { statusEl.style.display = 'block'; statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Ejecutando pg_dump...'; statusEl.style.color = 'var(--text-secondary)'; }

        try {
            const res  = await apiFetch('/api/admin/backup', { method: 'POST' });
            const data = await res?.json().catch(() => ({}));

            if (res?.ok) {
                toast(`✅ Respaldo creado: ${data.archivo} (${data.tamaño_kb} KB)`, 'success');
                if (statusEl) {
                    statusEl.innerHTML = `<i class="fa-solid fa-check-circle" style="color:var(--success);"></i> <strong>Respaldo exitoso:</strong> ${data.archivo} — ${data.tamaño_kb} KB`;
                    statusEl.style.color = 'var(--success)';
                }
                loadBackups();
            } else {
                toast('❌ Error al crear respaldo: ' + (data.error || 'desconocido'), 'error');
                if (statusEl) {
                    statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--danger);"></i> <strong>Error:</strong> ${data.error || 'No se pudo crear el respaldo'}${data.detail ? '<br><code style="font-size:.8em;">' + data.detail + '</code>' : ''}`;
                    statusEl.style.color = 'var(--danger)';
                }
            }
        } catch (e) {
            toast('❌ Error de conexión.', 'error');
            if (statusEl) { statusEl.innerHTML = `<i class="fa-solid fa-wifi"></i> Error de conexión: ${e.message}`; statusEl.style.color = 'var(--danger)'; }
        } finally {
            btn.disabled  = false;
            btn.innerHTML = '<i class="fa-solid fa-download"></i> Crear Respaldo Ahora';
        }
    });

    document.getElementById('btn-refresh-backups')?.addEventListener('click', loadBackups);

    // ════════════════════════════════════════════════════════════
    // UTILIDADES
    // ════════════════════════════════════════════════════════════
    function formatTs(ts) {
        if (!ts) return '—';
        const d = new Date(ts);
        const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        return `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    // ════════════════════════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════════════════════════
    async function init() {
        await loadPlantas();
        await loadUsuarios();
    }
    init();
});
