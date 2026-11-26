import {
  ElectricalNet,
  L1_X,
  L2_X,
  Point,
  Project,
  SchematicSheet,
  WireSegment,
} from '../types/ecad';
import { getComponentPins, getRungNumber, normalizeWire } from './schematicEngine';

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    let curr = x;
    while (curr !== root) {
      const next = this.parent.get(curr)!;
      this.parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) {
      this.parent.set(ra, rb);
    }
  }
}

export function pointKey(p: Point): string {
  return `${p.x},${p.y}`;
}

export function pointLiesOnSegment(pt: Point, rawWire: WireSegment): boolean {
  const w = normalizeWire(rawWire);
  if (w.y1 === w.y2) {
    return pt.y === w.y1 && pt.x >= w.x1 && pt.x <= w.x2;
  }
  if (w.x1 === w.x2) {
    return pt.x === w.x1 && pt.y >= w.y1 && pt.y <= w.y2;
  }
  return false;
}

/**
 * Graph-traversal netlist solver that identifies every continuous equipotential
 * electrical node on a sheet. Power rails L1 and L2 are unified into dedicated
 * L1 / L2 nets; feed-through terminal blocks unify their left and right pins
 * so wire numbers propagate cleanly through DIN-rail terminals.
 */
export function buildSheetNetlist(sheet: SchematicSheet): {
  nets: ElectricalNet[];
  wireToNetId: Map<string, string>;
  pinToNetId: Map<string, string>; // key: `${compId}:left` | `${compId}:right`
  pointToNetId: Map<string, string>;
} {
  const uf = new UnionFind();
  const L1_ROOT = '__RAIL_L1__';
  const L2_ROOT = '__RAIL_L2__';
  uf.find(L1_ROOT);
  uf.find(L2_ROOT);

  const allPoints = new Map<string, Point>();
  const registerPoint = (p: Point): string => {
    const k = pointKey(p);
    if (!allPoints.has(k)) allPoints.set(k, p);
    uf.find(k);
    if (p.x === L1_X) uf.union(k, L1_ROOT);
    if (p.x === L2_X) uf.union(k, L2_ROOT);
    return k;
  };

  // Register wire endpoints & union wire ends
  for (const w of sheet.wires) {
    const k1 = registerPoint({ x: w.x1, y: w.y1 });
    const k2 = registerPoint({ x: w.x2, y: w.y2 });
    uf.union(k1, k2);
  }

  // Register component pins
  for (const comp of sheet.components) {
    const pins = getComponentPins(comp);
    const kl = registerPoint(pins.left);
    const kr = registerPoint(pins.right);
    // Feed-through terminal blocks maintain equipotential continuity
    if (comp.type === 'terminal') {
      uf.union(kl, kr);
    }
  }

  // Handle any T-junctions where a point lies strictly on a wire segment
  for (const [k, pt] of allPoints.entries()) {
    for (const w of sheet.wires) {
      if (pointLiesOnSegment(pt, w)) {
        uf.union(k, pointKey({ x: w.x1, y: w.y1 }));
      }
    }
  }

  // Group into ElectricalNet objects
  const l1Root = uf.find(L1_ROOT);
  const l2Root = uf.find(L2_ROOT);

  interface NetAccumulator {
    root: string;
    isL1: boolean;
    isL2: boolean;
    wireIds: string[];
    points: Map<string, Point>;
    connectedPins: Array<{ componentId: string; pin: 'left' | 'right' }>;
    existingNumbers: string[];
    minRung: number;
    minX: number;
  }

  const groups = new Map<string, NetAccumulator>();
  const getGroup = (root: string): NetAccumulator => {
    let g = groups.get(root);
    if (!g) {
      g = {
        root,
        isL1: root === l1Root,
        isL2: root === l2Root,
        wireIds: [],
        points: new Map(),
        connectedPins: [],
        existingNumbers: [],
        minRung: Number.POSITIVE_INFINITY,
        minX: Number.POSITIVE_INFINITY,
      };
      groups.set(root, g);
    }
    return g;
  };

  for (const w of sheet.wires) {
    const root = uf.find(pointKey({ x: w.x1, y: w.y1 }));
    const g = getGroup(root);
    g.wireIds.push(w.id);
    g.points.set(pointKey({ x: w.x1, y: w.y1 }), { x: w.x1, y: w.y1 });
    g.points.set(pointKey({ x: w.x2, y: w.y2 }), { x: w.x2, y: w.y2 });
    if (w.wireNumber && w.wireNumber !== sheet.l1Label && w.wireNumber !== sheet.l2Label) {
      g.existingNumbers.push(w.wireNumber);
    }
    const r = Math.min(getRungNumber(w.y1), getRungNumber(w.y2));
    if (r < g.minRung) g.minRung = r;
    const mx = Math.min(w.x1, w.x2);
    if (mx < g.minX) g.minX = mx;
  }

  for (const comp of sheet.components) {
    const pins = getComponentPins(comp);
    const rl = uf.find(pointKey(pins.left));
    const rr = uf.find(pointKey(pins.right));
    getGroup(rl).connectedPins.push({ componentId: comp.id, pin: 'left' });
    getGroup(rr).connectedPins.push({ componentId: comp.id, pin: 'right' });
    getGroup(rl).points.set(pointKey(pins.left), pins.left);
    getGroup(rr).points.set(pointKey(pins.right), pins.right);
  }

  // Sort non-rail nets top-to-bottom by rung, then left-to-right
  const accList = Array.from(groups.values()).filter(
    (g) => g.wireIds.length > 0 || g.connectedPins.length > 0 || g.isL1 || g.isL2
  );
  accList.sort((a, b) => {
    if (a.isL1 && !b.isL1) return -1;
    if (!a.isL1 && b.isL1) return 1;
    if (a.isL2 && !b.isL2) return -1;
    if (!a.isL2 && b.isL2) return 1;
    if (a.minRung !== b.minRung) return a.minRung - b.minRung;
    return a.minX - b.minX;
  });

  const nets: ElectricalNet[] = [];
  const wireToNetId = new Map<string, string>();
  const pinToNetId = new Map<string, string>();
  const pointToNetId = new Map<string, string>();

  let netCounter = 1;
  for (const g of accList) {
    const netId = g.isL1
      ? `${sheet.id}_NET_L1`
      : g.isL2
        ? `${sheet.id}_NET_L2`
        : `${sheet.id}_NET_${netCounter++}`;

    const wireNumber = g.isL1
      ? sheet.l1Label
      : g.isL2
        ? sheet.l2Label
        : g.existingNumbers[0] || '';

    const net: ElectricalNet = {
      id: netId,
      sheetId: sheet.id,
      wireNumber,
      isL1: g.isL1,
      isL2: g.isL2,
      wireIds: g.wireIds,
      points: Array.from(g.points.values()),
      connectedPins: g.connectedPins,
      minRung: Number.isFinite(g.minRung) ? g.minRung : 1,
      minX: Number.isFinite(g.minX) ? g.minX : L1_X,
    };

    nets.push(net);
    for (const wid of g.wireIds) {
      wireToNetId.set(wid, netId);
    }
    for (const cp of g.connectedPins) {
      pinToNetId.set(`${cp.componentId}:${cp.pin}`, netId);
    }
    for (const k of g.points.keys()) {
      pointToNetId.set(k, netId);
    }
  }

  return { nets, wireToNetId, pinToNetId, pointToNetId };
}

/**
 * One-click Auto-Number Wires:
 * Assigns sequential wire numbers based on sheet & rung order (e.g., 101, 102, 103
 * on Sheet 1; 201, 202, 203 on Sheet 2), explicitly skipping L1 and L2 power rails.
 */
export function autoNumberProjectWires(project: Project): Project {
  return {
    ...project,
    sheets: project.sheets.map((sheet) => autoNumberSheetWires(sheet)),
  };
}

export function autoNumberSheetWires(sheet: SchematicSheet): SchematicSheet {
  const { nets, wireToNetId } = buildSheetNetlist(sheet);
  const netNumberMap = new Map<string, string>();

  const sheetBase = sheet.number * 100;
  let seq = 1;

  for (const net of nets) {
    if (net.isL1) {
      netNumberMap.set(net.id, sheet.l1Label);
    } else if (net.isL2) {
      netNumberMap.set(net.id, sheet.l2Label);
    } else if (net.wireIds.length > 0) {
      netNumberMap.set(net.id, String(sheetBase + seq));
      seq += 1;
    }
  }

  return {
    ...sheet,
    wires: sheet.wires.map((w) => {
      const netId = wireToNetId.get(w.id);
      const wireNumber = netId ? netNumberMap.get(netId) : w.wireNumber;
      return {
        ...w,
        netId,
        wireNumber,
      };
    }),
  };
}
