// reportes_generales.js — Reporte General de Inspección con persistencia en BD

document.addEventListener('DOMContentLoaded', function () {
    const toast = (m, t = 'info') => window.PdM?.showToast(m, t) || console.log(m);

    const tipoMaquinaSelect       = document.getElementById('tipo-maquina-select');
    const configGlobalMaquinaDiv  = document.getElementById('configuracion-global-maquina');
    const componentesOptionsDiv   = document.getElementById('componentes-maquina-options');
    const generarPuntosBtn        = document.getElementById('generar-puntos-btn');
    const tablasMedicionContainer = document.getElementById('tablas-medicion-container');
    const mensajeInicialTablas    = document.getElementById('mensaje-inicial-tablas');
    const controlesGeneracionTablaDiv = document.getElementById('controles-generacion-tabla');

    const VALID_ESTADO_CHARS_RG = ['B', 'A', 'C', 'N'];

    // ── Fecha de hoy ─────────────────────────────────────────────
    const hoy = new Date().toISOString().split('T')[0];
    const fechaEl = document.getElementById('fecha-reporte-general');
    if (fechaEl && !fechaEl.value) fechaEl.value = hoy;

    // ── Código consecutivo ────────────────────────────────────────
    async function generarCodigo() {
        const el     = document.getElementById('visual-report-id');
        const hidden = document.getElementById('current_report_id');
        if (!el) return;
        if (hidden?.value?.startsWith('Gen-')) { el.textContent = hidden.value; return; }
        try {
            const res = await PdM.apiFetch('/api/reportes/next-code?tecnica=generales');
            if (res?.ok) { const d = await res.json(); el.textContent = d.code; if (hidden) hidden.value = d.code; }
        } catch {
            const now = new Date();
            const dd = String(now.getDate()).padStart(2,'0');
            const m  = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][now.getMonth()];
            const yy = String(now.getFullYear()).slice(-2);
            const code = `Gen-${dd}-${m}-${yy}-${String(Math.floor(Math.random()*9999)+1).padStart(4,'0')}`;
            el.textContent = code; if (hidden) hidden.value = code;
        }
    }

    // ── Config de máquinas ────────────────────────────────────────
    const maquinasConfig = {

        // ── MOTOR ELÉCTRICO ───────────────────────────────────────
        "motor_electrico_ie": {
            nombreDisplay: "Motor Eléctrico",
            configuracionGlobal: [
                { id: "alimentacion_tipo", nombre: "Tipo de Alimentación", tipo: "select",
                  opciones: {"": "--Seleccione--", "monofasico": "Monofásico", "trifasico": "Trifásico"}, defecto: "trifasico" }
            ],
            componentes: [
                { id: "meie_alimentacion", nombre: "Alimentación y Caja de Bornes", tipo: "checkbox", defecto: true,
                  mediciones: {
                    comun:    ["Inspección Visual Cables y Conexiones", "Termografía Terminales (°C)", "Apriete de Conexiones (Torque Nm)", "Limpieza Caja de Bornes"],
                    monofasico: ["Voltaje L-N (V)", "Corriente de Línea (A)", "Potencia Activa (kW)", "Factor de Potencia"],
                    trifasico:  ["Voltaje L1-L2 (V)", "Voltaje L2-L3 (V)", "Voltaje L3-L1 (V)",
                                 "Corriente L1 (A)", "Corriente L2 (A)", "Corriente L3 (A)",
                                 "Desbalance de Corriente (%)", "Desbalance de Voltaje (%)",
                                 "Factor de Potencia Total", "Potencia Activa (kW)", "Potencia Aparente (kVA)", "Potencia Reactiva (kVAr)",
                                 "Secuencia de Fases", "THD Voltaje (%)", "THD Corriente (%)"]
                }},
                { id: "meie_bobinado", nombre: "Bobinado del Estator", tipo: "checkbox", defecto: true,
                  mediciones: {
                    comun:    ["Resistencia de Aislamiento (MΩ)", "Índice de Polarización (IP)", "Índice de Absorción Dieléctrica (DAR)"],
                    monofasico: ["Resistencia Óhmica Bobinado Principal (Ω)", "Resistencia Óhmica Bobinado Auxiliar (Ω)"],
                    trifasico:  ["Resistencia Óhmica L1-L2 (Ω)", "Resistencia Óhmica L2-L3 (Ω)", "Resistencia Óhmica L3-L1 (Ω)", "Balance de Resistencia Óhmica (%)"]
                }},
                { id: "meie_carcasa", nombre: "Carcasa y Puesta a Tierra", tipo: "checkbox", defecto: true,
                  mediciones: ["Continuidad Puesta a Tierra (Ω)", "Inspección Estado Carcasa", "Temperatura Carcasa (°C)"] },
                { id: "meie_rotor", nombre: "Rotor (si aplica)", tipo: "checkbox",
                  mediciones: ["Inspección Visual Barras del Rotor", "Prueba de Barras Rotas (si disponible)"] }
            ]
        },

        // ── TABLERO ELÉCTRICO ─────────────────────────────────────
        "tablero_electrico": {
            nombreDisplay: "Tablero Eléctrico Distribución/Control",
            configuracionGlobal: [
                { id: "te_tipo_alimentacion", nombre: "Alimentación Principal", tipo: "select",
                  opciones: {"": "--Seleccione--", "monofasico": "Monofásico", "trifasico": "Trifásico"}, defecto: "trifasico" }
            ],
            componentes: [
                { id: "te_gabinete", nombre: "Gabinete y Estructura", tipo: "checkbox", defecto: true,
                  mediciones: ["Inspección Estado Físico (Golpes, Corrosión)", "Grado de Protección IP (Verificación)", "Limpieza Interna y Externa", "Sellado y Empaques"] },
                { id: "te_interruptor_principal", nombre: "Interruptor Principal", tipo: "checkbox", defecto: true,
                  mediciones: {
                    comun:   ["Inspección Visual Contactos/Conexiones", "Termografía Terminales y Cuerpo (°C)", "Apriete de Conexiones", "Capacidad Interruptiva (kA vs Requerida)"],
                    monofasico: ["Voltaje L-N (V)", "Corriente (A)"],
                    trifasico:  ["Voltaje L1-L2 (V)", "Voltaje L2-L3 (V)", "Voltaje L3-L1 (V)", "Corriente L1 (A)", "Corriente L2 (A)", "Corriente L3 (A)"]
                }},
                { id: "te_barras_distribucion", nombre: "Barras de Distribución", tipo: "checkbox",
                  dependeDe: {id_control: "te_tipo_alimentacion", valor_requerido: "trifasico"},
                  mediciones: ["Inspección Visual (Aislamiento, Soportes)", "Termografía Barras y Conexiones (°C)", "Apriete de Conexiones"] },
                { id: "te_interruptores_derivados", nombre: "Interruptores Derivados", tipo: "number", min:1, defecto: 3,
                  unidad_nombre: "Interruptor Derivado",
                  mediciones_por_unidad: ["Identificación Circuito #", "Termografía Terminales # (°C)", "Corriente Circuito # (A)"] },
                { id: "te_contactores", nombre: "Contactores y Relés", tipo: "checkbox",
                  mediciones: ["Inspección Visual (Contactos, Bobinas)", "Termografía de Contactores (°C)", "Limpieza y Apriete"] },
                { id: "te_protecciones", nombre: "Protecciones (Fusibles, DPS, etc.)", tipo: "checkbox",
                  mediciones: ["Inspección Estado Fusibles", "Verificación Indicadores DPS", "Termografía General (°C)"] },
                { id: "te_cableado", nombre: "Cableado y Canalizaciones", tipo: "checkbox", defecto: true,
                  mediciones: ["Inspección Estado Aislamiento Cables", "Organización del Cableado", "Identificación de Circuitos (Etiquetado)"] },
                { id: "te_tierra_tablero", nombre: "Puesta a Tierra del Tablero", tipo: "checkbox", defecto: true,
                  mediciones: ["Inspección Barra de Tierra", "Continuidad Puesta a Tierra Chasis (Ω)"] }
            ]
        },

        // ── BOMBA DE AGUA ─────────────────────────────────────────
        "bomba_agua": {
            nombreDisplay: "Bomba de Agua",
            configuracionGlobal: [
                { id: "ba_alimentacion", nombre: "Alimentación Motor", tipo: "select",
                  opciones: {"": "--Seleccione--", "monofasico": "Monofásico", "trifasico": "Trifásico"}, defecto: "trifasico" }
            ],
            componentes: [
                { id: "ba_motor_elec", nombre: "Motor Eléctrico — Bornes", tipo: "checkbox", defecto: true,
                  mediciones: {
                    comun:    ["Inspección Visual Motor", "Temperatura Carcasa (°C)", "Resistencia de Aislamiento (MΩ)", "Termografía Terminales (°C)"],
                    monofasico: ["Voltaje L-N (V)", "Corriente de Línea (A)", "Factor de Potencia"],
                    trifasico:  ["Voltaje L1-L2 (V)", "Voltaje L2-L3 (V)", "Voltaje L3-L1 (V)",
                                 "Corriente L1 (A)", "Corriente L2 (A)", "Corriente L3 (A)",
                                 "Desbalance de Corriente (%)", "Factor de Potencia", "Potencia Activa (kW)"]
                }},
                { id: "ba_acople", nombre: "Acople / Transmisión", tipo: "checkbox", defecto: true,
                  mediciones: ["Inspección Visual Acople (Desgaste, Alineación)", "Estado Elemento Flexible del Acople", "Temperatura Acople (°C)"] },
                { id: "ba_hidraulica", nombre: "Parte Hidráulica", tipo: "checkbox", defecto: true,
                  mediciones: ["Presión de Succión (PSI/bar)", "Presión de Descarga (PSI/bar)", "Diferencial de Presión (ΔP)",
                               "Caudal Operativo (GPM/L/min)", "Temperatura Fluido Bombeado (°C)"] },
                { id: "ba_sello", nombre: "Sello Mecánico / Empaquetadura", tipo: "checkbox", defecto: true,
                  mediciones: ["Inspección Visual Fugas", "Estado Sello Mecánico", "Caudal Fuga Empaquetadura (gotas/min)"] }
            ]
        },

        // ── MANEJADORA DE AIRE ────────────────────────────────────
        "manejadora_aire": {
            nombreDisplay: "Manejadora de Aire (AHU)",
            configuracionGlobal: [
                { id: "ma_alimentacion", nombre: "Alimentación Motor Ventilador", tipo: "select",
                  opciones: {"": "--Seleccione--", "monofasico": "Monofásico", "trifasico": "Trifásico"}, defecto: "trifasico" }
            ],
            componentes: [
                { id: "ma_motor", nombre: "Motor del Ventilador", tipo: "checkbox", defecto: true,
                  mediciones: {
                    comun:    ["Temperatura Carcasa Motor (°C)", "Resistencia de Aislamiento (MΩ)", "Termografía Terminales (°C)"],
                    monofasico: ["Voltaje L-N (V)", "Corriente (A)", "Factor de Potencia"],
                    trifasico:  ["Voltaje L1-L2 (V)", "Voltaje L2-L3 (V)", "Voltaje L3-L1 (V)",
                                 "Corriente L1 (A)", "Corriente L2 (A)", "Corriente L3 (A)", "Desbalance de Corriente (%)"]
                }},
                { id: "ma_faja", nombre: "Faja / Correa de Transmisión", tipo: "checkbox", defecto: true,
                  mediciones: ["Inspección Visual Fajas (Desgaste, Grietas)", "Tensión de Faja (Hz/N)", "Alineación de Poleas", "Temperatura Poleas (°C)"] },
                { id: "ma_filtros", nombre: "Filtros de Aire", tipo: "checkbox", defecto: true,
                  mediciones: ["Presión Diferencial Filtros (Pa)", "Estado Visual Filtros (Sucio/Limpio)", "Fecha Último Cambio de Filtros"] },
                { id: "ma_serpentin", nombre: "Serpentín (Cooling/Heating Coil)", tipo: "checkbox",
                  mediciones: ["Temperatura Entrada Fluido (°C)", "Temperatura Salida Fluido (°C)", "Diferencia de Temperatura (ΔT °C)",
                               "Inspección Aletas (Corrosión, Obstrucción)", "Limpieza Serpentín"] },
                { id: "ma_bandeja", nombre: "Bandeja de Condensado", tipo: "checkbox", defecto: true,
                  mediciones: ["Inspección Visual Bandeja", "Limpieza y Desinfección Bandeja", "Drenaje Libre (Sin Obstrucción)"] },
                { id: "ma_gabinete", nombre: "Gabinete / Carcasa AHU", tipo: "checkbox", defecto: true,
                  mediciones: ["Inspección Estado Físico y Sellos", "Limpieza Interna", "Aislamiento Térmico (Estado)"] }
            ]
        },

        // ── VARIADOR DE FRECUENCIA ────────────────────────────────
        "variador_frecuencia": {
            nombreDisplay: "Variador de Frecuencia (VFD)",
            configuracionGlobal: [
                { id: "vfd_tipo_ali", nombre: "Alimentación de Entrada", tipo: "select",
                  opciones: {"": "--Seleccione--", "monofasico": "Monofásico", "trifasico": "Trifásico"}, defecto: "trifasico" }
            ],
            componentes: [
                { id: "vfd_gabinete", nombre: "Gabinete / Enclosure", tipo: "checkbox", defecto: true,
                  mediciones: ["Inspección Visual (Daños, Corrosión)", "Limpieza Interna", "Filtros de Ventilación (Estado)", "Temperatura Ambiente Gabinete (°C)"] },
                { id: "vfd_entrada", nombre: "Entrada de Potencia", tipo: "checkbox", defecto: true,
                  mediciones: {
                    comun:    ["Termografía Terminales Entrada (°C)", "Apriete Conexiones Entrada"],
                    monofasico: ["Voltaje Entrada L-N (V)", "Corriente Entrada (A)"],
                    trifasico:  ["Voltaje L1-L2 (V)", "Voltaje L2-L3 (V)", "Voltaje L3-L1 (V)",
                                 "Corriente L1 (A)", "Corriente L2 (A)", "Corriente L3 (A)", "THD Corriente Entrada (%)"]
                }},
                { id: "vfd_salida", nombre: "Salida al Motor", tipo: "checkbox", defecto: true,
                  mediciones: ["Voltaje Salida T1-T2 (V)", "Voltaje Salida T2-T3 (V)", "Voltaje Salida T3-T1 (V)",
                               "Corriente Salida T1 (A)", "Corriente Salida T2 (A)", "Corriente Salida T3 (A)",
                               "Frecuencia de Salida (Hz)", "Termografía Terminales Salida (°C)"] },
                { id: "vfd_dc_bus", nombre: "Bus DC / Capacitores", tipo: "checkbox", defecto: true,
                  mediciones: ["Voltaje Bus DC (V)", "Temperatura Bus DC (°C)", "Inspección Visual Capacitores"] },
                { id: "vfd_parametros", nombre: "Parámetros Operativos", tipo: "checkbox", defecto: true,
                  mediciones: ["Frecuencia de Operación (Hz)", "Porcentaje de Carga (%)", "Temperatura Interna VFD (°C)",
                               "Horas de Operación Acumuladas (h)", "Fallas en Historial (cantidad)"] }
            ]
        },

        // ── MOTOBOMBA ─────────────────────────────────────────────
        "motobomba": {
            nombreDisplay: "Motobomba (Unidad Completa)",
            configuracionGlobal: [
                { id: "mb_alimentacion", nombre: "Alimentación Motor", tipo: "select",
                  opciones: {"": "--Seleccione--", "monofasico": "Monofásico", "trifasico": "Trifásico"}, defecto: "trifasico" }
            ],
            componentes: [
                { id: "mb_motor_elec", nombre: "Motor Eléctrico", tipo: "checkbox", defecto: true,
                  mediciones: {
                    comun:    ["Temperatura Carcasa Motor (°C)", "Resistencia de Aislamiento (MΩ)", "Termografía Terminales (°C)", "Inspección Visual (Ventilación, Daños)"],
                    monofasico: ["Voltaje L-N (V)", "Corriente de Línea (A)", "Factor de Potencia"],
                    trifasico:  ["Voltaje L1-L2 (V)", "Voltaje L2-L3 (V)", "Voltaje L3-L1 (V)",
                                 "Corriente L1 (A)", "Corriente L2 (A)", "Corriente L3 (A)",
                                 "Desbalance de Corriente (%)", "Factor de Potencia", "Potencia Activa (kW)"]
                }},
                { id: "mb_hidraulica", nombre: "Parte Hidráulica", tipo: "checkbox", defecto: true,
                  mediciones: ["Presión de Succión (PSI/bar)", "Presión de Descarga (PSI/bar)", "Diferencial de Presión (ΔP)",
                               "Caudal (GPM/L/min)", "Temperatura Fluido (°C)"] },
                { id: "mb_sello", nombre: "Sello Mecánico / Empaquetadura", tipo: "checkbox", defecto: true,
                  mediciones: ["Inspección Visual Fugas", "Estado del Sello Mecánico", "Temperatura Zona Sello (°C)"] },
                { id: "mb_estructura", nombre: "Estructura y Montaje", tipo: "checkbox", defecto: true,
                  mediciones: ["Inspección Anclajes y Tornillería", "Inspección Visual Base/Bancada", "Alineación Motor-Bomba (Verificación)"] }
            ]
        },

        // ── AIRE ACONDICIONADO EXPANSIÓN DIRECTA ──────────────────
        "ac_expansion_directa": {
            nombreDisplay: "A/C Expansión Directa (Split/VRF/Packaged)",
            configuracionGlobal: [
                { id: "ac_tipo_unidad", nombre: "Tipo de Unidad", tipo: "select",
                  opciones: {"": "--Seleccione--", "split": "Split (Interior + Exterior)", "cassette": "Cassette / Piso-Techo", "packaged": "Unidad Paquete (Rooftop)"}, defecto: "split" }
            ],
            componentes: [
                { id: "ac_compresor", nombre: "Compresor", tipo: "checkbox", defecto: true,
                  mediciones: {
                    comun: ["Inspección Visual Compresor (Golpes, Fugas Aceite)", "Temperatura Línea de Descarga (°C)", "Temperatura Línea de Succión (°C)", "Corriente de Operación Compresor (A)", "Resistencia de Aislamiento Bobinas Compresor (MΩ)"],
                    trifasico: ["Voltaje L1-L2 (V)", "Voltaje L2-L3 (V)", "Voltaje L3-L1 (V)", "Corriente L1 (A)", "Corriente L2 (A)", "Corriente L3 (A)"],
                    monofasico: ["Voltaje de Operación (V)", "Corriente de Operación (A)"]
                }},
                { id: "ac_refrigerante", nombre: "Sistema de Refrigerante", tipo: "checkbox", defecto: true,
                  mediciones: ["Presión de Succión/Baja (PSI/bar)", "Presión de Descarga/Alta (PSI/bar)",
                               "Temperatura de Evaporación (°C)", "Temperatura de Condensación (°C)",
                               "Superheat (°C/°F)", "Subcooling (°C/°F)", "Inspección Visual Fugas de Refrigerante"] },
                { id: "ac_condensador", nombre: "Unidad Condensadora (Exterior)", tipo: "checkbox", defecto: true,
                  mediciones: ["Temperatura Aire Entrada Condensador (°C)", "Temperatura Aire Salida Condensador (°C)",
                               "Inspección Aletas Condensador (Obstrucción, Corrosión)", "Limpieza Aletas y Carcasa",
                               "Inspección Ventilador Condensador", "Corriente Motor Ventilador Condensador (A)"] },
                { id: "ac_evaporador", nombre: "Unidad Evaporadora (Interior)", tipo: "checkbox", defecto: true,
                  mediciones: ["Temperatura Aire Retorno (°C)", "Temperatura Aire Impulsión (°C)",
                               "Diferencia de Temperatura ΔT (°C)", "Presión Diferencial Filtros (Pa)",
                               "Estado y Limpieza Filtros", "Inspección Aletas Evaporador",
                               "Limpieza Bandeja y Drenaje de Condensado", "Inspección Motor Ventilador Interior"] },
                { id: "ac_electrico", nombre: "Sistema Eléctrico y Control", tipo: "checkbox", defecto: true,
                  mediciones: ["Inspección Tablero Eléctrico Unidad", "Termografía Conexiones Eléctricas (°C)",
                               "Verificación Capacitores de Arranque", "Verificación Termostato/Control",
                               "Revisión Actuadores y Válvulas de Control"] }
            ]
        },

        // ── CHILLER / ENFRIADOR DE AGUA ───────────────────────────
        "chiller_enfriador_agua": {
            nombreDisplay: "Chiller / Enfriador de Agua",
            configuracionGlobal: [
                { id: "ch_tipo", nombre: "Tipo de Compresor", tipo: "select",
                  opciones: {"": "--Seleccione--", "centrifugo": "Centrífugo", "tornillo": "Tornillo (Screw)", "scroll": "Scroll", "reciprocante": "Reciprocante"}, defecto: "tornillo" }
            ],
            componentes: [
                { id: "ch_compresor", nombre: "Compresor", tipo: "checkbox", defecto: true,
                  mediciones: {
                    comun: ["Temperatura Descarga Refrigerante (°C)", "Temperatura Succión Refrigerante (°C)",
                            "Presión de Descarga (PSI/bar)", "Presión de Succión (PSI/bar)",
                            "Temperatura Aceite Lubricante (°C)", "Presión Aceite Lubricante (PSI/bar)",
                            "Nivel Aceite Lubricante", "Temperatura Carcasa Compresor (°C)"],
                    trifasico: ["Voltaje L1-L2 (V)", "Voltaje L2-L3 (V)", "Voltaje L3-L1 (V)",
                                "Corriente L1 (A)", "Corriente L2 (A)", "Corriente L3 (A)",
                                "Factor de Potencia", "Potencia Activa (kW)"],
                    monofasico: ["Voltaje de Operación (V)", "Corriente de Operación (A)"]
                }},
                { id: "ch_condensador", nombre: "Condensador (Agua/Aire)", tipo: "checkbox", defecto: true,
                  mediciones: ["Temperatura Agua Entrada Condensador (°C)", "Temperatura Agua Salida Condensador (°C)",
                               "ΔT Condensador (°C)", "Caudal Agua Condensación (GPM/L/min)",
                               "Temperatura de Condensación Refrigerante (°C)", "Inspección Visual Incrustaciones/Fouling"] },
                { id: "ch_evaporador", nombre: "Evaporador (Barrel/Shell&Tube)", tipo: "checkbox", defecto: true,
                  mediciones: ["Temperatura Agua Entrada Evaporador (°C)", "Temperatura Agua Salida Evaporador (°C)",
                               "ΔT Evaporador (°C)", "Caudal Agua Helada (GPM/L/min)",
                               "Temperatura de Evaporación Refrigerante (°C)", "Presión Diferencial Evaporador"] },
                { id: "ch_refrigerante_ch", nombre: "Sistema de Refrigerante", tipo: "checkbox", defecto: true,
                  mediciones: ["Carga de Refrigerante (Verificación por Parámetros)", "Inspección Fugas (Detector Electrónico)",
                               "Superheat (°C)", "Subcooling (°C)", "Humedad en el Sistema (ppm)"] },
                { id: "ch_torres", nombre: "Torres de Enfriamiento (si aplica)", tipo: "checkbox",
                  mediciones: ["Temperatura Agua Torre Entrada (°C)", "Temperatura Agua Torre Salida (°C)",
                               "Inspección Visual Relleno (Fouling)", "Limpieza Torre y Cuenca",
                               "Corriente Motor Ventilador Torre (A)", "Inspección Distribuidores de Agua"] },
                { id: "ch_electrico_ch", nombre: "Panel Eléctrico y Control Chiller", tipo: "checkbox", defecto: true,
                  mediciones: ["Termografía Panel de Control (°C)", "Inspección Variadores (si aplica)",
                               "Verificación Parámetros Controlador (Setpoints)", "Alarmas Activas en Controlador",
                               "Revisión UPS/Respaldo si aplica", "Historial de Fallas Recientes"] }
            ]
        }
    }
    if (tipoMaquinaSelect) {
        const placeholderOption = tipoMaquinaSelect.options[0];
        tipoMaquinaSelect.innerHTML = '';
        tipoMaquinaSelect.appendChild(placeholderOption);
        for (const tipoId in maquinasConfig) {
            const opcion = document.createElement('option');
            opcion.value = tipoId;
            opcion.textContent = maquinasConfig[tipoId].nombreDisplay;
            tipoMaquinaSelect.appendChild(opcion);
        }
        tipoMaquinaSelect.addEventListener('change', function () {
            poblarOpcionesComponentes(this.value);
            if (tablasMedicionContainer) tablasMedicionContainer.innerHTML = '';
            if (mensajeInicialTablas) mensajeInicialTablas.style.display = 'block';
        });
    }

    function poblarOpcionesComponentes(tipoMaquinaId) {
        if (!componentesOptionsDiv || !controlesGeneracionTablaDiv || !configGlobalMaquinaDiv) return;
        
        componentesOptionsDiv.innerHTML = ''; 
        configGlobalMaquinaDiv.innerHTML = ''; // Limpiar configuraciones globales también
        configGlobalMaquinaDiv.style.display = 'none';


        if (!tipoMaquinaId || !maquinasConfig[tipoMaquinaId]) {
            componentesOptionsDiv.style.display = 'none';
            controlesGeneracionTablaDiv.style.display = 'none';
            return;
        }

        const maquina = maquinasConfig[tipoMaquinaId];

        // Poblar configuraciones globales si existen
        if (maquina.configuracionGlobal && maquina.configuracionGlobal.length > 0) {
            const tituloGlobal = document.createElement('h4');
            tituloGlobal.textContent = `A. Configuración General para: ${maquina.nombreDisplay}`;
            configGlobalMaquinaDiv.appendChild(tituloGlobal);

            maquina.configuracionGlobal.forEach(config => {
                const itemDiv = document.createElement('div');
                itemDiv.classList.add('rg-component-item'); // Reutilizar estilo si es adecuado
                const label = document.createElement('label');
                label.setAttribute('for', `glob-${config.id}`);
                label.textContent = `${config.nombre}: `;
                
                if (config.tipo === 'select') {
                    let selectHtml = `<select id="glob-${config.id}" name="glob-${config.id}" style="margin-left: 5px;">`;
                    for (const val in config.opciones) {
                        selectHtml += `<option value="${val}" ${val === config.defecto ? 'selected' : ''}>${config.opciones[val]}</option>`;
                    }
                    selectHtml += `</select>`;
                    const tempSpan = document.createElement('span'); 
                    tempSpan.innerHTML = selectHtml;
                    label.appendChild(tempSpan);
                }
                itemDiv.appendChild(label);
                configGlobalMaquinaDiv.appendChild(itemDiv);
            });
            configGlobalMaquinaDiv.style.display = 'block';
        }


        const tituloComponentes = document.createElement('h4');
        tituloComponentes.textContent = 'B. Seleccione/Configure Componentes Específicos:';
        componentesOptionsDiv.appendChild(tituloComponentes);

        const gridDiv = document.createElement('div');
        gridDiv.classList.add('rg-components-grid');
        componentesOptionsDiv.appendChild(gridDiv);

        maquina.componentes.forEach(comp => {
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('rg-component-item');
            itemDiv.dataset.componentId = comp.id; 
            const label = document.createElement('label');
            let inputHtml = ''; // Definir inputHtml aquí para evitar error de referencia
            if (comp.tipo === 'checkbox') {
                const isChecked = comp.defecto ? 'checked' : '';
                inputHtml = `<input type="checkbox" id="comp-${comp.id}" name="${comp.id}" ${isChecked}> ${comp.nombre}`;
                label.innerHTML = inputHtml;
                if (comp.defecto) itemDiv.classList.add('is-checked');
                // Toggle is-checked on change
                setTimeout(() => {
                    const cb = itemDiv.querySelector('input[type="checkbox"]');
                    if (cb) cb.addEventListener('change', () => itemDiv.classList.toggle('is-checked', cb.checked));
                }, 0); 
            } else if (comp.tipo === 'number') {
                label.setAttribute('for', `comp-${comp.id}`);
                label.textContent = `${comp.nombre}: `;
                inputHtml = `<input type="number" id="comp-${comp.id}" name="${comp.id}" min="${comp.min || 0}" value="${comp.defecto || 0}" style="width: 70px; margin-left: 5px;">`;
                const spanInput = document.createElement('span');
                spanInput.innerHTML = inputHtml;
                label.appendChild(spanInput);
            } else if (comp.tipo === 'select') {
                label.setAttribute('for', `comp-${comp.id}`);
                label.textContent = `${comp.nombre}: `;
                let selectHtml = `<select id="comp-${comp.id}" name="${comp.id}" style="margin-left: 5px;">`;
                for (const val in comp.opciones) {
                    selectHtml += `<option value="${val}" ${val === comp.defecto ? 'selected' : ''}>${comp.opciones[val]}</option>`;
                }
                selectHtml += `</select>`;
                const tempSpan = document.createElement('span'); 
                tempSpan.innerHTML = selectHtml;
                label.appendChild(tempSpan);
            }
            itemDiv.appendChild(label);
            gridDiv.appendChild(itemDiv);

            if (comp.dependeDe) {
                const controlPadre = componentesOptionsDiv.querySelector(`#comp-${comp.dependeDe.id_control}`) || configGlobalMaquinaDiv.querySelector(`#glob-${comp.dependeDe.id_control}`);
                if (controlPadre) {
                    const actualizarVisibilidad = () => { itemDiv.style.display = (controlPadre.value === comp.dependeDe.valor_requerido) ? 'block' : 'none'; };
                    actualizarVisibilidad(); 
                    controlPadre.addEventListener('change', actualizarVisibilidad);
                } else { itemDiv.style.display = 'none'; }
            }
        });
        componentesOptionsDiv.style.display = 'block';
        controlesGeneracionTablaDiv.style.display = 'block';
    }

    if (generarPuntosBtn) {
        generarPuntosBtn.addEventListener('click', function() {
            if (!tablasMedicionContainer || !componentesOptionsDiv || !tipoMaquinaSelect.value) return;
            
            tablasMedicionContainer.innerHTML = ''; 
            if(mensajeInicialTablas) mensajeInicialTablas.style.display = 'none';

            const tipoMaquinaId = tipoMaquinaSelect.value;
            const maquinaConf = maquinasConfig[tipoMaquinaId];
            if (!maquinaConf) return;

            // Obtener el tipo de alimentación seleccionado (busca cualquier config de alimentación global)
            let tipoAlimentacionSeleccionado = 'trifasico';
            if (maquinaConf.configuracionGlobal) {
                const aliConf = maquinaConf.configuracionGlobal.find(cg =>
                    cg.id.includes('alimentacion') || cg.id.includes('tipo_ali') || cg.id.includes('tipo_alimentacion')
                );
                if (aliConf) {
                    const aliElem = document.getElementById(`glob-${aliConf.id}`);
                    if (aliElem && aliElem.value) tipoAlimentacionSeleccionado = aliElem.value;
                }
            }


            maquinaConf.componentes.forEach(compConfig => {
                const inputComponente = componentesOptionsDiv.querySelector(`#comp-${compConfig.id}`);
                let generarParaEsteComponente = false;
                let cantidadUnidades = 1;

                if (compConfig.tipo === 'checkbox' && inputComponente && inputComponente.checked) { generarParaEsteComponente = true; } 
                else if (compConfig.tipo === 'select' && inputComponente) { if (inputComponente.value) generarParaEsteComponente = true; } // Generar si hay algo seleccionado
                else if (compConfig.tipo === 'number' && inputComponente) { cantidadUnidades = parseInt(inputComponente.value, 10) || 0; if (cantidadUnidades > 0) { generarParaEsteComponente = true; } }
                
                if (compConfig.dependeDe) {
                    const controlPadre = componentesOptionsDiv.querySelector(`#comp-${compConfig.dependeDe.id_control}`) || configGlobalMaquinaDiv.querySelector(`#glob-${compConfig.dependeDe.id_control}`);
                    if (!controlPadre || controlPadre.value !== compConfig.dependeDe.valor_requerido) { generarParaEsteComponente = false; }
                }

                if (generarParaEsteComponente) {
                    for (let i = 0; i < cantidadUnidades; i++) {
                        const tituloComponente = document.createElement('h4');
                        let nombreUnidad = compConfig.nombre;
                        if (compConfig.tipo === 'number' && cantidadUnidades > 0) { 
                            nombreUnidad = `${compConfig.unidad_nombre || compConfig.nombre} #${i + 1}`;
                        }
                        tituloComponente.textContent = nombreUnidad;
                        tablasMedicionContainer.appendChild(tituloComponente);

                        const tabla = document.createElement('table');
                        tabla.classList.add('rg-medicion-table');
                        const thead = tabla.createTHead();
                        const tbody = tabla.createTBody();
                        
                        const headerRow = thead.insertRow();
                        ["Punto de Medición", "Valor Tomado", "Unidad", "Observaciones"].forEach(texto => {
                            const th = document.createElement('th');
                            th.textContent = texto;
                            headerRow.appendChild(th);
                        });

                        let medicionesParaComponente = [];
                        if (typeof compConfig.mediciones === 'object' && compConfig.mediciones !== null && !Array.isArray(compConfig.mediciones)) {
                            // Es un objeto con mediciones comunes, monofasicas, trifasicas
                            if (compConfig.mediciones.comun) {
                                medicionesParaComponente = medicionesParaComponente.concat(compConfig.mediciones.comun);
                            }
                            if (tipoAlimentacionSeleccionado === 'monofasico' && compConfig.mediciones.monofasico) {
                                medicionesParaComponente = medicionesParaComponente.concat(compConfig.mediciones.monofasico);
                            } else if (tipoAlimentacionSeleccionado === 'trifasico' && compConfig.mediciones.trifasico) {
                                medicionesParaComponente = medicionesParaComponente.concat(compConfig.mediciones.trifasico);
                            }
                        } else if (Array.isArray(compConfig.mediciones)) { // Es un array simple de mediciones
                            medicionesParaComponente = compConfig.mediciones;
                        }
                         // Aplicar a mediciones_por_unidad si existen
                        if (compConfig.mediciones_por_unidad && compConfig.tipo === 'number') {
                            medicionesParaComponente = compConfig.mediciones_por_unidad;
                        }


                        if (medicionesParaComponente.length > 0) {
                            medicionesParaComponente.forEach((med, rowIdx) => {
                                const medRow = tbody.insertRow();
                                medRow.insertCell().textContent = med.replace("#", `#${i + 1}`); 
                                medRow.insertCell().innerHTML = `<input type="text" placeholder="Valor">`;
                                medRow.insertCell().innerHTML = `<input type="text" placeholder="Ej: V, A, MΩ, °C">`; // Unidades más eléctricas
                                medRow.insertCell().innerHTML = `<textarea placeholder="Notas..." rows="1"></textarea>`;
                            });
                        } else {
                            const medRow = tbody.insertRow();
                                medRow.className = rowIdx % 2 !== 0 ? "rg-row-alt" : "";
                            const cell = medRow.insertCell();
                            cell.colSpan = 4; 
                            cell.textContent = "No hay puntos de medición definidos para este componente/configuración.";
                            cell.style.textAlign = "center";
                            cell.style.fontStyle = "italic";
                        }
                        tablasMedicionContainer.appendChild(tabla);
                    }
                }
            });
            inicializarTextareasDinamicasYEstados();
        });
    }

    function inicializarTextareasDinamicasYEstados() {
        // ... (código sin cambios)
        tablasMedicionContainer.querySelectorAll('textarea').forEach(textarea => {
            textarea.style.height = 'auto';
            textarea.style.height = (textarea.scrollHeight) + 'px';
            textarea.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px'; });
        });
        tablasMedicionContainer.querySelectorAll('.estado-input').forEach(input => {
            input.dataset.lastValidValue = input.value.toUpperCase(); 
            aplicarEstiloCeldaEstadoRG(input); 
            input.addEventListener('input', function() {
                let currentValue = this.value.toUpperCase();
                if (currentValue === '' || VALID_ESTADO_CHARS_RG.includes(currentValue)) { this.dataset.lastValidValue = currentValue; } 
                else { this.value = this.dataset.lastValidValue || ''; }
                aplicarEstiloCeldaEstadoRG(this);
            });
        });
    }

    function aplicarEstiloCeldaEstadoRG(inputElement) { 
        // ... (código sin cambios)
        if (!inputElement) return;
        const cell = inputElement.closest('td');
        if (!cell) return;
        const valor = inputElement.value.trim().toUpperCase();
        cell.classList.remove('estado-b', 'estado-a', 'estado-c', 'estado-n'); 
        switch (valor) {
            case 'B': cell.classList.add('estado-b'); break;
            case 'A': cell.classList.add('estado-a'); break;
            case 'C': cell.classList.add('estado-c'); break;
            case 'N': cell.classList.add('estado-n'); break;
        }
    }


    // ── SECCIÓN IMÁGENES DE REFERENCIA ───────────────────────────
    let rgImages = []; // [{src, caption}]

    const rgToggleBtn  = document.getElementById('rg-toggle-imgs-btn');
    const rgImgsBody   = document.getElementById('rg-imagenes-body');
    const rgImgsIcon   = document.getElementById('rg-imgs-icon');
    const rgAddBtn     = document.getElementById('rg-add-img-btn');
    const rgClearBtn   = document.getElementById('rg-clear-imgs-btn');
    const rgImgsGrid   = document.getElementById('rg-imgs-grid');
    const rgImgsEmpty  = document.getElementById('rg-imgs-empty');

    // Toggle show/hide
    rgToggleBtn?.addEventListener('click', () => {
        const open = rgImgsBody.style.display !== 'none';
        rgImgsBody.style.display = open ? 'none' : 'block';
        rgImgsIcon.className = open ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
        rgToggleBtn.classList.toggle('open', !open);
    });

    function renderImgsGrid() {
        if (!rgImgsGrid) return;
        rgImgsGrid.innerHTML = '';
        rgImgsEmpty.style.display = rgImages.length === 0 ? 'block' : 'none';
        rgImages.forEach((img, idx) => {
            const card = document.createElement('div');
            card.className = 'rg-img-card';
            const hasSrc = img.src && img.src.length > 10;
            card.innerHTML = `
                <div class="rg-img-zone" data-idx="${idx}">
                    ${hasSrc
                        ? `<img src="${img.src}" alt="Imagen ${idx+1}">
                           <div class="rg-img-overlay no-print">
                               <i class="fa-solid fa-arrows-rotate"></i> Cambiar imagen
                           </div>`
                        : `<div class="rg-img-placeholder">
                               <i class="fa-regular fa-image"></i>
                               <span>Clic — Pegar del portapapeles</span>
                               <small>Doble clic — Buscar en la PC</small>
                           </div>`}
                </div>
                <div class="rg-img-footer">
                    <input type="text" class="rg-img-caption"
                        placeholder="Ej: Imagen frontal del equipo..."
                        value="${img.caption||''}" data-idx="${idx}">
                    <button type="button" class="rg-img-del-btn no-print"
                        data-idx="${idx}" title="Eliminar imagen">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>`;
            rgImgsGrid.appendChild(card);
        });

        // Helper: compress and save image
        function compressAndSave(idx, file) {
            const reader = new FileReader();
            reader.onload = e => {
                const img2 = new Image();
                img2.onload = () => {
                    const canvas = document.createElement('canvas');
                    const max = 1200;
                    let w = img2.width, h = img2.height;
                    if (w > max) { h = Math.round(h * max / w); w = max; }
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img2, 0, 0, w, h);
                    rgImages[idx].src = canvas.toDataURL('image/jpeg', 0.88);
                    renderImgsGrid();
                };
                img2.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }

        function browseFile(idx) {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*';
            inp.onchange = () => { if (inp.files[0]) compressAndSave(idx, inp.files[0]); };
            inp.click();
        }

        async function pasteFromClipboard(idx) {
            try {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    const imgType = item.types.find(t => t.startsWith('image/'));
                    if (imgType) {
                        const blob = await item.getType(imgType);
                        const file = new File([blob], 'clipboard.png', { type: imgType });
                        compressAndSave(idx, file);
                        return;
                    }
                }
                // No image in clipboard — fallback to browse
                toast('No hay imagen en el portapapeles. Usa doble clic para buscar en la PC.', 'info');
            } catch {
                // Clipboard API not available or permission denied — fallback
                browseFile(idx);
            }
        }

        // Listeners: single click = paste, double click = browse
        let clickTimer = null;
        rgImgsGrid.querySelectorAll('.rg-img-zone').forEach(zone => {
            zone.addEventListener('click', (e) => {
                const idx = +zone.dataset.idx;
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; } // handled by dblclick
                clickTimer = setTimeout(() => {
                    clickTimer = null;
                    pasteFromClipboard(idx);
                }, 220);
            });
            zone.addEventListener('dblclick', (e) => {
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                const idx = +zone.dataset.idx;
                browseFile(idx);
            });
        });

        rgImgsGrid.querySelectorAll('.rg-img-caption').forEach(inp => {
            inp.addEventListener('input', () => {
                rgImages[+inp.dataset.idx].caption = inp.value;
            });
        });

        rgImgsGrid.querySelectorAll('.rg-img-del-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                rgImages.splice(+btn.dataset.idx, 1);
                renderImgsGrid();
            });
        });
    }

    rgAddBtn?.addEventListener('click', () => {
        rgImages.push({ src: '', caption: '' });
        // Auto-open if hidden
        if (rgImgsBody.style.display === 'none') {
            rgImgsBody.style.display = 'block';
            rgImgsIcon.className = 'fa-solid fa-chevron-up';
            rgToggleBtn?.classList.add('open');
        }
        renderImgsGrid();
    });

    rgClearBtn?.addEventListener('click', () => {
        if (!rgImages.length) return;
        if (!confirm('¿Eliminar todas las imágenes?')) return;
        rgImages = [];
        renderImgsGrid();
    });

    renderImgsGrid();

    // ── Recolectar datos ──────────────────────────────────────────
    function collectData() {
        const tablas = [];
        tablasMedicionContainer.querySelectorAll('table').forEach(t => {
            const titulo = t.previousElementSibling?.textContent || '';
            const rows = [];
            t.querySelectorAll('tbody tr').forEach(tr => {
                rows.push([...tr.querySelectorAll('input,textarea,select')].map(i => i.value));
            });
            tablas.push({ titulo, rows });
        });
        const infoRows = [];
        document.querySelectorAll('#info-table tbody tr').forEach(tr => {
            infoRows.push([...tr.querySelectorAll('input')].map(i => ({ id: i.id||'', v: i.value })));
        });
        const firmas = [...document.querySelectorAll('.cargo-analista')].map(i => i.value);
        return {
            codigo:    document.getElementById('current_report_id')?.value || '',
            tipoMaquina: tipoMaquinaSelect?.value || '',
            infoRows, firmas, tablas,
            imagenes: rgImages
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
        datos.infoRows?.forEach(row => row.forEach(f => {
            if (f.id) { const el = document.getElementById(f.id); if (el) el.value = f.v; }
        }));
        datos.firmas?.forEach((v, i) => {
            const els = document.querySelectorAll('.cargo-analista');
            if (els[i]) els[i].value = v;
        });
        if (datos.tipoMaquina && tipoMaquinaSelect) {
            tipoMaquinaSelect.value = datos.tipoMaquina;
            poblarOpcionesComponentes(datos.tipoMaquina);
        }
        if (datos.tablas?.length) {
            if (generarPuntosBtn) generarPuntosBtn.click();
            setTimeout(() => {
                const allTables = tablasMedicionContainer.querySelectorAll('table');
                datos.tablas.forEach((t, ti) => {
                    const tbl = allTables[ti];
                    if (!tbl) return;
                    const allInputs = tbl.querySelectorAll('tbody input,tbody textarea,tbody select');
                    t.rows.forEach((row, ri) => {
                        const rowInputs = tbl.querySelectorAll(`tbody tr:nth-child(${ri+1}) input,tbody tr:nth-child(${ri+1}) textarea,tbody tr:nth-child(${ri+1}) select`);
                        row.forEach((val, vi) => { if (rowInputs[vi]) rowInputs[vi].value = val; });
                    });
                });
                tablasMedicionContainer.querySelectorAll('.estado-input').forEach(i => aplicarEstiloCeldaEstadoRG(i));
            }, 100);
        }
        // Restore images
        if (datos.imagenes?.length) {
            rgImages = datos.imagenes;
            if (rgImgsBody) { rgImgsBody.style.display = 'block'; rgImgsIcon.className = 'fa-solid fa-chevron-up'; rgToggleBtn?.classList.add('open'); }
            renderImgsGrid();
        }
        if (window.PdM?.renderFirmaSelectors) PdM.renderFirmaSelectors();
    }

    // ── Guardar en BD ─────────────────────────────────────────────
    async function guardarReporte() {
        const datos  = collectData();
        const codigo = datos.codigo;
        let dbId     = document.getElementById('db_report_id')?.value;
        const estadoEl = document.getElementById('reporte-estado');
        if (estadoEl) estadoEl.textContent = 'Guardando...';
        try {
            let res;
            if (dbId) {
                res = await PdM.apiFetch(`/api/reportes/${dbId}`, { method:'PUT', body:JSON.stringify({ titulo:codigo, datos }) });
                // Fallback a POST si el reporte fue eliminado externamente
                if (res?.status === 404) {
                    dbId = '';
                    const h = document.getElementById('db_report_id');
                    if (h) h.value = '';
                }
            }
            if (!dbId) {
                res = await PdM.apiFetch('/api/reportes', { method:'POST', body:JSON.stringify({ tecnica:'generales', titulo:codigo, datos, codigo_reporte:codigo }) });
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
        } catch { toast('❌ Error de conexión.','error'); }
    }

    // ── Cargar lista desde BD ─────────────────────────────────────
    async function mostrarListaReportes() {
        try {
            const res = await PdM.apiFetch('/api/reportes?tecnica=generales');
            if (!res?.ok) return toast('Error al obtener lista.','error');
            const lista = await res.json();
            if (!lista.length) return toast('No hay reportes generales guardados.','info');
            let modal = document.getElementById('modal-reportes-lista');
            if (modal) modal.remove();
            modal = document.createElement('div');
            modal.id = 'modal-reportes-lista'; modal.className = 'modal-overlay'; modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="modal-content config-modal-box" style="max-width:600px;width:95%;">
                    <div class="modal-header">
                        <h3><i class="fa-solid fa-folder-open"></i> Reportes Guardados — Generales</h3>
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
                    const h = document.getElementById('db_report_id'); if(h) h.value = rep.id;
                    restoreData(rep.datos); modal.remove();
                    toast(`✅ Reporte ${rep.datos?.codigo||''} cargado.`,'success');
                };
            });
            document.querySelectorAll('.btn-borrar').forEach(btn => {
                btn.onclick = async () => {
                    if (!confirm('¿Eliminar este reporte?')) return;
                    const r2 = await PdM.apiFetch(`/api/reportes/${btn.dataset.id}`,{method:'DELETE'});
                    if (r2?.ok) { btn.closest('div[style]').remove(); toast('Eliminado.','info'); }
                };
            });
        } catch { toast('Error de conexión.','error'); }
    }

    // ── Buscar por código ─────────────────────────────────────────
    async function buscarPorCodigo() {
        const codigo = document.getElementById('buscar-codigo-input')?.value?.trim();
        if (!codigo) { toast('Ingresa un código. Ej: Gen-19-mar-26-0001','info'); return; }
        try {
            const res = await PdM.apiFetch(`/api/reportes/by-code/${encodeURIComponent(codigo)}`);
            if (!res?.ok) { toast(`No se encontró "${codigo}".`,'error'); return; }
            const rep = await res.json();
            const h = document.getElementById('db_report_id'); if(h) h.value = rep.id;
            restoreData(rep.datos);
            document.getElementById('buscar-codigo-input').value = '';
            toast(`✅ Reporte ${codigo} cargado.`,'success');
        } catch { toast('Error de conexión.','error'); }
    }

    // ── Nuevo reporte ─────────────────────────────────────────────
    document.getElementById('btn-nuevo-reporte')?.addEventListener('click', () => {
        if (!confirm('¿Iniciar un reporte nuevo? Los cambios no guardados se perderán.')) return;
        document.getElementById('db_report_id').value = '';
        document.getElementById('current_report_id').value = '';
        if (tipoMaquinaSelect) tipoMaquinaSelect.value = '';
        if (componentesOptionsDiv) componentesOptionsDiv.style.display = 'none';
        if (configGlobalMaquinaDiv) { configGlobalMaquinaDiv.innerHTML = ''; configGlobalMaquinaDiv.style.display = 'none'; }
        if (controlesGeneracionTablaDiv) controlesGeneracionTablaDiv.style.display = 'none';
        if (tablasMedicionContainer) tablasMedicionContainer.innerHTML = '';
        if (mensajeInicialTablas) mensajeInicialTablas.style.display = 'block';
        ['tipo-reporte-general','cliente-reporte-general','elaborado-por-general'].forEach(id => {
            const el = document.getElementById(id); if(el) el.value = '';
        });
        const hoy2 = new Date().toISOString().split('T')[0];
        const fEl = document.getElementById('fecha-reporte-general'); if(fEl) fEl.value = hoy2;
        rgImages = [];
        renderImgsGrid();
        if (rgImgsBody) { rgImgsBody.style.display = 'none'; rgImgsIcon.className = 'fa-solid fa-chevron-down'; rgToggleBtn?.classList.remove('open'); }
        generarCodigo();
        toast('Nuevo reporte iniciado.','info');
    });

    // ── Listeners ─────────────────────────────────────────────────
    document.getElementById('btn-guardar-reporte')?.addEventListener('click', guardarReporte);
    document.getElementById('btn-cargar-reporte')?.addEventListener('click', mostrarListaReportes);
    document.getElementById('btn-buscar-codigo')?.addEventListener('click', buscarPorCodigo);
    document.getElementById('buscar-codigo-input')?.addEventListener('keydown', e => { if(e.key==='Enter') buscarPorCodigo(); });

    // Título PDF
    window.addEventListener('beforeprint', () => {
        const codigo = document.getElementById('visual-report-id')?.textContent?.trim();
        if (codigo && !codigo.includes('Generando')) document.title = 'Reporte General — ' + codigo;
    });

    // ── Init ──────────────────────────────────────────────────────
    generarCodigo();
    if (window.PdM?.renderFirmaSelectors) PdM.renderFirmaSelectors();
});
