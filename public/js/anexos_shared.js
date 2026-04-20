// anexos_shared.js

document.addEventListener('DOMContentLoaded', function() {
    console.log("anexos_shared.js cargado para manejar lógica de anexos.");

    const anexoResultadoTableBody = document.getElementById('anexo-resultado-tbody');
    const addAnexoResultadoRowBtn = document.getElementById('add-anexo-resultado-row-btn');
    const anexoDetailsArea = document.getElementById('anexo-details-area');
    const editModeToggleAnexo = document.getElementById('editModeToggleAnexo');
    const anexoReportTitleElement = document.getElementById('anexoReportTitle');

    // --- Lógica para edición del título del reporte del anexo ---
    if (editModeToggleAnexo && anexoReportTitleElement) {
        loadAnexoReportTitle();
        editModeToggleAnexo.addEventListener('change', function() {
            const isEditMode = this.checked;
            anexoReportTitleElement.setAttribute('contenteditable', isEditMode);
            anexoReportTitleElement.classList.toggle('editable-active', isEditMode);
            
            const iconElement = anexoReportTitleElement.querySelector('i');
            if (iconElement) {
                iconElement.style.display = isEditMode ? 'none' : 'inline-block';
            }

            if (isEditMode) {
                anexoReportTitleElement.focus();
                if (iconElement && !anexoReportTitleElement.dataset.iconHtml) { // Guardar solo si no se ha guardado ya
                    anexoReportTitleElement.dataset.iconHtml = iconElement.outerHTML;
                }
                anexoReportTitleElement.addEventListener('blur', handleAnexoTitleBlur);
            } else {
                anexoReportTitleElement.removeEventListener('blur', handleAnexoTitleBlur);
                saveAnexoReportTitle(); // Guardar al salir del modo edición
                // Restaurar el ícono si se guardó y no está presente
                if (anexoReportTitleElement.dataset.iconHtml && !anexoReportTitleElement.querySelector('i')) {
                     // Asegurarse de que el texto guardado no se duplique si ya está
                    let currentText = "";
                    anexoReportTitleElement.childNodes.forEach(node => {
                        if (node.nodeType === Node.TEXT_NODE) currentText += node.textContent.trim();
                    });
                    anexoReportTitleElement.innerHTML = anexoReportTitleElement.dataset.iconHtml + " " + currentText;
                } else if (iconElement) { // Si el ícono ya está, solo asegurarse de que sea visible
                    iconElement.style.display = 'inline-block';
                }
            }
        });
    }

    function handleAnexoTitleBlur() {
        saveAnexoReportTitle();
        // No se restaura el ícono aquí, se hace al desactivar el toggle.
    }

    function saveAnexoReportTitle() {
        if (anexoReportTitleElement && anexoReportTitleElement.dataset.editableTitleId) {
            const titleId = anexoReportTitleElement.dataset.editableTitleId;
            let textToSave = '';
            // Iterar sobre los nodos hijos para extraer solo el texto, excluyendo el HTML del ícono
            anexoReportTitleElement.childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    textToSave += node.textContent;
                }
            });
            const newText = textToSave.trim();

            // Guardar en sessionStorage (disponible en file:// y http://)
            // El título también viaja dentro del JSON de datos al guardar en BD
            try {
                sessionStorage.setItem(titleId, newText);
            } catch (e) {
                // sessionStorage no disponible: ignorar silenciosamente
            }
        }
    }

    function loadAnexoReportTitle() {
        if (anexoReportTitleElement && anexoReportTitleElement.dataset.editableTitleId) {
            const titleId = anexoReportTitleElement.dataset.editableTitleId;
            try {
                // Intentar sessionStorage primero, luego localStorage como fallback
                const savedText = sessionStorage.getItem(titleId) || (typeof localStorage !== 'undefined' ? localStorage.getItem(titleId) : null);
                const iconElement = anexoReportTitleElement.querySelector('i');
                let iconHTML = '';

                if (iconElement) { // Si hay un ícono originalmente en el HTML
                    iconHTML = iconElement.outerHTML + ' '; // Guardar su HTML
                    anexoReportTitleElement.dataset.iconHtml = iconHTML; // Guardar para referencia
                }

                if (savedText !== null && savedText.trim() !== '') {
                    // Reconstruir el contenido: ícono (si existe) + texto guardado
                    anexoReportTitleElement.innerHTML = (iconElement ? anexoReportTitleElement.dataset.iconHtml : '') + savedText.trim();
                } else if (iconElement && anexoReportTitleElement.textContent.trim() === iconElement.textContent.trim()) {
                    // Si no hay texto guardado y el título solo contiene el ícono, asegurar que el dataset.iconHtml esté.
                    if (!anexoReportTitleElement.dataset.iconHtml) anexoReportTitleElement.dataset.iconHtml = iconElement.outerHTML + ' ';
                }
                // Si no hay texto guardado Y el título original tenía texto además del ícono, se mantiene el original.
            } catch (e) {
                // Storage no disponible: mantener texto original del DOM
            }
        }
    }


    // --- Lógica de tabla de resultados y detalles para Anexos ---
    if (anexoResultadoTableBody && addAnexoResultadoRowBtn && anexoDetailsArea) {
        setupAnexoResultadoTableHeader();
        if (anexoResultadoTableBody.children.length > 0) {
            renumberAnexoComponents();
        }
        addAnexoResultadoRowBtn.addEventListener('click', addAnexoResultadoRow);
        anexoResultadoTableBody.addEventListener('click', handleAnexoResultadoTableClicks);
        anexoResultadoTableBody.addEventListener('input', handleAnexoResultadoTableInputs);
        anexoDetailsArea.addEventListener('click', handleAnexoDetailsClicks);
        anexoDetailsArea.addEventListener('input', handleAnexoDetailsInput);
    }

    function setupAnexoResultadoTableHeader() {
        const table = document.getElementById('anexo-resultado-table');
        if (!table) return;
        let thead = table.querySelector('thead');
        if (!thead) thead = table.createTHead();
        thead.innerHTML = ''; 
        const headerRow = thead.insertRow();
        headerRow.innerHTML = `
            <th>Componente</th>
            <th>Estado</th>
            <th>Acciones</th>
            <th>Severidad</th>
        `;
    }

    function addAnexoResultadoRow() {
        const currentRowCount = anexoResultadoTableBody.querySelectorAll('tr[data-component-id]').length;
        const nextComponentNumber = currentRowCount + 1;
        const componentId = `anexo-comp-${nextComponentNumber}-${Date.now()}`;
        const defaultComponentName = `Punto Anexo ${nextComponentNumber}`;

        const newRow = document.createElement('tr');
        newRow.dataset.componentId = componentId;
        newRow.innerHTML = `
            <td data-label="Componente" class="component-cell">
                <div class="component-cell-content">
                    <input type="text" class="component-name anexo-component-name" value="${defaultComponentName}" placeholder="Nombre punto/componente" data-target-id="${componentId}">
                    <button class="delete-resultado-row-btn anexo-delete-btn" title="Eliminar Punto"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </td>
            <td class="component-status" data-label="Estado">-</td> 
            <td class="component-actions" data-label="Acciones">-</td>
            <td class="component-severity" data-label="Severidad"></td> 
        `;
        anexoResultadoTableBody.appendChild(newRow);
        generateAnexoDetailSection(componentId, defaultComponentName);
    }
    
    function generateAnexoDetailSection(componentId, componentName) {
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'component-details-section anexo-details-section-specific';
        sectionDiv.dataset.componentId = componentId;
        sectionDiv.id = `details-${componentId}`;

        let specificDataTableHTML = '';
        let pageTitle = document.title; // Usar el título de la página para diferenciar

        if (pageTitle && pageTitle.includes("Anexo de Termografía")) {
            specificDataTableHTML = `
                <h5 class="component-data-table-title">Datos Específicos del Punto Termográfico</h5>
                <table class="component-data-table anexo-termografia-data-table" id="data-table-termografia-${componentId}">
                    <thead><tr><th colspan="6" class="data-section-header">Datos Generales</th></tr></thead>
                    <tbody>
                        <tr>
                            <td><label for="no_imagen_ir-${componentId}">No. De Imagen IR:</label></td><td><input type="text" id="no_imagen_ir-${componentId}" name="no_imagen_ir-${componentId}"></td>
                            <td><label for="no_imagen_visual-${componentId}">No. Imagen Visual:</label></td><td><input type="text" id="no_imagen_visual-${componentId}" name="no_imagen_visual-${componentId}"></td>
                            <td><label for="humedad_rel-${componentId}">Humedad Rel.:</label></td><td><input type="text" id="humedad_rel-${componentId}" name="humedad_rel-${componentId}" placeholder="Ej: 50%"></td>
                        </tr>
                        <tr>
                            <td><label for="distancia-${componentId}">Distancia:</label></td><td><input type="text" id="distancia-${componentId}" name="distancia-${componentId}" placeholder="Ej: 0.50m"></td>
                            <td><label for="veloc_viento-${componentId}">Veloc. Viento:</label></td><td><input type="text" id="veloc_viento-${componentId}" name="veloc_viento-${componentId}" placeholder="Ej: N/A"></td>
                            <td><label for="amperaje-${componentId}">Amperaje:</label></td><td><input type="text" id="amperaje-${componentId}" name="amperaje-${componentId}" placeholder="Ej: 24A"></td>
                        </tr>
                    </tbody>
                    <thead><tr><th colspan="6" class="data-section-header">Medición</th></tr></thead>
                    <tbody>
                        <tr>
                            <td><label for="temp_max-${componentId}">Temp. Máx.:</label></td><td colspan="2"><input type="text" id="temp_max-${componentId}" name="temp_max-${componentId}" placeholder="Ej: 115.08 °C (239.15°F)"></td>
                            <td><label for="temp_ref-${componentId}">Temp. Ref.:</label></td><td colspan="2"><input type="text" id="temp_ref-${componentId}" name="temp_ref-${componentId}" placeholder="Ej: N/A"></td>
                        </tr>
                        <tr>
                            <td><label for="delta_t-${componentId}">ΔT=:</label></td><td colspan="2"><input type="text" id="delta_t-${componentId}" name="delta_t-${componentId}" placeholder="Ej: N/A"></td>
                            <td><label for="emisividad-${componentId}">Emisividad:</label></td><td colspan="2"><input type="text" id="emisividad-${componentId}" name="emisividad-${componentId}" value="0.95"></td>
                        </tr>
                    </tbody>
                </table>`;
        } else if (pageTitle && pageTitle.includes("Anexo de Ultrasonido")) {
            specificDataTableHTML = `
                <h5 class="component-data-table-title">Datos Específicos del Punto de Ultrasonido</h5>
                <table class="component-data-table anexo-ultrasonido-data-table" id="data-table-ultrasonido-${componentId}">
                    <thead><tr><th colspan="4" class="data-section-header">Datos Generales del Punto</th></tr></thead>
                    <tbody>
                        <tr>
                            <td><label for="tipo_inspeccion_us-${componentId}">Tipo Inspección:</label></td><td><input type="text" id="tipo_inspeccion_us-${componentId}" name="tipo_inspeccion_us-${componentId}" placeholder="Aérea / Contacto"></td>
                            <td><label for="sensor_us-${componentId}">Sensor Utilizado:</label></td><td><input type="text" id="sensor_us-${componentId}" name="sensor_us-${componentId}"></td>
                        </tr>
                        <tr>
                            <td><label for="frec_central_us-${componentId}">Frec. Central (kHz):</label></td><td><input type="text" id="frec_central_us-${componentId}" name="frec_central_us-${componentId}" placeholder="Ej: 40"></td>
                            <td><label for="ruido_ambiente_us-${componentId}">Ruido Ambiente (dB):</label></td><td><input type="text" id="ruido_ambiente_us-${componentId}" name="ruido_ambiente_us-${componentId}" placeholder="Ej: 10"></td>
                        </tr>
                    </tbody>
                    <thead><tr><th colspan="4" class="data-section-header">Medición del Punto</th></tr></thead>
                    <tbody>
                        <tr>
                            <td><label for="nivel_max_us-${componentId}">Nivel Máx. (dBµV):</label></td><td><input type="text" id="nivel_max_us-${componentId}" name="nivel_max_us-${componentId}"></td>
                            <td><label for="nivel_prom_us-${componentId}">Nivel Prom. (dBµV):</label></td><td><input type="text" id="nivel_prom_us-${componentId}" name="nivel_prom_us-${componentId}"></td>
                        </tr>
                        <tr>
                            <td><label for="carac_sonido_us-${componentId}">Características Sonido:</label></td><td colspan="3"><input type="text" id="carac_sonido_us-${componentId}" name="carac_sonido_us-${componentId}" placeholder="Siseo, Chisporroteo, etc."></td>
                        </tr>
                    </tbody>
                </table>`;
        }

        let imageSectionTitle = (pageTitle && pageTitle.includes("Anexo de Termografía")) ? 
                                "Imágenes (Termogramas, Fotos Visibles, etc.)" : 
                                "Registros (Espectros, Ondas de Tiempo, etc.)";

        sectionDiv.innerHTML = `
            <h4>Detalles para: <span class="dynamic-component-title anexo-dynamic-title">${componentName}</span></h4>
            <h5>${imageSectionTitle}</h5>
            <div class="component-image-area anexo-component-image-area" id="anexo-image-area-${componentId}"></div>
            <button class="add-component-image-btn anexo-add-comp-img-btn" data-target-area="anexo-image-area-${componentId}">
                <i class="fa-solid fa-plus"></i> Añadir Imagen/Registro
            </button>
            
            ${specificDataTableHTML} 
            ${specificDataTableHTML ? '<hr class="subsection-separator">' : ''}

            <h5>Estado de Componente:</h5>
            <textarea class="component-estado-textarea anexo-estado-textarea" rows="4" placeholder="Describa el estado detallado..." data-target-id="${componentId}"></textarea>
            <h5>Acciones:</h5>
            <textarea class="component-acciones-textarea anexo-acciones-textarea" rows="4" placeholder="Describa las acciones recomendadas..." data-target-id="${componentId}"></textarea>
            <h5>Severidad:</h5>
            <div class="severity-input-container">
                <input type="text" class="severity-input anexo-severity-input" maxlength="1" placeholder="B, A, C" data-target-id="${componentId}">
                <span class="severity-box anexo-severity-box" title="Severidad Visual"></span>
                <span class="severity-legend">(B: Bueno, A: Alerta, C: Crítico)</span>
            </div>
        `;
        anexoDetailsArea.appendChild(sectionDiv);
    }

    function deleteAnexoResultadoRow(button) {
        const row = button.closest('tr');
        if (row && row.dataset.componentId) {
            const componentId = row.dataset.componentId;
            deleteAnexoDetailSection(componentId);
            row.remove();
            renumberAnexoComponents();
        }
    }

    function deleteAnexoDetailSection(componentId) {
        const section = document.getElementById(`details-${componentId}`);
        if (section) {
            section.remove();
        }
    }

    function renumberAnexoComponents() {
        const rows = anexoResultadoTableBody.querySelectorAll('tr[data-component-id]');
        const defaultNamePattern = /^Punto Anexo\s+\d+$/i;
        rows.forEach((row, index) => {
            const newNumber = index + 1;
            const componentId = row.dataset.componentId;
            if (!componentId) return;

            const nameInput = row.querySelector('input.anexo-component-name'); 
            const detailSection = document.getElementById(`details-${componentId}`);
            const detailTitleSpan = detailSection?.querySelector('.anexo-dynamic-title'); 

            if (nameInput) {
                const currentName = nameInput.value.trim();
                const newDefaultName = `Punto Anexo ${newNumber}`;
                if (defaultNamePattern.test(currentName) || currentName === "" || currentName.startsWith("Punto Anexo ")) {
                    nameInput.value = newDefaultName;
                    if (detailTitleSpan) detailTitleSpan.textContent = newDefaultName;
                } else {
                    if (detailTitleSpan) detailTitleSpan.textContent = currentName;
                }
            }
        });
    }

    function updateAnexoComponentTitle(inputElement) {
        const componentId = inputElement.dataset.targetId;
        if (!componentId) return;
        const detailsSection = document.getElementById(`details-${componentId}`);
        if (detailsSection) {
            const titleSpan = detailsSection.querySelector('.anexo-dynamic-title');
            if (titleSpan) {
                titleSpan.textContent = inputElement.value.trim() || `Punto Anexo ${componentId.split('-')[2] || '?'}`;
            }
        }
    }

    function updateAnexoResultadoTable(sourceElement, columnType) {
        const componentId = sourceElement.dataset.targetId;
        if (!componentId) return;
        const targetRow = anexoResultadoTableBody.querySelector(`tr[data-component-id="${componentId}"]`);
        if (!targetRow) return;

        let value = sourceElement.value.trim();
        let targetCell;

        switch (columnType) {
            case 'status':
                targetCell = targetRow.querySelector('td.component-status'); 
                if (targetCell) targetCell.textContent = value || '-';
                break;
            case 'actions':
                targetCell = targetRow.querySelector('td.component-actions'); 
                if (targetCell) targetCell.textContent = value || '-';
                break;
            case 'severity':
                targetCell = targetRow.querySelector('td.component-severity'); 
                const detailSeverityBox = sourceElement.closest('.anexo-details-section-specific')?.querySelector('.anexo-severity-box'); 
                if (targetCell) {
                    updateSeverityCellStyle(sourceElement, targetCell); 
                }
                if(detailSeverityBox){
                     updateSeverityVisualBox(sourceElement, detailSeverityBox); 
                }
                break;
        }
    }

    function handleAnexoResultadoTableClicks(event) {
        const deleteBtn = event.target.closest('.anexo-delete-btn'); 
        if (deleteBtn) {
            deleteAnexoResultadoRow(deleteBtn);
        }
    }
    function handleAnexoResultadoTableInputs(event) {
        if (event.target.classList.contains('anexo-component-name')) { 
            updateAnexoComponentTitle(event.target);
        }
    }
    function handleAnexoDetailsClicks(event) {
        const addImageBtn = event.target.closest('.anexo-add-comp-img-btn'); 
        if (addImageBtn) {
            const targetAreaId = addImageBtn.dataset.targetArea;
            const containerArea = document.getElementById(targetAreaId);
            
            if (containerArea && typeof window.addImageContainerToArea === "function") { 
                 window.addImageContainerToArea(containerArea);
            } else if (containerArea) { 
                const imageContainerTemplate = ` <div class="image-container"> <button class="delete-image-btn" title="Eliminar Imagen"><i class="fa-solid fa-trash-can"></i></button> <div class="image-preview-wrapper"> <img src="" alt="Vista previa de imagen" class="image-preview" style="display: none;"> </div> <label class="image-input-label"> <i class="fa-solid fa-upload"></i> Seleccionar archivo <input type="file" accept="image/*" class="image-input" style="display: none;"> </label> <input type="text" class="image-caption" placeholder="Descripción (opcional)"> </div>`;
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = imageContainerTemplate.trim();
                const newContainer = tempDiv.firstChild;
                if (newContainer) containerArea.appendChild(newContainer);
            }
        }
    }
    function handleAnexoDetailsInput(event) {
        if (event.target.classList.contains('anexo-estado-textarea')) { 
            updateAnexoResultadoTable(event.target, 'status');
        } else if (event.target.classList.contains('anexo-acciones-textarea')) { 
            updateAnexoResultadoTable(event.target, 'actions');
        } else if (event.target.classList.contains('anexo-severity-input')) { 
            updateAnexoResultadoTable(event.target, 'severity');
        }
    }
    
    function updateSeverityCellStyle(inputElement, cellElement) {
        if (!cellElement) return;
        const severityValue = inputElement.value.trim().toUpperCase();
        cellElement.textContent = ''; 
        cellElement.className = 'component-severity'; 
        let newClass = '';
        switch (severityValue) {
            case 'B': newClass = 'severity-b'; break;
            case 'A': newClass = 'severity-a'; break;
            case 'C': newClass = 'severity-c'; break;
        }
        if (newClass) {
            cellElement.classList.add(newClass);
        }
    }

    function updateSeverityVisualBox(inputElement, boxElement) {
        if (!boxElement) return;
        const severityValue = inputElement.value.trim().toUpperCase();
        boxElement.className = 'severity-box anexo-severity-box'; 
        switch (severityValue) {
            case 'B': boxElement.classList.add('severity-b'); break;
            case 'A': boxElement.classList.add('severity-a'); break;
            case 'C': boxElement.classList.add('severity-c'); break;
        }
    }

}); // Fin de DOMContentLoaded