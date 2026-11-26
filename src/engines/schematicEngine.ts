import {
  COMPONENT_HALF_SPAN,
  FIRST_RUNG_Y,
  GRID_SIZE,
  L1_X,
  L2_X,
  Point,
  RUNG_SPACING,
  SchematicComponent,
  SchematicSheet,
  WireSegment,
} from '../types/ecad';

export function snapToGrid(value: number, grid: number = GRID_SIZE): number {
  return Math.round(value / grid) * grid;
}

export function getRungNumber(y: number): number {
  const index = Math.round((y - FIRST_RUNG_Y) / RUNG_SPACING) + 1;
  return Math.max(1, index);
}

export function getRungY(rungNumber: number): number {
  return FIRST_RUNG_Y + (Math.max(1, rungNumber) - 1) * RUNG_SPACING;
}

export function formatRungNumber(rung: number): string {
  return String(Math.max(1, rung)).padStart(2, '0');
}

export function getComponentPins(comp: SchematicComponent): { left: Point; right: Point } {
  return {
    left: { x: comp.x - COMPONENT_HALF_SPAN, y: comp.y },
    right: { x: comp.x + COMPONENT_HALF_SPAN, y: comp.y },
  };
}

export function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36).slice(-4)}`;
}

export function normalizeWire(w: WireSegment): WireSegment {
  // Canonical ordering: left-to-right for horizontal, top-to-bottom for vertical
  if (w.y1 === w.y2 && w.x1 > w.x2) {
    return { ...w, x1: w.x2, x2: w.x1 };
  }
  if (w.x1 === w.x2 && w.y1 > w.y2) {
    return { ...w, y1: w.y2, y2: w.y1 };
  }
  return w;
}

/**
 * Splits any existing wire segments that pass strictly through point (px, py)
 * so T-junctions and 4-way crosses always share explicit vertices in the graph.
 */
export function splitWiresAtPoint(wires: WireSegment[], pt: Point): WireSegment[] {
  const result: WireSegment[] = [];
  for (const raw of wires) {
    const w = normalizeWire(raw);
    const isHoriz = w.y1 === w.y2;
    const isVert = w.x1 === w.x2;

    if (isHoriz && pt.y === w.y1 && pt.x > w.x1 && pt.x < w.x2) {
      result.push({
        ...w,
        id: w.id,
        x2: pt.x,
      });
      result.push({
        ...w,
        id: generateId('w'),
        x1: pt.x,
      });
    } else if (isVert && pt.x === w.x1 && pt.y > w.y1 && pt.y < w.y2) {
      result.push({
        ...w,
        id: w.id,
        y2: pt.y,
      });
      result.push({
        ...w,
        id: generateId('w'),
        y1: pt.y,
      });
    } else {
      result.push(w);
    }
  }
  return result;
}

/**
 * Places a component onto a sheet with automatic wire-breaking:
 * If the component's horizontal body [x - 20, x + 20] lies on an existing
 * horizontal wire segment at y === component.y, that wire is cleanly split
 * into left and right segments terminating at the component's pins.
 */
export function placeComponentWithWireBreak(
  sheet: SchematicSheet,
  component: SchematicComponent
): SchematicSheet {
  const snapped: SchematicComponent = {
    ...component,
    x: Math.max(L1_X + COMPONENT_HALF_SPAN * 2, Math.min(L2_X - COMPONENT_HALF_SPAN * 2, snapToGrid(component.x))),
    y: Math.max(FIRST_RUNG_Y, snapToGrid(component.y)),
  };

  const leftX = snapped.x - COMPONENT_HALF_SPAN;
  const rightX = snapped.x + COMPONENT_HALF_SPAN;
  const newWires: WireSegment[] = [];

  for (const raw of sheet.wires) {
    const w = normalizeWire(raw);
    const isHoriz = w.y1 === w.y2;

    if (isHoriz && w.y1 === snapped.y && w.x1 < rightX && w.x2 > leftX) {
      // Wire overlaps the component body: split cleanly around [leftX, rightX]
      if (w.x1 < leftX) {
        newWires.push({
          ...w,
          id: w.id,
          x1: w.x1,
          y1: w.y1,
          x2: leftX,
          y2: w.y2,
        });
      }
      if (w.x2 > rightX) {
        newWires.push({
          ...w,
          id: w.x1 < leftX ? generateId('w') : w.id,
          x1: rightX,
          y1: w.y1,
          x2: w.x2,
          y2: w.y2,
        });
      }
    } else {
      newWires.push(w);
    }
  }

  // Ensure rungCount accommodates placement
  const neededRung = getRungNumber(snapped.y);

  return {
    ...sheet,
    rungCount: Math.max(sheet.rungCount, neededRung),
    components: [...sheet.components, snapped],
    wires: deduplicateWires(newWires),
  };
}

/**
 * Moves an existing component to a new grid-snapped position and breaks any wire
 * it lands on.
 */
export function moveComponentWithWireBreak(
  sheet: SchematicSheet,
  componentId: string,
  newX: number,
  newY: number
): SchematicSheet {
  const existing = sheet.components.find((c) => c.id === componentId);
  if (!existing) return sheet;

  const withoutComp: SchematicSheet = {
    ...sheet,
    components: sheet.components.filter((c) => c.id !== componentId),
  };

  return placeComponentWithWireBreak(withoutComp, {
    ...existing,
    x: snapToGrid(newX),
    y: snapToGrid(newY),
  });
}

/**
 * Adds an orthogonal wire route (1 segment if axis-aligned, 2 segments forming
 * an L-bend otherwise) and splits any intersecting existing wires at the
 * endpoints and corner so the netlist graph stays electrically connected.
 */
export function addOrthogonalWire(
  sheet: SchematicSheet,
  start: Point,
  end: Point,
  horizontalFirst: boolean = true
): SchematicSheet {
  const p1: Point = { x: snapToGrid(start.x), y: snapToGrid(start.y) };
  const p2: Point = { x: snapToGrid(end.x), y: snapToGrid(end.y) };

  if (p1.x === p2.x && p1.y === p2.y) {
    return sheet;
  }

  const candidateSegments: WireSegment[] = [];
  const splitPoints: Point[] = [p1, p2];

  if (p1.x === p2.x || p1.y === p2.y) {
    candidateSegments.push(
      normalizeWire({
        id: generateId('w'),
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
      })
    );
  } else {
    const corner: Point = horizontalFirst ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y };
    splitPoints.push(corner);
    candidateSegments.push(
      normalizeWire({
        id: generateId('w'),
        x1: p1.x,
        y1: p1.y,
        x2: corner.x,
        y2: corner.y,
      })
    );
    candidateSegments.push(
      normalizeWire({
        id: generateId('w'),
        x1: corner.x,
        y1: corner.y,
        x2: p2.x,
        y2: p2.y,
      })
    );
  }

  // Split existing wires at new wire endpoints/corners
  let updatedWires = [...sheet.wires];
  for (const pt of splitPoints) {
    updatedWires = splitWiresAtPoint(updatedWires, pt);
  }

  // Also split the new segments wherever existing wire endpoints lie on them
  const existingEndpoints: Point[] = [];
  for (const w of updatedWires) {
    existingEndpoints.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
  }
  for (const c of sheet.components) {
    const pins = getComponentPins(c);
    existingEndpoints.push(pins.left, pins.right);
  }

  let splitCandidates = [...candidateSegments];
  for (const pt of existingEndpoints) {
    splitCandidates = splitWiresAtPoint(splitCandidates, pt);
  }

  // Avoid running new horizontal wire straight through an existing component body
  const finalNew: WireSegment[] = [];
  for (const seg of splitCandidates) {
    let pieces: WireSegment[] = [seg];
    for (const comp of sheet.components) {
      const nextPieces: WireSegment[] = [];
      for (const p of pieces) {
        const nw = normalizeWire(p);
        const leftX = comp.x - COMPONENT_HALF_SPAN;
        const rightX = comp.x + COMPONENT_HALF_SPAN;
        if (nw.y1 === nw.y2 && nw.y1 === comp.y && nw.x1 < rightX && nw.x2 > leftX) {
          if (nw.x1 < leftX) nextPieces.push({ ...nw, id: generateId('w'), x2: leftX });
          if (nw.x2 > rightX) nextPieces.push({ ...nw, id: generateId('w'), x1: rightX });
        } else {
          nextPieces.push(nw);
        }
      }
      pieces = nextPieces;
    }
    finalNew.push(...pieces);
  }

  const maxY = Math.max(p1.y, p2.y);
  const neededRung = getRungNumber(maxY);

  return {
    ...sheet,
    rungCount: Math.max(sheet.rungCount, neededRung),
    wires: deduplicateWires([...updatedWires, ...finalNew]),
  };
}

export function deduplicateWires(wires: WireSegment[]): WireSegment[] {
  const seen = new Set<string>();
  const out: WireSegment[] = [];
  for (const raw of wires) {
    const w = normalizeWire(raw);
    if (w.x1 === w.x2 && w.y1 === w.y2) continue;
    const key = `${w.x1},${w.y1}-${w.x2},${w.y2}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(w);
    }
  }
  return out;
}

/**
 * Computes all exact junction dot positions where 3+ wire endpoints meet
 * (T-junctions, 4-way crosses, or branches meeting a power rail).
 */
export function computeJunctionDots(
  wires: WireSegment[],
  components: SchematicComponent[]
): Point[] {
  const pointDegree = new Map<string, { x: number; y: number; count: number }>();

  const bump = (x: number, y: number, delta: number = 1) => {
    const key = `${x},${y}`;
    const existing = pointDegree.get(key);
    if (existing) {
      existing.count += delta;
    } else {
      pointDegree.set(key, { x, y, count: delta });
    }
  };

  for (const w of wires) {
    bump(w.x1, w.y1, 1);
    bump(w.x2, w.y2, 1);
    // Power rail connection gets +2 for vertical rail continuity
    if (w.x1 === L1_X || w.x1 === L2_X) bump(w.x1, w.y1, 2);
    if (w.x2 === L1_X || w.x2 === L2_X) bump(w.x2, w.y2, 2);
  }

  // Component pins count as 1 connection each (a wire landing on a pin is degree 2, not a junction;
  // two wires landing on a pin IS a 3-way junction)
  for (const c of components) {
    const pins = getComponentPins(c);
    bump(pins.left.x, pins.left.y, 1);
    bump(pins.right.x, pins.right.y, 1);
  }

  const junctions: Point[] = [];
  for (const entry of pointDegree.values()) {
    if (entry.count >= 3) {
      junctions.push({ x: entry.x, y: entry.y });
    }
  }
  return junctions;
}

/**
 * Generates the next unused sequential tag for a symbol prefix (e.g., CR1 -> CR2).
 */
export function getNextTag(allComponents: SchematicComponent[], prefix: string): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped}(\\d+)$`);
  let maxNum = 0;
  for (const comp of allComponents) {
    const match = comp.tag.match(regex);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return `${prefix}${maxNum + 1}`;
}

/**
 * Adds a full blank horizontal rung wire from L1 to L2 at the next rung row.
 */
export function addBlankRung(sheet: SchematicSheet): SchematicSheet {
  const nextRung = sheet.rungCount + 1;
  const y = getRungY(nextRung);
  return {
    ...sheet,
    rungCount: nextRung,
    wires: deduplicateWires([
      ...sheet.wires,
      {
        id: generateId('w'),
        x1: L1_X,
        y1: y,
        x2: L2_X,
        y2: y,
      },
    ]),
  };
}
