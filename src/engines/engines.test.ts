import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDemoProject, createVfdControlTemplate } from '../data/demoCircuits';
import { computeCrossReferences, renameParentTag } from './crossRefEngine';
import { runElectricalRuleCheck } from './ercEngine';
import { ExportEngine } from './exportEngine';
import { autoNumberProjectWires, buildSheetNetlist } from './netlistEngine';
import {
  addOrthogonalWire,
  computeJunctionDots,
  placeComponentWithWireBreak,
} from './schematicEngine';
import { createInitialSimulationState, stepSimulation } from './simulationEngine';
import { TemplateImporter } from './templateImporter';
import { L1_X, L2_X } from '../types/ecad';

test('Engine 1: Wire-breaking placement splits horizontal wire cleanly around component pins', () => {
  const demo = createDefaultDemoProject();
  const blankSheet = {
    ...demo.sheets[0],
    components: [],
    wires: [{ id: 'w1', x1: L1_X, y1: 100, x2: L2_X, y2: 100 }],
  };

  const placed = placeComponentWithWireBreak(blankSheet, {
    id: 'c_new',
    type: 'pb_no',
    x: 300,
    y: 100,
    tag: 'PB9',
    description: 'Test PB',
    manufacturer: 'AB',
    partNumber: '800F',
  });

  assert.equal(placed.components.length, 1);
  assert.equal(placed.wires.length, 2);
  assert.ok(placed.wires.some((w) => w.x1 === L1_X && w.x2 === 280));
  assert.ok(placed.wires.some((w) => w.x1 === 320 && w.x2 === L2_X));
});

test('Engine 1: Orthogonal wire routing creates L-bend and detects T-junction dot', () => {
  const demo = createDefaultDemoProject();
  const baseSheet = {
    ...demo.sheets[0],
    components: [],
    wires: [{ id: 'w1', x1: L1_X, y1: 100, x2: 400, y2: 100 }],
  };

  const wired = addOrthogonalWire(baseSheet, { x: 240, y: 100 }, { x: 320, y: 180 }, false);
  const junctions = computeJunctionDots(wired.wires, wired.components);
  assert.ok(
    junctions.some((j) => j.x === 240 && j.y === 100),
    'Expected T-junction dot at (240, 100)'
  );
});

test('Engine 2: Parent/Child Cross-Referencing computes locations and propagates Parent rename', () => {
  const demo = createDefaultDemoProject();
  const xrefs = computeCrossReferences(demo);
  const m1Ref = xrefs.get('M1');
  assert.ok(m1Ref, 'M1 parent cross-reference must exist');
  assert.equal(m1Ref.noContacts.length, 3);
  assert.match(m1Ref.summaryText, /NO: 02, 03, 04/);

  const renamed = renameParentTag(demo, 'c_m1', 'M99');
  const updatedXrefs = computeCrossReferences(renamed);
  assert.equal(updatedXrefs.has('M1'), false);
  assert.ok(updatedXrefs.has('M99'));
  assert.equal(updatedXrefs.get('M99')?.noContacts.length, 3);
});

test('Engine 3: Netlist solver skips L1/L2 and auto-numbers sequential rung wires', () => {
  const demo = createDefaultDemoProject();
  const numbered = autoNumberProjectWires(demo);
  const sheet = numbered.sheets[0];
  const { nets } = buildSheetNetlist(sheet);

  const l1Net = nets.find((n) => n.isL1);
  const l2Net = nets.find((n) => n.isL2);
  assert.ok(l1Net && l2Net);
  assert.equal(l1Net.wireNumber, 'L1');
  assert.equal(l2Net.wireNumber, 'L2');

  const innerNumbers = sheet.wires
    .map((w) => w.wireNumber)
    .filter((n) => n && n !== 'L1' && n !== 'L2');
  assert.ok(innerNumbers.includes('101'), 'Expected wire 101');
  assert.ok(innerNumbers.includes('102'), 'Expected wire 102');
});

test('Engine 4: Real-time 3-Wire Motor Seal-In Latch, TON 3.0s Timer, and Overload Trip', () => {
  const demo = createDefaultDemoProject();
  let sim = stepSimulation(demo, createInitialSimulationState(), 0);

  // Initially M1 is OFF, PL1 is OFF, TR1 is OFF
  assert.equal(sim.coilStates['M1'], false);
  assert.equal(sim.coilStates['CR1'], false);

  // Press Start PB2 (c_pb2)
  sim = stepSimulation(
    demo,
    { ...sim, interactiveStates: { ...sim.interactiveStates, c_pb2: true } },
    0.05
  );
  assert.equal(sim.coilStates['M1'], true, 'M1 should energize when Start PB2 pressed');
  assert.ok(sim.energizedComponentIds.includes('c_pl1'), 'Run Pilot Light PL1 should turn ON');

  // Release Start PB2 — M1 MUST remain latched via Rung 02 seal-in contact!
  sim = stepSimulation(
    demo,
    { ...sim, interactiveStates: { ...sim.interactiveStates, c_pb2: false } },
    0.1
  );
  assert.equal(sim.coilStates['M1'], true, 'M1 must stay latched after releasing Start PB2');
  assert.equal(sim.coilStates['CR1'], false, 'CR1 must not energize before 3.0s TON preset');

  // Advance timer past 3.0s preset
  for (let i = 0; i < 32; i++) {
    sim = stepSimulation(demo, sim, 0.1);
  }
  assert.equal(sim.timerStates['TR1']?.done, true, 'TR1 TON timer must reach DONE at 3.0s');
  assert.equal(sim.coilStates['CR1'], true, 'CR1 must energize once TR1 timer completes');
  assert.ok(sim.energizedComponentIds.includes('c_pl2'), 'Warning light PL2 must energize with CR1');

  // Trip Overload OL1 (c_ol1) — M1 must drop out immediately!
  sim = stepSimulation(
    demo,
    { ...sim, interactiveStates: { ...sim.interactiveStates, c_ol1: true } },
    0.05
  );
  assert.equal(sim.coilStates['M1'], false, 'Tripping Overload OL1 must de-energize M1');
});

test('Engine 5: ERC passes cleanly on demo circuit and flags shorts, duplicates, and orphans', () => {
  const demo = createDefaultDemoProject();
  const cleanDiags = runElectricalRuleCheck(demo);
  assert.equal(
    cleanDiags.filter((d) => d.severity === 'error').length,
    0,
    `Expected 0 ERC errors on demo circuit, got: ${JSON.stringify(cleanDiags)}`
  );

  // Introduce direct L1-L2 short, duplicate coil tag M1, and orphaned contact Z99
  const broken = structuredClone(demo);
  broken.sheets[0].wires.push({ id: 'w_short', x1: L1_X, y1: 580, x2: L2_X, y2: 580 });
  broken.sheets[0].components.push({
    id: 'c_dup',
    type: 'coil_motor',
    x: 680,
    y: 500,
    tag: 'M1',
    description: 'Duplicate M1',
    manufacturer: 'Test',
    partNumber: 'DUP',
  });
  broken.sheets[0].components.push({
    id: 'c_orphan',
    type: 'contact_no',
    x: 240,
    y: 500,
    tag: 'Z99',
    parentTag: 'Z99',
    description: 'Orphan',
    manufacturer: 'Test',
    partNumber: 'ORP',
  });

  const diags = runElectricalRuleCheck(broken);
  const codes = new Set(diags.map((d) => d.code));
  assert.ok(codes.has('ERC-001'), 'Must flag L1-L2 short circuit (ERC-001)');
  assert.ok(codes.has('ERC-002'), 'Must flag duplicate Parent coil tag (ERC-002)');
  assert.ok(codes.has('ERC-003'), 'Must flag orphaned Child contact (ERC-003)');
});

test('Engine 6: ExportEngine produces valid BOM, Terminal Strip, SVG, DXF, CODESYS .export, Simulink/Simscape .xml/.m/.mdl, and CADe_SIMU .cad', () => {
  const engine = new ExportEngine();
  const vfdProject = createVfdControlTemplate();

  const bom = engine.generateBom(vfdProject);
  assert.ok(bom.length >= 5, 'BOM should aggregate physical devices');

  const terminals = engine.generateTerminalStrip(vfdProject);
  assert.ok(terminals.length >= 2, 'Terminal strip should list TB1/TB2 terminals');

  const svg = engine.exportSvg(vfdProject.sheets[0], vfdProject);
  assert.ok(svg.includes('<svg') && svg.includes('VOLTGRID ECAD'));

  const dxf = engine.exportDxf(vfdProject.sheets[0], vfdProject);
  assert.ok(dxf.includes('SECTION') && dxf.includes('ENTITIES') && dxf.includes('EOF'));

  const codesys = engine.exportCodesys(vfdProject);
  assert.ok(codesys.includes('PRG_MainControl') && codesys.includes('GVL_IO') && codesys.includes('Standard.TOF'));

  const simscapeXml = engine.exportSimulinkSimscapeXml(vfdProject);
  assert.ok(
    simscapeXml.includes('SimscapeSimulinkModel') &&
      simscapeXml.includes('ee_lib/Semiconductors &amp; Converters/Three-Phase Inverter')
  );

  const simscapeM = engine.exportSimscapeMatlabScript(vfdProject);
  assert.ok(simscapeM.includes('nesl_utility/Solver Configuration') && simscapeM.includes('save_system'));

  const simulinkMdl = engine.exportSimulinkMdl(vfdProject);
  assert.ok(simulinkMdl.includes('Model {') && simulinkMdl.includes('BlockType Logic'));

  const cade = engine.exportCadeSimu(vfdProject.sheets[0], vfdProject);
  assert.ok(cade.includes('CADe_SIMU 4.0') && cade.includes('VARIADOR_VFD_CMD'));
});

test('TemplateImporter parses PDF VFD & PLC technical drawings into clean ERC-valid templates', () => {
  const importer = new TemplateImporter();
  const samplePdfText =
    'SIEMENS SINAMICS G120 VFD & S7-1200 PLC SCHEMATIC 24VDC DI1 RUN DI2 REV %IX0.0 %IX0.1 %QX0.0 R1A R1C 5.0 SEC';
  const { project, summary } = importer.parseSchematicText(samplePdfText, 'siemens_vfd_plc_panel.pdf');

  assert.equal(summary.detectedDomain, 'VFD + PLC Integrated');
  assert.equal(summary.detectedManufacturer, 'Siemens');
  assert.equal(summary.detectedVoltage, '24VDC');
  assert.equal(project.sheets.length, 2);
  assert.ok(summary.plcAddresses.includes('%IX0.0'));

  const diags = runElectricalRuleCheck(project);
  assert.equal(
    diags.filter((d) => d.severity === 'error').length,
    0,
    `Imported PDF template should have 0 ERC errors, got: ${JSON.stringify(diags)}`
  );
});
