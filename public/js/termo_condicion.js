// termo_condicion.js — Módulo de Tendencias de Termografía
// Suite PdM | Edwards

(function () {
    'use strict';

    const toast    = (m, t = 'info') => window.PdM?.showToast(m, t) || console.log(m);
    const apiFetch = (...a) => window.PdM?.apiFetch(...a);

    // ── Estado global ──────────────────────────────────────────
    let allEquipos    = [];
    let currentEquipo = null;
    let componentes   = [];   // componentes del equipo actual
    let lecturas      = [];   // lecturas del equipo actual
    let editingCompId = null;
    let editingLecId  = null;

    const ORDEN_SEV = { C: 3, A: 2, B: 1 };

    // ── Lista completa de tipos de componente del estándar ─────
    const TIPOS_COMPONENTE = [
        // ── Conductores ────────────────────────────────────────
        { grupo: 'Conductores', id: 'cond_bare_free',     label: 'Conductor desnudo — aire libre',          amb: 55, rise: 25, max: 80  },
        { grupo: 'Conductores', id: 'cond_bare_enc',      label: 'Conductor desnudo — en enclosure',        amb: 40, rise: 30, max: 70  },
        { grupo: 'Conductores', id: 'cond_bare_surf',     label: 'Conductor desnudo — sup. enclosure',      amb: 40, rise: 20, max: 60  },
        { grupo: 'Conductores', id: 'cond_ins_free',      label: 'Conductor aislado — aire libre',          amb: 30, rise: 30, max: 60  },
        { grupo: 'Conductores', id: 'cond_ins_enc',       label: 'Conductor aislado — en enclosure',        amb: 30, rise: 30, max: 60  },
        { grupo: 'Conductores', id: 'cond_ins_surf',      label: 'Conductor aislado — sup. enclosure',      amb: 30, rise: 20, max: 50  },
        { grupo: 'Conductores', id: 'cond_ins_sun',       label: 'Conductor aislado — al sol',              amb: 50, rise: 10, max: 60  },
        // ── Aislamiento de conductores ─────────────────────────
        { grupo: 'Aislamiento', id: 'ins_t_tw',           label: 'Aislamiento T / TW / R / RW / RU',       amb: 30, rise: 30, max: 60  },
        { grupo: 'Aislamiento', id: 'ins_thw',            label: 'Aislamiento THW / Polietileno / XHHW',    amb: 30, rise: 45, max: 75  },
        { grupo: 'Aislamiento', id: 'ins_varnished',      label: 'Aislamiento Barniz Cambric',              amb: 30, rise: 47, max: 77  },
        { grupo: 'Aislamiento', id: 'ins_paper_lead',     label: 'Aislamiento Papel-Plomo',                 amb: 30, rise: 50, max: 80  },
        { grupo: 'Aislamiento', id: 'ins_polyester',      label: 'Aislamiento Poliéster Barnizado',         amb: 30, rise: 55, max: 85  },
        { grupo: 'Aislamiento', id: 'ins_xlpe',           label: 'Aislamiento THH / XLPE / EPR',            amb: 30, rise: 60, max: 90  },
        { grupo: 'Aislamiento', id: 'ins_silicone',       label: 'Aislamiento Caucho de Silicona',          amb: 30, rise: 95, max: 125 },
        // ── Conectores y Terminaciones ─────────────────────────
        { grupo: 'Conectores', id: 'conn_silver',         label: 'Conector — Plata o aleación de plata',   amb: 40, rise: 40, max: 80  },
        { grupo: 'Conectores', id: 'conn_copper',         label: 'Conector — Cobre / Aleación Cu / Al',    amb: 40, rise: 50, max: 90  },
        { grupo: 'Conectores', id: 'conn_alalloy',        label: 'Conector — Aleación de aluminio',        amb: 52, rise: 53, max: 105 },
        // ── Dispositivos de sobrecorriente ─────────────────────
        { grupo: 'Protecciones', id: 'cb_molded',         label: 'Breaker — Caja moldeada',                amb: 40, rise: 20, max: 60  },
        { grupo: 'Protecciones', id: 'cb_other',          label: 'Breaker — Otros tipos',                  amb: 40, rise: 30, max: 70  },
        { grupo: 'Protecciones', id: 'fuse',              label: 'Fusible',                                amb: 40, rise: 30, max: 70  },
        { grupo: 'Protecciones', id: 'disconnect',        label: 'Desconectador / Interruptor / Aislador', amb: 40, rise: 30, max: 70  },
        // ── Bushings ───────────────────────────────────────────
        { grupo: 'Bushings', id: 'bushing_xfmr',         label: 'Bushing — Transformador (extremo bajo)', amb: 40, rise: 55, max: 95  },
        { grupo: 'Bushings', id: 'bushing_cb',            label: 'Bushing — Breaker (extremo bajo)',       amb: 40, rise: 40, max: 80  },
        { grupo: 'Bushings', id: 'bushing_ext',           label: 'Bushing — Terminal externo',             amb: 40, rise: 30, max: 70  },
        // ── Bobinas y Relés ────────────────────────────────────
        { grupo: 'Bobinas/Relés', id: 'coil_90',         label: 'Bobina / Relé — Clase 90',               amb: 40, rise: 50, max: 90  },
        { grupo: 'Bobinas/Relés', id: 'coil_105',        label: 'Bobina / Relé — Clase 105',              amb: 40, rise: 65, max: 105 },
        { grupo: 'Bobinas/Relés', id: 'coil_130',        label: 'Bobina / Relé — Clase 130',              amb: 40, rise: 90, max: 130 },
        { grupo: 'Bobinas/Relés', id: 'coil_155',        label: 'Bobina / Relé — Clase 155',              amb: 40, rise: 115, max: 155 },
        { grupo: 'Bobinas/Relés', id: 'coil_180',        label: 'Bobina / Relé — Clase 180',              amb: 40, rise: 140, max: 180 },
        { grupo: 'Bobinas/Relés', id: 'coil_220',        label: 'Bobina / Relé — Clase 220',              amb: 40, rise: 180, max: 220 },
        // ── Motores AC ────────────────────────────────────────
        { grupo: 'Motores AC', id: 'ac_1sf_a',           label: 'Motor AC — 1.00 SF Clase A (bobinado)',  amb: 40, rise: 60, max: 100 },
        { grupo: 'Motores AC', id: 'ac_1sf_b',           label: 'Motor AC — 1.00 SF Clase B (bobinado)',  amb: 40, rise: 80, max: 120 },
        { grupo: 'Motores AC', id: 'ac_1sf_f',           label: 'Motor AC — 1.00 SF Clase F (bobinado)',  amb: 40, rise: 105, max: 145 },
        { grupo: 'Motores AC', id: 'ac_1sf_h',           label: 'Motor AC — 1.00 SF Clase H (bobinado)',  amb: 40, rise: 125, max: 165 },
        { grupo: 'Motores AC', id: 'ac_115sf_b',         label: 'Motor AC — 1.15 SF Clase B (bobinado)',  amb: 40, rise: 90, max: 130 },
        { grupo: 'Motores AC', id: 'ac_115sf_f',         label: 'Motor AC — 1.15 SF Clase F (bobinado)',  amb: 40, rise: 115, max: 155 },
        // ── Motores DC / Generadores ───────────────────────────
        { grupo: 'Motores DC', id: 'dc_1sf_a',           label: 'Motor DC — 1.00 SF Clase A (bobinado)',  amb: 40, rise: 70, max: 110 },
        { grupo: 'Motores DC', id: 'dc_1sf_b',           label: 'Motor DC — 1.00 SF Clase B (bobinado)',  amb: 40, rise: 100, max: 140 },
        { grupo: 'Motores DC', id: 'dc_1sf_f',           label: 'Motor DC — 1.00 SF Clase F (bobinado)',  amb: 40, rise: 130, max: 170 },
        { grupo: 'Motores DC', id: 'dc_1sf_h',           label: 'Motor DC — 1.00 SF Clase H (bobinado)',  amb: 40, rise: 155, max: 195 },
        { grupo: 'Motores DC', id: 'dc_125sf_b',         label: 'Motor DC — 1.25 SF Clase B (2hr)',       amb: 40, rise: 80, max: 120 },
        { grupo: 'Motores DC', id: 'dc_125sf_f',         label: 'Motor DC — 1.25 SF Clase F (2hr)',       amb: 40, rise: 110, max: 150 },
        // ── Generadores síncronos ──────────────────────────────
        { grupo: 'Generadores', id: 'gen_b',              label: 'Generador Síncrono — Carcasa Clase B',   amb: 40, rise: 70, max: 110 },
        { grupo: 'Generadores', id: 'gen_f',              label: 'Generador Síncrono — Carcasa Clase F',   amb: 40, rise: 90, max: 130 },
        { grupo: 'Generadores', id: 'gen_h',              label: 'Generador Síncrono — Carcasa Clase H',   amb: 40, rise: 110, max: 150 },
        // ── Transformadores ────────────────────────────────────
        { grupo: 'Transformadores', id: 'xfmr_dry_105',  label: 'Transformador seco — Clase 105',         amb: 30, rise: 55, max: 85  },
        { grupo: 'Transformadores', id: 'xfmr_dry_150',  label: 'Transformador seco — Clase 150',         amb: 30, rise: 80, max: 110 },
        { grupo: 'Transformadores', id: 'xfmr_dry_185',  label: 'Transformador seco — Clase 185',         amb: 30, rise: 115, max: 145 },
        { grupo: 'Transformadores', id: 'xfmr_dry_220',  label: 'Transformador seco — Clase 220',         amb: 30, rise: 150, max: 180 },
        { grupo: 'Transformadores', id: 'xfmr_oil_55',   label: 'Transformador en aceite — 55°C carcasa', amb: 30, rise: 55, max: 85  },
        { grupo: 'Transformadores', id: 'xfmr_oil_65',   label: 'Transformador en aceite — 65°C carcasa', amb: 30, rise: 65, max: 95  },
        // ── Rodamientos — elementos rodantes ──────────────────
        { grupo: 'Rodamientos', id: 'brg_race',          label: 'Rodamiento — Pistas (estabilidad metal.)',  amb: null, rise: null, max: 125 },
        { grupo: 'Rodamientos', id: 'brg_rolling',       label: 'Rodamiento — Elementos rodantes',           amb: null, rise: null, max: 125 },
        { grupo: 'Rodamientos', id: 'brg_cage_plastic',  label: 'Rodamiento — Retén plástico',               amb: null, rise: null, max: 120 },
        { grupo: 'Rodamientos', id: 'brg_cage_steel',    label: 'Rodamiento — Retén acero',                  amb: null, rise: null, max: 300 },
        { grupo: 'Rodamientos', id: 'brg_cage_brass',    label: 'Rodamiento — Retén latón',                  amb: null, rise: null, max: 300 },
        { grupo: 'Rodamientos', id: 'brg_shield_steel',  label: 'Rodamiento — Escudo acero',                 amb: null, rise: null, max: 300 },
        { grupo: 'Rodamientos', id: 'brg_seal_nitrile',  label: 'Sello lip — Caucho nitrilo',                amb: null, rise: null, max: 100 },
        { grupo: 'Rodamientos', id: 'brg_seal_acrylic',  label: 'Sello lip — Acrílico',                     amb: null, rise: null, max: 130 },
        { grupo: 'Rodamientos', id: 'brg_seal_silicone', label: 'Sello lip — Silicona',                      amb: null, rise: null, max: 180 },
        { grupo: 'Rodamientos', id: 'brg_seal_ptfe',     label: 'Sello lip — PTFE',                         amb: null, rise: null, max: 220 },
        { grupo: 'Rodamientos', id: 'brg_seal_felt',     label: 'Sello — Fieltro',                          amb: null, rise: null, max: 100 },
        { grupo: 'Rodamientos', id: 'brg_labyrinth',     label: 'Sello — Laberinto aluminio',               amb: null, rise: null, max: 300 },
        // ── Rodamientos lisos ──────────────────────────────────
        { grupo: 'Cojinetes', id: 'plain_tin',           label: 'Cojinete liso — Babbitt de estaño',       amb: null, rise: null, max: 149 },
        { grupo: 'Cojinetes', id: 'plain_lead',          label: 'Cojinete liso — Babbitt de plomo',        amb: null, rise: null, max: 149 },
        { grupo: 'Cojinetes', id: 'plain_cad',           label: 'Cojinete liso — Base cadmio',             amb: null, rise: null, max: 260 },
        { grupo: 'Cojinetes', id: 'plain_cu_lead',       label: 'Cojinete liso — Plomo-cobre',             amb: null, rise: null, max: 177 },
        { grupo: 'Cojinetes', id: 'plain_tin_bronze',    label: 'Cojinete liso — Bronce de estaño',        amb: null, rise: null, max: 260 },
        { grupo: 'Cojinetes', id: 'plain_lead_bronze',   label: 'Cojinete liso — Bronce de plomo',         amb: null, rise: null, max: 232 },
        { grupo: 'Cojinetes', id: 'plain_al',            label: 'Cojinete liso — Aluminio',                amb: null, rise: null, max: 121 },
        { grupo: 'Cojinetes', id: 'plain_nylon',         label: 'Cojinete prod. — Nylon',                  amb: null, rise: null, max: 149 },
        { grupo: 'Cojinetes', id: 'plain_polyurethane',  label: 'Cojinete prod. — Poliuretano',            amb: null, rise: null, max: 82  },
        { grupo: 'Cojinetes', id: 'plain_wood',          label: 'Cojinete prod. — Madera',                 amb: null, rise: null, max: 71  },
        { grupo: 'Cojinetes', id: 'plain_rubber',        label: 'Cojinete prod. — Caucho',                 amb: null, rise: null, max: 49  },
        // ── Lubricantes ────────────────────────────────────────
        { grupo: 'Lubricantes', id: 'lub_mineral',       label: 'Lubricante — Aceite mineral sin EP',      amb: null, rise: null, max: 120 },
        { grupo: 'Lubricantes', id: 'lub_ep_ind',        label: 'Lubricante — Aceite EP industrial',      amb: null, rise: null, max: 110 },
        { grupo: 'Lubricantes', id: 'lub_ep_axle',       label: 'Lubricante — Aceite EP diferencial',     amb: null, rise: null, max: 100 },
        { grupo: 'Lubricantes', id: 'lub_polyglycol',    label: 'Lubricante — Sintético polietilenglicol', amb: null, rise: null, max: 120 },
        { grupo: 'Lubricantes', id: 'lub_diester',       label: 'Lubricante — Sintético di-éster/silicona', amb: null, rise: null, max: 110 },
        { grupo: 'Lubricantes', id: 'grease_li',         label: 'Grasa — Litio (retén plástico)',          amb: null, rise: null, max: 120 },
        { grupo: 'Lubricantes', id: 'grease_li_steel',   label: 'Grasa — Litio (retén acero/latón)',      amb: null, rise: null, max: 110 },
        { grupo: 'Lubricantes', id: 'grease_lico',       label: 'Grasa — Litio complejo',                  amb: null, rise: null, max: 140 },
        { grupo: 'Lubricantes', id: 'grease_na',         label: 'Grasa — Sodio',                          amb: null, rise: null, max: 80  },
        { grupo: 'Lubricantes', id: 'grease_ca',         label: 'Grasa — Calcio (Lima)',                  amb: null, rise: null, max: 60  },
        { grupo: 'Lubricantes', id: 'grease_polyurea',   label: 'Grasa — Poliurea',                       amb: null, rise: null, max: 140 },
        // ── Sellos y Empaques ──────────────────────────────────
        { grupo: 'Sellos/Empaques', id: 'seal_butyl',    label: 'O-ring / Empaque — Caucho butilo',       amb: null, rise: null, max: 107 },
        { grupo: 'Sellos/Empaques', id: 'seal_hypalon',  label: 'O-ring / Empaque — Hypalon',             amb: null, rise: null, max: 121 },
        { grupo: 'Sellos/Empaques', id: 'seal_epdm',     label: 'O-ring / Empaque — EPDM',                amb: null, rise: null, max: 149 },
        { grupo: 'Sellos/Empaques', id: 'seal_viton',    label: 'O-ring / Empaque — Fluorocarbono (Viton)',amb: null, rise: null, max: 204 },
        { grupo: 'Sellos/Empaques', id: 'seal_neoprene', label: 'O-ring / Empaque — Neopreno',            amb: null, rise: null, max: 149 },
        { grupo: 'Sellos/Empaques', id: 'seal_nitrile',  label: 'O-ring / Empaque — Nitrilo',             amb: null, rise: null, max: 135 },
        { grupo: 'Sellos/Empaques', id: 'seal_silicone', label: 'O-ring / Empaque — Silicona',            amb: null, rise: null, max: 232 },
        { grupo: 'Sellos/Empaques', id: 'lip_nitrile',   label: 'Sello labial — Nitrilo',                 amb: null, rise: null, max: 121 },
        { grupo: 'Sellos/Empaques', id: 'lip_silicone',  label: 'Sello labial — Silicona',                amb: null, rise: null, max: 163 },
        { grupo: 'Sellos/Empaques', id: 'lip_viton',     label: 'Sello labial — Fluorocarbono',           amb: null, rise: null, max: 204 },
        { grupo: 'Sellos/Empaques', id: 'lip_leather',   label: 'Sello labial — Cuero',                   amb: null, rise: null, max: 93  },
        // ── Transmisión de potencia ────────────────────────────
        { grupo: 'Transmisión', id: 'vbelt',             label: 'Banda en V (V-belt)',                    amb: null, rise: null, max: 60  },
        { grupo: 'Transmisión', id: 'chain',             label: 'Cadena (limitado por lubricante)',        amb: null, rise: null, max: null },
        { grupo: 'Transmisión', id: 'gear',              label: 'Engranaje (limitado por lubricante)',     amb: null, rise: null, max: null },
        // ── Sellos mecánicos ───────────────────────────────────
        { grupo: 'Sellos Mecánicos', id: 'mech_stellite', label: 'Sello mecánico — Stellite',             amb: null, rise: null, max: 177 },
        { grupo: 'Sellos Mecánicos', id: 'mech_wc',       label: 'Sello mecánico — Carburo de tungsteno', amb: null, rise: null, max: 232 },
        { grupo: 'Sellos Mecánicos', id: 'mech_ss',       label: 'Sello mecánico — Acero inoxidable',     amb: null, rise: null, max: 316 },
        { grupo: 'Sellos Mecánicos', id: 'mech_bronze',   label: 'Sello mecánico — Bronce plomado',       amb: null, rise: null, max: 177 },
        { grupo: 'Sellos Mecánicos', id: 'mech_carbon',   label: 'Sello mecánico — Carbono',              amb: null, rise: null, max: 275 },
        { grupo: 'Sellos Mecánicos', id: 'mech_sic',      label: 'Sello mecánico — Carburo de silicio',   amb: null, rise: null, max: 1650},
        // ── Genérico ───────────────────────────────────────────
        { grupo: 'Genérico', id: 'custom',               label: 'Componente personalizado',               amb: null, rise: null, max: null },
    ];

    // ── Presets de norma ΔT ─────────────────────────────────────
    const NORMA_DT = {
        neta_similar: { alerta: 4,  alarma: 15, desc: 'NETA — entre componentes similares bajo igual carga' },
        neta_amb:     { alerta: 11, alarma: 40, desc: 'NETA — sobre temperatura ambiente' },
        militar:      { alerta: 25, alarma: 70, desc: 'MIL-STD-2194 — sistema militar' },
        experiencia:  { alerta: 10, alarma: 40, desc: 'Basado en experiencia — uso general' },
        motor_core:   { alerta: 10, alarma: 20, desc: 'Núcleos de motor en banco de prueba' },
        custom:       { alerta: null, alarma: null, desc: 'Valores personalizados' },
    };

    // ── Criterio por defecto según tipo ─────────────────────────
    const CRITERIO_POR_TIPO = {
        // Delta T — eléctricos comparativos
        cond_bare_free: 'delta_t', cond_bare_enc: 'delta_t', cond_bare_surf: 'delta_t',
        cond_ins_free: 'delta_t', cond_ins_enc: 'delta_t', cond_ins_surf: 'delta_t', cond_ins_sun: 'delta_t',
        conn_silver: 'delta_t', conn_copper: 'delta_t', conn_alalloy: 'delta_t',
        cb_molded: 'delta_t', cb_other: 'delta_t', fuse: 'delta_t', disconnect: 'delta_t',
        bushing_xfmr: 'delta_t', bushing_cb: 'delta_t', bushing_ext: 'delta_t',
        coil_90: 'delta_t', coil_105: 'delta_t', coil_130: 'delta_t',
        coil_155: 'delta_t', coil_180: 'delta_t', coil_220: 'delta_t',
        // Absoluta + corrección — motores/generadores/transformadores
        ac_1sf_a: 'absoluta_corr', ac_1sf_b: 'absoluta_corr', ac_1sf_f: 'absoluta_corr',
        ac_1sf_h: 'absoluta_corr', ac_115sf_b: 'absoluta_corr', ac_115sf_f: 'absoluta_corr',
        dc_1sf_a: 'absoluta_corr', dc_1sf_b: 'absoluta_corr', dc_1sf_f: 'absoluta_corr',
        dc_1sf_h: 'absoluta_corr', dc_125sf_b: 'absoluta_corr', dc_125sf_f: 'absoluta_corr',
        gen_b: 'absoluta_corr', gen_f: 'absoluta_corr', gen_h: 'absoluta_corr',
        xfmr_dry_105: 'absoluta_corr', xfmr_dry_150: 'absoluta_corr',
        xfmr_dry_185: 'absoluta_corr', xfmr_dry_220: 'absoluta_corr',
        xfmr_oil_55: 'absoluta_corr', xfmr_oil_65: 'absoluta_corr',
        // Absoluta — mecánicos con límite fijo
        brg_race: 'absoluta', brg_rolling: 'absoluta', brg_cage_plastic: 'absoluta',
        brg_cage_steel: 'absoluta', brg_cage_brass: 'absoluta', brg_shield_steel: 'absoluta',
        brg_seal_nitrile: 'absoluta', brg_seal_acrylic: 'absoluta', brg_seal_silicone: 'absoluta',
        brg_seal_ptfe: 'absoluta', brg_seal_felt: 'absoluta', brg_labyrinth: 'absoluta',
        plain_tin: 'absoluta', plain_lead: 'absoluta', plain_cad: 'absoluta',
        plain_cu_lead: 'absoluta', plain_tin_bronze: 'absoluta', plain_lead_bronze: 'absoluta',
        plain_al: 'absoluta', plain_nylon: 'absoluta', plain_polyurethane: 'absoluta',
        plain_wood: 'absoluta', plain_rubber: 'absoluta',
        lub_mineral: 'absoluta', lub_ep_ind: 'absoluta', lub_ep_axle: 'absoluta',
        lub_polyglycol: 'absoluta', lub_diester: 'absoluta',
        grease_li: 'absoluta', grease_li_steel: 'absoluta', grease_lico: 'absoluta',
        grease_na: 'absoluta', grease_ca: 'absoluta', grease_polyurea: 'absoluta',
        seal_butyl: 'absoluta', seal_hypalon: 'absoluta', seal_epdm: 'absoluta',
        seal_viton: 'absoluta', seal_neoprene: 'absoluta', seal_nitrile: 'absoluta',
        seal_silicone: 'absoluta', lip_nitrile: 'absoluta', lip_silicone: 'absoluta',
        lip_viton: 'absoluta', lip_leather: 'absoluta',
        vbelt: 'absoluta', chain: 'absoluta', gear: 'absoluta',
        mech_stellite: 'absoluta', mech_wc: 'absoluta', mech_ss: 'absoluta',
        mech_bronze: 'absoluta', mech_carbon: 'absoluta', mech_sic: 'absoluta',
        ins_t_tw: 'absoluta', ins_thw: 'absoluta', ins_varnished: 'absoluta',
        ins_paper_lead: 'absoluta', ins_polyester: 'absoluta', ins_xlpe: 'absoluta',
        ins_silicone: 'absoluta',
    };



    // ── Helpers ────────────────────────────────────────────────
    function sevBadge(estado) {
        if (!estado) return `<span class="sev-badge-table sev-empty">—</span>`;
        const map    = { C: 'sev-c', A: 'sev-a', B: 'sev-b' };
        const labels = { C: 'Alarma', A: 'Alerta', B: 'Bueno' };
        return `<span class="sev-badge-table ${map[estado] || 'sev-empty'}">${labels[estado] || estado}</span>`;
    }

    function peorEstado(arr) {
        let peor = null;
        arr.forEach(s => { if (s && (ORDEN_SEV[s] || 0) > (ORDEN_SEV[peor] || 0)) peor = s; });
        return peor;
    }

    function fmtFecha(val) {
        if (!val) return '—';
        const s = String(val).split('T')[0];
        const [y, m, d] = s.split('-').map(Number);
        const M = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        return `${String(d).padStart(2,'0')}-${M[m-1]}-${String(y).slice(-2)}`;
    }

    function tipoLabel(id) {
        return TIPOS_COMPONENTE.find(t => t.id === id)?.label || id;
    }

    function tipoData(id) {
        return TIPOS_COMPONENTE.find(t => t.id === id) || {};
    }

    // ── Calcular ΔT y Tmaxcorr para display ───────────────────
    function calcularDT(comp, tempAmb, fase) {
        const temp = parseFloat(fase.temperatura);
        if (isNaN(temp)) return null;
        return +(temp - tempAmb).toFixed(1);
    }

    function calcularTmaxCorr(comp, tempAmb, fase) {
        const corrNominal   = parseFloat(comp.corriente_nominal);
        const corrM         = parseFloat(fase.corriente);
        const tempRiseRated = parseFloat(comp.temp_rise_rated);
        if (!corrNominal || !corrM || isNaN(tempRiseRated)) return null;
        const ratio = corrM / corrNominal;
        return +((ratio * ratio * tempRiseRated) + tempAmb).toFixed(1);
    }

    function calcularEstadoLocal(comp, tempAmb, fases) {
        const criterio      = comp.criterio || 'delta_t';
        const corrNominal   = parseFloat(comp.corriente_nominal) || null;
        const tempRiseRated = parseFloat(comp.temp_rise_rated)   || null;
        const tempMaxAbs    = parseFloat(comp.temp_max_abs)      || null;
        const dtAlerta      = parseFloat(comp.delta_t_alerta)    || null;
        const dtAlarma      = parseFloat(comp.delta_t_alarma)    || null;
        if (!fases || !fases.length) return null;
        let peor = null;
        for (const fase of fases) {
            const temp  = parseFloat(fase.temperatura);
            const corrM = parseFloat(fase.corriente) || null;
            if (isNaN(temp)) continue;
            let estado = null;
            if (criterio === 'delta_t') {
                const dt = temp - tempAmb;
                if (dtAlarma != null && dt >= dtAlarma)      estado = 'C';
                else if (dtAlerta != null && dt >= dtAlerta) estado = 'A';
                else                                          estado = 'B';
            } else if (criterio === 'absoluta') {
                if (tempMaxAbs != null) {
                    if (temp >= tempMaxAbs)                              estado = 'C';
                    else if (temp >= tempMaxAbs - (tempRiseRated || 10)) estado = 'A';
                    else                                                  estado = 'B';
                }
            } else if (criterio === 'absoluta_corr') {
                if (corrNominal && corrM && tempRiseRated != null) {
                    const ratio = corrM / corrNominal;
                    const tmc   = (ratio * ratio * tempRiseRated) + tempAmb;
                    if (temp >= tmc)             estado = 'C';
                    else if (temp >= tmc * 0.85) estado = 'A';
                    else                         estado = 'B';
                } else if (tempMaxAbs != null) {
                    if (temp >= tempMaxAbs)                              estado = 'C';
                    else if (temp >= tempMaxAbs - (tempRiseRated || 10)) estado = 'A';
                    else                                                  estado = 'B';
                }
            }
            if (estado && (ORDEN_SEV[estado] || 0) > (ORDEN_SEV[peor] || 0)) peor = estado;
        }
        return peor;
    }

    // ══════════════════════════════════════════════════════════
    // ÁRBOL DE EQUIPOS (panel lateral)
    // ══════════════════════════════════════════════════════════
    async function loadEquipos() {
        const tree = document.getElementById('termo-asset-tree');
        const search = document.getElementById('termo-sidebar-search');
        if (!tree) return;

        tree.innerHTML = `<div class="cond-tree-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Cargando...</span></div>`;
        try {
            const res = await apiFetch('/api/equipos');
            if (!res?.ok) throw new Error();
            allEquipos = (await res.json()).filter(e => e.aplica_termografia);
            renderTree(allEquipos);
        } catch {
            tree.innerHTML = `<div class="cond-tree-loading" style="color:var(--danger);">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>Error al cargar activos</span></div>`;
        }

        search?.addEventListener('input', () => {
            renderTree(allEquipos, search.value.toLowerCase().trim());
        });
    }

    function renderTree(equipos, query = '') {
        const tree = document.getElementById('termo-asset-tree');
        if (!tree) return;
        if (!equipos.length) {
            tree.innerHTML = `<div class="cond-tree-loading">
                <i class="fa-solid fa-circle-info"></i>
                <span style="text-align:center;">No hay activos con<br>termografía habilitada</span>
            </div>`;
            return;
        }

        const grupos = {};
        equipos.forEach(eq => {
            const planta = (eq.ubicacion || 'Sin Ubicación').split('/')[0].trim() || 'Sin Ubicación';
            if (!grupos[planta]) grupos[planta] = [];
            grupos[planta].push(eq);
        });

        let html = '';
        let haMatch = false;
        Object.keys(grupos).sort().forEach(planta => {
            const items = query
                ? grupos[planta].filter(e =>
                    e.asset_id?.toLowerCase().includes(query) ||
                    (e.descripcion||'').toLowerCase().includes(query) ||
                    (e.ubicacion||'').toLowerCase().includes(query))
                : grupos[planta];
            if (!items.length) return;
            haMatch = true;

            const semItems = items.map(e => {
                const s  = e.ultimo_estado_termografia;
                const sc = s ? `sema-${s}` : 'sema-null';
                const isActive = currentEquipo?.asset_id === e.asset_id ? 'active' : '';
                return `<div class="cond-tree-activo ${isActive}" data-id="${e.asset_id}">
                    <div class="cond-semaforo-mini ${sc}"></div>
                    <span class="cond-activo-id">${e.asset_id}</span>
                    <span class="cond-activo-desc" title="${e.descripcion || ''}">${e.descripcion || '—'}</span>
                </div>`;
            }).join('');

            html += `<div class="cond-tree-planta" data-planta="${planta}">
                <div class="cond-tree-planta-header">
                    <i class="fa-solid fa-industry" style="font-size:.8em;opacity:.6;"></i>
                    <span>${planta}</span>
                    <span class="cond-planta-count">${items.length}</span>
                    <i class="fa-solid fa-chevron-down chevron"></i>
                </div>
                <div class="cond-tree-activos">${semItems}</div>
            </div>`;
        });

        if (!haMatch) {
            tree.innerHTML = `<div class="cond-tree-loading">
                <i class="fa-solid fa-magnifying-glass"></i><span>Sin resultados</span></div>`;
            return;
        }

        tree.innerHTML = html;

        tree.querySelectorAll('.cond-tree-planta-header').forEach(h => {
            h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'));
        });

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
        // Actualizar árbol
        document.querySelectorAll('#termo-asset-tree .cond-tree-activo').forEach(el => {
            el.classList.toggle('active', el.dataset.id === eq.asset_id);
        });

        // Mostrar panel
        document.getElementById('termo-panel-empty')?.style && (document.getElementById('termo-panel-empty').style.display = 'none');
        document.getElementById('termo-panel-equipo')?.style && (document.getElementById('termo-panel-equipo').style.display = '');

        // Ficha técnica completa — igual que vibraciones
        const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = (v != null && v !== '') ? v : '—'; };

        setT('termo-ficha-id',           eq.asset_id);
        setT('termo-ficha-desc',         eq.descripcion);
        setT('termo-ficha-ubicacion',    eq.ubicacion);
        setT('termo-ficha-marca',        eq.marca);
        setT('termo-ficha-modelo',       eq.modelo);
        setT('termo-ficha-tipo-sistema', (eq.tipo_sistema || '').toUpperCase() || '—');
        setT('termo-ficha-potencia',     eq.potencia_hp ? `${eq.potencia_hp} HP` : '—');
        setT('termo-ficha-rpm',          eq.rpm        ? `${eq.rpm} RPM`        : '—');
        setT('termo-ficha-elec',         [eq.voltaje ? eq.voltaje+'V' : '', eq.amperaje ? eq.amperaje+'A' : ''].filter(Boolean).join(' / ') || '—');
        setT('termo-ficha-clase-aisl',   eq.clase_aislamiento);
        setT('termo-ficha-rodamientos',  [eq.rodamiento_de, eq.rodamiento_ode].filter(Boolean).join(' / ') || '—');
        setT('termo-ficha-acople',       [eq.tipo_acople, eq.transmision_tipo].filter(Boolean).join(' / ') || '—');
        setT('termo-ficha-estado-txt',   { B:'Bueno', A:'Alerta', C:'Alarma' }[eq.ultimo_estado_termografia] || 'Sin datos');
        setT('termo-ficha-crit-txt',     eq.criticidad);

        // Badge de criticidad
        const badge = document.getElementById('termo-ficha-criticidad-badge');
        if (badge) {
            badge.textContent = eq.criticidad || '—';
            badge.className   = 'cond-ficha-badge';
            if (eq.criticidad === 'Alta')  badge.classList.add('crit-alta');
            if (eq.criticidad === 'Media') badge.classList.add('crit-media');
            if (eq.criticidad === 'Baja')  badge.classList.add('crit-baja');
        }

        // Semáforo
        const semaforo = document.getElementById('termo-ficha-semaforo');
        if (semaforo) {
            const s = eq.ultimo_estado_termografia;
            semaforo.className = `cond-semaforo-dot${s ? ' sema-' + s : ''}`;
        }

        await loadComponentes(eq.asset_id);
        loadTermoGap();
        loadTermoChart();
    }

    // ══════════════════════════════════════════════════════════
    // COMPONENTES
    // ══════════════════════════════════════════════════════════
    async function loadComponentes(assetId) {
        try {
            const res = await apiFetch(`/api/termo/componentes/${assetId}`);
            if (!res?.ok) throw new Error();
            componentes = await res.json();
        } catch {
            componentes = [];
        }
        renderComponentes();
        await loadLecturas(assetId);
    }

    function renderComponentes() {
        const wrap = document.getElementById('termo-componentes-wrap');
        if (!wrap) return;
        if (!componentes.length) {
            wrap.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:.9em;">
                <i class="fa-solid fa-plus-circle"></i> Sin componentes. Usa <b>+ Añadir Componente</b> para crear uno.</div>`;
            return;
        }
        wrap.innerHTML = componentes.map(c => {
            const lecsFiltradas = lecturas.filter(l => l.componente_id === c.id);
            const ultima = lecsFiltradas[lecsFiltradas.length - 1];
            const estado = ultima?.estado || null;
            const criterioLabel = { delta_t: 'ΔT', absoluta: 'Abs.', absoluta_corr: 'Abs.+Corr.' }[c.criterio] || c.criterio;
            return `<div class="termo-comp-card ${estado ? 'comp-estado-' + estado.toLowerCase() : ''}" data-comp-id="${c.id}">
                <div class="termo-comp-header">
                    <div class="termo-comp-title">
                        <i class="fa-solid fa-thermometer-half"></i>
                        <span>${c.nombre}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        ${sevBadge(estado)}
                        <button class="termo-btn-icon btn-edit-comp" data-id="${c.id}" title="Editar componente">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="termo-btn-icon btn-delete-comp" data-id="${c.id}" title="Eliminar componente" style="color:var(--danger);">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="termo-comp-meta">
                    <span><i class="fa-solid fa-tag"></i> ${tipoLabel(c.tipo_componente)}</span>
                    <span><i class="fa-solid fa-ruler"></i> Criterio: ${criterioLabel}</span>
                    <span><i class="fa-solid fa-bolt"></i> Fases: ${c.num_fases}</span>
                    ${c.corriente_nominal ? `<span><i class="fa-solid fa-plug"></i> I<sub>nom</sub>: ${c.corriente_nominal} A</span>` : ''}
                    ${c.temp_max_abs ? `<span><i class="fa-solid fa-temperature-high"></i> T<sub>max</sub>: ${c.temp_max_abs}°C</span>` : ''}
                    ${c.emisividad != null ? `<span><i class="fa-solid fa-eye"></i> ε: ${c.emisividad}</span>` : ''}
                    ${c.distancia_tipica ? `<span><i class="fa-solid fa-ruler-horizontal"></i> ${c.distancia_tipica}m</span>` : ''}
                    ${ultima ? `<span><i class="fa-solid fa-calendar"></i> Última: ${fmtFecha(ultima.fecha_medicion)}</span>` : ''}
                </div>
                <div class="termo-comp-actions no-print">
                    <button class="cond-btn btn-add-lectura" data-comp-id="${c.id}">
                        <i class="fa-solid fa-plus"></i> Nueva Lectura
                    </button>
                    <button class="cond-btn btn-ver-lecturas" data-comp-id="${c.id}">
                        <i class="fa-solid fa-table-list"></i> Ver Lecturas (${lecsFiltradas.length})
                    </button>
                </div>
            </div>`;
        }).join('');

        // Eventos
        wrap.querySelectorAll('.btn-edit-comp').forEach(btn => {
            btn.addEventListener('click', () => openCompModal(parseInt(btn.dataset.id)));
        });
        wrap.querySelectorAll('.btn-delete-comp').forEach(btn => {
            btn.addEventListener('click', () => deleteComponente(parseInt(btn.dataset.id)));
        });
        wrap.querySelectorAll('.btn-add-lectura').forEach(btn => {
            btn.addEventListener('click', () => openLecturaModal(parseInt(btn.dataset.compId)));
        });
        wrap.querySelectorAll('.btn-ver-lecturas').forEach(btn => {
            btn.addEventListener('click', () => openTablaLecturas(parseInt(btn.dataset.compId)));
        });
    }

    async function deleteComponente(id) {
        if (!confirm('¿Eliminar este componente y todas sus lecturas?')) return;
        const res = await apiFetch(`/api/termo/componentes/${id}`, { method: 'DELETE' });
        if (res?.ok) {
            toast('Componente eliminado.', 'info');
            await loadComponentes(currentEquipo.asset_id);
        } else {
            toast('Error al eliminar.', 'error');
        }
    }

    // ══════════════════════════════════════════════════════════
    // LECTURAS
    // ══════════════════════════════════════════════════════════
    async function loadLecturas(assetId) {
        try {
            const res = await apiFetch(`/api/termo/lecturas/${assetId}`);
            if (!res?.ok) throw new Error();
            lecturas = await res.json();
        } catch {
            lecturas = [];
        }
        renderComponentes(); // actualizar conteos y últimas fechas
        renderTablaGlobal();
    }

    function renderTablaGlobal() {
        const tbody = document.getElementById('termo-tabla-tbody');
        if (!tbody) return;
        if (!lecturas.length) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">Sin lecturas registradas</td></tr>`;
            return;
        }
        // Mostrar las últimas 30 lecturas ordenadas por fecha desc
        const sorted = [...lecturas].sort((a,b) => b.fecha_medicion > a.fecha_medicion ? 1 : -1).slice(0, 50);
        tbody.innerHTML = sorted.map(l => {
            const nFases = parseInt(l.num_fases) || 1;
            const labels = nFases === 3 ? ['R','S','T'] : nFases === 2 ? ['L1','L2'] : [''];
            const fasesStr = (l.fases || []).map((f, i) => {
                const lbl = labels[i] || `F${i+1}`;
                const dt  = +(parseFloat(f.temperatura) - parseFloat(l.temp_ambiente)).toFixed(1);
                const dtColor = dt > 40 ? 'var(--danger)' : dt > 10 ? '#f59e0b' : 'var(--text-muted)';
                return `<span>${lbl ? `<b>${lbl}</b>: ` : ''}${f.temperatura}°C${f.corriente ? `/`+f.corriente+`A` : ''} <small style="color:${dtColor};">(ΔT ${dt}°C)</small></span>`;
            }).join('<br>');
            const imgs = [l.num_img_ir ? `IR: ${l.num_img_ir}` : '', l.num_img_vis ? `Vis: ${l.num_img_vis}` : ''].filter(Boolean).join(' · ');
            return `<tr>
                <td style="white-space:nowrap;">${fmtFecha(l.fecha_medicion)}</td>
                <td style="font-weight:600;">${l.comp_nombre || '—'}</td>
                <td style="font-size:.82em;color:var(--text-muted);">${tipoLabel(l.tipo_componente)}</td>
                <td style="white-space:nowrap;">${l.temp_ambiente}°C${l.emisividad ? `<br><small style="color:var(--text-muted);">ε=${l.emisividad}</small>` : ''}${l.distancia ? `<br><small style="color:var(--text-muted);">${l.distancia}m</small>` : ''}</td>
                <td style="font-size:.85em;">${fasesStr || '—'}</td>
                <td>${sevBadge(l.estado)}</td>
                <td style="font-size:.82em;color:var(--text-muted);">${imgs ? `<span style="color:var(--primary);">${imgs}</span><br>` : ''}${l.notas || ''}</td>
                <td class="no-print" style="white-space:nowrap;">
                    <button class="termo-btn-icon btn-edit-lec" data-id="${l.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
                    <button class="termo-btn-icon btn-del-lec" data-id="${l.id}" title="Eliminar" style="color:var(--danger);"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('.btn-edit-lec').forEach(btn => {
            btn.addEventListener('click', () => editLectura(parseInt(btn.dataset.id)));
        });
        tbody.querySelectorAll('.btn-del-lec').forEach(btn => {
            btn.addEventListener('click', () => deleteLectura(parseInt(btn.dataset.id)));
        });
    }

    async function deleteLectura(id) {
        if (!confirm('¿Eliminar esta lectura?')) return;
        const res = await apiFetch(`/api/termo/lecturas/${id}`, { method: 'DELETE' });
        if (res?.ok) {
            toast('Lectura eliminada.', 'info');
            await loadLecturas(currentEquipo.asset_id);
            refreshTreeEstado();
            loadTermoChart();
        } else {
            toast('Error al eliminar lectura.', 'error');
        }
    }

    function editLectura(id) {
        const lec = lecturas.find(l => l.id === id);
        if (!lec) return;
        const comp = componentes.find(c => c.id === lec.componente_id);
        if (!comp) return;
        openLecturaModal(comp.id, lec);
    }

    // ══════════════════════════════════════════════════════════
    // MODAL COMPONENTE
    // ══════════════════════════════════════════════════════════
    function buildTiposOptions(selected) {
        const grupos = [...new Set(TIPOS_COMPONENTE.map(t => t.grupo))];
        return grupos.map(g => {
            const items = TIPOS_COMPONENTE.filter(t => t.grupo === g);
            return `<optgroup label="${g}">${items.map(t =>
                `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}
                    data-max="${t.max ?? ''}" data-rise="${t.rise ?? ''}" data-amb="${t.amb ?? ''}"
                >${t.label}</option>`
            ).join('')}</optgroup>`;
        }).join('');
    }

    function openCompModal(compId = null) {
        const comp = compId ? componentes.find(c => c.id === compId) : null;
        editingCompId = compId;

        const modal = document.getElementById('termo-modal-comp');
        if (!modal) return;

        modal.querySelector('#tmc-titulo').textContent    = comp ? 'Editar Componente' : 'Nuevo Componente';
        modal.querySelector('#tmc-nombre').value          = comp?.nombre || '';
        modal.querySelector('#tmc-tipo').innerHTML        = buildTiposOptions(comp?.tipo_componente || '');
        modal.querySelector('#tmc-criterio').value        = comp?.criterio || 'delta_t';
        modal.querySelector('#tmc-fases').value           = comp?.num_fases || 1;
        modal.querySelector('#tmc-corriente-nom').value   = comp?.corriente_nominal || '';
        modal.querySelector('#tmc-corr-r').value          = comp?.corriente_nominal_r || '';
        modal.querySelector('#tmc-corr-s').value          = comp?.corriente_nominal_s || '';
        modal.querySelector('#tmc-corr-t').value          = comp?.corriente_nominal_t || '';
        modal.querySelector('#tmc-temp-max').value        = comp?.temp_max_abs || '';
        modal.querySelector('#tmc-temp-rise').value       = comp?.temp_rise_rated || '';
        modal.querySelector('#tmc-temp-amb-rated').value  = comp?.temp_amb_rated ?? 40;
        modal.querySelector('#tmc-dt-alerta').value       = comp?.delta_t_alerta || '';
        modal.querySelector('#tmc-dt-alarma').value       = comp?.delta_t_alarma || '';
        modal.querySelector('#tmc-emisividad').value      = comp?.emisividad ?? 0.95;
        modal.querySelector('#tmc-distancia').value       = comp?.distancia_tipica || '';
        modal.querySelector('#tmc-notas').value           = comp?.notas_config || '';

        updateCompModalCriterio();
        if (!comp) {
            // New component: auto-apply tipo hints
            updateCompModalTipo();
        } else {
            // Editing: just show the hint for current tipo
            const hint = modal.querySelector('#tmc-tipo-hint');
            if (hint) hint.style.display = 'none';
        }
        updateFasesNomShow();
        modal.style.display = 'flex';
    }

    function updateFasesNomShow() {
        const modal = document.getElementById('termo-modal-comp');
        if (!modal) return;
        const n = parseInt(modal.querySelector('#tmc-fases')?.value) || 1;
        const row = modal.querySelector('#tmc-row-fases-nom');
        if (row) row.style.display = n === 3 ? '' : 'none';
        const lbl = modal.querySelector('#tmc-corr-por-fase-label');
        if (lbl) lbl.textContent = n > 1 ? `— por fase` : `— total`;
    }

    function updateCompModalCriterio() {
        const modal   = document.getElementById('termo-modal-comp');
        const crit    = modal?.querySelector('#tmc-criterio')?.value;
        const rowDT   = modal?.querySelector('#tmc-row-dt');
        const rowAbs  = modal?.querySelector('#tmc-row-abs');
        const rowCorr = modal?.querySelector('#tmc-row-corr');
        const rowNorma = modal?.querySelector('#tmc-row-norma');
        const hintEl  = modal?.querySelector('#tmc-criterio-hint');
        if (!rowDT) return;
        const isDT   = crit === 'delta_t';
        const isAbs  = crit === 'absoluta' || crit === 'absoluta_corr';
        const isCorr = crit === 'absoluta_corr';
        rowDT.style.display    = isDT   ? 'grid' : 'none';
        rowAbs.style.display   = isAbs  ? 'grid' : 'none';
        rowCorr.style.display  = isCorr ? ''     : 'none';
        if (rowNorma) rowNorma.style.display = isDT ? '' : 'none';
        if (hintEl) {
            const hints = {
                delta_t:       'Compara la temperatura del componente con una referencia (ambiente o similar). Ideal para conexiones eléctricas y componentes comparativos.',
                absoluta:      'Compara contra el límite absoluto del estándar Infraspection. Ideal para rodamientos, lubricantes y sellos.',
                absoluta_corr: 'Aplica la fórmula Tmaxcorr = (Imed/Inom)² × Trise + Tamb. Ideal para motores, transformadores y generadores bajo carga variable.',
            };
            hintEl.textContent = hints[crit] || '';
        }
    }

    function updateCompModalTipo() {
        const modal = document.getElementById('termo-modal-comp');
        if (!modal) return;
        const sel   = modal.querySelector('#tmc-tipo');
        const opt   = sel?.options[sel.selectedIndex];
        if (!opt) return;

        const tipoId = opt.value;
        const maxV   = opt.dataset.max;
        const riseV  = opt.dataset.rise;
        const ambV   = opt.dataset.amb;

        // Auto-fill temperature limits from standard
        if (maxV)  modal.querySelector('#tmc-temp-max').value = maxV;
        if (riseV) modal.querySelector('#tmc-temp-rise').value = riseV;
        if (ambV)  modal.querySelector('#tmc-temp-amb-rated').value = ambV;

        // Auto-select criterio based on type
        const critAuto = CRITERIO_POR_TIPO[tipoId];
        if (critAuto) {
            modal.querySelector('#tmc-criterio').value = critAuto;
            updateCompModalCriterio();
        }

        // Show hint about the component
        const hintEl = modal.querySelector('#tmc-tipo-hint');
        if (hintEl) {
            const parts = [];
            if (maxV)  parts.push(`T<sub>max</sub>: <b>${maxV}°C</b>`);
            if (riseV) parts.push(`T<sub>rise</sub>: <b>${riseV}°C</b>`);
            if (ambV)  parts.push(`T<sub>amb_rated</sub>: <b>${ambV}°C</b>`);
            if (critAuto) parts.push(`Criterio sugerido: <b>${{delta_t:'ΔT',absoluta:'Absoluta',absoluta_corr:'Abs.+Corrección'}[critAuto]}</b>`);
            hintEl.innerHTML = parts.join(' &nbsp;·&nbsp; ');
            hintEl.style.display = parts.length ? '' : 'none';
        }
    }

    async function saveComp() {
        const modal = document.getElementById('termo-modal-comp');
        const body = {
            asset_id:              currentEquipo.asset_id,
            nombre:                modal.querySelector('#tmc-nombre').value.trim(),
            tipo_componente:       modal.querySelector('#tmc-tipo').value,
            criterio:              modal.querySelector('#tmc-criterio').value,
            num_fases:             parseInt(modal.querySelector('#tmc-fases').value) || 1,
            corriente_nominal:     parseFloat(modal.querySelector('#tmc-corriente-nom').value) || null,
            corriente_nominal_r:   parseFloat(modal.querySelector('#tmc-corr-r').value) || null,
            corriente_nominal_s:   parseFloat(modal.querySelector('#tmc-corr-s').value) || null,
            corriente_nominal_t:   parseFloat(modal.querySelector('#tmc-corr-t').value) || null,
            temp_max_abs:          parseFloat(modal.querySelector('#tmc-temp-max').value) || null,
            temp_rise_rated:       parseFloat(modal.querySelector('#tmc-temp-rise').value) || null,
            temp_amb_rated:        parseFloat(modal.querySelector('#tmc-temp-amb-rated').value) || 40,
            delta_t_alerta:        parseFloat(modal.querySelector('#tmc-dt-alerta').value) || null,
            delta_t_alarma:        parseFloat(modal.querySelector('#tmc-dt-alarma').value) || null,
            emisividad:            parseFloat(modal.querySelector('#tmc-emisividad').value) || 0.95,
            distancia_tipica:      parseFloat(modal.querySelector('#tmc-distancia').value) || null,
            notas_config:          modal.querySelector('#tmc-notas').value.trim() || null,
        };
        if (!body.nombre || !body.tipo_componente) { toast('Nombre y tipo son obligatorios.', 'error'); return; }

        const url    = editingCompId ? `/api/termo/componentes/${editingCompId}` : '/api/termo/componentes';
        const method = editingCompId ? 'PUT' : 'POST';
        const res    = await apiFetch(url, { method, body: JSON.stringify(body) });
        if (res?.ok) {
            toast(editingCompId ? '✅ Componente actualizado.' : '✅ Componente creado.', 'success');
            modal.style.display = 'none';
            await loadComponentes(currentEquipo.asset_id);
        } else {
            toast('Error al guardar componente.', 'error');
        }
    }

    // ══════════════════════════════════════════════════════════
    // MODAL LECTURA
    // ══════════════════════════════════════════════════════════
    function openLecturaModal(compId, lectura = null) {
        const comp = componentes.find(c => c.id === compId);
        if (!comp) return;
        editingLecId = lectura?.id || null;

        const modal = document.getElementById('termo-modal-lectura');
        if (!modal) return;

        modal.querySelector('#tml-titulo').textContent    = lectura ? 'Editar Lectura' : 'Nueva Lectura';
        modal.querySelector('#tml-comp-nombre').textContent = comp.nombre;
        modal.querySelector('#tml-fecha').value           = lectura ? String(lectura.fecha_medicion).split('T')[0] : new Date().toISOString().split('T')[0];
        modal.querySelector('#tml-temp-amb').value        = lectura?.temp_ambiente || '';
        modal.querySelector('#tml-emisividad').value      = lectura?.emisividad ?? comp.emisividad ?? 0.95;
        modal.querySelector('#tml-distancia').value       = lectura?.distancia ?? comp.distancia_tipica ?? '';
        modal.querySelector('#tml-img-ir').value          = lectura?.num_img_ir || '';
        modal.querySelector('#tml-img-vis').value         = lectura?.num_img_vis || '';
        modal.querySelector('#tml-notas').value           = lectura?.notas || '';
        modal.dataset.compId = compId;

        // Renderizar inputs de fases
        renderFasesInputs(comp, lectura?.fases || []);
        updateLecturaPreview(comp, lectura?.fases || []);

        modal.style.display = 'flex';
    }

    function renderFasesInputs(comp, fasesData) {
        const wrap = document.getElementById('tml-fases-wrap');
        if (!wrap) return;
        const n    = parseInt(comp.num_fases) || 1;
        const labels = n === 1 ? [''] : n === 2 ? ['Fase L1', 'Fase L2'] : ['Fase R', 'Fase S', 'Fase T'];
        const needsCorriente = comp.criterio === 'absoluta_corr';

        wrap.innerHTML = Array.from({ length: n }, (_, i) => {
            const fd = fasesData[i] || {};
            return `<div class="tml-fase-row">
                <div class="tml-fase-label">${labels[i] || `Fase ${i+1}`}</div>
                <div class="tml-fase-fields">
                    <label>Temperatura (°C)
                        <input type="number" step="0.1" class="tml-temp-fase" data-fase="${i}" value="${fd.temperatura || ''}">
                    </label>
                    <label class="tml-corr-label ${needsCorriente ? '' : 'tml-corr-optional'}">
                        Corriente (A) ${needsCorriente ? '' : '<span style="color:var(--text-muted);font-size:.8em;">(opcional)</span>'}
                        <input type="number" step="0.01" class="tml-corr-fase" data-fase="${i}" value="${fd.corriente || ''}">
                    </label>
                </div>
            </div>`;
        }).join('');

        // Live preview al cambiar valores
        wrap.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('input', () => {
                const fases = collectFases();
                const tempAmb = parseFloat(document.getElementById('tml-temp-amb')?.value) || 0;
                updateLecturaPreview(comp, fases, tempAmb);
            });
        });
        document.getElementById('tml-temp-amb')?.addEventListener('input', () => {
            const fases = collectFases();
            const tempAmb = parseFloat(document.getElementById('tml-temp-amb')?.value) || 0;
            updateLecturaPreview(comp, fases, tempAmb);
        });
    }

    function collectFases() {
        const wrap = document.getElementById('tml-fases-wrap');
        if (!wrap) return [];
        const temps  = wrap.querySelectorAll('.tml-temp-fase');
        const corrs  = wrap.querySelectorAll('.tml-corr-fase');
        return Array.from(temps).map((t, i) => ({
            temperatura: t.value !== '' ? parseFloat(t.value) : '',
            corriente:   corrs[i]?.value !== '' ? parseFloat(corrs[i].value) : '',
        }));
    }

    function updateLecturaPreview(comp, fases, tempAmb) {
        const prev = document.getElementById('tml-preview');
        if (!prev) return;
        if (isNaN(parseFloat(tempAmb)) || !fases.length) { prev.innerHTML = ''; return; }

        const criterio      = comp.criterio;
        const corrNominal   = parseFloat(comp.corriente_nominal);
        const tempRiseRated = parseFloat(comp.temp_rise_rated);
        const tempMaxAbs    = parseFloat(comp.temp_max_abs);
        const dtAlerta      = parseFloat(comp.delta_t_alerta);
        const dtAlarma      = parseFloat(comp.delta_t_alarma);

        const rows = fases.map((f, i) => {
            const temp = parseFloat(f.temperatura);
            const corrM= parseFloat(f.corriente);
            if (isNaN(temp)) return '';
            const dt   = +(temp - tempAmb).toFixed(1);
            let limInfo = '';
            let estado  = null;

            if (criterio === 'delta_t') {
                limInfo = `ΔT = ${dt}°C`;
                if (!isNaN(dtAlarma) && dt >= dtAlarma)       estado = 'C';
                else if (!isNaN(dtAlerta) && dt >= dtAlerta)  estado = 'A';
                else if (!isNaN(temp))                         estado = 'B';
                if (!isNaN(dtAlerta)) limInfo += ` | Alerta ≥ ${dtAlerta}°C`;
                if (!isNaN(dtAlarma)) limInfo += ` | Alarma ≥ ${dtAlarma}°C`;
            } else if (criterio === 'absoluta') {
                limInfo = `T = ${temp}°C`;
                if (!isNaN(tempMaxAbs)) {
                    if (temp >= tempMaxAbs)                              estado = 'C';
                    else if (temp >= tempMaxAbs - (tempRiseRated || 10)) estado = 'A';
                    else                                                  estado = 'B';
                    limInfo += ` | T<sub>max</sub> = ${tempMaxAbs}°C`;
                }
            } else if (criterio === 'absoluta_corr') {
                if (!isNaN(corrNominal) && !isNaN(corrM) && !isNaN(tempRiseRated)) {
                    const ratio = corrM / corrNominal;
                    const tmc   = +((ratio * ratio * tempRiseRated) + tempAmb).toFixed(1);
                    limInfo = `T = ${temp}°C | T<sub>max_corr</sub> = ${tmc}°C`;
                    if (temp >= tmc)             estado = 'C';
                    else if (temp >= tmc * 0.85) estado = 'A';
                    else                         estado = 'B';
                } else {
                    limInfo = `T = ${temp}°C | <span style="color:var(--text-muted);">Ingresa corriente medida para calcular T<sub>max_corr</sub></span>`;
                }
            }

            const label = fases.length > 1 ? `<b>F${i+1}:</b> ` : '';
            return `<div class="tml-prev-row">
                ${label}${limInfo} — ${sevBadge(estado)}
            </div>`;
        }).join('');

        const estadoGlobal = calcularEstadoLocal(comp, tempAmb, fases);
        prev.innerHTML = `<div class="tml-prev-wrap">
            ${rows}
            <div class="tml-prev-global">Estado del componente: ${sevBadge(estadoGlobal)}</div>
        </div>`;
    }

    async function saveLectura() {
        const modal   = document.getElementById('termo-modal-lectura');
        const compId  = parseInt(modal?.dataset.compId);
        const comp    = componentes.find(c => c.id === compId);
        if (!comp) return;

        const fecha      = modal.querySelector('#tml-fecha')?.value;
        const tempAmb    = parseFloat(modal.querySelector('#tml-temp-amb')?.value);
        const emisividad = parseFloat(modal.querySelector('#tml-emisividad')?.value) || null;
        const distancia  = parseFloat(modal.querySelector('#tml-distancia')?.value) || null;
        const numImgIR   = modal.querySelector('#tml-img-ir')?.value?.trim() || null;
        const numImgVis  = modal.querySelector('#tml-img-vis')?.value?.trim() || null;
        const notas      = modal.querySelector('#tml-notas')?.value?.trim() || null;
        const fases      = collectFases();

        if (!fecha)         { toast('Ingresa la fecha.', 'error'); return; }
        if (isNaN(tempAmb)) { toast('Ingresa la temperatura ambiente.', 'error'); return; }
        if (!fases.some(f => f.temperatura !== '')) { toast('Ingresa al menos una temperatura.', 'error'); return; }

        const body = { componente_id: compId, asset_id: currentEquipo.asset_id,
                       fecha_medicion: fecha, temp_ambiente: tempAmb, fases,
                       emisividad, distancia, num_img_ir: numImgIR, num_img_vis: numImgVis, notas };
        const url    = editingLecId ? `/api/termo/lecturas/${editingLecId}` : '/api/termo/lecturas';
        const method = editingLecId ? 'PUT' : 'POST';

        const res = await apiFetch(url, { method, body: JSON.stringify(body) });
        if (res?.ok) {
            toast(editingLecId ? '✅ Lectura actualizada.' : '✅ Lectura guardada.', 'success');
            modal.style.display = 'none';
            await loadLecturas(currentEquipo.asset_id);
            refreshTreeEstado();
        } else {
            toast('Error al guardar lectura.', 'error');
        }
    }

    // ══════════════════════════════════════════════════════════
    // MODAL TABLA LECTURAS POR COMPONENTE
    // ══════════════════════════════════════════════════════════
    function openTablaLecturas(compId) {
        const comp = componentes.find(c => c.id === compId);
        if (!comp) return;
        const lecsComp = lecturas.filter(l => l.componente_id === compId);

        const modal = document.getElementById('termo-modal-tabla-lec');
        if (!modal) return;
        modal.querySelector('#tmtl-titulo').textContent = `Lecturas — ${comp.nombre}`;

        const tbody = modal.querySelector('#tmtl-tbody');
        if (!lecsComp.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--text-muted);">Sin lecturas</td></tr>`;
        } else {
            const nFases2 = parseInt(comp.num_fases) || 1;
            const fLabels2 = nFases2 === 3 ? ['R','S','T'] : nFases2 === 2 ? ['L1','L2'] : [''];
            tbody.innerHTML = lecsComp.sort((a,b) => b.fecha_medicion > a.fecha_medicion ? 1 : -1).map(l => {
                const fasesStr = (l.fases || []).map((f, i) => {
                    const lbl = fLabels2[i] || `F${i+1}`;
                    const dt  = +(parseFloat(f.temperatura) - parseFloat(l.temp_ambiente)).toFixed(1);
                    return `${nFases2 > 1 ? `<b>${lbl}</b>: ` : ''}${f.temperatura}°C${f.corriente ? '/'+f.corriente+'A' : ''} <small style="color:var(--text-muted);">(ΔT ${dt}°C)</small>`;
                }).join('<br>');
                const imgs = [l.num_img_ir ? `IR: ${l.num_img_ir}` : '', l.num_img_vis ? `Vis: ${l.num_img_vis}` : ''].filter(Boolean).join(' · ');
                const meta = [l.emisividad ? `ε=${l.emisividad}` : '', l.distancia ? `${l.distancia}m` : ''].filter(Boolean).join(' · ');
                return `<tr>
                    <td style="white-space:nowrap;">${fmtFecha(l.fecha_medicion)}</td>
                    <td>${l.temp_ambiente}°C${meta ? `<br><small style="color:var(--text-muted);">${meta}</small>` : ''}</td>
                    <td style="font-size:.85em;">${fasesStr || '—'}</td>
                    <td>${sevBadge(l.estado)}</td>
                    <td style="font-size:.82em;">${imgs ? `<span style="color:var(--primary);font-size:.9em;">${imgs}</span><br>` : ''}<span style="color:var(--text-muted);">${l.notas || ''}</span></td>
                    <td class="no-print" style="white-space:nowrap;">
                        <button class="termo-btn-icon btl-edit" data-id="${l.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
                        <button class="termo-btn-icon btl-del" data-id="${l.id}" title="Eliminar" style="color:var(--danger);"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>`;
            }).join('');

            tbody.querySelectorAll('.btl-edit').forEach(btn => {
                btn.addEventListener('click', () => {
                    modal.style.display = 'none';
                    editLectura(parseInt(btn.dataset.id));
                });
            });
            tbody.querySelectorAll('.btl-del').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await deleteLectura(parseInt(btn.dataset.id));
                    openTablaLecturas(compId); // refrescar
                });
            });
        }
        modal.style.display = 'flex';
    }

    // ══════════════════════════════════════════════════════════
    // REFRESCAR ESTADO EN ÁRBOL
    // ══════════════════════════════════════════════════════════
    async function refreshTreeEstado() {
        try {
            const res = await apiFetch('/api/equipos');
            if (!res?.ok) return;
            allEquipos = (await res.json()).filter(e => e.aplica_termografia);
            renderTree(allEquipos);
            if (currentEquipo) {
                const eq = allEquipos.find(e => e.asset_id === currentEquipo.asset_id);
                if (eq) {
                    currentEquipo = eq;
                    const semaforo = document.getElementById('termo-ficha-semaforo');
                    if (semaforo) {
                        const s = eq.ultimo_estado_termografia;
                        semaforo.className = `cond-semaforo-dot${s ? ' sema-' + s : ' sema-null'}`;
                    }
                }
            }
        } catch {}
    }

    // ══════════════════════════════════════════════════════════
    // INIT — sólo cuando la pestaña termografía está activa
    // ══════════════════════════════════════════════════════════
    window.termoCondicionInit = async function () {
        await loadEquipos();

        // Botón añadir componente
        document.getElementById('termo-btn-add-comp')?.addEventListener('click', () => {
            if (!currentEquipo) { toast('Selecciona un equipo primero.', 'error'); return; }
            openCompModal(null);
        });

        // Modal componente — eventos internos
        const mc = document.getElementById('termo-modal-comp');
        if (mc) {
            mc.querySelector('#tmc-criterio')?.addEventListener('change', updateCompModalCriterio);
            mc.querySelector('#tmc-tipo')?.addEventListener('change', () => {
                mc.querySelector('#tmc-temp-max').value       = '';
                mc.querySelector('#tmc-temp-rise').value      = '';
                mc.querySelector('#tmc-temp-amb-rated').value = '';
                updateCompModalTipo();
            });
            mc.querySelector('#tmc-fases')?.addEventListener('change', updateFasesNomShow);
            mc.querySelector('#tmc-norma-dt')?.addEventListener('change', () => {
                const norma = mc.querySelector('#tmc-norma-dt')?.value;
                const preset = NORMA_DT[norma];
                if (preset && preset.alerta != null) {
                    mc.querySelector('#tmc-dt-alerta').value = preset.alerta;
                    mc.querySelector('#tmc-dt-alarma').value = preset.alarma;
                    toast(`✅ Límites ${preset.desc} aplicados.`, 'success');
                }
            });
            mc.querySelector('#tmc-btn-save')?.addEventListener('click', saveComp);
            mc.querySelectorAll('#tmc-btn-cancel, #tmc-btn-close-x').forEach(b => b.addEventListener('click', () => mc.style.display = 'none'));
            mc.addEventListener('click', e => { if (e.target === mc) mc.style.display = 'none'; });
        }

        // Modal lectura — eventos internos
        const ml = document.getElementById('termo-modal-lectura');
        if (ml) {
            ml.querySelector('#tml-btn-save')?.addEventListener('click', saveLectura);
            ml.querySelectorAll('#tml-btn-cancel, #tml-btn-close-x').forEach(b => b.addEventListener('click', () => ml.style.display = 'none'));
            ml.addEventListener('click', e => { if (e.target === ml) ml.style.display = 'none'; });
        }

        // Modal tabla lecturas
        const mtl = document.getElementById('termo-modal-tabla-lec');
        if (mtl) {
            mtl.querySelector('#tmtl-btn-close')?.addEventListener('click', () => mtl.style.display = 'none');
            mtl.addEventListener('click', e => { if (e.target === mtl) mtl.style.display = 'none'; });
        }
    };


    // ════════════════════════════════════════════════════════════
    // GRÁFICO DE TENDENCIA — TERMOGRAFÍA
    // ════════════════════════════════════════════════════════════
    let termoChartInstance = null;

    async function loadTermoChart() {
        if (!currentEquipo || !lecturas.length) return;
        if (typeof Chart === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
            });
        }

        const container = document.getElementById('termo-chart-container');
        if (!container) return;

        // Agrupar lecturas por componente
        const COLORS = ['#dc2626','#2563eb','#16a34a','#d97706','#7c3aed','#0891b2'];
        const datasets = [];

        componentes.forEach((comp, ci) => {
            const lecsComp = lecturas.filter(l => l.componente_id === comp.id)
                .sort((a,b) => a.fecha_medicion > b.fecha_medicion ? 1 : -1);
            if (!lecsComp.length) return;
            const fases = JSON.parse(lecsComp[0].fases || '[]');
            const nFases = Math.max(fases.length, 1);

            for (let fi = 0; fi < nFases; fi++) {
                const labels2 = ['R','S','T'];
                const label = nFases > 1 ? `${comp.nombre} — F${labels2[fi]||fi+1}` : comp.nombre;
                datasets.push({
                    label,
                    data: lecsComp.map(l => {
                        const f = JSON.parse(l.fases || '[]')[fi];
                        return f ? parseFloat(f.temperatura) : null;
                    }),
                    borderColor: COLORS[(ci * nFases + fi) % COLORS.length],
                    backgroundColor: COLORS[(ci * nFases + fi) % COLORS.length] + '22',
                    borderWidth: 2, pointRadius: 3, tension: 0.3, spanGaps: true,
                });
            }
        });

        // Etiquetas de fechas (unión de todas)
        const todasFechas = [...new Set(lecturas.map(l => String(l.fecha_medicion).split('T')[0]))].sort();
        const M = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        const labels = todasFechas.map(f => {
            const [y,m,d] = f.split('-');
            return `${d}-${M[+m-1]}-${String(y).slice(-2)}`;
        });

        // Reagrupar datos por fechas comunes
        datasets.forEach(ds => {
            const comp = componentes.find(c => ds.label.startsWith(c.nombre));
            if (!comp) return;
            const lecsComp = lecturas.filter(l => l.componente_id === comp.id)
                .sort((a,b) => a.fecha_medicion > b.fecha_medicion ? 1 : -1);
            const mapaFecha = {};
            lecsComp.forEach(l => {
                const fecha = String(l.fecha_medicion).split('T')[0];
                mapaFecha[fecha] = l;
            });
            const fiIdx = ds.label.includes('— F') ? ['R','S','T'].indexOf(ds.label.slice(-1)) : 0;
            ds.data = todasFechas.map(f => {
                const l = mapaFecha[f];
                if (!l) return null;
                const fa = JSON.parse(l.fases || '[]')[fiIdx >= 0 ? fiIdx : 0];
                return fa ? parseFloat(fa.temperatura) : null;
            });
        });

        container.style.display = '';
        if (termoChartInstance) { termoChartInstance.destroy(); termoChartInstance = null; }
        const canvas = document.getElementById('termo-tendencia-chart');
        if (!canvas) return;

        // Cargar tendencia
        let trendText = '';
        try {
            const tr = await apiFetch(`/api/termo/tendencia/${currentEquipo.asset_id}`);
            if (tr?.ok) {
                const data = await tr.json();
                const partes = Object.values(data).filter(t => t.suficiente).map(t => {
                    const iconos = { estable: '→', creciente: '↗', creciente_rapido: '⚠ ↑↑', descendente: '↘' };
                    return `${t.comp_nombre}: ${iconos[t.clasificacion]} ${t.slope_mes >= 0 ? '+' : ''}${t.slope_mes}°C/mes`;
                });
                trendText = partes.join('  |  ');
            }
        } catch {}

        const banner = document.getElementById('termo-chart-banner');
        if (banner) { banner.textContent = trendText; banner.style.display = trendText ? '' : 'none'; }

        termoChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
                scales: {
                    x: { ticks: { maxTicksLimit: 12, font: { size: 10 } } },
                    y: { title: { display: true, text: '°C', font: { size: 11 } } }
                }
            }
        });
    }

    // ════════════════════════════════════════════════════════════
    // GAP DE INSPECCIÓN — TERMOGRAFÍA
    // ════════════════════════════════════════════════════════════
    async function loadTermoGap() {
        if (!currentEquipo) return;
        try {
            const res = await apiFetch(`/api/condicion/gap/${currentEquipo.asset_id}`);
            if (!res?.ok) return;
            const gap = (await res.json()).termografia;
            const banner = document.getElementById('termo-gap-banner');
            if (!banner) return;
            if (!gap || gap.nivel === 'ok') { banner.style.display = 'none'; return; }
            const colores = { atrasado: '#fef3c7', critico: '#fee2e2' };
            const texts   = { atrasado: '#92400e', critico: '#991b1b' };
            banner.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 14px;
                border-radius:8px;margin-bottom:10px;font-size:.84em;font-weight:600;
                background:${colores[gap.nivel]};color:${texts[gap.nivel]};`;
            banner.innerHTML = `<span>${gap.nivel==='critico'?'🚨':'⚠'}</span>
                <span>${gap.dias} días sin medición termográfica — Última: ${gap.ultima || 'nunca'}</span>`;
        } catch {}
    }

    // ════════════════════════════════════════════════════════════
    // EXPORTAR EXCEL — TERMOGRAFÍA
    // ════════════════════════════════════════════════════════════
    async function exportarExcelTermo() {
        if (!currentEquipo || !lecturas.length) { toast('No hay datos para exportar.', 'info'); return; }
        if (typeof XLSX === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
            });
        }
        const wb  = XLSX.utils.book_new();
        const eq  = currentEquipo;
        const M   = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        const fmtF = s => { const [y,m,d] = String(s).split('T')[0].split('-'); return `${d}-${M[+m-1]}-${y.slice(-2)}`; };

        // Hoja por componente
        componentes.forEach(comp => {
            const lecsComp = lecturas.filter(l => l.componente_id === comp.id)
                .sort((a,b) => a.fecha_medicion > b.fecha_medicion ? 1 : -1);
            const nFases = parseInt(comp.num_fases) || 1;
            const fLabels = nFases === 3 ? ['R','S','T'] : nFases === 2 ? ['L1','L2'] : [''];
            const hdrs = ['Fecha','T. Amb (°C)', 'ε', 'Distancia (m)',
                ...fLabels.flatMap(f => [`T ${f} (°C)`, `I ${f} (A)`, `ΔT ${f}`]),
                'Estado','No. IR','No. Visual','Notas'];
            const rows = [
                [`Termografía — ${comp.nombre} — ${comp.tipo_componente}`],
                [`Equipo: ${eq.asset_id}  ${eq.descripcion || ''}  |  Criterio: ${comp.criterio}`],
                [], hdrs
            ];
            lecsComp.forEach(l => {
                const fases = JSON.parse(l.fases || '[]');
                const tamb = parseFloat(l.temp_ambiente);
                const row = [fmtF(l.fecha_medicion), l.temp_ambiente, l.emisividad ?? '', l.distancia ?? ''];
                fases.forEach((f, fi) => {
                    const t = parseFloat(f.temperatura);
                    row.push(f.temperatura ?? '');
                    row.push(f.corriente ?? '');
                    row.push(!isNaN(t) && !isNaN(tamb) ? +(t - tamb).toFixed(1) : '');
                });
                row.push({B:'Bueno',A:'Alerta',C:'Alarma'}[l.estado] || '');
                row.push(l.num_img_ir || ''); row.push(l.num_img_vis || ''); row.push(l.notas || '');
                rows.push(row);
            });
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = hdrs.map(() => ({ wch: 14 }));
            XLSX.utils.book_append_sheet(wb, ws, comp.nombre.slice(0, 31));
        });

        XLSX.writeFile(wb, `Termografia_${eq.asset_id}_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast(`✅ Excel termografía exportado.`, 'success');
    }

})();
