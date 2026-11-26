import React from 'react';
import { getSymbolDef } from '../data/symbolCatalog';
import {
  CrossReferenceEntry,
  SchematicComponent,
  SymbolType,
  TimerRuntimeState,
} from '../types/ecad';

interface SymbolGlyphProps {
  type: SymbolType;
  stroke: string;
  fill?: string;
  isActuated?: boolean;
  isEnergized?: boolean;
  isConducting?: boolean;
  pilotColor?: 'green' | 'red' | 'amber' | 'cyan';
  tag?: string;
  timerState?: TimerRuntimeState;
}

function pilotHex(color?: 'green' | 'red' | 'amber' | 'cyan'): string {
  switch (color) {
    case 'green':
      return '#34C759';
    case 'amber':
      return '#F59E0B';
    case 'cyan':
      return '#00E5FF';
    case 'red':
    default:
      return '#FF3B30';
  }
}

/**
 * Pure JIC/IEC vector glyph centered at (0,0) with left pin at (-20,0) and right pin at (+20,0).
 */
export const SymbolGlyph: React.FC<SymbolGlyphProps> = ({
  type,
  stroke,
  isActuated = false,
  isEnergized = false,
  isConducting = false,
  pilotColor = 'green',
  tag = '',
  timerState,
}) => {
  const sw = 1.9;

  switch (type) {
    case 'pb_no': {
      const bridgeY = isActuated ? -2 : -8;
      return (
        <g>
          <line x1={-20} y1={0} x2={-9} y2={0} stroke={stroke} strokeWidth={sw} />
          <line x1={9} y1={0} x2={20} y2={0} stroke={stroke} strokeWidth={sw} />
          <circle cx={-9} cy={0} r={2.2} fill={stroke} />
          <circle cx={9} cy={0} r={2.2} fill={stroke} />
          <line x1={-11} y1={bridgeY} x2={11} y2={bridgeY} stroke={stroke} strokeWidth={2.2} />
          <line x1={0} y1={bridgeY} x2={0} y2={bridgeY - 9} stroke={stroke} strokeWidth={1.6} />
          <line x1={-6} y1={bridgeY - 9} x2={6} y2={bridgeY - 9} stroke={stroke} strokeWidth={2.2} />
        </g>
      );
    }

    case 'pb_nc': {
      const bridgeY = isActuated ? 10 : 3;
      return (
        <g>
          <line x1={-20} y1={0} x2={-9} y2={0} stroke={stroke} strokeWidth={sw} />
          <line x1={9} y1={0} x2={20} y2={0} stroke={stroke} strokeWidth={sw} />
          <circle cx={-9} cy={0} r={2.2} fill={stroke} />
          <circle cx={9} cy={0} r={2.2} fill={stroke} />
          <line x1={-11} y1={bridgeY} x2={11} y2={bridgeY} stroke={stroke} strokeWidth={2.2} />
          <line x1={0} y1={bridgeY} x2={0} y2={bridgeY - 12} stroke={stroke} strokeWidth={1.6} />
          <line x1={-6} y1={bridgeY - 12} x2={6} y2={bridgeY - 12} stroke={stroke} strokeWidth={2.2} />
        </g>
      );
    }

    case 'estop_nc': {
      const bridgeY = isActuated ? 10 : 3;
      const headColor = isActuated ? '#FF3B30' : '#F87171';
      return (
        <g>
          <line x1={-20} y1={0} x2={-9} y2={0} stroke={stroke} strokeWidth={sw} />
          <line x1={9} y1={0} x2={20} y2={0} stroke={stroke} strokeWidth={sw} />
          <circle cx={-9} cy={0} r={2.2} fill={stroke} />
          <circle cx={9} cy={0} r={2.2} fill={stroke} />
          <line x1={-11} y1={bridgeY} x2={11} y2={bridgeY} stroke={stroke} strokeWidth={2.2} />
          <line x1={0} y1={bridgeY} x2={0} y2={bridgeY - 11} stroke={stroke} strokeWidth={1.6} />
          {/* Mushroom head */}
          <path
            d={`M -9 ${bridgeY - 11} A 9 7 0 0 1 9 ${bridgeY - 11} Z`}
            fill={isActuated ? '#FF3B30' : '#2A1619'}
            stroke={headColor}
            strokeWidth={1.6}
          />
        </g>
      );
    }

    case 'selector_no':
    case 'selector_nc': {
      const isNc = type === 'selector_nc';
      const closed = isNc ? !isActuated : isActuated;
      return (
        <g>
          <line x1={-20} y1={0} x2={-9} y2={0} stroke={stroke} strokeWidth={sw} />
          <line x1={9} y1={0} x2={20} y2={0} stroke={stroke} strokeWidth={sw} />
          <circle cx={-9} cy={0} r={2.2} fill={stroke} />
          <circle cx={9} cy={0} r={2.2} fill={stroke} />
          {closed ? (
            <line x1={-9} y1={0} x2={10} y2={0} stroke={stroke} strokeWidth={2.2} />
          ) : (
            <line x1={-9} y1={0} x2={8} y2={-9} stroke={stroke} strokeWidth={2.2} />
          )}
          <line x1={-1} y1={-4} x2={-1} y2={-13} stroke={stroke} strokeWidth={1.4} strokeDasharray="2 2" />
          <polyline points="-5,-15 -1,-12 4,-16" fill="none" stroke={stroke} strokeWidth={1.6} />
        </g>
      );
    }

    case 'contact_no':
    case 'timer_contact_no': {
      const isTimed = type === 'timer_contact_no';
      return (
        <g>
          <line x1={-20} y1={0} x2={-6} y2={0} stroke={stroke} strokeWidth={sw} />
          <line x1={6} y1={0} x2={20} y2={0} stroke={stroke} strokeWidth={sw} />
          <line x1={-6} y1={-11} x2={-6} y2={11} stroke={stroke} strokeWidth={2.2} />
          <line x1={6} y1={-11} x2={6} y2={11} stroke={stroke} strokeWidth={2.2} />
          {isConducting && (
            <line x1={-6} y1={0} x2={6} y2={0} stroke="#FF3B30" strokeWidth={2.2} strokeDasharray="2 2" />
          )}
          {isTimed && (
            <g>
              <line x1={0} y1={4} x2={0} y2={13} stroke={stroke} strokeWidth={1.4} />
              <polyline points="-4,10 0,14 4,10" fill="none" stroke={stroke} strokeWidth={1.4} />
            </g>
          )}
        </g>
      );
    }

    case 'contact_nc':
    case 'timer_contact_nc': {
      const isTimed = type === 'timer_contact_nc';
      return (
        <g>
          <line x1={-20} y1={0} x2={-6} y2={0} stroke={stroke} strokeWidth={sw} />
          <line x1={6} y1={0} x2={20} y2={0} stroke={stroke} strokeWidth={sw} />
          <line x1={-6} y1={-11} x2={-6} y2={11} stroke={stroke} strokeWidth={2.2} />
          <line x1={6} y1={-11} x2={6} y2={11} stroke={stroke} strokeWidth={2.2} />
          <line
            x1={-10}
            y1={10}
            x2={10}
            y2={-10}
            stroke={isConducting ? stroke : '#64748B'}
            strokeWidth={1.8}
            strokeDasharray={isConducting ? undefined : '3 2'}
          />
          {isTimed && (
            <g>
              <line x1={0} y1={4} x2={0} y2={13} stroke={stroke} strokeWidth={1.4} />
              <polyline points="-4,10 0,14 4,10" fill="none" stroke={stroke} strokeWidth={1.4} />
            </g>
          )}
        </g>
      );
    }

    case 'coil_relay':
    case 'coil_motor': {
      const fill = isEnergized ? 'rgba(255, 59, 48, 0.25)' : '#14171D';
      return (
        <g>
          <line x1={-20} y1={0} x2={-14} y2={0} stroke={stroke} strokeWidth={sw} />
          <line x1={14} y1={0} x2={20} y2={0} stroke={stroke} strokeWidth={sw} />
          <circle cx={0} cy={0} r={14} fill={fill} stroke={stroke} strokeWidth={2} />
          {type === 'coil_motor' && (
            <circle cx={0} cy={0} r={11} fill="none" stroke={stroke} strokeWidth={0.9} strokeOpacity={0.5} />
          )}
          <text
            x={0}
            y={3.5}
            textAnchor="middle"
            fill={isEnergized ? '#FF6B63' : '#E6EDF3'}
            fontSize={9}
            fontWeight={700}
            fontFamily="JetBrains Mono, monospace"
          >
            {tag.slice(0, 4)}
          </text>
        </g>
      );
    }

    case 'coil_ton':
    case 'coil_tof': {
      const isTiming = Boolean(timerState?.timing);
      const isDone = Boolean(timerState?.done);
      const fill = isDone
        ? 'rgba(52, 199, 89, 0.24)'
        : isTiming || isEnergized
          ? 'rgba(245, 158, 11, 0.24)'
          : '#14171D';
      const borderStroke = isDone ? '#34C759' : isTiming || isEnergized ? '#F59E0B' : stroke;
      return (
        <g>
          <line x1={-20} y1={0} x2={-15} y2={0} stroke={borderStroke} strokeWidth={sw} />
          <line x1={15} y1={0} x2={20} y2={0} stroke={borderStroke} strokeWidth={sw} />
          <rect
            x={-15}
            y={-12}
            width={30}
            height={24}
            rx={3}
            fill={fill}
            stroke={borderStroke}
            strokeWidth={2}
          />
          <text
            x={0}
            y={3}
            textAnchor="middle"
            fill={isDone ? '#34C759' : isTiming ? '#FBBF24' : '#E6EDF3'}
            fontSize={8.5}
            fontWeight={700}
            fontFamily="JetBrains Mono, monospace"
          >
            {type === 'coil_ton' ? 'TON' : 'TOF'}
          </text>
        </g>
      );
    }

    case 'pilot_light': {
      const colorHex = pilotHex(pilotColor);
      const activeStroke = isEnergized ? colorHex : stroke;
      return (
        <g>
          <line x1={-20} y1={0} x2={-13} y2={0} stroke={activeStroke} strokeWidth={sw} />
          <line x1={13} y1={0} x2={20} y2={0} stroke={activeStroke} strokeWidth={sw} />
          <circle
            cx={0}
            cy={0}
            r={13}
            fill={isEnergized ? colorHex : '#14171D'}
            fillOpacity={isEnergized ? 0.32 : 1}
            stroke={activeStroke}
            strokeWidth={2}
          />
          {/* JIC Jewel Rays */}
          <line x1={-8} y1={-8} x2={8} y2={8} stroke={activeStroke} strokeWidth={1.3} />
          <line x1={-8} y1={8} x2={8} y2={-8} stroke={activeStroke} strokeWidth={1.3} />
          {isEnergized && (
            <g stroke={colorHex} strokeWidth={1.5} strokeLinecap="round">
              <line x1={0} y1={-17} x2={0} y2={-20} />
              <line x1={12} y1={-12} x2={15} y2={-15} />
              <line x1={-12} y1={-12} x2={-15} y2={-15} />
              <line x1={0} y1={17} x2={0} y2={20} />
            </g>
          )}
        </g>
      );
    }

    case 'overload_nc': {
      const tripColor = isActuated ? '#FF3B30' : stroke;
      return (
        <g>
          <line x1={-20} y1={0} x2={-12} y2={0} stroke={tripColor} strokeWidth={sw} />
          <line x1={12} y1={0} x2={20} y2={0} stroke={tripColor} strokeWidth={sw} />
          {/* Thermal heater element curve */}
          <path
            d="M -12 0 C -9 -9, -3 -9, 0 0 C 3 9, 9 9, 12 0"
            fill="none"
            stroke={tripColor}
            strokeWidth={2}
            strokeDasharray={isActuated ? '3 2' : undefined}
          />
          {isActuated && (
            <line x1={-8} y1={-10} x2={8} y2={10} stroke="#FF3B30" strokeWidth={2} />
          )}
        </g>
      );
    }

    case 'fuse': {
      const fStroke = isActuated ? '#FF3B30' : stroke;
      return (
        <g>
          <line x1={-20} y1={0} x2={-13} y2={0} stroke={fStroke} strokeWidth={sw} />
          <line x1={13} y1={0} x2={20} y2={0} stroke={fStroke} strokeWidth={sw} />
          <rect x={-13} y={-6} width={26} height={12} rx={2} fill="#14171D" stroke={fStroke} strokeWidth={1.8} />
          {!isActuated ? (
            <line x1={-13} y1={0} x2={13} y2={0} stroke={fStroke} strokeWidth={1.6} />
          ) : (
            <line x1={-4} y1={-4} x2={4} y2={4} stroke="#FF3B30" strokeWidth={2} />
          )}
        </g>
      );
    }

    case 'breaker': {
      const bStroke = isActuated ? '#F59E0B' : stroke;
      return (
        <g>
          <line x1={-20} y1={0} x2={-10} y2={0} stroke={bStroke} strokeWidth={sw} />
          <line x1={10} y1={0} x2={20} y2={0} stroke={bStroke} strokeWidth={sw} />
          <circle cx={-10} cy={0} r={2} fill={bStroke} />
          <circle cx={10} cy={0} r={2} fill={bStroke} />
          {isActuated ? (
            <line x1={-10} y1={0} x2={8} y2={-10} stroke={bStroke} strokeWidth={2.2} />
          ) : (
            <path d="M -10 0 Q 0 -10 10 0" fill="none" stroke={bStroke} strokeWidth={2.2} />
          )}
        </g>
      );
    }

    case 'terminal': {
      return (
        <g>
          <line x1={-20} y1={0} x2={-7} y2={0} stroke={stroke} strokeWidth={sw} />
          <line x1={7} y1={0} x2={20} y2={0} stroke={stroke} strokeWidth={sw} />
          <circle cx={0} cy={0} r={7} fill="#14171D" stroke="#00E5FF" strokeWidth={1.8} />
          <line x1={-4.5} y1={4.5} x2={4.5} y2={-4.5} stroke="#00E5FF" strokeWidth={1.3} />
        </g>
      );
    }

    case 'plc_in': {
      const fill = isEnergized ? 'rgba(52, 199, 89, 0.22)' : '#14171D';
      const pStroke = isEnergized ? '#34C759' : stroke;
      return (
        <g>
          <line x1={-20} y1={0} x2={-16} y2={0} stroke={pStroke} strokeWidth={sw} />
          <line x1={16} y1={0} x2={20} y2={0} stroke={pStroke} strokeWidth={sw} />
          <rect x={-16} y={-11} width={32} height={22} rx={2} fill={fill} stroke={pStroke} strokeWidth={1.9} />
          <text
            x={0}
            y={3.5}
            textAnchor="middle"
            fill={isEnergized ? '#34C759' : '#00E5FF'}
            fontSize={8}
            fontWeight={700}
            fontFamily="JetBrains Mono, monospace"
          >
            DI
          </text>
        </g>
      );
    }

    case 'plc_out': {
      const pStroke = isActuated ? '#34C759' : stroke;
      return (
        <g>
          <line x1={-20} y1={0} x2={-16} y2={0} stroke={pStroke} strokeWidth={sw} />
          <line x1={16} y1={0} x2={20} y2={0} stroke={pStroke} strokeWidth={sw} />
          <rect
            x={-16}
            y={-11}
            width={32}
            height={22}
            rx={2}
            fill={isActuated ? 'rgba(52,199,89,0.2)' : '#14171D'}
            stroke={pStroke}
            strokeWidth={1.9}
          />
          <text
            x={0}
            y={3.5}
            textAnchor="middle"
            fill={isActuated ? '#34C759' : '#E6EDF3'}
            fontSize={8}
            fontWeight={700}
            fontFamily="JetBrains Mono, monospace"
          >
            DO
          </text>
        </g>
      );
    }

    case 'vfd_cmd': {
      const vStroke = isEnergized ? '#34C759' : stroke;
      return (
        <g>
          <line x1={-20} y1={0} x2={-17} y2={0} stroke={vStroke} strokeWidth={sw} />
          <line x1={17} y1={0} x2={20} y2={0} stroke={vStroke} strokeWidth={sw} />
          <rect
            x={-17}
            y={-12}
            width={34}
            height={24}
            rx={2}
            fill={isEnergized ? 'rgba(52,199,89,0.22)' : '#14171D'}
            stroke={vStroke}
            strokeWidth={2}
          />
          <text
            x={0}
            y={3.5}
            textAnchor="middle"
            fill={isEnergized ? '#34C759' : '#00E5FF'}
            fontSize={8.5}
            fontWeight={700}
            fontFamily="JetBrains Mono, monospace"
          >
            VFD
          </text>
        </g>
      );
    }

    default:
      return null;
  }
};

interface CanvasSymbolProps {
  component: SchematicComponent;
  isSelected: boolean;
  isHighlightedError: boolean;
  isSimMode: boolean;
  isEnergized: boolean;
  isConducting: boolean;
  isActuated: boolean;
  crossRef?: CrossReferenceEntry;
  timerState?: TimerRuntimeState;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGGElement>) => void;
  onClick: (e: React.MouseEvent<SVGGElement>) => void;
}

export const CanvasSymbol: React.FC<CanvasSymbolProps> = ({
  component,
  isSelected,
  isHighlightedError,
  isSimMode,
  isEnergized,
  isConducting,
  isActuated,
  crossRef,
  timerState,
  onPointerDown,
  onPointerUp,
  onClick,
}) => {
  const def = getSymbolDef(component.type);
  const interactive = isSimMode && def.isInteractiveInSim;

  let stroke = '#DCE3EC';
  if (isHighlightedError) {
    stroke = '#FF3B30';
  } else if (isSelected && !isSimMode) {
    stroke = '#00E5FF';
  } else if (isSimMode && isEnergized) {
    stroke = component.type === 'pilot_light' ? pilotHex(component.pilotColor) : '#FF3B30';
  } else if (isSimMode && isConducting && !def.isLoad && component.type !== 'terminal') {
    stroke = '#F8FAFC';
  }

  return (
    <g
      transform={`translate(${component.x}, ${component.y})`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClick={onClick}
      className={interactive ? 'cursor-pointer' : isSimMode ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}
      data-testid={`component-${component.id}`}
      data-tag={component.tag}
      data-energized={isEnergized ? 'true' : 'false'}
      data-actuated={isActuated ? 'true' : 'false'}
    >
      {/* Accessible hit box */}
      <rect
        x={-23}
        y={-16}
        width={46}
        height={32}
        fill="transparent"
        rx={4}
        stroke={
          isHighlightedError
            ? '#FF3B30'
            : isSelected && !isSimMode
              ? '#00E5FF'
              : interactive
                ? 'rgba(0, 229, 255, 0.28)'
                : 'none'
        }
        strokeWidth={isHighlightedError ? 2 : 1.2}
        strokeDasharray={isSelected || isHighlightedError ? '4 2' : interactive ? '2 2' : undefined}
      />

      {/* Core JIC/IEC vector glyph */}
      <SymbolGlyph
        type={component.type}
        stroke={stroke}
        isActuated={isActuated}
        isEnergized={isEnergized}
        isConducting={isConducting}
        pilotColor={component.pilotColor}
        tag={component.tag}
        timerState={timerState}
      />

      {/* Component Tag above */}
      <text
        x={0}
        y={-21}
        textAnchor="middle"
        fill={isSelected && !isSimMode ? '#00E5FF' : '#E6EDF3'}
        fontSize={10.5}
        fontWeight={700}
        fontFamily="JetBrains Mono, monospace"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {component.tag}
      </text>

      {/* Secondary descriptor / PLC address / VFD param */}
      <text
        x={0}
        y={26}
        textAnchor="middle"
        fill="#8B949E"
        fontSize={8.5}
        fontFamily="Plus Jakarta Sans, sans-serif"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {(() => {
          const raw = component.vfdParam || component.plcAddress || component.description;
          return raw.length > 20 ? `${raw.slice(0, 18).trimEnd()}…` : raw;
        })()}
      </text>

      {/* Live Timer Countdown HUD on canvas */}
      {(component.type === 'coil_ton' || component.type === 'coil_tof') && (
        <g transform="translate(0, 38)">
          <rect x={-28} y={-7} width={56} height={13} rx={2} fill="#141820" stroke="#2A2F3A" strokeWidth={0.9} />
          {isSimMode && timerState && (
            <rect
              x={-27}
              y={-6}
              width={Math.max(0, Math.min(54, (timerState.accumulated / Math.max(0.1, timerState.preset)) * 54))}
              height={11}
              rx={1.5}
              fill={timerState.done ? 'rgba(52,199,89,0.4)' : 'rgba(245,158,11,0.45)'}
            />
          )}
          <text
            x={0}
            y={2.5}
            textAnchor="middle"
            fill={isSimMode && timerState?.done ? '#34C759' : isSimMode && timerState?.timing ? '#FBBF24' : '#94A3B8'}
            fontSize={8}
            fontWeight={600}
            fontFamily="JetBrains Mono, monospace"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {isSimMode && timerState
              ? `${timerState.accumulated.toFixed(1)}s/${timerState.preset.toFixed(1)}s`
              : `PT ${Number(component.timerPreset ?? 3.0).toFixed(1)}s`}
          </text>
        </g>
      )}

      {/* Parent Coil Live Cross-Reference Table underneath */}
      {def.isParent && crossRef && (
        <text
          x={0}
          y={component.type === 'coil_ton' || component.type === 'coil_tof' ? 54 : 39}
          textAnchor="middle"
          fill="#00E5FF"
          fontSize={8.5}
          fontWeight={600}
          fontFamily="JetBrains Mono, monospace"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {crossRef.summaryText}
        </text>
      )}

      {/* Simulation interactive hint state (TRIPPED / PRESSED) */}
      {isSimMode && isActuated && (
        <text
          x={0}
          y={-31}
          textAnchor="middle"
          fill={component.type === 'overload_nc' || component.type === 'estop_nc' ? '#FF3B30' : '#34C759'}
          fontSize={8}
          fontWeight={700}
          fontFamily="JetBrains Mono, monospace"
        >
          {component.type === 'overload_nc'
            ? 'TRIPPED'
            : component.type === 'estop_nc'
              ? 'ENGAGED'
              : 'CLOSED'}
        </text>
      )}
    </g>
  );
};
