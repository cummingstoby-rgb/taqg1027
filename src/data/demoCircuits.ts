import { getSymbolDef } from './symbolCatalog';
import {
  COMPONENT_HALF_SPAN,
  L1_X,
  L2_X,
  Project,
  SchematicComponent,
  SchematicSheet,
  SymbolType,
  WireSegment,
} from '../types/ecad';
import { autoNumberProjectWires } from '../engines/netlistEngine';
import { getRungY } from '../engines/schematicEngine';

function comp(
  id: string,
  type: SymbolType,
  x: number,
  rung: number,
  tag: string,
  overrides: Partial<SchematicComponent> = {}
): SchematicComponent {
  const def = getSymbolDef(type);
  return {
    id,
    type,
    x,
    y: getRungY(rung),
    tag,
    description: overrides.description ?? def.defaultDescription,
    manufacturer: overrides.manufacturer ?? def.defaultManufacturer,
    partNumber: overrides.partNumber ?? def.defaultPartNumber,
    parentTag: overrides.parentTag,
    timerPreset: overrides.timerPreset ?? def.defaultTimerPreset,
    pilotColor: overrides.pilotColor ?? def.defaultColor,
    terminalStrip: overrides.terminalStrip,
    terminalNumber: overrides.terminalNumber,
    plcAddress: overrides.plcAddress,
    vfdParam: overrides.vfdParam,
  };
}

function wire(id: string, x1: number, y1: number, x2: number, y2: number): WireSegment {
  return { id, x1, y1, x2, y2 };
}

function wireRungSeries(
  prefix: string,
  rung: number,
  xs: number[]
): WireSegment[] {
  const y = getRungY(rung);
  const sorted = [...xs].sort((a, b) => a - b);
  const segs: WireSegment[] = [];
  let cursor = L1_X;
  let idx = 1;
  for (const cx of sorted) {
    const lx = cx - COMPONENT_HALF_SPAN;
    if (lx > cursor) {
      segs.push(wire(`${prefix}_${idx++}`, cursor, y, lx, y));
    }
    cursor = cx + COMPONENT_HALF_SPAN;
  }
  if (L2_X > cursor) {
    segs.push(wire(`${prefix}_${idx++}`, cursor, y, L2_X, y));
  }
  return segs;
}

/**
 * Pre-Loaded Demo Circuit:
 * 3-Wire Start/Stop Motor Control Circuit
 * - Rung 01: E-Stop (ES1 NC) -> Stop PB (PB1 NC) -> TB1-1 -> Start PB (PB2 NO) -> Motor Starter Coil (M1) -> Overload (OL1 NC)
 * - Rung 02: Seal-in contact (M1 NO) wired in parallel around Start PB (PB2)
 * - Rung 03: Run Pilot Light (PL1 Green) controlled by M1 (NO) through TB1-2
 * - Rung 04: On-Delay Timer (TR1, 3.0s) energized by M1 (NO)
 * - Rung 05: Timed Contact (TR1 NO) energizing Auxiliary Relay (CR1)
 * - Rung 06: Parallel branch from TR1 (NO) energizing Warning Light (PL2 Amber) through TB1-3
 */
export function createDefaultDemoProject(): Project {
  const r1Y = getRungY(1);
  const r2Y = getRungY(2);
  const r5Y = getRungY(5);
  const r6Y = getRungY(6);

  const components: SchematicComponent[] = [
    // Rung 01
    comp('c_es1', 'estop_nc', 160, 1, 'ES1', {
      description: 'Emergency Stop (NC)',
      plcAddress: '%IX0.0',
    }),
    comp('c_pb1', 'pb_nc', 280, 1, 'PB1', {
      description: 'Stop Push Button (NC)',
      plcAddress: '%IX0.1',
    }),
    comp('c_tb1_1', 'terminal', 380, 1, 'TB1-1', {
      terminalStrip: 'TB1',
      terminalNumber: '1',
      description: 'Start/Stop Station Common',
    }),
    comp('c_pb2', 'pb_no', 500, 1, 'PB2', {
      description: 'Start Push Button (NO)',
      plcAddress: '%IX0.2',
    }),
    comp('c_m1', 'coil_motor', 680, 1, 'M1', {
      description: 'Main Motor Starter Coil',
      plcAddress: '%QX0.0',
    }),
    comp('c_ol1', 'overload_nc', 800, 1, 'OL1', {
      description: 'Motor Thermal Overload (NC)',
      plcAddress: '%IX0.3',
    }),

    // Rung 02 (Seal-in parallel around Start PB PB2 at x=500)
    comp('c_m1_seal', 'contact_no', 500, 2, 'M1', {
      parentTag: 'M1',
      description: 'M1 Seal-In Holding Contact',
    }),

    // Rung 03 (Run Pilot Light PL1 Green controlled by M1 NO)
    comp('c_m1_pl1', 'contact_no', 240, 3, 'M1', {
      parentTag: 'M1',
      description: 'Motor Running Aux Contact',
    }),
    comp('c_tb1_2', 'terminal', 460, 3, 'TB1-2', {
      terminalStrip: 'TB1',
      terminalNumber: '2',
      description: 'Run Pilot Lamp Field Wire',
    }),
    comp('c_pl1', 'pilot_light', 680, 3, 'PL1', {
      pilotColor: 'green',
      description: 'Motor Run Pilot Light (Green)',
      partNumber: '800F-P3G',
      plcAddress: '%QX0.1',
    }),

    // Rung 04 (On-Delay Timer TR1 3.0s energized by M1 NO)
    comp('c_m1_tr1', 'contact_no', 240, 4, 'M1', {
      parentTag: 'M1',
      description: 'Timer Start Interlock',
    }),
    comp('c_tr1', 'coil_ton', 680, 4, 'TR1', {
      timerPreset: 3.0,
      description: 'Aux Delay Timer (TON 3.0s)',
    }),

    // Rung 05 (TR1 Timed NO triggers Auxiliary Relay CR1)
    comp('c_tr1_no', 'timer_contact_no', 240, 5, 'TR1', {
      parentTag: 'TR1',
      description: 'TR1 Timed Closing Contact',
    }),
    comp('c_cr1', 'coil_relay', 680, 5, 'CR1', {
      description: 'Auxiliary Sequence Relay',
    }),

    // Rung 06 (Parallel branch from TR1 Timed NO drives Warning Light PL2)
    comp('c_tb1_3', 'terminal', 460, 6, 'TB1-3', {
      terminalStrip: 'TB1',
      terminalNumber: '3',
      description: 'Warning Lamp Field Wire',
    }),
    comp('c_pl2', 'pilot_light', 680, 6, 'PL2', {
      pilotColor: 'amber',
      description: 'Aux Warning Light (Amber)',
      partNumber: '800F-P5A',
      plcAddress: '%QX0.2',
    }),
  ];

  // Build clean split wires so every T-junction shares an exact vertex
  const wires: WireSegment[] = [
    // Rung 01 with explicit branch nodes at x=440 (between TB1-1@380 and PB2@500) and x=580 (between PB2@500 and M1@680)
    wire('w_r1_1', L1_X, r1Y, 140, r1Y),
    wire('w_r1_2', 180, r1Y, 260, r1Y),
    wire('w_r1_3', 300, r1Y, 360, r1Y),
    wire('w_r1_4', 400, r1Y, 440, r1Y),
    wire('w_r1_5', 440, r1Y, 480, r1Y),
    wire('w_r1_6', 520, r1Y, 580, r1Y),
    wire('w_r1_7', 580, r1Y, 660, r1Y),
    wire('w_r1_8', 700, r1Y, 780, r1Y),
    wire('w_r1_9', 820, r1Y, L2_X, r1Y),

    // Rung 02 seal-in parallel branch around PB2
    wire('w_r2_drop_l', 440, r1Y, 440, r2Y),
    wire('w_r2_left', 440, r2Y, 480, r2Y),
    wire('w_r2_right', 520, r2Y, 580, r2Y),
    wire('w_r2_drop_r', 580, r1Y, 580, r2Y),

    // Rung 03
    ...wireRungSeries('w_r3', 3, [240, 460, 680]),

    // Rung 04
    ...wireRungSeries('w_r4', 4, [240, 680]),

    // Rung 05 with T-junction at x=340 feeding parallel Rung 06 Warning Light PL2
    wire('w_r5_1', L1_X, r5Y, 220, r5Y),
    wire('w_r5_2', 260, r5Y, 340, r5Y),
    wire('w_r5_3', 340, r5Y, 660, r5Y),
    wire('w_r5_4', 700, r5Y, L2_X, r5Y),

    // Rung 06 parallel branch for Warning Light PL2
    wire('w_r6_drop', 340, r5Y, 340, r6Y),
    wire('w_r6_1', 340, r6Y, 440, r6Y),
    wire('w_r6_2', 480, r6Y, 660, r6Y),
    wire('w_r6_3', 700, r6Y, L2_X, r6Y),
  ];

  const sheet1: SchematicSheet = {
    id: 'sheet_1',
    number: 1,
    name: '3-Wire Motor Control',
    voltageLabel: '120VAC 60Hz',
    l1Label: 'L1',
    l2Label: 'L2',
    rungCount: 6,
    components,
    wires,
  };

  return autoNumberProjectWires({
    id: 'proj_demo_motor_3wire',
    metadata: {
      title: '3-Wire Start/Stop Motor Control',
      projectNumber: 'VG-2026-001',
      revision: 'A',
      author: 'Controls Engineering',
      standard: 'JIC / NFPA 79',
      description:
        'Standard 3-wire motor starter with seal-in holding circuit, overload protection, green run indicator, and 3.0s on-delay auxiliary sequence.',
    },
    sheets: [sheet1],
    activeSheetId: 'sheet_1',
  });
}

/**
 * Template 2: Industrial VFD 3-Wire Run / Reverse / Fault Control (Multi-Sheet)
 */
export function createVfdControlTemplate(): Project {
  const r1Y = getRungY(1);
  const r2Y = getRungY(2);

  const sheet1: SchematicSheet = {
    id: 'vfd_s1',
    number: 1,
    name: 'VFD 3-Wire Run & Interlock',
    voltageLabel: '24VDC',
    l1Label: '+24V',
    l2Label: '0V',
    rungCount: 5,
    components: [
      comp('v_fu1', 'fuse', 160, 1, 'FU1', { description: '24VDC Control Fuse 2A' }),
      comp('v_es1', 'estop_nc', 260, 1, 'ES1', { description: 'Safe Torque Off E-Stop', plcAddress: '%IX0.0' }),
      comp('v_pb1', 'pb_nc', 380, 1, 'PB1', { description: 'VFD Stop PB (NC)', plcAddress: '%IX0.1' }),
      comp('v_pb2', 'pb_no', 500, 1, 'PB2', { description: 'VFD Start PB (NO)', plcAddress: '%IX0.2' }),
      comp('v_cr1', 'coil_relay', 680, 1, 'CR1', { description: 'VFD Run Command Relay' }),
      comp('v_ol1', 'overload_nc', 800, 1, 'OL1', { description: 'VFD Fault Relay R1A-R1C (NC)', plcAddress: '%IX0.3' }),

      comp('v_cr1_seal', 'contact_no', 500, 2, 'CR1', { parentTag: 'CR1', description: 'VFD Run Seal-In' }),

      comp('v_cr1_di1', 'contact_no', 240, 3, 'CR1', { parentTag: 'CR1', description: 'Drive Run Interlock' }),
      comp('v_tb1_1', 'terminal', 460, 3, 'TB1-1', { terminalStrip: 'TB1', terminalNumber: '1', description: 'VFD Terminal DI1' }),
      comp('v_di1', 'vfd_cmd', 700, 3, 'VFD1', {
        description: 'PowerFlex 525 Start (DI1)',
        manufacturer: 'Allen-Bradley',
        partNumber: '25B-D4P0N104',
        vfdParam: 'DI1-RUN (P046=2)',
        plcAddress: '%QX0.0',
      }),

      comp('v_cr1_di2', 'contact_no', 240, 4, 'CR1', { parentTag: 'CR1', description: 'Run Active Permissive' }),
      comp('v_ss1', 'selector_no', 380, 4, 'SS1', { description: 'FWD / REV Selector Switch', plcAddress: '%IX0.4' }),
      comp('v_tb1_2', 'terminal', 540, 4, 'TB1-2', { terminalStrip: 'TB1', terminalNumber: '2', description: 'VFD Terminal DI2' }),
      comp('v_di2', 'vfd_cmd', 700, 4, 'VFD2', {
        description: 'PowerFlex 525 Reverse (DI2)',
        manufacturer: 'Allen-Bradley',
        partNumber: '25B-D4P0N104',
        vfdParam: 'DI2-REV (P062=7)',
        plcAddress: '%QX0.1',
      }),

      comp('v_cr1_pl', 'contact_no', 240, 5, 'CR1', { parentTag: 'CR1', description: 'Drive Running Aux' }),
      comp('v_pl1', 'pilot_light', 700, 5, 'PL1', { pilotColor: 'green', description: 'VFD Running Lamp (Green)' }),
    ],
    wires: [
      wire('vw1', L1_X, r1Y, 140, r1Y),
      wire('vw2', 180, r1Y, 240, r1Y),
      wire('vw3', 280, r1Y, 360, r1Y),
      wire('vw4', 400, r1Y, 440, r1Y),
      wire('vw5', 440, r1Y, 480, r1Y),
      wire('vw6', 520, r1Y, 580, r1Y),
      wire('vw7', 580, r1Y, 660, r1Y),
      wire('vw8', 700, r1Y, 780, r1Y),
      wire('vw9', 820, r1Y, L2_X, r1Y),
      wire('vw_s1', 440, r1Y, 440, r2Y),
      wire('vw_s2', 440, r2Y, 480, r2Y),
      wire('vw_s3', 520, r2Y, 580, r2Y),
      wire('vw_s4', 580, r1Y, 580, r2Y),
      ...wireRungSeries('vw_r3', 3, [240, 460, 700]),
      ...wireRungSeries('vw_r4', 4, [240, 380, 540, 700]),
      ...wireRungSeries('vw_r5', 5, [240, 700]),
    ],
  };

  const sheet2: SchematicSheet = {
    id: 'vfd_s2',
    number: 2,
    name: 'VFD Fault & Cooling Timer',
    voltageLabel: '24VDC',
    l1Label: '+24V',
    l2Label: '0V',
    rungCount: 3,
    components: [
      comp('v2_c1', 'contact_no', 240, 1, 'CR1', { parentTag: 'CR1', description: 'VFD Run Signal' }),
      comp('v2_tr1', 'coil_tof', 680, 1, 'TR1', { timerPreset: 4.0, description: 'Cabinet Cooling Off-Delay (4.0s)' }),

      comp('v2_tno', 'timer_contact_no', 240, 2, 'TR1', { parentTag: 'TR1', description: 'Cooling Fan Timed Contact' }),
      comp('v2_tb2_1', 'terminal', 460, 2, 'TB2-1', { terminalStrip: 'TB2', terminalNumber: '1', description: 'Cooling Fan Output Terminal' }),
      comp('v2_fan', 'coil_motor', 680, 2, 'M2', { description: 'VFD Enclosure Cooling Fan', plcAddress: '%QX0.2' }),

      comp('v2_c2', 'contact_nc', 240, 3, 'CR1', { parentTag: 'CR1', description: 'Drive Stopped Indicator' }),
      comp('v2_pl2', 'pilot_light', 680, 3, 'PL2', { pilotColor: 'amber', description: 'VFD Standby / Stopped Lamp' }),
    ],
    wires: [
      ...wireRungSeries('vw2_r1', 1, [240, 680]),
      ...wireRungSeries('vw2_r2', 2, [240, 460, 680]),
      ...wireRungSeries('vw2_r3', 3, [240, 680]),
    ],
  };

  return autoNumberProjectWires({
    id: 'tpl_vfd_3wire_control',
    metadata: {
      title: 'VFD 3-Wire Run, Direction & Cooling Control',
      projectNumber: 'VG-VFD-102',
      revision: 'B',
      author: 'Drive Systems Engineering',
      standard: 'JIC / NFPA 79',
      description:
        'Industrial PowerFlex / Altivar VFD 3-wire start/stop with FWD/REV direction select, fault trip interlock, and 4.0s off-delay cabinet cooling.',
    },
    sheets: [sheet1, sheet2],
    activeSheetId: 'vfd_s1',
  });
}

/**
 * Template 3: PLC Digital I/O & VFD Integration (Siemens S7-1200 / CompactLogix)
 */
export function createPlcVfdIoTemplate(): Project {
  const sheet1: SchematicSheet = {
    id: 'plc_s1',
    number: 1,
    name: 'PLC 24VDC Inputs (%IX0.0–0.3)',
    voltageLabel: '24VDC',
    l1Label: '+24V',
    l2Label: '0V',
    rungCount: 4,
    components: [
      comp('p_cb1', 'breaker', 160, 1, 'CB1', { description: '24VDC PLC I/O Breaker 6A' }),
      comp('p_es1', 'estop_nc', 300, 1, 'ES1', { description: 'Master E-Stop NC' }),
      comp('p_tb1', 'terminal', 480, 1, 'TB1-1', { terminalStrip: 'TB1', terminalNumber: '1', description: 'Field E-Stop Input' }),
      comp('p_di0', 'plc_in', 720, 1, 'DI0', { description: 'PLC Input: E-Stop Healthy', plcAddress: '%IX0.0' }),

      comp('p_pb1', 'pb_no', 300, 2, 'PB1', { description: 'Auto Cycle Start PB' }),
      comp('p_tb2', 'terminal', 480, 2, 'TB1-2', { terminalStrip: 'TB1', terminalNumber: '2', description: 'Field Start Input' }),
      comp('p_di1', 'plc_in', 720, 2, 'DI1', { description: 'PLC Input: Auto Start', plcAddress: '%IX0.1' }),

      comp('p_ss1', 'selector_no', 300, 3, 'SS1', { description: 'Auto / Manual Selector' }),
      comp('p_tb3', 'terminal', 480, 3, 'TB1-3', { terminalStrip: 'TB1', terminalNumber: '3', description: 'Mode Select Input' }),
      comp('p_di2', 'plc_in', 720, 3, 'DI2', { description: 'PLC Input: Auto Mode', plcAddress: '%IX0.2' }),

      comp('p_ol1', 'overload_nc', 300, 4, 'OL1', { description: 'VFD Ready / No Fault NC' }),
      comp('p_tb4', 'terminal', 480, 4, 'TB1-4', { terminalStrip: 'TB1', terminalNumber: '4', description: 'VFD Status Input' }),
      comp('p_di3', 'plc_in', 720, 4, 'DI3', { description: 'PLC Input: VFD Healthy', plcAddress: '%IX0.3' }),
    ],
    wires: [
      ...wireRungSeries('pw1', 1, [160, 300, 480, 720]),
      ...wireRungSeries('pw2', 2, [300, 480, 720]),
      ...wireRungSeries('pw3', 3, [300, 480, 720]),
      ...wireRungSeries('pw4', 4, [300, 480, 720]),
    ],
  };

  const sheet2: SchematicSheet = {
    id: 'plc_s2',
    number: 2,
    name: 'PLC Outputs (%QX0.0–0.2) & VFD',
    voltageLabel: '24VDC',
    l1Label: '+24V',
    l2Label: '0V',
    rungCount: 4,
    components: [
      comp('p2_do0', 'plc_out', 240, 1, 'DO0', { description: 'PLC Out %QX0.0 (VFD Run)', plcAddress: '%QX0.0' }),
      comp('p2_tb1', 'terminal', 460, 1, 'TB2-1', { terminalStrip: 'TB2', terminalNumber: '1', description: 'VFD DI1 Terminal' }),
      comp('p2_cr1', 'coil_relay', 700, 1, 'CR1', { description: 'VFD Interface Interposing Relay' }),

      comp('p2_cr1_no', 'contact_no', 240, 2, 'CR1', { parentTag: 'CR1', description: 'Isolated VFD Run Contact' }),
      comp('p2_vfd', 'vfd_cmd', 700, 2, 'VFD1', {
        description: 'SINAMICS G120 Run Cmd (DI0)',
        manufacturer: 'Siemens',
        partNumber: '6SL3210-1PE18-0AL1',
        vfdParam: 'DI0-ON/OFF1',
      }),

      comp('p2_do1', 'plc_out', 240, 3, 'DO1', { description: 'PLC Out %QX0.1 (Conveyor)', plcAddress: '%QX0.1' }),
      comp('p2_m1', 'coil_motor', 700, 3, 'M1', { description: 'Infeed Conveyor Starter' }),

      comp('p2_m1_no', 'contact_no', 240, 4, 'M1', { parentTag: 'M1', description: 'Conveyor Running Aux' }),
      comp('p2_pl1', 'pilot_light', 700, 4, 'PL1', { pilotColor: 'green', description: 'Line Running Indicator' }),
    ],
    wires: [
      ...wireRungSeries('pw2_1', 1, [240, 460, 700]),
      ...wireRungSeries('pw2_2', 2, [240, 700]),
      ...wireRungSeries('pw2_3', 3, [240, 700]),
      ...wireRungSeries('pw2_4', 4, [240, 700]),
    ],
  };

  return autoNumberProjectWires({
    id: 'tpl_plc_vfd_io',
    metadata: {
      title: 'PLC Digital I/O & VFD Interface',
      projectNumber: 'VG-PLC-204',
      revision: 'A',
      author: 'Automation Controls',
      standard: 'IEC 60617',
      description:
        'Complete 24VDC PLC Digital Input (%IX0.0–0.3) and Output (%QX0.0–0.1) schematic interfacing with a SINAMICS/PowerFlex VFD and conveyor starter.',
    },
    sheets: [sheet1, sheet2],
    activeSheetId: 'plc_s1',
  });
}

/**
 * Template 4: Forward / Reverse Motor Starter with Cross-Interlocking
 */
export function createForwardReverseTemplate(): Project {
  const r1Y = getRungY(1);
  const r2Y = getRungY(2);
  const r3Y = getRungY(3);
  const r4Y = getRungY(4);

  const sheet1: SchematicSheet = {
    id: 'fr_s1',
    number: 1,
    name: 'Forward / Reverse Interlock',
    voltageLabel: '120VAC 60Hz',
    l1Label: 'L1',
    l2Label: 'L2',
    rungCount: 6,
    components: [
      // Rung 01: Stop -> FWD PB -> REV NC Interlock -> FWD Coil -> OL
      comp('fr_stop', 'pb_nc', 180, 1, 'PB1', { description: 'Stop Push Button (NC)' }),
      comp('fr_fwd_pb', 'pb_no', 340, 1, 'PB2', { description: 'Forward Start PB (NO)' }),
      comp('fr_rev_nc', 'contact_nc', 520, 1, 'REV', { parentTag: 'REV', description: 'Reverse Electrical Interlock (NC)' }),
      comp('fr_fwd_coil', 'coil_motor', 680, 1, 'FWD', { description: 'Forward Contactor Coil' }),
      comp('fr_ol1', 'overload_nc', 800, 1, 'OL1', { description: 'Motor Thermal Overload (NC)' }),

      // Rung 02: FWD Seal-in
      comp('fr_fwd_seal', 'contact_no', 340, 2, 'FWD', { parentTag: 'FWD', description: 'FWD Seal-In Contact' }),

      // Rung 03: Stop -> REV PB -> FWD NC Interlock -> REV Coil -> OL2
      comp('fr_stop2', 'pb_nc', 180, 3, 'PB3', { description: 'Rev Stop PB (NC)' }),
      comp('fr_rev_pb', 'pb_no', 340, 3, 'PB4', { description: 'Reverse Start PB (NO)' }),
      comp('fr_fwd_nc', 'contact_nc', 520, 3, 'FWD', { parentTag: 'FWD', description: 'Forward Electrical Interlock (NC)' }),
      comp('fr_rev_coil', 'coil_motor', 680, 3, 'REV', { description: 'Reverse Contactor Coil' }),
      comp('fr_ol2', 'overload_nc', 800, 3, 'OL2', { description: 'Reverse Overload Aux (NC)' }),

      // Rung 04: REV Seal-in
      comp('fr_rev_seal', 'contact_no', 340, 4, 'REV', { parentTag: 'REV', description: 'REV Seal-In Contact' }),

      // Rung 05: FWD Pilot
      comp('fr_fwd_ind', 'contact_no', 240, 5, 'FWD', { parentTag: 'FWD', description: 'FWD Aux Contact' }),
      comp('fr_pl1', 'pilot_light', 680, 5, 'PL1', { pilotColor: 'green', description: 'Forward Run Light' }),

      // Rung 06: REV Pilot
      comp('fr_rev_ind', 'contact_no', 240, 6, 'REV', { parentTag: 'REV', description: 'REV Aux Contact' }),
      comp('fr_pl2', 'pilot_light', 680, 6, 'PL2', { pilotColor: 'amber', description: 'Reverse Run Light' }),
    ],
    wires: [
      // Rung 1
      wire('frw1', L1_X, r1Y, 160, r1Y),
      wire('frw2', 200, r1Y, 260, r1Y),
      wire('frw3', 260, r1Y, 320, r1Y),
      wire('frw4', 360, r1Y, 420, r1Y),
      wire('frw5', 420, r1Y, 500, r1Y),
      wire('frw6', 540, r1Y, 660, r1Y),
      wire('frw7', 700, r1Y, 780, r1Y),
      wire('frw8', 820, r1Y, L2_X, r1Y),
      // Rung 2 seal-in
      wire('frw_s1', 260, r1Y, 260, r2Y),
      wire('frw_s2', 260, r2Y, 320, r2Y),
      wire('frw_s3', 360, r2Y, 420, r2Y),
      wire('frw_s4', 420, r1Y, 420, r2Y),
      // Rung 3
      wire('frw9', L1_X, r3Y, 160, r3Y),
      wire('frw10', 200, r3Y, 260, r3Y),
      wire('frw11', 260, r3Y, 320, r3Y),
      wire('frw12', 360, r3Y, 420, r3Y),
      wire('frw13', 420, r3Y, 500, r3Y),
      wire('frw14', 540, r3Y, 660, r3Y),
      wire('frw15', 700, r3Y, 780, r3Y),
      wire('frw16', 820, r3Y, L2_X, r3Y),
      // Rung 4 seal-in
      wire('frw_s5', 260, r3Y, 260, r4Y),
      wire('frw_s6', 260, r4Y, 320, r4Y),
      wire('frw_s7', 360, r4Y, 420, r4Y),
      wire('frw_s8', 420, r3Y, 420, r4Y),
      // Rungs 5 & 6
      ...wireRungSeries('frw_r5', 5, [240, 680]),
      ...wireRungSeries('frw_r6', 6, [240, 680]),
    ],
  };

  return autoNumberProjectWires({
    id: 'tpl_forward_reverse',
    metadata: {
      title: 'Forward / Reverse Reversing Starter',
      projectNumber: 'VG-REV-301',
      revision: 'A',
      author: 'Controls Engineering',
      standard: 'JIC / NFPA 79',
      description:
        'Reversing motor starter with dual seal-in holding contacts and cross-coupled NC electrical interlocks preventing simultaneous FWD/REV energization.',
    },
    sheets: [sheet1],
    activeSheetId: 'fr_s1',
  });
}

export const BUILTIN_TEMPLATES: Array<{
  id: string;
  fileName: string;
  category: 'Motor Control' | 'VFD' | 'PLC';
  factory: () => Project;
}> = [
  {
    id: 'tpl_motor_3wire',
    fileName: '01_motor_start_stop_3wire.json',
    category: 'Motor Control',
    factory: createDefaultDemoProject,
  },
  {
    id: 'tpl_vfd_3wire',
    fileName: '02_vfd_3wire_run_direction.json',
    category: 'VFD',
    factory: createVfdControlTemplate,
  },
  {
    id: 'tpl_plc_vfd_io',
    fileName: '03_plc_digital_io_vfd_interface.json',
    category: 'PLC',
    factory: createPlcVfdIoTemplate,
  },
  {
    id: 'tpl_fwd_rev',
    fileName: '04_forward_reverse_interlock.json',
    category: 'Motor Control',
    factory: createForwardReverseTemplate,
  },
];
