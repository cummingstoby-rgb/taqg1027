export const GRID_SIZE = 20;
export const L1_X = 80;
export const L2_X = 880;
export const FIRST_RUNG_Y = 100;
export const RUNG_SPACING = 100;
export const COMPONENT_HALF_SPAN = 20; // Left pin at x-20, Right pin at x+20

export type AppMode = 'EDIT' | 'SIMULATE';
export type ToolMode = 'select' | 'wire' | 'place';

export type SymbolCategory =
  | 'Pilot Devices'
  | 'Contacts'
  | 'Coils & Timers'
  | 'Indicators & Loads'
  | 'Protection & Power'
  | 'Terminals & PLC / VFD';

export type SymbolRole =
  | 'switch_momentary_no'
  | 'switch_momentary_nc'
  | 'switch_maintained_no'
  | 'switch_maintained_nc'
  | 'contact_no'
  | 'contact_nc'
  | 'timer_contact_no'
  | 'timer_contact_nc'
  | 'parent_coil'
  | 'parent_timer_ton'
  | 'parent_timer_tof'
  | 'load'
  | 'overload_nc'
  | 'protection'
  | 'terminal'
  | 'plc_in'
  | 'plc_out';

export type SymbolType =
  | 'pb_no'
  | 'pb_nc'
  | 'estop_nc'
  | 'selector_no'
  | 'selector_nc'
  | 'contact_no'
  | 'contact_nc'
  | 'timer_contact_no'
  | 'timer_contact_nc'
  | 'coil_relay'
  | 'coil_motor'
  | 'coil_ton'
  | 'coil_tof'
  | 'overload_nc'
  | 'pilot_light'
  | 'fuse'
  | 'breaker'
  | 'terminal'
  | 'plc_in'
  | 'plc_out'
  | 'vfd_cmd';

export interface SymbolDefinition {
  type: SymbolType;
  name: string;
  shortLabel: string;
  category: SymbolCategory;
  role: SymbolRole;
  defaultTagPrefix: string;
  defaultDescription: string;
  defaultManufacturer: string;
  defaultPartNumber: string;
  isParent: boolean;
  isChild: boolean;
  isLoad: boolean;
  isInteractiveInSim: boolean;
  defaultColor?: 'green' | 'red' | 'amber' | 'cyan';
  defaultTimerPreset?: number;
}

export interface SchematicComponent {
  id: string;
  type: SymbolType;
  x: number; // Grid-snapped center X
  y: number; // Grid-snapped center Y
  tag: string;
  description: string;
  manufacturer: string;
  partNumber: string;
  parentTag?: string; // For child contacts
  timerPreset?: number; // Seconds for TON / TOF coils
  pilotColor?: 'green' | 'red' | 'amber' | 'cyan';
  terminalStrip?: string; // e.g., TB1
  terminalNumber?: string; // e.g., 1, 2, 3
  plcAddress?: string; // e.g., %IX0.0 or %QX0.0
  vfdParam?: string; // e.g., DI1-RUN, DI2-REV, AI1-SPD
}

export interface WireSegment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  wireNumber?: string;
  netId?: string;
}

export interface SchematicSheet {
  id: string;
  number: number;
  name: string;
  voltageLabel: string; // e.g., "120VAC 60Hz" or "24VDC"
  l1Label: string; // e.g., "L1" or "+24V"
  l2Label: string; // e.g., "L2" or "0V"
  rungCount: number;
  components: SchematicComponent[];
  wires: WireSegment[];
}

export interface ProjectMetadata {
  title: string;
  projectNumber: string;
  revision: string;
  author: string;
  standard: 'JIC / NFPA 79' | 'IEC 60617';
  description: string;
}

export interface Project {
  id: string;
  metadata: ProjectMetadata;
  sheets: SchematicSheet[];
  activeSheetId: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface CrossReferenceEntry {
  parentTag: string;
  parentId: string;
  parentSheetNumber: number;
  parentRung: number;
  parentType: SymbolType;
  noContacts: Array<{ id: string; sheetNumber: number; rung: number; isTimed: boolean }>;
  ncContacts: Array<{ id: string; sheetNumber: number; rung: number; isTimed: boolean }>;
  summaryText: string;
}

export interface ElectricalNet {
  id: string;
  sheetId: string;
  wireNumber: string;
  isL1: boolean;
  isL2: boolean;
  wireIds: string[];
  points: Point[];
  connectedPins: Array<{ componentId: string; pin: 'left' | 'right' }>;
  minRung: number;
  minX: number;
}

export interface TimerRuntimeState {
  accumulated: number; // seconds elapsed
  preset: number;
  done: boolean;
  timing: boolean;
  wasEnergized: boolean;
}

export interface SimulationState {
  running: boolean;
  /** Map of componentId -> boolean (true = pressed/actuated/tripped/closed toggle) */
  interactiveStates: Record<string, boolean>;
  /** Map of parent coil tag -> boolean (energized) */
  coilStates: Record<string, boolean>;
  /** Map of timer parent tag -> TimerRuntimeState */
  timerStates: Record<string, TimerRuntimeState>;
  /** Set of component IDs currently energized (coils, pilot lights, active loads) */
  energizedComponentIds: string[];
  /** Set of wire IDs currently carrying hot potential */
  energizedWireIds: string[];
  /** Set of wire IDs carrying valid neutral return */
  returnWireIds: string[];
  /** Set of component IDs currently conducting (closed switches/contacts) */
  conductingComponentIds: string[];
  /** Detected live short circuit */
  hasLiveShort: boolean;
}

export type ErcSeverity = 'error' | 'warning';

export interface ErcDiagnostic {
  id: string;
  code: string;
  severity: ErcSeverity;
  message: string;
  sheetId: string;
  sheetNumber: number;
  targetType: 'component' | 'wire' | 'sheet';
  targetId?: string;
}

export interface BomRow {
  partNumber: string;
  manufacturer: string;
  type: string;
  description: string;
  tags: string[];
  quantity: number;
}

export interface TerminalRow {
  componentId: string;
  sheetId: string;
  sheetNumber: number;
  rung: number;
  strip: string;
  terminalNumber: string;
  fullLabel: string;
  wireNumber: string;
  leftDevice: string;
  rightDevice: string;
  description: string;
}
