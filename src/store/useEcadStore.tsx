import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { createDefaultDemoProject } from '../data/demoCircuits';
import { getSymbolDef } from '../data/symbolCatalog';
import { computeCrossReferences, linkChildToParent, renameParentTag } from '../engines/crossRefEngine';
import { runElectricalRuleCheck } from '../engines/ercEngine';
import { exportEngine } from '../engines/exportEngine';
import { autoNumberProjectWires } from '../engines/netlistEngine';
import {
  addBlankRung,
  addOrthogonalWire,
  generateId,
  getNextTag,
  moveComponentWithWireBreak,
  placeComponentWithWireBreak,
} from '../engines/schematicEngine';
import { createInitialSimulationState, stepSimulation } from '../engines/simulationEngine';
import {
  AppMode,
  BomRow,
  CrossReferenceEntry,
  ErcDiagnostic,
  Point,
  Project,
  SchematicComponent,
  SchematicSheet,
  SimulationState,
  SymbolType,
  TerminalRow,
  ToolMode,
} from '../types/ecad';

interface HistoryState {
  past: Project[];
  present: Project;
  future: Project[];
}

type HistoryAction =
  | { type: 'COMMIT'; project: Project }
  | { type: 'REPLACE_ALL'; project: Project }
  | { type: 'UNDO' }
  | { type: 'REDO' };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'COMMIT': {
      const nextPast = [...state.past.slice(-49), state.present];
      return { past: nextPast, present: action.project, future: [] };
    }
    case 'REPLACE_ALL':
      return { past: [], present: action.project, future: [] };
    case 'UNDO': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future.slice(0, 49)],
      };
    }
    case 'REDO': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      };
    }
    default:
      return state;
  }
}

export type RightPanelTab = 'inspector' | 'bom' | 'xref' | 'terminals' | 'erc';

interface EcadContextValue {
  project: Project;
  activeSheet: SchematicSheet;
  mode: AppMode;
  tool: ToolMode;
  placingSymbol: SymbolType | null;
  selectedComponentId: string | null;
  selectedWireId: string | null;
  highlightedDiagnosticTargetId: string | null;
  rightTab: RightPanelTab;
  zoom: number;
  pan: Point;
  canUndo: boolean;
  canRedo: boolean;
  simulation: SimulationState;
  crossRefs: Map<string, CrossReferenceEntry>;
  ercDiagnostics: ErcDiagnostic[];
  bomRows: BomRow[];
  terminalRows: TerminalRow[];
  toastMessage: string | null;

  setMode: (mode: AppMode) => void;
  setTool: (tool: ToolMode) => void;
  startPlacingSymbol: (type: SymbolType) => void;
  selectComponent: (id: string | null) => void;
  selectWire: (id: string | null) => void;
  setRightTab: (tab: RightPanelTab) => void;
  setZoom: (zoom: number | ((z: number) => number)) => void;
  setPan: (pan: Point | ((p: Point) => Point)) => void;
  resetView: () => void;
  showToast: (msg: string) => void;

  undo: () => void;
  redo: () => void;

  // Sheet actions
  switchSheet: (sheetId: string) => void;
  addSheet: (name?: string, voltageLabel?: string) => void;
  deleteSheet: (sheetId: string) => void;
  addRungToActiveSheet: () => void;

  // Schematic editing actions
  placeSymbolAt: (type: SymbolType, x: number, y: number) => void;
  moveComponentTo: (componentId: string, x: number, y: number) => void;
  drawOrthogonalWire: (start: Point, end: Point, horizontalFirst?: boolean) => void;
  updateComponent: (componentId: string, patch: Partial<SchematicComponent>) => void;
  renameParentComponentTag: (componentId: string, newTag: string) => void;
  linkContactToParent: (componentId: string, parentTag: string) => void;
  deleteSelected: () => void;
  autoNumberWires: () => void;
  runErcNow: () => void;
  focusDiagnostic: (diag: ErcDiagnostic) => void;
  loadProject: (project: Project, announcement?: string) => void;

  // Simulation interactions
  toggleInteractiveSwitch: (componentId: string, forcedState?: boolean) => void;
  pulseMomentarySwitch: (componentId: string) => void;
  resetSimulation: () => void;
}

const EcadContext = createContext<EcadContextValue | null>(null);

export const EcadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: createDefaultDemoProject(),
    future: [],
  }));

  const project = history.present;
  const activeSheet = useMemo(
    () => project.sheets.find((s) => s.id === project.activeSheetId) ?? project.sheets[0],
    [project]
  );

  const [mode, setModeState] = useState<AppMode>('EDIT');
  const [tool, setToolState] = useState<ToolMode>('select');
  const [placingSymbol, setPlacingSymbol] = useState<SymbolType | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>('c_m1');
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [highlightedDiagnosticTargetId, setHighlightedDiagnosticTargetId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightPanelTab>('inspector');
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<Point>({ x: 24, y: 16 });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [simulation, setSimulation] = useState<SimulationState>(() =>
    createInitialSimulationState()
  );

  const projectRef = useRef(project);
  projectRef.current = project;
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 3200);
  }, []);

  // Derived live engineering models
  const crossRefs = useMemo(() => computeCrossReferences(project), [project]);
  const ercDiagnostics = useMemo(() => runElectricalRuleCheck(project), [project]);
  const bomRows = useMemo(() => exportEngine.generateBom(project), [project]);
  const terminalRows = useMemo(() => exportEngine.generateTerminalStrip(project), [project]);

  // Continuous real-time simulation loop (50ms tick)
  useEffect(() => {
    if (mode !== 'SIMULATE') return;

    // Immediate first evaluation
    setSimulation((prev) => stepSimulation(projectRef.current, { ...prev, running: true }, 0));

    let lastTime = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.2, Math.max(0.01, (now - lastTime) / 1000));
      lastTime = now;
      setSimulation((prev) => stepSimulation(projectRef.current, prev, dt));
    }, 50);

    return () => window.clearInterval(interval);
  }, [mode]);

  const setMode = useCallback((nextMode: AppMode) => {
    setModeState(nextMode);
    if (nextMode === 'SIMULATE') {
      setToolState('select');
      setPlacingSymbol(null);
      setSimulation((prev) =>
        stepSimulation(projectRef.current, { ...createInitialSimulationState(), ...prev, running: true }, 0)
      );
    } else {
      setSimulation(createInitialSimulationState());
    }
  }, []);

  const setTool = useCallback((nextTool: ToolMode) => {
    setToolState(nextTool);
    if (nextTool !== 'place') {
      setPlacingSymbol(null);
    }
  }, []);

  const startPlacingSymbol = useCallback((type: SymbolType) => {
    setModeState('EDIT');
    setSimulation(createInitialSimulationState());
    setPlacingSymbol(type);
    setToolState('place');
    setSelectedWireId(null);
  }, []);

  const selectComponent = useCallback((id: string | null) => {
    setSelectedComponentId(id);
    if (id) {
      setSelectedWireId(null);
      setHighlightedDiagnosticTargetId(null);
    }
  }, []);

  const selectWire = useCallback((id: string | null) => {
    setSelectedWireId(id);
    if (id) {
      setSelectedComponentId(null);
      setHighlightedDiagnosticTargetId(null);
    }
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 24, y: 16 });
  }, []);

  const commitActiveSheet = useCallback(
    (updater: (sheet: SchematicSheet) => SchematicSheet) => {
      const curr = projectRef.current;
      const updatedProject: Project = {
        ...curr,
        sheets: curr.sheets.map((s) => (s.id === curr.activeSheetId ? updater(s) : s)),
      };
      dispatch({ type: 'COMMIT', project: updatedProject });
    },
    []
  );

  const switchSheet = useCallback((sheetId: string) => {
    const curr = projectRef.current;
    if (curr.activeSheetId === sheetId) return;
    dispatch({
      type: 'COMMIT',
      project: { ...curr, activeSheetId: sheetId },
    });
    setSelectedComponentId(null);
    setSelectedWireId(null);
  }, []);

  const addSheet = useCallback(
    (name?: string, voltageLabel: string = '120VAC 60Hz') => {
      const curr = projectRef.current;
      const nextNum = curr.sheets.length + 1;
      const isDc = voltageLabel.toUpperCase().includes('DC');
      const newSheet: SchematicSheet = {
        id: generateId('sheet'),
        number: nextNum,
        name: name || `Control Sheet ${nextNum}`,
        voltageLabel,
        l1Label: isDc ? '+24V' : 'L1',
        l2Label: isDc ? '0V' : 'L2',
        rungCount: 6,
        components: [],
        wires: [],
      };
      dispatch({
        type: 'COMMIT',
        project: {
          ...curr,
          sheets: [...curr.sheets, newSheet],
          activeSheetId: newSheet.id,
        },
      });
      setSelectedComponentId(null);
      setSelectedWireId(null);
      showToast(`Added Sheet ${nextNum}: ${newSheet.name}`);
    },
    [showToast]
  );

  const deleteSheet = useCallback(
    (sheetId: string) => {
      const curr = projectRef.current;
      if (curr.sheets.length <= 1) {
        showToast('Cannot delete the only remaining sheet.');
        return;
      }
      const remaining = curr.sheets
        .filter((s) => s.id !== sheetId)
        .map((s, idx) => ({ ...s, number: idx + 1 }));
      const nextActive =
        curr.activeSheetId === sheetId ? remaining[0].id : curr.activeSheetId;
      dispatch({
        type: 'COMMIT',
        project: { ...curr, sheets: remaining, activeSheetId: nextActive },
      });
      setSelectedComponentId(null);
      setSelectedWireId(null);
    },
    [showToast]
  );

  const addRungToActiveSheet = useCallback(() => {
    commitActiveSheet((s) => addBlankRung(s));
    showToast('Added new wired rung');
  }, [commitActiveSheet, showToast]);

  const placeSymbolAt = useCallback(
    (type: SymbolType, x: number, y: number) => {
      const def = getSymbolDef(type);
      const allComps = projectRef.current.sheets.flatMap((s) => s.components);
      const parentCoils = allComps.filter((c) => getSymbolDef(c.type)?.isParent);

      let tag = getNextTag(allComps, def.defaultTagPrefix);
      let parentTag: string | undefined;
      let terminalStrip: string | undefined;
      let terminalNumber: string | undefined;

      if (def.isChild) {
        const preferred =
          type === 'timer_contact_no' || type === 'timer_contact_nc'
            ? parentCoils.find((c) => c.type === 'coil_ton' || c.type === 'coil_tof') ?? parentCoils[0]
            : parentCoils[0];
        parentTag = preferred?.tag ?? 'CR1';
        tag = parentTag;
      } else if (type === 'terminal') {
        const existingTb1 = allComps.filter((c) => c.type === 'terminal' && (c.terminalStrip || 'TB1') === 'TB1');
        terminalStrip = 'TB1';
        terminalNumber = String(existingTb1.length + 1);
        tag = `${terminalStrip}-${terminalNumber}`;
      }

      const newComp: SchematicComponent = {
        id: generateId('c'),
        type,
        x,
        y,
        tag,
        description: def.defaultDescription,
        manufacturer: def.defaultManufacturer,
        partNumber: def.defaultPartNumber,
        parentTag,
        timerPreset: def.defaultTimerPreset,
        pilotColor: def.defaultColor,
        terminalStrip,
        terminalNumber,
      };

      commitActiveSheet((s) => placeComponentWithWireBreak(s, newComp));
      setSelectedComponentId(newComp.id);
      setSelectedWireId(null);
      setRightTab('inspector');
    },
    [commitActiveSheet]
  );

  const moveComponentTo = useCallback(
    (componentId: string, x: number, y: number) => {
      commitActiveSheet((s) => moveComponentWithWireBreak(s, componentId, x, y));
    },
    [commitActiveSheet]
  );

  const drawOrthogonalWire = useCallback(
    (start: Point, end: Point, horizontalFirst: boolean = true) => {
      commitActiveSheet((s) => addOrthogonalWire(s, start, end, horizontalFirst));
    },
    [commitActiveSheet]
  );

  const updateComponent = useCallback(
    (componentId: string, patch: Partial<SchematicComponent>) => {
      commitActiveSheet((sheet) => ({
        ...sheet,
        components: sheet.components.map((c) => (c.id === componentId ? { ...c, ...patch } : c)),
      }));
    },
    [commitActiveSheet]
  );

  const renameParentComponentTag = useCallback(
    (componentId: string, newTag: string) => {
      const updated = renameParentTag(projectRef.current, componentId, newTag);
      if (updated !== projectRef.current) {
        dispatch({ type: 'COMMIT', project: updated });
        showToast(`Renamed Parent coil & linked contacts to ${newTag.trim().toUpperCase()}`);
      }
    },
    [showToast]
  );

  const linkContactToParent = useCallback((componentId: string, parentTag: string) => {
    const updated = linkChildToParent(projectRef.current, componentId, parentTag);
    dispatch({ type: 'COMMIT', project: updated });
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedComponentId) {
      commitActiveSheet((sheet) => ({
        ...sheet,
        components: sheet.components.filter((c) => c.id !== selectedComponentId),
      }));
      setSelectedComponentId(null);
      return;
    }
    if (selectedWireId) {
      commitActiveSheet((sheet) => ({
        ...sheet,
        wires: sheet.wires.filter((w) => w.id !== selectedWireId),
      }));
      setSelectedWireId(null);
    }
  }, [commitActiveSheet, selectedComponentId, selectedWireId]);

  const autoNumberWires = useCallback(() => {
    const numbered = autoNumberProjectWires(projectRef.current);
    dispatch({ type: 'COMMIT', project: numbered });
    showToast('Auto-numbered all equipotential nets by rung');
  }, [showToast]);

  const runErcNow = useCallback(() => {
    setRightTab('erc');
    const diags = runElectricalRuleCheck(projectRef.current);
    const errors = diags.filter((d) => d.severity === 'error').length;
    const warnings = diags.filter((d) => d.severity === 'warning').length;
    showToast(
      diags.length === 0
        ? 'ERC Passed: 0 errors, 0 warnings'
        : `ERC Complete: ${errors} error(s), ${warnings} warning(s)`
    );
  }, [showToast]);

  const focusDiagnostic = useCallback((diag: ErcDiagnostic) => {
    const curr = projectRef.current;
    if (curr.activeSheetId !== diag.sheetId) {
      dispatch({ type: 'COMMIT', project: { ...curr, activeSheetId: diag.sheetId } });
    }
    if (diag.targetType === 'component' && diag.targetId) {
      setSelectedComponentId(diag.targetId);
      setSelectedWireId(null);
      setHighlightedDiagnosticTargetId(diag.targetId);
    } else if (diag.targetType === 'wire' && diag.targetId) {
      setSelectedWireId(diag.targetId);
      setSelectedComponentId(null);
      setHighlightedDiagnosticTargetId(diag.targetId);
    }
  }, []);

  const loadProject = useCallback(
    (nextProject: Project, announcement?: string) => {
      setModeState('EDIT');
      setSimulation(createInitialSimulationState());
      dispatch({ type: 'REPLACE_ALL', project: nextProject });
      const firstComp = nextProject.sheets[0]?.components[0]?.id ?? null;
      setSelectedComponentId(firstComp);
      setSelectedWireId(null);
      setHighlightedDiagnosticTargetId(null);
      resetView();
      if (announcement) showToast(announcement);
    },
    [resetView, showToast]
  );

  const toggleInteractiveSwitch = useCallback((componentId: string, forcedState?: boolean) => {
    setSimulation((prev) => {
      const nextVal = forcedState !== undefined ? forcedState : !prev.interactiveStates[componentId];
      const nextState: SimulationState = {
        ...prev,
        interactiveStates: {
          ...prev.interactiveStates,
          [componentId]: nextVal,
        },
      };
      return stepSimulation(projectRef.current, nextState, 0);
    });
  }, []);

  const pulseMomentarySwitch = useCallback((componentId: string) => {
    setSimulation((prev) => {
      const pressed: SimulationState = {
        ...prev,
        interactiveStates: { ...prev.interactiveStates, [componentId]: true },
      };
      return stepSimulation(projectRef.current, pressed, 0);
    });
    window.setTimeout(() => {
      setSimulation((prev) => {
        const released: SimulationState = {
          ...prev,
          interactiveStates: { ...prev.interactiveStates, [componentId]: false },
        };
        return stepSimulation(projectRef.current, released, 0);
      });
    }, 240);
  }, []);

  const resetSimulation = useCallback(() => {
    setSimulation(stepSimulation(projectRef.current, { ...createInitialSimulationState(), running: true }, 0));
    showToast('Simulation state reset');
  }, [showToast]);

  // Global keyboard shortcuts (Undo/Redo, Delete, Escape, Wire tool)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          dispatch({ type: 'REDO' });
        } else {
          dispatch({ type: 'UNDO' });
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'REDO' });
        return;
      }
      if (e.key === 'Escape') {
        setToolState('select');
        setPlacingSymbol(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && mode === 'EDIT') {
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelected, mode]);

  const value: EcadContextValue = {
    project,
    activeSheet,
    mode,
    tool,
    placingSymbol,
    selectedComponentId,
    selectedWireId,
    highlightedDiagnosticTargetId,
    rightTab,
    zoom,
    pan,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    simulation,
    crossRefs,
    ercDiagnostics,
    bomRows,
    terminalRows,
    toastMessage,

    setMode,
    setTool,
    startPlacingSymbol,
    selectComponent,
    selectWire,
    setRightTab,
    setZoom,
    setPan,
    resetView,
    showToast,

    undo: () => dispatch({ type: 'UNDO' }),
    redo: () => dispatch({ type: 'REDO' }),

    switchSheet,
    addSheet,
    deleteSheet,
    addRungToActiveSheet,

    placeSymbolAt,
    moveComponentTo,
    drawOrthogonalWire,
    updateComponent,
    renameParentComponentTag,
    linkContactToParent,
    deleteSelected,
    autoNumberWires,
    runErcNow,
    focusDiagnostic,
    loadProject,

    toggleInteractiveSwitch,
    pulseMomentarySwitch,
    resetSimulation,
  };

  return <EcadContext.Provider value={value}>{children}</EcadContext.Provider>;
};

export function useEcad(): EcadContextValue {
  const ctx = useContext(EcadContext);
  if (!ctx) throw new Error('useEcad must be used within EcadProvider');
  return ctx;
}
