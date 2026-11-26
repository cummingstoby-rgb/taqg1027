import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import { getSymbolDef } from '../data/symbolCatalog';
import {
  computeJunctionDots,
  formatRungNumber,
  getRungNumber,
  getRungY,
  snapToGrid,
} from '../engines/schematicEngine';
import { useEcad } from '../store/useEcadStore';
import {
  FIRST_RUNG_Y,
  GRID_SIZE,
  L1_X,
  L2_X,
  Point,
} from '../types/ecad';
import { CanvasSymbol, SymbolGlyph } from './SymbolSvg';

export const LadderCanvas: React.FC = () => {
  const {
    project,
    activeSheet,
    mode,
    tool,
    placingSymbol,
    selectedComponentId,
    selectedWireId,
    highlightedDiagnosticTargetId,
    zoom,
    pan,
    simulation,
    crossRefs,
    setZoom,
    setPan,
    selectComponent,
    selectWire,
    placeSymbolAt,
    moveComponentTo,
    drawOrthogonalWire,
    toggleInteractiveSwitch,
    pulseMomentarySwitch,
    resetSimulation,
    switchSheet,
    addSheet,
  } = useEcad();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursorWorld, setCursorWorld] = useState<Point>({ x: L1_X, y: FIRST_RUNG_Y });
  const [wireStart, setWireStart] = useState<Point | null>(null);
  const [wireHorizFirst, setWireHorizFirst] = useState<boolean>(true);
  const [draggingCompId, setDraggingCompId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<Point | null>(null);
  const [panning, setPanning] = useState<{ startX: number; startY: number; origPan: Point } | null>(null);

  const fitCanvasToViewport = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100) return;
    const contentWidth = 960;
    const contentHeight = Math.max(660, getRungY(Math.max(activeSheet.rungCount, 6)) + 80);
    const scaleX = (rect.width - 24) / contentWidth;
    const scaleY = (rect.height - 24) / contentHeight;
    const fitZoom = Math.min(1, Math.max(0.55, Number(Math.min(scaleX, scaleY).toFixed(2))));
    const offsetX = Math.max(12, Math.round((rect.width - contentWidth * fitZoom) / 2));
    setZoom(fitZoom);
    setPan({ x: offsetX, y: 10 });
  }, [activeSheet.rungCount, setPan, setZoom]);

  useEffect(() => {
    fitCanvasToViewport();
    const onResize = () => fitCanvasToViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitCanvasToViewport, activeSheet.id]);

  const isSimMode = mode === 'SIMULATE';
  const junctions = useMemo(
    () => computeJunctionDots(activeSheet.wires, activeSheet.components),
    [activeSheet.wires, activeSheet.components]
  );

  const energizedWireSet = useMemo(
    () => new Set(isSimMode ? simulation.energizedWireIds : []),
    [isSimMode, simulation.energizedWireIds]
  );
  const energizedCompSet = useMemo(
    () => new Set(isSimMode ? simulation.energizedComponentIds : []),
    [isSimMode, simulation.energizedComponentIds]
  );
  const conductingCompSet = useMemo(
    () => new Set(isSimMode ? simulation.conductingComponentIds : []),
    [isSimMode, simulation.conductingComponentIds]
  );

  const interactiveDevices = useMemo(
    () => activeSheet.components.filter((c) => getSymbolDef(c.type)?.isInteractiveInSim),
    [activeSheet.components]
  );

  const screenToWorld = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((z) => Math.min(2.4, Math.max(0.45, Number((z * factor).toFixed(2)))));
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Middle click or Alt+left click initiates pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      setPanning({ startX: e.clientX, startY: e.clientY, origPan: pan });
      return;
    }

    if (e.button !== 0) return;

    const world = screenToWorld(e.clientX, e.clientY);
    const snapped = { x: snapToGrid(world.x), y: snapToGrid(world.y) };

    if (!isSimMode && tool === 'place' && placingSymbol) {
      placeSymbolAt(placingSymbol, snapped.x, snapped.y);
      return;
    }

    if (!isSimMode && tool === 'wire') {
      if (!wireStart) {
        setWireStart(snapped);
      } else {
        drawOrthogonalWire(wireStart, snapped, wireHorizFirst);
        setWireStart(null);
      }
      return;
    }

    // Clicked empty background -> deselect or pan if dragging
    if ((e.target as Element).getAttribute('data-canvas-bg') === 'true') {
      selectComponent(null);
      selectWire(null);
      setPanning({ startX: e.clientX, startY: e.clientY, origPan: pan });
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const world = screenToWorld(e.clientX, e.clientY);
    const snapped = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
    setCursorWorld(snapped);

    if (panning) {
      setPan({
        x: panning.origPan.x + (e.clientX - panning.startX),
        y: panning.origPan.y + (e.clientY - panning.startY),
      });
      return;
    }

    if (draggingCompId && !isSimMode) {
      setDragPreview(snapped);
    }
  };

  const handleCanvasPointerUp = () => {
    if (panning) {
      setPanning(null);
    }
    if (draggingCompId && dragPreview && !isSimMode) {
      const comp = activeSheet.components.find((c) => c.id === draggingCompId);
      if (comp && (comp.x !== dragPreview.x || comp.y !== dragPreview.y)) {
        moveComponentTo(draggingCompId, dragPreview.x, dragPreview.y);
      }
    }
    setDraggingCompId(null);
    setDragPreview(null);
  };

  const handleDrop = (e: React.DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (isSimMode) return;
    const symType = e.dataTransfer.getData('application/voltgrid-symbol');
    if (!symType) return;
    const world = screenToWorld(e.clientX, e.clientY);
    placeSymbolAt(symType as never, snapToGrid(world.x), snapToGrid(world.y));
  };

  const railTop = FIRST_RUNG_Y - 36;
  const railBottom = getRungY(Math.max(activeSheet.rungCount, 6)) + 56;
  const currentRung = getRungNumber(cursorWorld.y);

  // Deduplicate wire number labels so each net displays its number once on its longest horizontal segment
  const labeledNetIds = new Set<string>();
  const wireLabelWinner = useMemo(() => {
    const best = new Map<string, { wireId: string; len: number }>();
    for (const w of activeSheet.wires) {
      if (!w.wireNumber || w.y1 !== w.y2) continue;
      const key = w.netId || w.wireNumber;
      const len = Math.abs(w.x2 - w.x1);
      const curr = best.get(key);
      if (!curr || len > curr.len) {
        best.set(key, { wireId: w.id, len });
      }
    }
    return new Set(Array.from(best.values()).map((v) => v.wireId));
  }, [activeSheet.wires]);

  return (
    <div className="relative flex-1 flex flex-col bg-[#0F1115] overflow-hidden select-none">
      {/* Simulation Quick-Actuate Control Strip (only shown in SIMULATE mode) */}
      {isSimMode && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2 bg-[#161920] border-b border-[#2A2F3A] overflow-x-auto"
          data-testid="sim-control-bar"
        >
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-semibold text-[#34C759] whitespace-nowrap">
              Live Solver Active
            </span>
            <span className="text-[#2A2F3A]">|</span>
            <span className="text-xs text-[#94A3B8] whitespace-nowrap">
              Click devices on schematic or actuate:
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {interactiveDevices.map((dev) => {
              const def = getSymbolDef(dev.type);
              const isMomentary =
                def.role === 'switch_momentary_no' || def.role === 'switch_momentary_nc';
              const actuated = Boolean(simulation.interactiveStates[dev.id]);
              return (
                <button
                  key={dev.id}
                  type="button"
                  onClick={() =>
                    isMomentary ? pulseMomentarySwitch(dev.id) : toggleInteractiveSwitch(dev.id)
                  }
                  className={`px-2.5 py-1 rounded text-xs font-mono font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    actuated
                      ? dev.type === 'overload_nc' || dev.type === 'estop_nc'
                        ? 'bg-[#FF3B30]/20 border-[#FF3B30] text-[#FF6B63]'
                        : 'bg-[#34C759]/20 border-[#34C759] text-[#34C759]'
                      : 'bg-[#1E222B] border-[#2A2F3A] text-[#E6EDF3] hover:border-[#00E5FF]'
                  }`}
                  aria-label={`Actuate ${dev.tag} ${dev.description}`}
                >
                  {dev.tag}
                  {dev.type === 'pb_no'
                    ? ' Start'
                    : dev.type === 'pb_nc'
                      ? ' Stop'
                      : dev.type === 'overload_nc'
                        ? actuated
                          ? ' Tripped'
                          : ' Trip'
                        : dev.type === 'estop_nc'
                          ? actuated
                            ? ' Reset'
                            : ' E-Stop'
                          : ''}
                </button>
              );
            })}
            <button
              type="button"
              onClick={resetSimulation}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-[#1E222B] border border-[#2A2F3A] text-[#94A3B8] hover:text-[#E6EDF3] hover:border-[#3E4656] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              aria-label="Reset simulation state"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Live Short Circuit Alert Banner */}
      {isSimMode && simulation.hasLiveShort && (
        <div
          role="alert"
          className="px-4 py-1.5 bg-[#FF3B30]/20 border-b border-[#FF3B30] text-xs font-mono font-semibold text-[#FF6B63] flex items-center justify-between"
        >
          <span>FAULT: Direct {activeSheet.l1Label} to {activeSheet.l2Label} short circuit detected — power supply tripped.</span>
        </div>
      )}

      {/* Main Hardware-Accelerated SVG Vector Canvas */}
      <svg
        ref={svgRef}
        data-testid="ladder-canvas"
        data-mode={mode}
        className={`flex-1 w-full h-full ${
          panning
            ? 'cursor-grabbing'
            : !isSimMode && (tool === 'wire' || tool === 'place')
              ? 'cursor-crosshair'
              : 'cursor-default'
        }`}
        onWheel={handleWheel}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onContextMenu={(e) => {
          if (tool === 'wire' && wireStart) {
            e.preventDefault();
            setWireHorizFirst((v) => !v);
          }
        }}
      >
        <defs>
          <pattern
            id="voltgrid-dots"
            width={GRID_SIZE}
            height={GRID_SIZE}
            patternUnits="userSpaceOnUse"
          >
            <circle cx={0.5} cy={0.5} r={1} fill="#1E2430" />
          </pattern>
        </defs>

        {/* Infinite Background Click Surface */}
        <rect
          x={-10000}
          y={-10000}
          width={20000}
          height={20000}
          fill="#0F1115"
          data-canvas-bg="true"
        />

        {/* World Transform Group */}
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Precision CAD Grid Sheet Area */}
          <rect
            x={0}
            y={0}
            width={980}
            height={Math.max(640, railBottom + 60)}
            fill="url(#voltgrid-dots)"
            stroke="#1F242E"
            strokeWidth={1}
            data-canvas-bg="true"
          />

          {/* Sheet Header Banner inside drawing border */}
          <text
            x={(L1_X + L2_X) / 2}
            y={30}
            textAnchor="middle"
            fill="#8B949E"
            fontSize={11}
            fontWeight={600}
            fontFamily="JetBrains Mono, monospace"
            style={{ pointerEvents: 'none' }}
          >
            {`SHEET ${activeSheet.number}: ${activeSheet.name.toUpperCase()}  ·  ${activeSheet.voltageLabel}  ·  ${project.metadata.standard}`}
          </text>

          {/* Subtle Rung Guide Lines & Automatic Rung Numbering (01, 02, 03...) */}
          {Array.from({ length: Math.max(activeSheet.rungCount + 1, 7) }).map((_, i) => {
            const rungNum = i + 1;
            const y = getRungY(rungNum);
            return (
              <g key={rungNum} style={{ pointerEvents: 'none' }}>
                <line
                  x1={L1_X}
                  y1={y}
                  x2={L2_X}
                  y2={y}
                  stroke="#171B22"
                  strokeWidth={1}
                  strokeDasharray="3 5"
                />
                <text
                  x={42}
                  y={y + 4}
                  textAnchor="middle"
                  fill="#64748B"
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {formatRungNumber(rungNum)}
                </text>
              </g>
            );
          })}

          {/* Vertical L1 (Hot) and L2 (Neutral) Power Rails */}
          <g style={{ pointerEvents: 'none' }}>
            <line
              x1={L1_X}
              y1={railTop}
              x2={L1_X}
              y2={railBottom}
              stroke="#FF3B30"
              strokeWidth={isSimMode ? 3.2 : 2.5}
            />
            <line
              x1={L2_X}
              y1={railTop}
              x2={L2_X}
              y2={railBottom}
              stroke="#60A5FA"
              strokeWidth={2.5}
            />
            <text
              x={L1_X}
              y={railTop - 10}
              textAnchor="middle"
              fill="#FF3B30"
              fontSize={13}
              fontWeight={700}
              fontFamily="JetBrains Mono, monospace"
            >
              {activeSheet.l1Label}
            </text>
            <text
              x={L2_X}
              y={railTop - 10}
              textAnchor="middle"
              fill="#60A5FA"
              fontSize={13}
              fontWeight={700}
              fontFamily="JetBrains Mono, monospace"
            >
              {activeSheet.l2Label}
            </text>
          </g>

          {/* Wire Segments */}
          {activeSheet.wires.map((w) => {
            const isHot = energizedWireSet.has(w.id);
            const isSelected = selectedWireId === w.id;
            const isError = highlightedDiagnosticTargetId === w.id;
            const strokeColor = isError
              ? '#FF3B30'
              : isSelected && !isSimMode
                ? '#00E5FF'
                : isHot
                  ? '#FF3B30'
                  : '#94A3B8';

            const showNumber =
              Boolean(w.wireNumber) &&
              w.wireNumber !== activeSheet.l1Label &&
              w.wireNumber !== activeSheet.l2Label &&
              wireLabelWinner.has(w.id) &&
              !labeledNetIds.has(w.netId || w.wireNumber || w.id);
            if (showNumber) labeledNetIds.add(w.netId || w.wireNumber || w.id);

            return (
              <g
                key={w.id}
                onClick={(e) => {
                  if (isSimMode || tool !== 'select') return;
                  e.stopPropagation();
                  selectWire(w.id);
                }}
                className={!isSimMode && tool === 'select' ? 'cursor-pointer' : undefined}
              >
                {/* Wide invisible hit target for easy wire selection */}
                <line
                  x1={w.x1}
                  y1={w.y1}
                  x2={w.x2}
                  y2={w.y2}
                  stroke="transparent"
                  strokeWidth={10}
                />
                <line
                  x1={w.x1}
                  y1={w.y1}
                  x2={w.x2}
                  y2={w.y2}
                  stroke={strokeColor}
                  strokeWidth={isHot || isSelected || isError ? 2.6 : 1.75}
                  strokeLinecap="square"
                />
                {showNumber && (
                  <g style={{ pointerEvents: 'none' }}>
                    <rect
                      x={(w.x1 + w.x2) / 2 - 14}
                      y={w.y1 - 16}
                      width={28}
                      height={12}
                      rx={2}
                      fill="#0F1115"
                      fillOpacity={0.9}
                    />
                    <text
                      x={(w.x1 + w.x2) / 2}
                      y={w.y1 - 7}
                      textAnchor="middle"
                      fill={isHot ? '#FF6B63' : '#00E5FF'}
                      fontSize={9}
                      fontWeight={600}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {w.wireNumber}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Automatic Junction Dots (3+ wire intersections) */}
          {junctions.map((j, idx) => (
            <circle
              key={`j_${j.x}_${j.y}_${idx}`}
              cx={j.x}
              cy={j.y}
              r={3.5}
              fill="#E6EDF3"
              style={{ pointerEvents: 'none' }}
            />
          ))}

          {/* Placed Schematic Components */}
          {activeSheet.components.map((comp) => {
            const def = getSymbolDef(comp.type);
            const isMomentary =
              def.role === 'switch_momentary_no' || def.role === 'switch_momentary_nc';
            const isEnergized = energizedCompSet.has(comp.id);
            const isConducting = conductingCompSet.has(comp.id);
            const isActuated = Boolean(simulation.interactiveStates[comp.id]);

            return (
              <CanvasSymbol
                key={comp.id}
                component={comp}
                isSelected={selectedComponentId === comp.id}
                isHighlightedError={highlightedDiagnosticTargetId === comp.id}
                isSimMode={isSimMode}
                isEnergized={isEnergized}
                isConducting={isConducting}
                isActuated={isActuated}
                crossRef={def.isParent ? crossRefs.get(comp.tag) : undefined}
                timerState={
                  comp.type === 'coil_ton' || comp.type === 'coil_tof'
                    ? simulation.timerStates[comp.tag]
                    : undefined
                }
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (isSimMode) {
                    if (def.isInteractiveInSim && isMomentary) {
                      toggleInteractiveSwitch(comp.id, true);
                    }
                    return;
                  }
                  if (tool === 'select') {
                    selectComponent(comp.id);
                    setDraggingCompId(comp.id);
                    setDragPreview({ x: comp.x, y: comp.y });
                  }
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  if (isSimMode && def.isInteractiveInSim && isMomentary) {
                    toggleInteractiveSwitch(comp.id, false);
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isSimMode) {
                    if (def.isInteractiveInSim && !isMomentary) {
                      toggleInteractiveSwitch(comp.id);
                    }
                    return;
                  }
                  if (tool === 'select') {
                    selectComponent(comp.id);
                  }
                }}
              />
            );
          })}

          {/* Component Drag Ghost Preview */}
          {draggingCompId && dragPreview && !isSimMode && (
            <g transform={`translate(${dragPreview.x}, ${dragPreview.y})`} opacity={0.55} style={{ pointerEvents: 'none' }}>
              <rect
                x={-22}
                y={-18}
                width={44}
                height={36}
                rx={3}
                fill="rgba(0, 229, 255, 0.12)"
                stroke="#00E5FF"
                strokeWidth={1.4}
                strokeDasharray="3 2"
              />
            </g>
          )}

          {/* Symbol Placement Ghost Preview */}
          {!isSimMode && tool === 'place' && placingSymbol && (
            <g transform={`translate(${cursorWorld.x}, ${cursorWorld.y})`} opacity={0.75} style={{ pointerEvents: 'none' }}>
              <rect
                x={-24}
                y={-18}
                width={48}
                height={36}
                rx={3}
                fill="rgba(0, 229, 255, 0.1)"
                stroke="#00E5FF"
                strokeWidth={1.2}
                strokeDasharray="3 2"
              />
              <SymbolGlyph type={placingSymbol} stroke="#00E5FF" />
            </g>
          )}

          {/* Orthogonal Wire Drawing Preview */}
          {!isSimMode && tool === 'wire' && (
            <g style={{ pointerEvents: 'none' }}>
              <circle cx={cursorWorld.x} cy={cursorWorld.y} r={3.5} fill="#00E5FF" />
              {wireStart && (
                <>
                  <circle cx={wireStart.x} cy={wireStart.y} r={4} fill="#00E5FF" />
                  <polyline
                    points={
                      wireHorizFirst
                        ? `${wireStart.x},${wireStart.y} ${cursorWorld.x},${wireStart.y} ${cursorWorld.x},${cursorWorld.y}`
                        : `${wireStart.x},${wireStart.y} ${wireStart.x},${cursorWorld.y} ${cursorWorld.x},${cursorWorld.y}`
                    }
                    fill="none"
                    stroke="#00E5FF"
                    strokeWidth={2}
                    strokeDasharray="5 3"
                  />
                </>
              )}
            </g>
          )}
        </g>
      </svg>

      {/* Bottom Sheet Tabs Bar & Precision Coordinate / Zoom HUD */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#181B20] border-t border-[#2A2F3A] text-xs">
        {/* Multi-sheet switcher */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {project.sheets.map((s) => {
            const active = s.id === activeSheet.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => switchSheet(s.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#00E5FF]/15 text-[#00E5FF] border border-[#00E5FF]/40'
                    : 'text-[#94A3B8] hover:text-[#E6EDF3] hover:bg-[#222731] border border-transparent'
                }`}
              >
                <span className="font-mono mr-1">S{s.number} </span>
                {s.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => addSheet()}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#94A3B8] hover:text-[#00E5FF] hover:bg-[#222731] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            aria-label="Add schematic sheet"
          >
            <Plus className="w-3.5 h-3.5" />
            Sheet
          </button>
        </div>

        {/* Right HUD: Grid coordinates & Zoom */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-[11px] text-[#8B949E] hidden sm:inline">
            X:{cursorWorld.x} · Y:{cursorWorld.y} · Rung {formatRungNumber(currentRung)}
          </span>
          {!isSimMode && tool === 'wire' && (
            <span className="text-[11px] text-[#00E5FF] font-mono hidden md:inline">
              {wireStart ? 'Click end point (Right-click flips bend)' : 'Click wire start point'}
            </span>
          )}
          <div className="flex items-center gap-1 border-l border-[#2A2F3A] pl-3">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.45, Number((z - 0.15).toFixed(2))))}
              className="p-1 rounded hover:bg-[#222731] text-[#94A3B8] hover:text-[#E6EDF3] cursor-pointer"
              aria-label="Zoom out"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] text-[#E6EDF3] w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2.4, Number((z + 0.15).toFixed(2))))}
              className="p-1 rounded hover:bg-[#222731] text-[#94A3B8] hover:text-[#E6EDF3] cursor-pointer"
              aria-label="Zoom in"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={fitCanvasToViewport}
              className="p-1 rounded hover:bg-[#222731] text-[#94A3B8] hover:text-[#E6EDF3] cursor-pointer"
              aria-label="Fit schematic to view"
              title="Fit schematic to view"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
