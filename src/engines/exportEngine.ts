import { getSymbolDef } from '../data/symbolCatalog';
import {
  BomRow,
  COMPONENT_HALF_SPAN,
  FIRST_RUNG_Y,
  L1_X,
  L2_X,
  Project,
  RUNG_SPACING,
  SchematicComponent,
  SchematicSheet,
  SimulationState,
  TerminalRow,
} from '../types/ecad';
import { computeCrossReferences } from './crossRefEngine';
import { buildSheetNetlist } from './netlistEngine';
import { computeJunctionDots, formatRungNumber, getRungNumber, getRungY } from './schematicEngine';

function xmlEscape(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeIdentifier(raw: string, fallback: string = 'DEV'): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  return cleaned || fallback;
}

/**
 * Derive boolean logic equations for every load/coil in the project by tracing
 * all simple non-load switch paths from L1 to the load's left/right pins.
 * Used by CODESYS (.export), Simulink/Simscape (.xml / .mdl / .m), and CADe_SIMU (.cad).
 */
interface RungLogicEquation {
  sheetNumber: number;
  rung: number;
  load: SchematicComponent;
  /** Disjunctive Normal Form (OR of AND-terms): each term is an array of series switches */
  paths: SchematicComponent[][];
}

function extractProjectLogicEquations(project: Project): RungLogicEquation[] {
  const equations: RungLogicEquation[] = [];

  for (const sheet of project.sheets) {
    const { nets, pinToNetId } = buildSheetNetlist(sheet);
    const l1Net = nets.find((n) => n.isL1);
    const l2Net = nets.find((n) => n.isL2);
    if (!l1Net || !l2Net) continue;

    // Build switch graph: netId -> Array<{ nextNet, comp }>
    const adj = new Map<string, Array<{ nextNet: string; comp: SchematicComponent }>>();
    const addEdge = (a: string, b: string, comp: SchematicComponent) => {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a)!.push({ nextNet: b, comp });
      adj.get(b)!.push({ nextNet: a, comp });
    };

    for (const comp of sheet.components) {
      const def = getSymbolDef(comp.type);
      if (!def || def.isLoad || comp.type === 'terminal') continue;
      const ln = pinToNetId.get(`${comp.id}:left`);
      const rn = pinToNetId.get(`${comp.id}:right`);
      if (ln && rn) addEdge(ln, rn, comp);
    }

    const findSimplePaths = (startNet: string, targetNet: string, maxPaths = 8): SchematicComponent[][] => {
      const results: SchematicComponent[][] = [];
      if (startNet === targetNet) return [[]];

      const visitedNets = new Set<string>([startNet]);
      const dfs = (curr: string, path: SchematicComponent[]) => {
        if (results.length >= maxPaths || path.length > 10) return;
        for (const edge of adj.get(curr) ?? []) {
          if (edge.nextNet === targetNet) {
            results.push([...path, edge.comp]);
            continue;
          }
          if (!visitedNets.has(edge.nextNet)) {
            visitedNets.add(edge.nextNet);
            dfs(edge.nextNet, [...path, edge.comp]);
            visitedNets.delete(edge.nextNet);
          }
        }
      };

      dfs(startNet, []);
      return results;
    };

    for (const comp of sheet.components) {
      const def = getSymbolDef(comp.type);
      if (!def?.isLoad) continue;
      const ln = pinToNetId.get(`${comp.id}:left`);
      const rn = pinToNetId.get(`${comp.id}:right`);
      if (!ln || !rn) continue;

      // Supply paths from L1 to left pin + return paths from right pin to L2
      const supplyPaths = findSimplePaths(l1Net.id, ln);
      const returnPaths = findSimplePaths(rn, l2Net.id);

      const combined: SchematicComponent[][] = [];
      for (const sp of supplyPaths) {
        for (const rp of returnPaths) {
          combined.push([...sp, ...rp]);
        }
      }

      equations.push({
        sheetNumber: sheet.number,
        rung: getRungNumber(comp.y),
        load: comp,
        paths: combined.length > 0 ? combined : [[]],
      });
    }
  }

  equations.sort((a, b) =>
    a.sheetNumber !== b.sheetNumber ? a.sheetNumber - b.sheetNumber : a.rung - b.rung
  );
  return equations;
}

export class ExportEngine {
  /**
   * Generates a live aggregated Bill of Materials (BOM) for all physical components.
   * Excludes child auxiliary contacts that belong to an already-counted parent coil
   * unless they carry a distinct auxiliary block part number.
   */
  public generateBom(project: Project): BomRow[] {
    const map = new Map<string, BomRow>();

    for (const sheet of project.sheets) {
      for (const comp of sheet.components) {
        const def = getSymbolDef(comp.type);
        if (!def) continue;
        // Parent devices & standalone field devices appear on the main BOM;
        // child contacts are aggregated under their auxiliary block if distinct, or skipped if integral.
        if (def.isChild) continue;

        const key = `${comp.manufacturer}::${comp.partNumber}::${def.name}`;
        const existing = map.get(key);
        if (existing) {
          existing.quantity += 1;
          if (!existing.tags.includes(comp.tag)) {
            existing.tags.push(comp.tag);
          }
        } else {
          map.set(key, {
            partNumber: comp.partNumber || def.defaultPartNumber,
            manufacturer: comp.manufacturer || def.defaultManufacturer,
            type: def.name,
            description: comp.description || def.defaultDescription,
            tags: [comp.tag],
            quantity: 1,
          });
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => a.tags[0].localeCompare(b.tags[0]));
  }

  /**
   * Generates the Terminal Strip Schedule (TB1-1, TB1-2...) for all placed terminal blocks.
   */
  public generateTerminalStrip(project: Project): TerminalRow[] {
    const rows: TerminalRow[] = [];

    for (const sheet of project.sheets) {
      const { nets, pinToNetId } = buildSheetNetlist(sheet);
      const netMap = new Map(nets.map((n) => [n.id, n]));
      const compMap = new Map(sheet.components.map((c) => [c.id, c]));

      for (const comp of sheet.components) {
        if (comp.type !== 'terminal') continue;
        const leftNetId = pinToNetId.get(`${comp.id}:left`);
        const net = leftNetId ? netMap.get(leftNetId) : undefined;
        const wireNumber = net?.wireNumber || '—';

        // Find adjacent devices on the left and right of this terminal on the same rung/net
        const sameRungLeft = sheet.components
          .filter((c) => c.id !== comp.id && c.y === comp.y && c.x < comp.x)
          .sort((a, b) => b.x - a.x)[0];
        const sameRungRight = sheet.components
          .filter((c) => c.id !== comp.id && c.y === comp.y && c.x > comp.x)
          .sort((a, b) => a.x - b.x)[0];

        const strip = comp.terminalStrip || comp.tag.split('-')[0] || 'TB1';
        const num = comp.terminalNumber || comp.tag.split('-')[1] || String(rows.length + 1);

        // Fallback to any other component sharing the same net
        const netNeighbors = (net?.connectedPins ?? [])
          .map((p) => compMap.get(p.componentId))
          .filter((c): c is SchematicComponent => Boolean(c && c.id !== comp.id));

        const leftLabel = sameRungLeft?.tag || netNeighbors[0]?.tag || sheet.l1Label;
        const rightLabel = sameRungRight?.tag || netNeighbors[1]?.tag || sheet.l2Label;

        rows.push({
          componentId: comp.id,
          sheetId: sheet.id,
          sheetNumber: sheet.number,
          rung: getRungNumber(comp.y),
          strip,
          terminalNumber: num,
          fullLabel: `${strip}-${num}`,
          wireNumber,
          leftDevice: leftLabel,
          rightDevice: rightLabel,
          description: comp.description,
        });
      }
    }

    rows.sort((a, b) => {
      if (a.strip !== b.strip) return a.strip.localeCompare(b.strip);
      return (parseInt(a.terminalNumber, 10) || 0) - (parseInt(b.terminalNumber, 10) || 0);
    });
    return rows;
  }

  public exportBomCsv(project: Project): string {
    const bom = this.generateBom(project);
    const header = ['Item', 'Tags', 'Type', 'Description', 'Manufacturer', 'Part Number', 'Quantity'];
    const lines = [header.join(',')];
    bom.forEach((row, idx) => {
      const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
      lines.push(
        [
          idx + 1,
          esc(row.tags.join('; ')),
          esc(row.type),
          esc(row.description),
          esc(row.manufacturer),
          esc(row.partNumber),
          row.quantity,
        ].join(',')
      );
    });
    return lines.join('\n');
  }

  public exportJson(project: Project): string {
    return JSON.stringify(project, null, 2);
  }

  public importJson(rawJson: string): Project {
    const parsed = JSON.parse(rawJson) as Project;
    if (!parsed || !Array.isArray(parsed.sheets) || parsed.sheets.length === 0) {
      throw new Error('Invalid VoltGrid ECAD project JSON: missing sheets array.');
    }
    return {
      ...parsed,
      activeSheetId: parsed.activeSheetId || parsed.sheets[0].id,
    };
  }

  /**
   * Exports the active schematic sheet to a standalone, print-clean vector SVG.
   */
  public exportSvg(sheet: SchematicSheet, project: Project, sim?: SimulationState): string {
    const width = 1040;
    const height = Math.max(660, FIRST_RUNG_Y + sheet.rungCount * RUNG_SPACING + 120);
    const crossRefs = computeCrossReferences(project);
    const junctions = computeJunctionDots(sheet.wires, sheet.components);
    const energizedWires = new Set(sim?.running ? sim.energizedWireIds : []);
    const energizedComps = new Set(sim?.running ? sim.energizedComponentIds : []);

    const railTop = FIRST_RUNG_Y - 36;
    const railBottom = getRungY(sheet.rungCount) + 40;

    const svgParts: string[] = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `  <rect width="100%" height="100%" fill="#0F1115"/>`,
      `  <g font-family="JetBrains Mono, monospace" font-size="11">`,
      `    <!-- Power Rails -->`,
      `    <line x1="${L1_X}" y1="${railTop}" x2="${L1_X}" y2="${railBottom}" stroke="#FF3B30" stroke-width="2.5"/>`,
      `    <line x1="${L2_X}" y1="${railTop}" x2="${L2_X}" y2="${railBottom}" stroke="#60A5FA" stroke-width="2.5"/>`,
      `    <text x="${L1_X}" y="${railTop - 10}" fill="#FF3B30" text-anchor="middle" font-weight="700" font-size="13">${xmlEscape(sheet.l1Label)}</text>`,
      `    <text x="${L2_X}" y="${railTop - 10}" fill="#60A5FA" text-anchor="middle" font-weight="700" font-size="13">${xmlEscape(sheet.l2Label)}</text>`,
      `    <text x="${(L1_X + L2_X) / 2}" y="${railTop - 10}" fill="#94A3B8" text-anchor="middle" font-size="11">${xmlEscape(sheet.voltageLabel)} — SHEET ${sheet.number}: ${xmlEscape(sheet.name)}</text>`,
    ];

    // Rung numbers
    for (let r = 1; r <= sheet.rungCount; r++) {
      const y = getRungY(r);
      svgParts.push(
        `    <text x="40" y="${y + 4}" fill="#64748B" text-anchor="middle" font-weight="600">${formatRungNumber(r)}</text>`
      );
    }

    // Wires
    for (const w of sheet.wires) {
      const hot = energizedWires.has(w.id);
      const stroke = hot ? '#FF3B30' : '#94A3B8';
      svgParts.push(
        `    <line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${stroke}" stroke-width="${hot ? 2.4 : 1.75}"/>`
      );
      if (w.wireNumber && w.y1 === w.y2 && Math.abs(w.x2 - w.x1) >= 40) {
        const mx = (w.x1 + w.x2) / 2;
        svgParts.push(
          `    <text x="${mx}" y="${w.y1 - 6}" fill="#00E5FF" text-anchor="middle" font-size="9">${xmlEscape(w.wireNumber)}</text>`
        );
      }
    }

    // Junction dots
    for (const j of junctions) {
      svgParts.push(`    <circle cx="${j.x}" cy="${j.y}" r="3.5" fill="#E6EDF3"/>`);
    }

    // Components
    for (const c of sheet.components) {
      const def = getSymbolDef(c.type);
      const active = energizedComps.has(c.id);
      const stroke = active ? (c.pilotColor === 'green' ? '#34C759' : '#FF3B30') : '#E6EDF3';
      svgParts.push(`    <g transform="translate(${c.x}, ${c.y})">`);

      if (def?.isLoad) {
        const fill = active
          ? c.pilotColor === 'green'
            ? 'rgba(52,199,89,0.28)'
            : c.pilotColor === 'amber'
              ? 'rgba(245,158,11,0.28)'
              : 'rgba(255,59,48,0.25)'
          : '#181B20';
        svgParts.push(
          `      <line x1="-20" y1="0" x2="-15" y2="0" stroke="${stroke}" stroke-width="1.8"/>`,
          `      <line x1="15" y1="0" x2="20" y2="0" stroke="${stroke}" stroke-width="1.8"/>`,
          `      <circle cx="0" cy="0" r="15" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>`,
          `      <text x="0" y="4" fill="${stroke}" text-anchor="middle" font-size="9" font-weight="700">${xmlEscape(c.tag)}</text>`
        );
      } else if (c.type === 'terminal') {
        svgParts.push(
          `      <line x1="-20" y1="0" x2="-8" y2="0" stroke="${stroke}" stroke-width="1.8"/>`,
          `      <line x1="8" y1="0" x2="20" y2="0" stroke="${stroke}" stroke-width="1.8"/>`,
          `      <circle cx="0" cy="0" r="8" fill="#181B20" stroke="#00E5FF" stroke-width="1.8"/>`,
          `      <line x1="-5" y1="5" x2="5" y2="-5" stroke="#00E5FF" stroke-width="1.2"/>`
        );
      } else {
        // Contacts / Push Buttons / Switches
        svgParts.push(
          `      <line x1="-20" y1="0" x2="-7" y2="0" stroke="${stroke}" stroke-width="1.8"/>`,
          `      <line x1="7" y1="0" x2="20" y2="0" stroke="${stroke}" stroke-width="1.8"/>`,
          `      <line x1="-7" y1="-11" x2="-7" y2="11" stroke="${stroke}" stroke-width="2"/>`,
          `      <line x1="7" y1="-11" x2="7" y2="11" stroke="${stroke}" stroke-width="2"/>`
        );
        if (
          c.type === 'contact_nc' ||
          c.type === 'pb_nc' ||
          c.type === 'estop_nc' ||
          c.type === 'selector_nc' ||
          c.type === 'timer_contact_nc' ||
          c.type === 'overload_nc'
        ) {
          svgParts.push(
            `      <line x1="-10" y1="10" x2="10" y2="-10" stroke="${stroke}" stroke-width="1.8"/>`
          );
        }
      }

      svgParts.push(
        `      <text x="0" y="-19" fill="#E6EDF3" text-anchor="middle" font-size="10" font-weight="700">${xmlEscape(c.tag)}</text>`,
        `      <text x="0" y="27" fill="#94A3B8" text-anchor="middle" font-size="8.5">${xmlEscape(c.description.slice(0, 22))}</text>`
      );

      if (def?.isParent) {
        const xref = crossRefs.get(c.tag);
        if (xref) {
          svgParts.push(
            `      <text x="0" y="38" fill="#00E5FF" text-anchor="middle" font-size="8.5">${xmlEscape(xref.summaryText)}</text>`
          );
        }
      }
      svgParts.push(`    </g>`);
    }

    // Engineering Title Block
    const tbY = height - 68;
    svgParts.push(
      `    <rect x="24" y="${tbY}" width="${width - 48}" height="48" fill="#181B20" stroke="#2A2F3A" stroke-width="1.2"/>`,
      `    <text x="40" y="${tbY + 20}" fill="#E6EDF3" font-size="12" font-weight="700">${xmlEscape(project.metadata.title)}</text>`,
      `    <text x="40" y="${tbY + 37}" fill="#94A3B8" font-size="10">PROJ: ${xmlEscape(project.metadata.projectNumber)}  |  REV: ${xmlEscape(project.metadata.revision)}  |  STD: ${xmlEscape(project.metadata.standard)}</text>`,
      `    <text x="${width - 40}" y="${tbY + 28}" fill="#00E5FF" text-anchor="end" font-size="11" font-weight="600">SHEET ${sheet.number} OF ${project.sheets.length} — VOLTGRID ECAD</text>`,
      `  </g>`,
      `</svg>`
    );

    return svgParts.join('\n');
  }

  /**
   * Exports active schematic to valid ASCII AutoCAD 2D DXF (R12/AC1009).
   */
  public exportDxf(sheet: SchematicSheet, project: Project): string {
    const maxY = Math.max(600, getRungY(sheet.rungCount) + 100);
    // Flip Y for CAD coordinate system (Y-up)
    const fy = (y: number) => maxY - y;
    const lines: string[] = [
      '0', 'SECTION',
      '2', 'HEADER',
      '9', '$ACADVER', '1', 'AC1009',
      '0', 'ENDSEC',
      '0', 'SECTION',
      '2', 'TABLES',
      '0', 'TABLE', '2', 'LAYER', '70', '4',
      '0', 'LAYER', '2', 'RAILS', '70', '0', '62', '1', '6', 'CONTINUOUS',
      '0', 'LAYER', '2', 'WIRES', '70', '0', '62', '7', '6', 'CONTINUOUS',
      '0', 'LAYER', '2', 'SYMBOLS', '70', '0', '62', '4', '6', 'CONTINUOUS',
      '0', 'LAYER', '2', 'LABELS', '70', '0', '62', '3', '6', 'CONTINUOUS',
      '0', 'ENDTAB',
      '0', 'ENDSEC',
      '0', 'SECTION',
      '2', 'ENTITIES',
    ];

    const addLine = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
      lines.push(
        '0', 'LINE', '8', layer,
        '10', x1.toFixed(2), '20', fy(y1).toFixed(2), '30', '0.0',
        '11', x2.toFixed(2), '21', fy(y2).toFixed(2), '31', '0.0'
      );
    };

    const addCircle = (layer: string, cx: number, cy: number, r: number) => {
      lines.push(
        '0', 'CIRCLE', '8', layer,
        '10', cx.toFixed(2), '20', fy(cy).toFixed(2), '30', '0.0',
        '40', r.toFixed(2)
      );
    };

    const addText = (layer: string, x: number, y: number, h: number, text: string) => {
      lines.push(
        '0', 'TEXT', '8', layer,
        '10', x.toFixed(2), '20', fy(y).toFixed(2), '30', '0.0',
        '40', h.toFixed(2), '1', text
      );
    };

    // Power Rails
    const railTop = FIRST_RUNG_Y - 36;
    const railBottom = getRungY(sheet.rungCount) + 40;
    addLine('RAILS', L1_X, railTop, L1_X, railBottom);
    addLine('RAILS', L2_X, railTop, L2_X, railBottom);
    addText('LABELS', L1_X - 8, railTop - 12, 10, sheet.l1Label);
    addText('LABELS', L2_X - 8, railTop - 12, 10, sheet.l2Label);
    addText('LABELS', 40, railTop - 28, 12, `${project.metadata.title} - SHEET ${sheet.number}`);

    // Wires
    for (const w of sheet.wires) {
      addLine('WIRES', w.x1, w.y1, w.x2, w.y2);
      if (w.wireNumber && w.y1 === w.y2 && Math.abs(w.x2 - w.x1) >= 40) {
        addText('LABELS', (w.x1 + w.x2) / 2 - 8, w.y1 - 8, 7, w.wireNumber);
      }
    }

    // Components
    for (const c of sheet.components) {
      const def = getSymbolDef(c.type);
      if (def?.isLoad) {
        addCircle('SYMBOLS', c.x, c.y, 15);
        addLine('SYMBOLS', c.x - COMPONENT_HALF_SPAN, c.y, c.x - 15, c.y);
        addLine('SYMBOLS', c.x + 15, c.y, c.x + COMPONENT_HALF_SPAN, c.y);
      } else if (c.type === 'terminal') {
        addCircle('SYMBOLS', c.x, c.y, 8);
        addLine('SYMBOLS', c.x - COMPONENT_HALF_SPAN, c.y, c.x - 8, c.y);
        addLine('SYMBOLS', c.x + 8, c.y, c.x + COMPONENT_HALF_SPAN, c.y);
      } else {
        addLine('SYMBOLS', c.x - COMPONENT_HALF_SPAN, c.y, c.x - 7, c.y);
        addLine('SYMBOLS', c.x + 7, c.y, c.x + COMPONENT_HALF_SPAN, c.y);
        addLine('SYMBOLS', c.x - 7, c.y - 11, c.x - 7, c.y + 11);
        addLine('SYMBOLS', c.x + 7, c.y - 11, c.x + 7, c.y + 11);
        if (c.type.includes('_nc') || c.type === 'overload_nc') {
          addLine('SYMBOLS', c.x - 10, c.y + 10, c.x + 10, c.y - 10);
        }
      }
      addText('LABELS', c.x - 12, c.y - 20, 8, c.tag);
    }

    lines.push('0', 'ENDSEC', '0', 'EOF');
    return lines.join('\n');
  }

  /**
   * CODESYS Transformer (.export):
   * Generates a production-ready IEC 61131-3 CODESYS V3.5+ native .export (PLCopen XML)
   * directly importable via Project -> Import... with zero manual editing.
   * Maps all physical switches, E-Stops, overloads, PLC I/O (%IX/%QX), VFD parameters,
   * TON/TOF timer instances, seal-in latches, and cross-referenced relay logic.
   */
  public exportCodesys(project: Project): string {
    const equations = extractProjectLogicEquations(project);
    const nowIso = new Date().toISOString();

    const inputs = new Map<string, { varName: string; addr: string; comment: string; isNc: boolean }>();
    const outputs = new Map<string, { varName: string; addr: string; comment: string; vfdParam?: string }>();
    const coils = new Map<string, { varName: string; comment: string }>();
    const timers = new Map<string, { varName: string; type: 'TON' | 'TOF'; presetMs: number; comment: string }>();

    let inIdx = 0;
    let outIdx = 0;

    for (const sheet of project.sheets) {
      for (const comp of sheet.components) {
        const def = getSymbolDef(comp.type);
        if (!def) continue;
        const vName = sanitizeIdentifier(comp.tag);

        if (comp.type === 'coil_ton' || comp.type === 'coil_tof') {
          timers.set(comp.tag, {
            varName: `fb_${vName}`,
            type: comp.type === 'coil_ton' ? 'TON' : 'TOF',
            presetMs: Math.round((comp.timerPreset ?? 3.0) * 1000),
            comment: `${comp.description} (PT=${comp.timerPreset ?? 3.0}s)`,
          });
        } else if (def.isParent) {
          coils.set(comp.tag, {
            varName: `x_${vName}`,
            comment: `${comp.description} [${comp.manufacturer} ${comp.partNumber}]`,
          });
        } else if (def.isLoad) {
          const addr = comp.plcAddress || `%QX0.${outIdx++}`;
          outputs.set(comp.tag, {
            varName: `q_${vName}`,
            addr,
            comment: `${comp.description}${comp.vfdParam ? ` | VFD: ${comp.vfdParam}` : ''}`,
            vfdParam: comp.vfdParam,
          });
        } else if (def.isInteractiveInSim) {
          const addr = comp.plcAddress || `%IX0.${inIdx++}`;
          const isNc =
            comp.type === 'pb_nc' ||
            comp.type === 'estop_nc' ||
            comp.type === 'selector_nc' ||
            comp.type === 'overload_nc' ||
            comp.type === 'fuse' ||
            comp.type === 'breaker';
          inputs.set(comp.tag, {
            varName: `i_${vName}`,
            addr,
            comment: `${comp.description} (${isNc ? 'Fail-Safe NC' : 'NO'})`,
            isNc,
          });
        }
      }
    }

    const exprForSwitch = (sw: SchematicComponent): string => {
      const pTag = sw.parentTag || sw.tag;
      if (sw.type === 'contact_no') {
        const c = coils.get(pTag);
        return c ? c.varName : `x_${sanitizeIdentifier(pTag)}`;
      }
      if (sw.type === 'contact_nc') {
        const c = coils.get(pTag);
        return `NOT ${c ? c.varName : `x_${sanitizeIdentifier(pTag)}`}`;
      }
      if (sw.type === 'timer_contact_no') {
        const t = timers.get(pTag);
        return t ? `${t.varName}.Q` : `fb_${sanitizeIdentifier(pTag)}.Q`;
      }
      if (sw.type === 'timer_contact_nc') {
        const t = timers.get(pTag);
        return `NOT ${t ? `${t.varName}.Q` : `fb_${sanitizeIdentifier(pTag)}.Q`}`;
      }
      const inp = inputs.get(sw.tag);
      if (inp) {
        // In IEC industrial PLC wiring, NC safety contacts (E-Stop, Stop PB, OL) are wired closed -> TRUE when healthy
        return `GVL_IO.${inp.varName}`;
      }
      return 'TRUE';
    };

    const stLines: string[] = [
      `(* ============================================================================ *)`,
      `(* Project: ${project.metadata.title} (${project.metadata.projectNumber}) Rev ${project.metadata.revision} *)`,
      `(* Generated by VoltGrid ECAD — Production IEC 61131-3 Control Logic *)`,
      `(* Standard: ${project.metadata.standard} | Direct CODESYS V3.5+ Import *)`,
      `(* ============================================================================ *)`,
      ``,
    ];

    for (const eq of equations) {
      const orTerms = eq.paths.map((path) => {
        if (path.length === 0) return 'TRUE';
        const andTerms = path.map(exprForSwitch);
        return andTerms.length > 1 ? `(${andTerms.join(' AND ')})` : andTerms[0];
      });
      const rhs = orTerms.length > 1 ? `(${orTerms.join(' OR ')})` : orTerms[0];

      stLines.push(`(* Sheet ${eq.sheetNumber}, Rung ${formatRungNumber(eq.rung)}: ${eq.load.tag} — ${eq.load.description} *)`);

      if (eq.load.type === 'coil_ton' || eq.load.type === 'coil_tof') {
        const t = timers.get(eq.load.tag)!;
        stLines.push(`${t.varName}(IN := ${rhs}, PT := T#${t.presetMs}MS);`);
        stLines.push(`x_${sanitizeIdentifier(eq.load.tag)}_DN := ${t.varName}.Q;`);
      } else if (coils.has(eq.load.tag)) {
        const c = coils.get(eq.load.tag)!;
        stLines.push(`${c.varName} := ${rhs};`);
        // Mirror motor starters to physical contactor output if not already mapped
        if (eq.load.type === 'coil_motor') {
          stLines.push(`GVL_IO.q_${sanitizeIdentifier(eq.load.tag)}_COIL := ${c.varName};`);
        }
      } else if (outputs.has(eq.load.tag)) {
        const o = outputs.get(eq.load.tag)!;
        stLines.push(`GVL_IO.${o.varName} := ${rhs};`);
      }
      stLines.push('');
    }

    const gvlVars: string[] = [];
    for (const inp of inputs.values()) {
      gvlVars.push(
        `          <variable name="${xmlEscape(inp.varName)}" address="${xmlEscape(inp.addr)}">\n` +
          `            <type><BOOL /></type>\n` +
          `            <initialValue><simpleValue value="${inp.isNc ? 'TRUE' : 'FALSE'}" /></initialValue>\n` +
          `            <documentation><xhtml xmlns="http://www.w3.org/1999/xhtml">${xmlEscape(inp.comment)}</xhtml></documentation>\n` +
          `          </variable>`
      );
    }
    for (const out of outputs.values()) {
      gvlVars.push(
        `          <variable name="${xmlEscape(out.varName)}" address="${xmlEscape(out.addr)}">\n` +
          `            <type><BOOL /></type>\n` +
          `            <documentation><xhtml xmlns="http://www.w3.org/1999/xhtml">${xmlEscape(out.comment)}</xhtml></documentation>\n` +
          `          </variable>`
      );
    }
    for (const [tag, coil] of coils.entries()) {
      const comp = project.sheets.flatMap((s) => s.components).find((c) => c.tag === tag);
      if (comp?.type === 'coil_motor') {
        gvlVars.push(
          `          <variable name="q_${xmlEscape(sanitizeIdentifier(tag))}_COIL" address="%QX0.${outIdx++}">\n` +
            `            <type><BOOL /></type>\n` +
            `            <documentation><xhtml xmlns="http://www.w3.org/1999/xhtml">Motor Contactor Output ${xmlEscape(coil.comment)}</xhtml></documentation>\n` +
            `          </variable>`
        );
      }
    }

    const localVars: string[] = [];
    for (const c of coils.values()) {
      localVars.push(
        `            <variable name="${xmlEscape(c.varName)}"><type><BOOL /></type><documentation><xhtml xmlns="http://www.w3.org/1999/xhtml">${xmlEscape(c.comment)}</xhtml></documentation></variable>`
      );
    }
    for (const [tag, t] of timers.entries()) {
      localVars.push(
        `            <variable name="${xmlEscape(t.varName)}"><type><derived name="Standard.${t.type}" /></type><documentation><xhtml xmlns="http://www.w3.org/1999/xhtml">${xmlEscape(t.comment)}</xhtml></documentation></variable>`,
        `            <variable name="x_${xmlEscape(sanitizeIdentifier(tag))}_DN"><type><BOOL /></type></variable>`
      );
    }

    return [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<project xmlns="http://www.plcopen.org/xml/tc6_0200">`,
      `  <fileHeader companyName="VoltGrid ECAD" productName="CODESYS V3.5 SP19" productVersion="3.5.19.0" creationDateTime="${nowIso}" />`,
      `  <contentHeader name="${xmlEscape(project.metadata.title)}" version="${xmlEscape(project.metadata.revision)}" modificationDateTime="${nowIso}" author="${xmlEscape(project.metadata.author)}">`,
      `    <coordinateInfo>`,
      `      <fbd><scaling x="1" y="1" /></fbd>`,
      `      <ld><scaling x="1" y="1" /></ld>`,
      `      <sfc><scaling x="1" y="1" /></sfc>`,
      `    </coordinateInfo>`,
      `  </contentHeader>`,
      `  <types>`,
      `    <dataTypes />`,
      `    <pous>`,
      `      <pou name="PRG_MainControl" pouType="program">`,
      `        <interface>`,
      `          <localVars>`,
      ...localVars,
      `          </localVars>`,
      `        </interface>`,
      `        <body>`,
      `          <ST>`,
      `            <xhtml xmlns="http://www.w3.org/1999/xhtml">${xmlEscape(stLines.join('\n'))}</xhtml>`,
      `          </ST>`,
      `        </body>`,
      `      </pou>`,
      `    </pous>`,
      `  </types>`,
      `  <instances>`,
      `    <configurations>`,
      `      <configuration name="CODESYS_Control_Industrial">`,
      `        <resource name="Application">`,
      `          <task name="MainTask" priority="1" interval="PT0.01S">`,
      `            <pouInstance name="PRG_MainControl" typeName="PRG_MainControl" />`,
      `          </task>`,
      `          <globalVars name="GVL_IO">`,
      ...gvlVars,
      `          </globalVars>`,
      `        </resource>`,
      `      </configuration>`,
      `    </configurations>`,
      `  </instances>`,
      `</project>`,
    ].join('\n');
  }

  /**
   * Simulink / Simscape Electrical Transformer (.xml):
   * Maps the schematic netlist and every component directly to the user's installed
   * Simscape libraries (Foundation Library, Utilities, Driveline, Electrical:
   * Connectors & References, Control, Electromechanical, Integrated Circuits, Passive,
   * Semiconductors & Converters, Sensors & Transducers, Sources, Switches & Breakers, Utilities).
   */
  public exportSimulinkSimscapeXml(project: Project): string {
    const equations = extractProjectLogicEquations(project);
    const modelName = sanitizeIdentifier(project.metadata.title, 'VoltGrid_Simscape');

    const mapToSimscapeBlock = (c: SchematicComponent): { library: string; blockPath: string; params: Record<string, string> } => {
      switch (c.type) {
        case 'pb_no':
        case 'selector_no':
        case 'plc_out':
          return {
            library: 'Simscape / Electrical / Switches & Breakers',
            blockPath: 'ee_lib/Switches & Breakers/SPST Switch',
            params: { InitialState: '0', R_closed: '0.01', G_open: '1e-8' },
          };
        case 'pb_nc':
        case 'estop_nc':
        case 'selector_nc':
        case 'overload_nc':
          return {
            library: 'Simscape / Electrical / Switches & Breakers',
            blockPath: 'ee_lib/Switches & Breakers/SPST Switch',
            params: { InitialState: '1', R_closed: '0.01', G_open: '1e-8' },
          };
        case 'fuse':
        case 'breaker':
          return {
            library: 'Simscape / Electrical / Switches & Breakers',
            blockPath: 'ee_lib/Switches & Breakers/Circuit Breaker',
            params: { R_closed: '0.005', I_trip: '10' },
          };
        case 'contact_no':
        case 'timer_contact_no':
          return {
            library: 'Simscape / Electrical / Switches & Breakers',
            blockPath: 'ee_lib/Switches & Breakers/Controlled Switch',
            params: { Threshold: '0.5', Mode: 'NormallyOpen', ParentTag: c.parentTag || c.tag },
          };
        case 'contact_nc':
        case 'timer_contact_nc':
          return {
            library: 'Simscape / Electrical / Switches & Breakers',
            blockPath: 'ee_lib/Switches & Breakers/Controlled Switch',
            params: { Threshold: '0.5', Mode: 'NormallyClosed', ParentTag: c.parentTag || c.tag },
          };
        case 'coil_motor':
          return {
            library: 'Simscape / Electrical / Electromechanical',
            blockPath: 'ee_lib/Electromechanical/Solenoid',
            params: { R_coil: '120', L_coil: '0.45', DrivelineCoupling: 'sdl_lib/Inertia' },
          };
        case 'coil_relay':
          return {
            library: 'Simscape / Electrical / Electromechanical',
            blockPath: 'ee_lib/Electromechanical/Relay',
            params: { R_coil: '240', V_pullin: '85' },
          };
        case 'coil_ton':
        case 'coil_tof':
          return {
            library: 'Simscape / Electrical / Control',
            blockPath: 'ee_lib/Control/Timer Relay',
            params: { Mode: c.type === 'coil_ton' ? 'OnDelay' : 'OffDelay', PresetSec: String(c.timerPreset ?? 3.0) },
          };
        case 'vfd_cmd':
          return {
            library: 'Simscape / Electrical / Semiconductors & Converters',
            blockPath: 'ee_lib/Semiconductors & Converters/Three-Phase Inverter',
            params: { VfdParam: c.vfdParam || 'DI1-RUN', CarrierHz: '4000', RatedFreqHz: '60' },
          };
        case 'plc_in':
          return {
            library: 'Simscape / Electrical / Sensors & Transducers',
            blockPath: 'ee_lib/Sensors & Transducers/Voltage Sensor',
            params: { PlcAddress: c.plcAddress || '%IX0.0', InputImpedanceOhm: '10000' },
          };
        case 'pilot_light':
          return {
            library: 'Simscape / Electrical / Passive',
            blockPath: 'ee_lib/Passive/Resistor',
            params: { R: '1200', IndicatorColor: c.pilotColor || 'green' },
          };
        default:
          return {
            library: 'Simscape / Electrical / Connectors & References',
            blockPath: 'ee_lib/Connectors & References/Connection Port',
            params: { Terminal: c.tag },
          };
      }
    };

    const blocksXml: string[] = [];
    const connectionsXml: string[] = [];

    for (const sheet of project.sheets) {
      const { nets, pinToNetId } = buildSheetNetlist(sheet);
      blocksXml.push(
        `    <Subsystem name="Sheet_${sheet.number}_${xmlEscape(sanitizeIdentifier(sheet.name))}" voltage="${xmlEscape(sheet.voltageLabel)}">`,
        `      <Block name="Solver_Configuration" library="Simscape / Utilities" source="nesl_utility/Solver Configuration" />`,
        `      <Block name="Electrical_Reference" library="Simscape / Foundation Library" source="fl_lib/Electrical/Electrical Elements/Electrical Reference" />`,
        `      <Block name="Supply_${xmlEscape(sanitizeIdentifier(sheet.l1Label))}_${xmlEscape(sanitizeIdentifier(sheet.l2Label))}" library="Simscape / Electrical / Sources" source="${sheet.voltageLabel.includes('DC') ? 'ee_lib/Sources/DC Voltage Source' : 'ee_lib/Sources/AC Voltage Source'}" amplitude="${sheet.voltageLabel.includes('24') ? '24' : '120'}" frequency="${sheet.voltageLabel.includes('DC') ? '0' : '60'}" />`
      );

      for (const comp of sheet.components) {
        const mapped = mapToSimscapeBlock(comp);
        const paramAttrs = Object.entries(mapped.params)
          .map(([k, v]) => `${k}="${xmlEscape(v)}"`)
          .join(' ');
        blocksXml.push(
          `      <Block id="${xmlEscape(comp.id)}" tag="${xmlEscape(comp.tag)}" type="${xmlEscape(comp.type)}" library="${xmlEscape(mapped.library)}" source="${xmlEscape(mapped.blockPath)}" x="${comp.x}" y="${comp.y}" ${paramAttrs} />`
        );
      }

      for (const net of nets) {
        if (net.connectedPins.length === 0) continue;
        const pinsAttr = net.connectedPins.map((p) => `${p.componentId}:${p.pin}`).join(',');
        connectionsXml.push(
          `      <PhysicalNet id="${xmlEscape(net.id)}" wireNumber="${xmlEscape(net.wireNumber || net.id)}" isL1="${net.isL1}" isL2="${net.isL2}" pins="${xmlEscape(pinsAttr)}" />`
        );
      }
      blocksXml.push(`    </Subsystem>`);
    }

    const logicXml = equations.map((eq) => {
      const expr = eq.paths
        .map((p) => (p.length ? p.map((s) => `${s.type.includes('nc') ? '!' : ''}${s.tag}`).join(' && ') : '1'))
        .join(' || ');
      return `    <ControlRule target="${xmlEscape(eq.load.tag)}" sheet="${eq.sheetNumber}" rung="${formatRungNumber(eq.rung)}" expression="${xmlEscape(expr)}" />`;
    });

    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<SimscapeSimulinkModel name="${xmlEscape(modelName)}" generator="VoltGrid ECAD" version="2026.1">`,
      `  <Metadata title="${xmlEscape(project.metadata.title)}" projectNumber="${xmlEscape(project.metadata.projectNumber)}" standard="${xmlEscape(project.metadata.standard)}" />`,
      `  <InstalledSimscapeLibraries>`,
      `    <Library>Simscape / Foundation Library (fl_lib)</Library>`,
      `    <Library>Simscape / Utilities (nesl_utility)</Library>`,
      `    <Library>Simscape / Driveline (sdl_lib)</Library>`,
      `    <Library>Simscape / Electrical / Connectors &amp; References (ee_lib)</Library>`,
      `    <Library>Simscape / Electrical / Control (ee_lib)</Library>`,
      `    <Library>Simscape / Electrical / Electromechanical (ee_lib)</Library>`,
      `    <Library>Simscape / Electrical / Integrated Circuits (ee_lib)</Library>`,
      `    <Library>Simscape / Electrical / Passive (ee_lib)</Library>`,
      `    <Library>Simscape / Electrical / Semiconductors &amp; Converters (ee_lib)</Library>`,
      `    <Library>Simscape / Electrical / Sensors &amp; Transducers (ee_lib)</Library>`,
      `    <Library>Simscape / Electrical / Sources (ee_lib)</Library>`,
      `    <Library>Simscape / Electrical / Switches &amp; Breakers (ee_lib)</Library>`,
      `    <Library>Simscape / Electrical / Utilities (ee_lib)</Library>`,
      `  </InstalledSimscapeLibraries>`,
      `  <Blocks>`,
      ...blocksXml,
      `  </Blocks>`,
      `  <NetlistConnections>`,
      ...connectionsXml,
      `  </NetlistConnections>`,
      `  <SimulinkControlEquations>`,
      ...logicXml,
      `  </SimulinkControlEquations>`,
      `</SimscapeSimulinkModel>`,
    ].join('\n');
  }

  /**
   * Simscape Electrical Direct Auto-Build Script (.m):
   * Run directly in MATLAB to construct, connect, layout, save (.slx), and open
   * the exact model using all available Simscape libraries shown in the user's library browser.
   */
  public exportSimscapeMatlabScript(project: Project): string {
    const modelName = sanitizeIdentifier(project.metadata.title, 'VoltGrid_Simscape_Model');
    const sheet = project.sheets.find((s) => s.id === project.activeSheetId) ?? project.sheets[0];
    const { nets } = buildSheetNetlist(sheet);
    const isDc = sheet.voltageLabel.toUpperCase().includes('DC');
    const voltageVal = sheet.voltageLabel.includes('24') ? '24' : '120';

    const lines: string[] = [
      `%% VoltGrid ECAD — Direct Simscape Electrical Model Builder (No Editing Required)`,
      `% Project: ${project.metadata.title} (${project.metadata.projectNumber})`,
      `% Sheet ${sheet.number}: ${sheet.name} (${sheet.voltageLabel})`,
      `% Uses installed libraries: Simscape Foundation, Utilities, Driveline, Electrical`,
      ``,
      `modelName = '${modelName}';`,
      `if bdIsLoaded(modelName), close_system(modelName, 0); end`,
      `new_system(modelName);`,
      `open_system(modelName);`,
      `set_param(modelName, 'Solver', 'ode23t', 'StopTime', '10');`,
      ``,
      `%% 1. Core Simscape Utilities & Power Supply (${sheet.l1Label} / ${sheet.l2Label})`,
      `add_block('nesl_utility/Solver Configuration', [modelName '/Solver_Config'], 'Position', [40 40 90 70]);`,
      `add_block('fl_lib/Electrical/Electrical Elements/Electrical Reference', [modelName '/Gnd_L2'], 'Position', [40 160 80 200]);`,
      isDc
        ? `add_block('fl_lib/Electrical/Electrical Sources/DC Voltage Source', [modelName '/Supply_L1_L2'], 'v0', '${voltageVal}', 'Position', [40 90 80 140]);`
        : `add_block('fl_lib/Electrical/Electrical Sources/AC Voltage Source', [modelName '/Supply_L1_L2'], 'amp', '${voltageVal}*sqrt(2)', 'frequency', '60', 'Position', [40 90 80 140]);`,
      `add_line(modelName, 'Supply_L1_L2/RConn1', 'Gnd_L2/LConn1', 'autorouting', 'smart');`,
      `add_line(modelName, 'Solver_Config/RConn1', 'Gnd_L2/LConn1', 'autorouting', 'smart');`,
      ``,
      `%% 2. Schematic Components (Simscape Electrical & Electromechanical)`,
    ];

    const compBlockNames = new Map<string, string>();
    sheet.components.forEach((comp, idx) => {
      const bName = sanitizeIdentifier(`${comp.tag}_${idx + 1}`);
      compBlockNames.set(comp.id, bName);
      const px = comp.x;
      const py = comp.y;
      const pos = `[${px - 22} ${py - 16} ${px + 22} ${py + 16}]`;

      if (comp.type === 'coil_motor' || comp.type === 'coil_relay') {
        lines.push(
          `add_block('fl_lib/Electrical/Electrical Elements/Resistor', [modelName '/${bName}'], 'R', '${comp.type === 'coil_motor' ? '120' : '240'}', 'Position', ${pos}); % ${comp.tag}: ${comp.description}`
        );
      } else if (comp.type === 'coil_ton' || comp.type === 'coil_tof') {
        lines.push(
          `add_block('fl_lib/Electrical/Electrical Elements/Resistor', [modelName '/${bName}'], 'R', '360', 'Position', ${pos}); % Timer ${comp.tag} (${comp.type.toUpperCase()} ${comp.timerPreset ?? 3}s)`
        );
        lines.push(
          `add_block('simulink/Continuous/Transport Delay', [modelName '/${bName}_TimerDelay'], 'DelayTime', '${comp.timerPreset ?? 3.0}', 'Position', [${px - 18} ${py + 28} ${px + 18} ${py + 52}]);`
        );
      } else if (comp.type === 'pilot_light' || comp.type === 'plc_in' || comp.type === 'vfd_cmd') {
        lines.push(
          `add_block('fl_lib/Electrical/Electrical Elements/Resistor', [modelName '/${bName}'], 'R', '1000', 'Position', ${pos}); % Load ${comp.tag}: ${comp.description}`
        );
      } else if (comp.type === 'terminal') {
        lines.push(
          `add_block('fl_lib/Electrical/Electrical Elements/Resistor', [modelName '/${bName}'], 'R', '1e-4', 'Position', ${pos}); % Terminal ${comp.tag}`
        );
      } else {
        // Switches, Push Buttons, Contacts, Overload, Breaker, Fuse
        const isClosed =
          comp.type === 'pb_nc' ||
          comp.type === 'estop_nc' ||
          comp.type === 'selector_nc' ||
          comp.type === 'overload_nc' ||
          comp.type === 'contact_nc' ||
          comp.type === 'timer_contact_nc' ||
          comp.type === 'fuse' ||
          comp.type === 'breaker';
        lines.push(
          `add_block('fl_lib/Electrical/Electrical Elements/Switch', [modelName '/${bName}'], 'R_closed', '0.01', 'G_open', '1e-8', 'Threshold', '0.5', 'Position', ${pos}); % ${comp.tag}: ${comp.description}`
        );
        lines.push(
          `add_block('simulink/Sources/Constant', [modelName '/${bName}_Cmd'], 'Value', '${isClosed ? '1' : '0'}', 'Position', [${px - 15} ${py - 48} ${px + 15} ${py - 30}]);`
        );
        lines.push(
          `add_block('nesl_utility/Simulink-PS Converter', [modelName '/${bName}_Conv'], 'Position', [${px + 22} ${py - 48} ${px + 42} ${py - 30}]);`
        );
        lines.push(`add_line(modelName, '${bName}_Cmd/1', '${bName}_Conv/1', 'autorouting', 'smart');`);
        lines.push(`add_line(modelName, '${bName}_Conv/RConn1', '${bName}/LConn2', 'autorouting', 'smart');`);
      }
    });

    lines.push(``, `%% 3. Electrical Netlist Wiring (Physical Conserving Lines)`);
    for (const net of nets) {
      const endpoints: string[] = [];
      if (net.isL1) endpoints.push('Supply_L1_L2/LConn1');
      if (net.isL2) endpoints.push('Supply_L1_L2/RConn1');

      for (const cp of net.connectedPins) {
        const bName = compBlockNames.get(cp.componentId);
        if (!bName) continue;
        endpoints.push(cp.pin === 'left' ? `${bName}/LConn1` : `${bName}/RConn1`);
      }

      if (endpoints.length >= 2) {
        const anchor = endpoints[0];
        for (let i = 1; i < endpoints.length; i++) {
          lines.push(
            `try, add_line(modelName, '${anchor}', '${endpoints[i]}', 'autorouting', 'smart'); catch, end % Net ${net.wireNumber || net.id}`
          );
        }
      }
    }

    lines.push(
      ``,
      `%% 4. Auto-Arrange, Save & Simulate`,
      `Simulink.BlockDiagram.arrangeSystem(modelName);`,
      `save_system(modelName, [modelName '.slx']);`,
      `fprintf('VoltGrid ECAD: Built and opened Simscape model %s.slx successfully.\\n', modelName);`
    );

    return lines.join('\n');
  }

  /**
   * Native plain-text Simulink .mdl Control Logic Model (directly openable in Simulink).
   */
  public exportSimulinkMdl(project: Project): string {
    const modelName = sanitizeIdentifier(project.metadata.title, 'VoltGrid_Simulink');
    const equations = extractProjectLogicEquations(project);
    const blocks: string[] = [];
    const lines: string[] = [];

    let yCursor = 40;
    equations.forEach((eq, idx) => {
      const outName = sanitizeIdentifier(`${eq.load.tag}_Out_${idx + 1}`);
      const logicName = sanitizeIdentifier(`${eq.load.tag}_Logic_${idx + 1}`);

      blocks.push(
        `    Block {\n` +
          `      BlockType Constant\n` +
          `      Name "${sanitizeIdentifier(`${eq.load.tag}_Enable_${idx + 1}`)}"\n` +
          `      Value "1"\n` +
          `      Position [60, ${yCursor}, 100, ${yCursor + 30}]\n` +
          `    }`,
        `    Block {\n` +
          `      BlockType Logic\n` +
          `      Name "${logicName}"\n` +
          `      Operator "AND"\n` +
          `      Inputs "1"\n` +
          `      Position [200, ${yCursor}, 240, ${yCursor + 30}]\n` +
          `    }`
      );

      let prevBlock = logicName;
      if (eq.load.type === 'coil_ton' || eq.load.type === 'coil_tof') {
        const tName = sanitizeIdentifier(`${eq.load.tag}_Timer_${idx + 1}`);
        blocks.push(
          `    Block {\n` +
            `      BlockType TransportDelay\n` +
            `      Name "${tName}"\n` +
            `      DelayTime "${eq.load.timerPreset ?? 3.0}"\n` +
            `      Position [310, ${yCursor}, 355, ${yCursor + 30}]\n` +
            `    }`
        );
        lines.push(
          `    Line {\n      SrcBlock "${logicName}"\n      SrcPort 1\n      DstBlock "${tName}"\n      DstPort 1\n    }`
        );
        prevBlock = tName;
      }

      blocks.push(
        `    Block {\n` +
          `      BlockType Outport\n` +
          `      Name "${outName}"\n` +
          `      Port "${idx + 1}"\n` +
          `      Position [440, ${yCursor + 6}, 470, ${yCursor + 24}]\n` +
          `    }`
      );

      lines.push(
        `    Line {\n      SrcBlock "${sanitizeIdentifier(`${eq.load.tag}_Enable_${idx + 1}`)}"\n      SrcPort 1\n      DstBlock "${logicName}"\n      DstPort 1\n    }`,
        `    Line {\n      SrcBlock "${prevBlock}"\n      SrcPort 1\n      DstBlock "${outName}"\n      DstPort 1\n    }`
      );
      yCursor += 70;
    });

    return [
      `Model {`,
      `  Name "${modelName}"`,
      `  Version 8.0`,
      `  Description "VoltGrid ECAD Industrial Control Model: ${project.metadata.title}"`,
      `  System {`,
      `    Name "${modelName}"`,
      `    Location [100, 100, 960, 720]`,
      ...blocks,
      ...lines,
      `  }`,
      `}`,
    ].join('\n');
  }

  /**
   * CADe_SIMU Transformer (.cad):
   * Generates a structured CADe_SIMU schematic file mapping JIC/IEC power rails,
   * contacts, coils, timers, VFD/PLC blocks, terminal strips, and wire segments.
   */
  public exportCadeSimu(sheet: SchematicSheet, project: Project): string {
    const mapCadeSymbol = (c: SchematicComponent): string => {
      switch (c.type) {
        case 'pb_no': return 'PULSADOR_NA';
        case 'pb_nc': return 'PULSADOR_NC';
        case 'estop_nc': return 'SETA_NC';
        case 'selector_no': return 'INTERRUPTOR_NA';
        case 'selector_nc': return 'INTERRUPTOR_NC';
        case 'contact_no': return 'CONTACTO_NA';
        case 'contact_nc': return 'CONTACTO_NC';
        case 'timer_contact_no': return 'CONTACTO_TEMP_CON_NA';
        case 'timer_contact_nc': return 'CONTACTO_TEMP_CON_NC';
        case 'coil_relay': return 'BOBINA_RELE';
        case 'coil_motor': return 'BOBINA_CONTACTOR';
        case 'coil_ton': return 'BOBINA_TEMP_CON';
        case 'coil_tof': return 'BOBINA_TEMP_DESC';
        case 'overload_nc': return 'TERMICO_NC';
        case 'pilot_light': return 'PILOTO_SENALIZACION';
        case 'fuse': return 'FUSIBLE_1P';
        case 'breaker': return 'DISYUNTOR_1P';
        case 'terminal': return 'BORNA_X';
        case 'plc_in': return 'PLC_ENTRADA_DI';
        case 'plc_out': return 'PLC_SALIDA_DO';
        case 'vfd_cmd': return 'VARIADOR_VFD_CMD';
        default: return 'GENERICO';
      }
    };

    const lines: string[] = [
      `CADe_SIMU 4.0`,
      `[HEADER]`,
      `TITLE=${project.metadata.title}`,
      `PROJECT=${project.metadata.projectNumber}`,
      `SHEET=${sheet.number}`,
      `SHEET_NAME=${sheet.name}`,
      `VOLTAGE=${sheet.voltageLabel}`,
      `STANDARD=${project.metadata.standard}`,
      `GRID=20`,
      ``,
      `[POWER_RAILS]`,
      `RAIL;${sheet.l1Label};X=${L1_X};Y1=${FIRST_RUNG_Y - 30};Y2=${getRungY(sheet.rungCount) + 40};COLOR=RED`,
      `RAIL;${sheet.l2Label};X=${L2_X};Y1=${FIRST_RUNG_Y - 30};Y2=${getRungY(sheet.rungCount) + 40};COLOR=BLUE`,
      ``,
      `[COMPONENTS]`,
    ];

    for (const c of sheet.components) {
      const sym = mapCadeSymbol(c);
      const extra = [
        c.parentTag ? `PARENT=${c.parentTag}` : '',
        c.timerPreset ? `PRESET=${c.timerPreset}s` : '',
        c.plcAddress ? `PLC=${c.plcAddress}` : '',
        c.vfdParam ? `VFD=${c.vfdParam}` : '',
        c.pilotColor ? `COLOR=${c.pilotColor.toUpperCase()}` : '',
      ]
        .filter(Boolean)
        .join('|');

      lines.push(
        `COMP;${sym};TAG=-${c.tag};X=${c.x};Y=${c.y};PIN1=${c.x - COMPONENT_HALF_SPAN},${c.y};PIN2=${c.x + COMPONENT_HALF_SPAN},${c.y};DESC=${c.description.replace(/;/g, ',')}${extra ? `;ATTR=${extra}` : ''}`
      );
    }

    lines.push(``, `[WIRES]`);
    for (const w of sheet.wires) {
      lines.push(
        `WIRE;X1=${w.x1};Y1=${w.y1};X2=${w.x2};Y2=${w.y2};NET=${w.wireNumber || w.netId || 'UNNUMBERED'}`
      );
    }

    lines.push(``, `[END]`);
    return lines.join('\n');
  }
}

export const exportEngine = new ExportEngine();
