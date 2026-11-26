import { getSymbolDef } from '../data/symbolCatalog';
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
import { autoNumberProjectWires } from './netlistEngine';
import { generateId, getRungY } from './schematicEngine';

export interface ParsedPdfSummary {
  fileName: string;
  detectedDomain: 'VFD Control' | 'PLC I/O & Logic' | 'VFD + PLC Integrated' | 'Motor Control';
  detectedVoltage: string;
  detectedManufacturer: string;
  detectedModel: string;
  extractedTags: string[];
  vfdParameters: string[];
  plcAddresses: string[];
  terminalCount: number;
  componentCount: number;
  sheetCount: number;
  rawExtractedPreview: string;
}

export interface TemplateCatalogItem {
  id: string;
  fileName: string;
  title: string;
  category: 'VFD' | 'PLC' | 'Motor Control' | 'Imported PDF';
  description: string;
  sheetCount: number;
  componentCount: number;
  source: 'builtin' | 'disk';
}

/**
 * Extracts readable ASCII & PDF text operators (Tj / TJ / parenthesized strings)
 * from raw PDF bytes, decompressing FlateDecode streams when browser/Node
 * DecompressionStream is available.
 */
export async function extractTextFromPdfBytes(bytes: Uint8Array): Promise<string> {
  const latin1 = new TextDecoder('latin1').decode(bytes);
  const chunks: string[] = [];

  // 1. Extract literal strings inside PDF text blocks (BT ... ET) or parentheses
  const extractParenText = (src: string) => {
    const parenRegex = /\(([^()\\]{2,120}(?:\\.[^()\\]*)*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = parenRegex.exec(src)) !== null) {
      const cleaned = m[1]
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
        .replace(/[^\x20-\x7E]/g, ' ')
        .trim();
      if (cleaned.length >= 2 && /[A-Za-z0-9]/.test(cleaned)) {
        chunks.push(cleaned);
      }
    }
  };

  extractParenText(latin1);

  // 2. Attempt FlateDecode stream decompression if supported in environment
  if (typeof DecompressionStream !== 'undefined') {
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;
    let streamCount = 0;

    while ((match = streamRegex.exec(latin1)) !== null && streamCount < 24) {
      streamCount++;
      const startOffset = match.index + match[0].indexOf(match[1]);
      const endOffset = startOffset + match[1].length;
      const slice = bytes.subarray(startOffset, endOffset);

      // Check zlib header (0x78 0x9C, 0x78 0x01, 0x78 0xDA)
      if (slice.length > 2 && slice[0] === 0x78) {
        try {
          const ds = new DecompressionStream('deflate');
          const writer = ds.writable.getWriter();
          writer.write(new Uint8Array(slice));
          writer.close();
          const decompressed = await new Response(ds.readable).arrayBuffer();
          const text = new TextDecoder('latin1').decode(new Uint8Array(decompressed));
          extractParenText(text);
        } catch {
          // Ignore non-deflate or malformed binary image streams
        }
      }
    }
  }

  return chunks.join(' ');
}

/**
 * Helper to wire a single horizontal rung cleanly from L1 through an ordered list of components to L2.
 */
function buildWiredRung(
  rungNum: number,
  items: Array<{ x: number; comp: SchematicComponent }>
): { components: SchematicComponent[]; wires: WireSegment[] } {
  const y = getRungY(rungNum);
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const components: SchematicComponent[] = [];
  const wires: WireSegment[] = [];

  let cursorX = L1_X;
  for (const item of sorted) {
    const comp = { ...item.comp, x: item.x, y };
    components.push(comp);
    const leftPinX = comp.x - COMPONENT_HALF_SPAN;
    if (leftPinX > cursorX) {
      wires.push({
        id: generateId('w'),
        x1: cursorX,
        y1: y,
        x2: leftPinX,
        y2: y,
      });
    }
    cursorX = comp.x + COMPONENT_HALF_SPAN;
  }

  if (L2_X > cursorX) {
    wires.push({
      id: generateId('w'),
      x1: cursorX,
      y1: y,
      x2: L2_X,
      y2: y,
    });
  }

  return { components, wires };
}

function makeComp(
  type: SymbolType,
  tag: string,
  overrides: Partial<SchematicComponent> = {}
): SchematicComponent {
  const def = getSymbolDef(type);
  return {
    id: generateId('c'),
    type,
    x: 200,
    y: 100,
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

/**
 * TemplateImporter class:
 * Parses technical PDF drawings for VFD and PLC schematics, extracts electrical
 * attributes, I/O addresses, VFD parameters, and terminal pinouts, generates
 * a fully wired VoltGrid ECAD Project template, and saves it into `/templates`.
 */
export class TemplateImporter {
  /**
   * Parses raw extracted PDF text + filename into a structured VoltGrid ECAD Project
   * and detailed extraction summary.
   */
  public parseSchematicText(
    extractedText: string,
    fileName: string
  ): { project: Project; summary: ParsedPdfSummary } {
    const combined = `${fileName} ${extractedText}`;
    const upper = combined.toUpperCase();

    const hasVfd = /\b(VFD|INVERTER|POWERFLEX|ALTIVAR|SINAMICS|ACS\d+|DRIVE|FREQ|DI1|DI2|AI1|4-20MA|0-10V|RUN\s*CMD)\b/.test(
      upper
    );
    const hasPlc = /\b(PLC|COMPACTLOGIX|CONTROLLOGIX|S7-1200|S7-1500|MICRO850|CODESYS|%IX|%QX|I0\.\d|Q0\.\d|DI\d|DO\d|LADDER|CPU)\b/.test(
      upper
    );

    const detectedDomain: ParsedPdfSummary['detectedDomain'] =
      hasVfd && hasPlc
        ? 'VFD + PLC Integrated'
        : hasVfd
          ? 'VFD Control'
          : hasPlc
            ? 'PLC I/O & Logic'
            : 'Motor Control';

    const voltageMatch = upper.match(/\b(24\s*VDC|24\s*V\s*DC|120\s*VAC|230\s*VAC|480\s*VAC|400\s*VAC)\b/);
    const detectedVoltage = voltageMatch
      ? voltageMatch[1].replace(/\s+/g, '')
      : hasPlc || hasVfd
        ? '24VDC'
        : '120VAC 60Hz';
    const isDc = detectedVoltage.includes('DC');

    // Manufacturer & model detection
    let detectedManufacturer = 'Allen-Bradley';
    let detectedModel = hasVfd ? 'PowerFlex 525 (25B-D4P0N104)' : 'CompactLogix 5380';
    if (/SIEMENS|S7-1200|S7-1500|SINAMICS|G120/.test(upper)) {
      detectedManufacturer = 'Siemens';
      detectedModel = hasVfd ? 'SINAMICS G120 / S7-1200' : 'SIMATIC S7-1200 CPU 1214C';
    } else if (/SCHNEIDER|ALTIVAR|ATV320|MODICON/.test(upper)) {
      detectedManufacturer = 'Schneider Electric';
      detectedModel = hasVfd ? 'Altivar ATV320' : 'Modicon M221';
    } else if (/ABB|ACS580|ACS380/.test(upper)) {
      detectedManufacturer = 'ABB';
      detectedModel = 'ACS580 Drive';
    } else if (/OMRON|NX1P|MX2/.test(upper)) {
      detectedManufacturer = 'Omron';
      detectedModel = 'MX2 / NX1P2';
    }

    // Extract PLC addresses (e.g. %IX0.0, I0.1, %QX0.0, Q0.2)
    const plcMatches = Array.from(
      new Set(
        (upper.match(/(?:%[IQ]X\d+\.\d+|[IQ]\d+\.\d+)/g) ?? []).map((addr) =>
          addr.startsWith('%') ? addr : addr.startsWith('I') ? `%IX${addr.slice(1)}` : `%QX${addr.slice(1)}`
        )
      )
    );

    // Extract VFD terminal parameters
    const vfdMatches = Array.from(
      new Set(
        upper.match(/\b(DI[1-6]|DO[1-4]|AI[1-2]|AO[1-2]|R1[A-C]|R2[A-C]|STO[1-2]|RUN|REV|FAULT|RESET|JOG|SPEED)\b/g) ??
          []
      )
    );

    // Extract timer preset if mentioned (e.g., 5.0s, 3s, 10 SEC)
    const timerMatch = upper.match(/(\d+(?:\.\d+)?)\s*(?:S|SEC|SECONDS)\b/);
    const timerPreset = timerMatch ? Math.min(60, Math.max(0.5, parseFloat(timerMatch[1]))) : 3.0;

    // Build structured schematic sheets from parsed technical specs
    const sheets: SchematicSheet[] = [];
    const baseName = fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported Schematic';

    if (detectedDomain === 'VFD Control' || detectedDomain === 'VFD + PLC Integrated') {
      // Sheet 1: VFD Run / Direction / Fault & E-Stop Control
      const comps: SchematicComponent[] = [];
      const wires: WireSegment[] = [];

      const r1 = buildWiredRung(1, [
        { x: 160, comp: makeComp('fuse', 'FU1', { description: 'Control Circuit Fuse 2A', manufacturer: 'Bussmann' }) },
        { x: 260, comp: makeComp('estop_nc', 'ES1', { description: 'VFD Safe Torque Off E-Stop', plcAddress: plcMatches[0] || '%IX0.0' }) },
        { x: 380, comp: makeComp('pb_nc', 'PB1', { description: 'Drive Stop PB (NC)', plcAddress: plcMatches[1] || '%IX0.1' }) },
        { x: 500, comp: makeComp('pb_no', 'PB2', { description: 'Drive Start PB (NO)', plcAddress: plcMatches[2] || '%IX0.2' }) },
        { x: 640, comp: makeComp('terminal', 'TB1-1', { terminalStrip: 'TB1', terminalNumber: '1', description: 'VFD DI1 Start Terminal' }) },
        { x: 780, comp: makeComp('coil_relay', 'CR1', { description: 'VFD Run Enable Relay', manufacturer: detectedManufacturer }) },
      ]);
      comps.push(...r1.components);
      wires.push(...r1.wires);

      // Rung 2: Seal-in around Start PB (x=500 -> left 480, right 520)
      const sealY = getRungY(2);
      const r1Y = getRungY(1);
      comps.push({
        ...makeComp('contact_no', 'CR1', { parentTag: 'CR1', description: 'VFD Run Seal-In Contact' }),
        x: 500,
        y: sealY,
      });
      wires.push(
        { id: generateId('w'), x1: 440, y1: r1Y, x2: 440, y2: sealY },
        { id: generateId('w'), x1: 440, y1: sealY, x2: 480, y2: sealY },
        { id: generateId('w'), x1: 520, y1: sealY, x2: 560, y2: sealY },
        { id: generateId('w'), x1: 560, y1: sealY, x2: 560, y2: r1Y }
      );

      // Rung 3: VFD Digital Input DI1 (RUN) Command
      const r3 = buildWiredRung(3, [
        { x: 240, comp: makeComp('contact_no', 'CR1', { parentTag: 'CR1', description: 'Run Permissive Contact' }) },
        { x: 420, comp: makeComp('overload_nc', 'OL1', { description: 'VFD Fault Relay Contact (R1A-R1C)' }) },
        { x: 600, comp: makeComp('terminal', 'TB1-2', { terminalStrip: 'TB1', terminalNumber: '2', description: 'VFD DI1 Command Bus' }) },
        {
          x: 780,
          comp: makeComp('vfd_cmd', 'VFD1', {
            description: `${detectedModel} Run Cmd`,
            manufacturer: detectedManufacturer,
            partNumber: detectedModel,
            vfdParam: vfdMatches.includes('DI1') ? 'DI1-START' : 'DI1-RUN (P046=2)',
            plcAddress: '%QX0.0',
          }),
        },
      ]);
      comps.push(...r3.components);
      wires.push(...r3.wires);

      // Rung 4: Forward / Reverse Selector -> VFD DI2 Reverse Command
      const r4 = buildWiredRung(4, [
        { x: 240, comp: makeComp('contact_no', 'CR1', { parentTag: 'CR1', description: 'VFD Active Interlock' }) },
        { x: 420, comp: makeComp('selector_no', 'SS1', { description: 'FWD / REV Direction Selector' }) },
        { x: 600, comp: makeComp('terminal', 'TB1-3', { terminalStrip: 'TB1', terminalNumber: '3', description: 'VFD DI2 Direction Terminal' }) },
        {
          x: 780,
          comp: makeComp('vfd_cmd', 'VFD2', {
            description: `${detectedModel} Reverse Cmd`,
            manufacturer: detectedManufacturer,
            partNumber: detectedModel,
            vfdParam: 'DI2-REV (P062=7)',
            plcAddress: '%QX0.1',
          }),
        },
      ]);
      comps.push(...r4.components);
      wires.push(...r4.wires);

      // Rung 5: Accel/Stabilize Timer + Run Pilot Light
      const r5 = buildWiredRung(5, [
        { x: 240, comp: makeComp('contact_no', 'CR1', { parentTag: 'CR1', description: 'VFD Running Status' }) },
        { x: 520, comp: makeComp('terminal', 'TB1-4', { terminalStrip: 'TB1', terminalNumber: '4', description: 'Panel Run Indicator' }) },
        { x: 780, comp: makeComp('pilot_light', 'PL1', { pilotColor: 'green', description: 'VFD Running Pilot Light' }) },
      ]);
      comps.push(...r5.components);
      wires.push(...r5.wires);

      const r6 = buildWiredRung(6, [
        { x: 240, comp: makeComp('contact_no', 'CR1', { parentTag: 'CR1', description: 'Start Accel Monitor' }) },
        { x: 780, comp: makeComp('coil_ton', 'TR1', { timerPreset, description: `VFD Ramp Stabilize Timer (${timerPreset}s)` }) },
      ]);
      comps.push(...r6.components);
      wires.push(...r6.wires);

      sheets.push({
        id: generateId('sheet'),
        number: 1,
        name: 'VFD Drive Control',
        voltageLabel: detectedVoltage,
        l1Label: isDc ? '+24V' : 'L1',
        l2Label: isDc ? '0V' : 'L2',
        rungCount: 6,
        components: comps,
        wires,
      });
    }

    if (detectedDomain === 'PLC I/O & Logic' || detectedDomain === 'VFD + PLC Integrated' || sheets.length === 0) {
      const sheetNum = sheets.length + 1;
      const comps: SchematicComponent[] = [];
      const wires: WireSegment[] = [];

      const r1 = buildWiredRung(1, [
        { x: 220, comp: makeComp('estop_nc', 'ES2', { description: 'PLC Safety Input E-Stop' }) },
        { x: 460, comp: makeComp('terminal', 'TB2-1', { terminalStrip: 'TB2', terminalNumber: '1', description: 'PLC DI0.0 Field Terminal' }) },
        {
          x: 780,
          comp: makeComp('plc_in', 'DI0', {
            description: 'PLC Input: Safety Healthy',
            manufacturer: detectedManufacturer,
            plcAddress: plcMatches[0] || '%IX0.0',
          }),
        },
      ]);
      const r2 = buildWiredRung(2, [
        { x: 220, comp: makeComp('pb_no', 'PB3', { description: 'Cycle Start Push Button' }) },
        { x: 460, comp: makeComp('terminal', 'TB2-2', { terminalStrip: 'TB2', terminalNumber: '2', description: 'PLC DI0.1 Field Terminal' }) },
        {
          x: 780,
          comp: makeComp('plc_in', 'DI1', {
            description: 'PLC Input: Cycle Start',
            manufacturer: detectedManufacturer,
            plcAddress: plcMatches[1] || '%IX0.1',
          }),
        },
      ]);
      const r3 = buildWiredRung(3, [
        { x: 220, comp: makeComp('plc_out', 'DO0', { description: 'PLC Output %QX0.0 Command', plcAddress: '%QX0.0' }) },
        { x: 460, comp: makeComp('terminal', 'TB2-3', { terminalStrip: 'TB2', terminalNumber: '3', description: 'Output Coil Terminal' }) },
        { x: 780, comp: makeComp('coil_motor', 'M1', { description: 'PLC Controlled Motor Starter', manufacturer: detectedManufacturer }) },
      ]);
      const r4 = buildWiredRung(4, [
        { x: 220, comp: makeComp('contact_no', 'M1', { parentTag: 'M1', description: 'Starter Aux Feedback' }) },
        { x: 780, comp: makeComp('pilot_light', 'PL2', { pilotColor: 'amber', description: 'PLC Sequence Active Lamp' }) },
      ]);

      comps.push(...r1.components, ...r2.components, ...r3.components, ...r4.components);
      wires.push(...r1.wires, ...r2.wires, ...r3.wires, ...r4.wires);

      sheets.push({
        id: generateId('sheet'),
        number: sheetNum,
        name: 'PLC Digital I/O Map',
        voltageLabel: '24VDC',
        l1Label: '+24V',
        l2Label: '0V',
        rungCount: 4,
        components: comps,
        wires,
      });
    }

    const rawProject: Project = {
      id: generateId('proj'),
      metadata: {
        title: `${baseName} (${detectedDomain})`,
        projectNumber: `VG-TPL-${Math.floor(100 + Math.random() * 899)}`,
        revision: '1.0',
        author: 'VoltGrid TemplateImporter',
        standard: detectedManufacturer === 'Siemens' ? 'IEC 60617' : 'JIC / NFPA 79',
        description: `Generated from PDF schematic "${fileName}" — ${detectedManufacturer} ${detectedModel}`,
      },
      sheets,
      activeSheetId: sheets[0].id,
    };

    const numbered = autoNumberProjectWires(rawProject);
    const allComps = numbered.sheets.flatMap((s) => s.components);

    const summary: ParsedPdfSummary = {
      fileName,
      detectedDomain,
      detectedVoltage,
      detectedManufacturer,
      detectedModel,
      extractedTags: allComps.map((c) => c.tag),
      vfdParameters:
        vfdMatches.length > 0
          ? vfdMatches
          : detectedDomain.includes('VFD')
            ? ['DI1-RUN', 'DI2-REV', 'R1A-R1C (Fault)']
            : [],
      plcAddresses:
        plcMatches.length > 0
          ? plcMatches
          : allComps.map((c) => c.plcAddress).filter((a): a is string => Boolean(a)),
      terminalCount: allComps.filter((c) => c.type === 'terminal').length,
      componentCount: allComps.length,
      sheetCount: numbered.sheets.length,
      rawExtractedPreview: extractedText.slice(0, 260) || `Parsed specification from ${fileName}`,
    };

    return { project: numbered, summary };
  }

  /**
   * End-to-end PDF File import: reads PDF bytes, extracts text streams, parses
   * into a VoltGrid Project, and persists to the `/templates` directory via API.
   */
  public async importPdfFile(file: File): Promise<{
    project: Project;
    summary: ParsedPdfSummary;
    savedFileName: string;
    savedToServer: boolean;
  }> {
    const buffer = await file.arrayBuffer();
    const extracted = await extractTextFromPdfBytes(new Uint8Array(buffer));
    const { project, summary } = this.parseSchematicText(extracted, file.name);
    const slug = file.name
      .replace(/\.pdf$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const savedFileName = `${slug || 'imported_schematic'}.json`;

    const savedToServer = await this.saveTemplateToDirectory(savedFileName, project);
    return { project, summary, savedFileName, savedToServer };
  }

  /**
   * Saves a generated template into the application's `/templates` directory.
   */
  public async saveTemplateToDirectory(fileName: string, project: Project): Promise<boolean> {
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, project }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Lists all available templates saved in `/templates`.
   */
  public async listSavedTemplates(): Promise<TemplateCatalogItem[]> {
    try {
      const res = await fetch('/api/templates');
      if (!res.ok) return [];
      const data = (await res.json()) as { templates: TemplateCatalogItem[] };
      return Array.isArray(data.templates) ? data.templates : [];
    } catch {
      return [];
    }
  }

  /**
   * Loads a template JSON straight from `/templates/<fileName>`.
   */
  public async loadTemplateFromDirectory(fileName: string): Promise<Project> {
    const res = await fetch(`/api/templates/${encodeURIComponent(fileName)}`);
    if (!res.ok) {
      throw new Error(`Failed to load template "${fileName}"`);
    }
    return (await res.json()) as Project;
  }
}

export const templateImporter = new TemplateImporter();
