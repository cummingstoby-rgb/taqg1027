import { getSymbolDef } from '../data/symbolCatalog';
import {
  Project,
  SchematicComponent,
  SimulationState,
  TimerRuntimeState,
} from '../types/ecad';
import { buildSheetNetlist } from './netlistEngine';

export function createInitialSimulationState(): SimulationState {
  return {
    running: false,
    interactiveStates: {},
    coilStates: {},
    timerStates: {},
    energizedComponentIds: [],
    energizedWireIds: [],
    returnWireIds: [],
    conductingComponentIds: [],
    hasLiveShort: false,
  };
}

/**
 * Determines whether a non-load series switching device is currently closed/conducting.
 */
export function isSwitchConducting(
  comp: SchematicComponent,
  interactiveStates: Record<string, boolean>,
  coilStates: Record<string, boolean>,
  timerStates: Record<string, TimerRuntimeState>
): boolean {
  const pressed = Boolean(interactiveStates[comp.id]);
  const parentTag = comp.parentTag || comp.tag;

  switch (comp.type) {
    case 'pb_no':
    case 'selector_no':
    case 'plc_out':
      return pressed;

    case 'pb_nc':
    case 'estop_nc':
    case 'selector_nc':
    case 'overload_nc':
    case 'fuse':
    case 'breaker':
      // Normally closed: conducts until actuated/tripped/opened
      return !pressed;

    case 'terminal':
      return true;

    case 'contact_no':
      return Boolean(coilStates[parentTag]);

    case 'contact_nc':
      return !Boolean(coilStates[parentTag]);

    case 'timer_contact_no': {
      const t = timerStates[parentTag];
      return t ? t.done : false;
    }

    case 'timer_contact_nc': {
      const t = timerStates[parentTag];
      return t ? !t.done : true;
    }

    default:
      return false;
  }
}

/**
 * Runs one fixed-point electrical scan cycle + timer tick across all sheets.
 * Supports latching (seal-in) circuits, cross-sheet relay interlocking,
 * On-Delay (TON) and Off-Delay (TOF) timers, and live short-circuit detection.
 */
export function stepSimulation(
  project: Project,
  prevState: SimulationState,
  dtSeconds: number = 0
): SimulationState {
  // Build netlists once per step
  const sheetNetlists = project.sheets.map((sheet) => ({
    sheet,
    ...buildSheetNetlist(sheet),
  }));

  // Copy mutable maps for fixed-point convergence
  const coilStates: Record<string, boolean> = { ...prevState.coilStates };
  const timerStates: Record<string, TimerRuntimeState> = {};

  // Ensure every timer coil has a runtime record
  for (const sheet of project.sheets) {
    for (const comp of sheet.components) {
      if (comp.type === 'coil_ton' || comp.type === 'coil_tof') {
        const preset = Math.max(0.1, comp.timerPreset ?? 3.0);
        const existing = prevState.timerStates[comp.tag];
        timerStates[comp.tag] = existing
          ? { ...existing, preset }
          : {
              accumulated: 0,
              preset,
              done: false,
              timing: false,
              wasEnergized: false,
            };
      }
    }
  }

  let energizedComponentIds = new Set<string>();
  let energizedWireIds = new Set<string>();
  let returnWireIds = new Set<string>();
  let conductingComponentIds = new Set<string>();
  let hasLiveShort = false;

  // Iterate fixed-point until coil states settle (max 12 passes prevents infinite oscillation)
  for (let pass = 0; pass < 12; pass++) {
    const nextCoilStates: Record<string, boolean> = {};
    energizedComponentIds = new Set<string>();
    energizedWireIds = new Set<string>();
    returnWireIds = new Set<string>();
    conductingComponentIds = new Set<string>();
    hasLiveShort = false;

    // Pre-initialize all parent coils to false
    for (const { sheet } of sheetNetlists) {
      for (const comp of sheet.components) {
        if (getSymbolDef(comp.type)?.isParent) {
          if (!(comp.tag in nextCoilStates)) {
            nextCoilStates[comp.tag] = false;
          }
        }
      }
    }

    for (const { sheet, nets, pinToNetId } of sheetNetlists) {
      const l1Net = nets.find((n) => n.isL1);
      const l2Net = nets.find((n) => n.isL2);

      // Build adjacency graph of conducting switches (excluding loads!)
      const adj = new Map<string, Set<string>>();
      const addEdge = (a: string, b: string) => {
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      };

      for (const comp of sheet.components) {
        const def = getSymbolDef(comp.type);
        if (!def || def.isLoad) continue;

        const conducts = isSwitchConducting(
          comp,
          prevState.interactiveStates,
          coilStates,
          timerStates
        );

        if (conducts) {
          conductingComponentIds.add(comp.id);
          const leftNet = pinToNetId.get(`${comp.id}:left`);
          const rightNet = pinToNetId.get(`${comp.id}:right`);
          if (leftNet && rightNet) {
            addEdge(leftNet, rightNet);
          }
        }
      }

      // BFS from L1 to find all hot-potential nets
      const hotNets = new Set<string>();
      if (l1Net) {
        const queue: string[] = [l1Net.id];
        hotNets.add(l1Net.id);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          const neighbors = adj.get(curr);
          if (!neighbors) continue;
          for (const n of neighbors) {
            if (!hotNets.has(n)) {
              hotNets.add(n);
              queue.push(n);
            }
          }
        }
      }

      // BFS from L2 to find all neutral-return nets
      const neutralNets = new Set<string>();
      if (l2Net) {
        const queue: string[] = [l2Net.id];
        neutralNets.add(l2Net.id);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          const neighbors = adj.get(curr);
          if (!neighbors) continue;
          for (const n of neighbors) {
            if (!neutralNets.has(n)) {
              neutralNets.add(n);
              queue.push(n);
            }
          }
        }
      }

      // Check direct short L1 <-> L2
      if (l1Net && l2Net && hotNets.has(l2Net.id)) {
        hasLiveShort = true;
      }

      // Evaluate loads (coils, timers, pilot lights, PLC inputs, VFD commands)
      for (const comp of sheet.components) {
        const def = getSymbolDef(comp.type);
        if (!def?.isLoad) continue;

        const leftNet = pinToNetId.get(`${comp.id}:left`);
        const rightNet = pinToNetId.get(`${comp.id}:right`);
        if (!leftNet || !rightNet) continue;

        const powered =
          !hasLiveShort &&
          ((hotNets.has(leftNet) && neutralNets.has(rightNet)) ||
            (hotNets.has(rightNet) && neutralNets.has(leftNet)));

        if (powered) {
          energizedComponentIds.add(comp.id);
          if (def.isParent) {
            nextCoilStates[comp.tag] = true;
          }
        }
      }

      // Collect energized wire IDs for visual highlighting
      for (const net of nets) {
        if (hotNets.has(net.id)) {
          for (const wid of net.wireIds) energizedWireIds.add(wid);
        }
        if (neutralNets.has(net.id)) {
          for (const wid of net.wireIds) returnWireIds.add(wid);
        }
      }
    }

    // Check convergence and ensure every parent coil key is explicitly initialized
    let changed = false;
    const allKeys = new Set([...Object.keys(coilStates), ...Object.keys(nextCoilStates)]);
    for (const k of allKeys) {
      const prevVal = Boolean(coilStates[k]);
      const nextVal = Boolean(nextCoilStates[k]);
      if (prevVal !== nextVal) {
        changed = true;
      }
      coilStates[k] = nextVal;
    }
    if (!changed) break;
  }

  // Advance TON / TOF timers by dtSeconds
  if (dtSeconds >= 0) {
    for (const sheet of project.sheets) {
      for (const comp of sheet.components) {
        if (comp.type !== 'coil_ton' && comp.type !== 'coil_tof') continue;
        const energized = Boolean(coilStates[comp.tag]);
        const preset = Math.max(0.1, comp.timerPreset ?? 3.0);
        const curr = timerStates[comp.tag];

        if (comp.type === 'coil_ton') {
          if (energized) {
            const nextAcc = Math.min(preset, curr.accumulated + dtSeconds);
            const done = nextAcc >= preset - 1e-6;
            timerStates[comp.tag] = {
              accumulated: nextAcc,
              preset,
              done,
              timing: !done,
              wasEnergized: true,
            };
          } else {
            timerStates[comp.tag] = {
              accumulated: 0,
              preset,
              done: false,
              timing: false,
              wasEnergized: false,
            };
          }
        } else {
          // Off-Delay Timer (TOF)
          if (energized) {
            timerStates[comp.tag] = {
              accumulated: 0,
              preset,
              done: true,
              timing: false,
              wasEnergized: true,
            };
          } else if (curr.wasEnergized && curr.done) {
            const nextAcc = Math.min(preset, curr.accumulated + dtSeconds);
            const done = nextAcc < preset - 1e-6;
            timerStates[comp.tag] = {
              accumulated: done ? nextAcc : preset,
              preset,
              done,
              timing: done,
              wasEnergized: done,
            };
          } else {
            timerStates[comp.tag] = {
              accumulated: 0,
              preset,
              done: false,
              timing: false,
              wasEnergized: false,
            };
          }
        }
      }
    }
  }

  return {
    running: true,
    interactiveStates: prevState.interactiveStates,
    coilStates,
    timerStates,
    energizedComponentIds: Array.from(energizedComponentIds),
    energizedWireIds: Array.from(energizedWireIds),
    returnWireIds: Array.from(returnWireIds),
    conductingComponentIds: Array.from(conductingComponentIds),
    hasLiveShort,
  };
}
