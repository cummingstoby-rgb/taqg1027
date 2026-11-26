import { getSymbolDef } from '../data/symbolCatalog';
import { ErcDiagnostic, L1_X, L2_X, Project } from '../types/ecad';
import { buildSheetNetlist, pointKey } from './netlistEngine';
import { getComponentPins } from './schematicEngine';

/**
 * Electrical Rule Check (ERC) & Diagnostics Engine.
 * Validates:
 *  - ERC-001: Direct L1-to-L2 short circuits (no load in path)
 *  - ERC-002: Duplicate Parent coil tags
 *  - ERC-003: Orphaned Child contacts (linked to non-existent Parent)
 *  - ERC-004: Unconnected / floating wire ends
 *  - ERC-005: Coils or loads missing a supply path from L1 or return path to L2
 *  - ERC-006: Unconnected component pins
 */
export function runElectricalRuleCheck(project: Project): ErcDiagnostic[] {
  const diagnostics: ErcDiagnostic[] = [];
  let diagIdx = 1;
  const nextId = () => `erc_${diagIdx++}`;

  // 1. Collect all parent coil tags across all sheets and detect duplicates
  const parentTagLocations = new Map<
    string,
    Array<{ id: string; sheetId: string; sheetNumber: number }>
  >();

  for (const sheet of project.sheets) {
    for (const comp of sheet.components) {
      const def = getSymbolDef(comp.type);
      if (def?.isParent) {
        const list = parentTagLocations.get(comp.tag) ?? [];
        list.push({ id: comp.id, sheetId: sheet.id, sheetNumber: sheet.number });
        parentTagLocations.set(comp.tag, list);
      }
    }
  }

  for (const [tag, locs] of parentTagLocations.entries()) {
    if (locs.length > 1) {
      for (const loc of locs) {
        diagnostics.push({
          id: nextId(),
          code: 'ERC-002',
          severity: 'error',
          message: `Duplicate Parent coil tag "${tag}" found (${locs.length} coils share this tag).`,
          sheetId: loc.sheetId,
          sheetNumber: loc.sheetNumber,
          targetType: 'component',
          targetId: loc.id,
        });
      }
    }
  }

  // 2. Per-sheet topological checks
  for (const sheet of project.sheets) {
    const { nets, pinToNetId } = buildSheetNetlist(sheet);
    const l1Net = nets.find((n) => n.isL1);
    const l2Net = nets.find((n) => n.isL2);

    // Check orphaned child contacts
    for (const comp of sheet.components) {
      const def = getSymbolDef(comp.type);
      if (def?.isChild) {
        const targetParent = comp.parentTag || comp.tag;
        if (!targetParent || !parentTagLocations.has(targetParent)) {
          diagnostics.push({
            id: nextId(),
            code: 'ERC-003',
            severity: 'error',
            message: `Orphaned contact "${comp.tag || 'UNASSIGNED'}" references non-existent Parent coil "${targetParent || 'none'}".`,
            sheetId: sheet.id,
            sheetNumber: sheet.number,
            targetType: 'component',
            targetId: comp.id,
          });
        }
      }
    }

    // Build structural non-load adjacency graph:
    // (a) Strictly-closed / direct short graph (ignores NO switches, includes wires & NC/protection/terminals)
    // (b) Full switchability graph (all switches assumed closable, excluding loads)
    const directShortAdj = new Map<string, Set<string>>();
    const allSwitchAdj = new Map<string, Set<string>>();

    const addEdge = (graph: Map<string, Set<string>>, a: string, b: string) => {
      if (!graph.has(a)) graph.set(a, new Set());
      if (!graph.has(b)) graph.set(b, new Set());
      graph.get(a)!.add(b);
      graph.get(b)!.add(a);
    };

    for (const comp of sheet.components) {
      const def = getSymbolDef(comp.type);
      if (!def || def.isLoad) continue;
      const ln = pinToNetId.get(`${comp.id}:left`);
      const rn = pinToNetId.get(`${comp.id}:right`);
      if (!ln || !rn) continue;

      addEdge(allSwitchAdj, ln, rn);

      // Normally-closed switches, protection devices, and terminals can conduct immediately
      if (
        comp.type === 'terminal' ||
        comp.type === 'fuse' ||
        comp.type === 'breaker' ||
        comp.type === 'estop_nc' ||
        comp.type === 'pb_nc' ||
        comp.type === 'selector_nc' ||
        comp.type === 'overload_nc' ||
        comp.type === 'contact_nc' ||
        comp.type === 'timer_contact_nc'
      ) {
        addEdge(directShortAdj, ln, rn);
      }
    }

    const bfsReach = (startId: string | undefined, graph: Map<string, Set<string>>): Set<string> => {
      const visited = new Set<string>();
      if (!startId) return visited;
      const q = [startId];
      visited.add(startId);
      while (q.length > 0) {
        const curr = q.shift()!;
        for (const nb of graph.get(curr) ?? []) {
          if (!visited.has(nb)) {
            visited.add(nb);
            q.push(nb);
          }
        }
      }
      return visited;
    };

    // ERC-001: Direct L1-to-L2 short circuit check (either direct wire or through switches with zero load)
    const directFromL1 = bfsReach(l1Net?.id, directShortAdj);
    const anySwitchFromL1 = bfsReach(l1Net?.id, allSwitchAdj);
    if (l1Net && l2Net) {
      if (l1Net.id === l2Net.id || directFromL1.has(l2Net.id)) {
        const offendingWire = l1Net.wireIds[0] || l2Net.wireIds[0];
        diagnostics.push({
          id: nextId(),
          code: 'ERC-001',
          severity: 'error',
          message: `Direct ${sheet.l1Label} to ${sheet.l2Label} short circuit detected (continuous path with no electrical load).`,
          sheetId: sheet.id,
          sheetNumber: sheet.number,
          targetType: offendingWire ? 'wire' : 'sheet',
          targetId: offendingWire,
        });
      } else if (anySwitchFromL1.has(l2Net.id)) {
        const offendingWire = l1Net.wireIds[0];
        diagnostics.push({
          id: nextId(),
          code: 'ERC-001',
          severity: 'error',
          message: `Potential ${sheet.l1Label}-${sheet.l2Label} short circuit path through series contacts without a load.`,
          sheetId: sheet.id,
          sheetNumber: sheet.number,
          targetType: offendingWire ? 'wire' : 'sheet',
          targetId: offendingWire,
        });
      }
    }

    // ERC-005: Check every load (coil / pilot light / timer / PLC input / VFD cmd) has path to L1 and L2
    const reachableFromL1 = anySwitchFromL1;
    const reachableFromL2 = bfsReach(l2Net?.id, allSwitchAdj);

    for (const comp of sheet.components) {
      const def = getSymbolDef(comp.type);
      if (!def?.isLoad) continue;
      const ln = pinToNetId.get(`${comp.id}:left`);
      const rn = pinToNetId.get(`${comp.id}:right`);
      const hasSupply = Boolean((ln && reachableFromL1.has(ln)) || (rn && reachableFromL1.has(rn)));
      const hasReturn = Boolean((ln && reachableFromL2.has(ln)) || (rn && reachableFromL2.has(rn)));

      if (!hasReturn) {
        diagnostics.push({
          id: nextId(),
          code: 'ERC-005',
          severity: 'error',
          message: `Load "${comp.tag}" (${def.name}) is missing a return path to ${sheet.l2Label}.`,
          sheetId: sheet.id,
          sheetNumber: sheet.number,
          targetType: 'component',
          targetId: comp.id,
        });
      }
      if (!hasSupply) {
        diagnostics.push({
          id: nextId(),
          code: 'ERC-005',
          severity: 'warning',
          message: `Load "${comp.tag}" (${def.name}) has no supply path from ${sheet.l1Label}.`,
          sheetId: sheet.id,
          sheetNumber: sheet.number,
          targetType: 'component',
          targetId: comp.id,
        });
      }
    }

    // ERC-004 & ERC-006: Unconnected/floating wire ends and unconnected component pins
    const endpointCounts = new Map<string, number>();
    const pinPoints = new Set<string>();

    const bump = (k: string) => endpointCounts.set(k, (endpointCounts.get(k) ?? 0) + 1);

    for (const comp of sheet.components) {
      const pins = getComponentPins(comp);
      const kl = pointKey(pins.left);
      const kr = pointKey(pins.right);
      pinPoints.add(kl);
      pinPoints.add(kr);
      bump(kl);
      bump(kr);
    }

    for (const w of sheet.wires) {
      bump(pointKey({ x: w.x1, y: w.y1 }));
      bump(pointKey({ x: w.x2, y: w.y2 }));
    }

    // Check component pins that have no attached wire (degree 1 and not on rail)
    for (const comp of sheet.components) {
      const pins = getComponentPins(comp);
      const leftDeg = endpointCounts.get(pointKey(pins.left)) ?? 0;
      const rightDeg = endpointCounts.get(pointKey(pins.right)) ?? 0;
      const leftOnRail = pins.left.x === L1_X || pins.left.x === L2_X;
      const rightOnRail = pins.right.x === L1_X || pins.right.x === L2_X;

      if (leftDeg < 2 && !leftOnRail) {
        diagnostics.push({
          id: nextId(),
          code: 'ERC-006',
          severity: 'warning',
          message: `Component "${comp.tag}" has an unconnected left terminal.`,
          sheetId: sheet.id,
          sheetNumber: sheet.number,
          targetType: 'component',
          targetId: comp.id,
        });
      }
      if (rightDeg < 2 && !rightOnRail) {
        diagnostics.push({
          id: nextId(),
          code: 'ERC-006',
          severity: 'warning',
          message: `Component "${comp.tag}" has an unconnected right terminal.`,
          sheetId: sheet.id,
          sheetNumber: sheet.number,
          targetType: 'component',
          targetId: comp.id,
        });
      }
    }

    // Check floating wire endpoints
    for (const w of sheet.wires) {
      const pts = [
        { x: w.x1, y: w.y1 },
        { x: w.x2, y: w.y2 },
      ];
      for (const p of pts) {
        if (p.x === L1_X || p.x === L2_X) continue;
        const k = pointKey(p);
        const deg = endpointCounts.get(k) ?? 0;
        if (deg < 2 && !pinPoints.has(k)) {
          diagnostics.push({
            id: nextId(),
            code: 'ERC-004',
            severity: 'warning',
            message: `Floating/unconnected wire end at (${p.x}, ${p.y}) on wire "${w.wireNumber || w.id}".`,
            sheetId: sheet.id,
            sheetNumber: sheet.number,
            targetType: 'wire',
            targetId: w.id,
          });
          break;
        }
      }
    }
  }

  return diagnostics;
}
