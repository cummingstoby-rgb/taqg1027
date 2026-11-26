import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  GitBranch,
  ListChecks,
  Package,
  RefreshCw,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { getSymbolDef } from '../data/symbolCatalog';
import { getAllParentCoils } from '../engines/crossRefEngine';
import { exportEngine } from '../engines/exportEngine';
import { formatRungNumber, getRungNumber } from '../engines/schematicEngine';
import { RightPanelTab, useEcad } from '../store/useEcadStore';

export const RightPanel: React.FC = () => {
  const {
    project,
    activeSheet,
    mode,
    selectedComponentId,
    selectedWireId,
    rightTab,
    crossRefs,
    ercDiagnostics,
    bomRows,
    terminalRows,
    setRightTab,
    updateComponent,
    renameParentComponentTag,
    linkContactToParent,
    deleteSelected,
    selectComponent,
    switchSheet,
    runErcNow,
    focusDiagnostic,
    showToast,
  } = useEcad();

  const selectedComp = useMemo(
    () => activeSheet.components.find((c) => c.id === selectedComponentId) ?? null,
    [activeSheet.components, selectedComponentId]
  );

  const selectedWire = useMemo(
    () => activeSheet.wires.find((w) => w.id === selectedWireId) ?? null,
    [activeSheet.wires, selectedWireId]
  );

  const allParents = useMemo(() => getAllParentCoils(project), [project]);
  const [parentTagDraft, setParentTagDraft] = useState('');

  useEffect(() => {
    setParentTagDraft(selectedComp?.tag ?? '');
  }, [selectedComp?.id, selectedComp?.tag]);

  const errorCount = ercDiagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = ercDiagnostics.filter((d) => d.severity === 'warning').length;

  const tabs: Array<{ id: RightPanelTab; label: string; icon: React.ReactNode }> = [
    { id: 'inspector', label: 'Inspect', icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
    { id: 'bom', label: 'BOM', icon: <Package className="w-3.5 h-3.5" /> },
    { id: 'xref', label: 'X-Ref', icon: <GitBranch className="w-3.5 h-3.5" /> },
    { id: 'terminals', label: 'TB', icon: <TerminalSquare className="w-3.5 h-3.5" /> },
    {
      id: 'erc',
      label: ercDiagnostics.length > 0 ? `ERC (${ercDiagnostics.length})` : 'ERC',
      icon: <ListChecks className="w-3.5 h-3.5" />,
    },
  ];

  const handleExportBomCsv = () => {
    const csv = exportEngine.exportBomCsv(project);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.metadata.projectNumber || 'voltgrid'}_bom.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Exported Bill of Materials CSV');
  };

  return (
    <aside
      className="w-[332px] shrink-0 bg-[#181B20] border-l border-[#2A2F3A] flex flex-col overflow-hidden"
      aria-label="Component inspector and engineering reports"
    >
      {/* Right Panel Navigation Tabs */}
      <div className="flex border-b border-[#2A2F3A] bg-[#14171C] shrink-0" role="tablist">
        {tabs.map((tab) => {
          const active = rightTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setRightTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1 py-2.5 px-1 text-[11px] font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                active
                  ? 'border-[#00E5FF] text-[#00E5FF] bg-[#181B20]'
                  : 'border-transparent text-[#8B949E] hover:text-[#E6EDF3]'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3.5">
        {/* TAB 1: LIVE PROPERTIES INSPECTOR */}
        {rightTab === 'inspector' && (
          <div className="space-y-4">
            {selectedComp ? (
              (() => {
                const def = getSymbolDef(selectedComp.type);
                const xref = def.isParent ? crossRefs.get(selectedComp.tag) : undefined;
                return (
                  <>
                    <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#2A2F3A]">
                      <div>
                        <h2 className="text-sm font-semibold text-[#E6EDF3]">{def.name}</h2>
                        <p className="text-[11px] font-mono text-[#8B949E] mt-0.5">
                          Sheet {activeSheet.number} · Rung {formatRungNumber(getRungNumber(selectedComp.y))} · ({selectedComp.x}, {selectedComp.y})
                        </p>
                      </div>
                      {mode === 'EDIT' && (
                        <button
                          type="button"
                          onClick={deleteSelected}
                          className="p-1.5 rounded bg-[#222731] hover:bg-[#FF3B30]/20 text-[#94A3B8] hover:text-[#FF6B63] transition-colors cursor-pointer"
                          aria-label={`Delete component ${selectedComp.tag}`}
                          title="Delete component"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Tag / Atomic Parent Rename */}
                    <div className="space-y-1.5">
                      <label htmlFor="prop-tag" className="block text-xs font-medium text-[#94A3B8]">
                        {def.isParent ? 'Parent Coil Tag (Auto-Updates Children)' : 'Component Tag'}
                      </label>
                      {def.isParent ? (
                        <div className="flex gap-1.5">
                          <input
                            id="prop-tag"
                            type="text"
                            value={parentTagDraft}
                            onChange={(e) => setParentTagDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                renameParentComponentTag(selectedComp.id, parentTagDraft);
                              }
                            }}
                            className="flex-1 px-2.5 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs font-mono text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                          />
                          <button
                            type="button"
                            onClick={() => renameParentComponentTag(selectedComp.id, parentTagDraft)}
                            className="px-2.5 py-1.5 rounded text-xs font-semibold bg-[#00E5FF]/15 text-[#00E5FF] border border-[#00E5FF]/40 hover:bg-[#00E5FF]/25 whitespace-nowrap cursor-pointer"
                          >
                            Apply
                          </button>
                        </div>
                      ) : (
                        <input
                          id="prop-tag"
                          type="text"
                          value={selectedComp.tag}
                          onChange={(e) =>
                            updateComponent(selectedComp.id, { tag: e.target.value.toUpperCase() })
                          }
                          className="w-full px-2.5 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs font-mono text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                        />
                      )}
                    </div>

                    {/* Child Contact Parent Link Dropdown */}
                    {def.isChild && (
                      <div className="space-y-1.5">
                        <label htmlFor="prop-parent-link" className="block text-xs font-medium text-[#94A3B8]">
                          Linked Parent Coil
                        </label>
                        <select
                          id="prop-parent-link"
                          value={selectedComp.parentTag || ''}
                          onChange={(e) => linkContactToParent(selectedComp.id, e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs font-mono text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                        >
                          <option value="">-- Unlinked (Orphan) --</option>
                          {allParents.map((p) => (
                            <option key={p.component.id} value={p.component.tag}>
                              {p.component.tag} — {p.component.description} (S{p.sheetNumber}-R{formatRungNumber(p.rung)})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Timer Preset (for TON / TOF coils) */}
                    {(selectedComp.type === 'coil_ton' || selectedComp.type === 'coil_tof') && (
                      <div className="space-y-1.5">
                        <label htmlFor="prop-timer-preset" className="block text-xs font-medium text-[#94A3B8]">
                          Timer Preset (Seconds)
                        </label>
                        <input
                          id="prop-timer-preset"
                          type="number"
                          step="0.5"
                          min="0.5"
                          max="120"
                          value={selectedComp.timerPreset ?? 3.0}
                          onChange={(e) =>
                            updateComponent(selectedComp.id, {
                              timerPreset: Math.max(0.1, parseFloat(e.target.value) || 0.5),
                            })
                          }
                          className="w-full px-2.5 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs font-mono text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                        />
                      </div>
                    )}

                    {/* Pilot Light Color */}
                    {selectedComp.type === 'pilot_light' && (
                      <div className="space-y-1.5">
                        <label htmlFor="prop-pilot-color" className="block text-xs font-medium text-[#94A3B8]">
                          Lens Color
                        </label>
                        <select
                          id="prop-pilot-color"
                          value={selectedComp.pilotColor || 'green'}
                          onChange={(e) =>
                            updateComponent(selectedComp.id, {
                              pilotColor: e.target.value as 'green' | 'red' | 'amber' | 'cyan',
                            })
                          }
                          className="w-full px-2.5 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                        >
                          <option value="green">Green (Run)</option>
                          <option value="amber">Amber (Warning / Standby)</option>
                          <option value="red">Red (Fault / Stop)</option>
                          <option value="cyan">Blue / Cyan (Ready)</option>
                        </select>
                      </div>
                    )}

                    {/* Terminal Strip Fields */}
                    {selectedComp.type === 'terminal' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label htmlFor="prop-tb-strip" className="block text-xs font-medium text-[#94A3B8]">
                            Strip ID
                          </label>
                          <input
                            id="prop-tb-strip"
                            type="text"
                            value={selectedComp.terminalStrip || 'TB1'}
                            onChange={(e) => {
                              const strip = e.target.value.toUpperCase();
                              const num = selectedComp.terminalNumber || '1';
                              updateComponent(selectedComp.id, {
                                terminalStrip: strip,
                                tag: `${strip}-${num}`,
                              });
                            }}
                            className="w-full px-2 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs font-mono text-[#E6EDF3]"
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="prop-tb-num" className="block text-xs font-medium text-[#94A3B8]">
                            Terminal #
                          </label>
                          <input
                            id="prop-tb-num"
                            type="text"
                            value={selectedComp.terminalNumber || '1'}
                            onChange={(e) => {
                              const num = e.target.value;
                              const strip = selectedComp.terminalStrip || 'TB1';
                              updateComponent(selectedComp.id, {
                                terminalNumber: num,
                                tag: `${strip}-${num}`,
                              });
                            }}
                            className="w-full px-2 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs font-mono text-[#E6EDF3]"
                          />
                        </div>
                      </div>
                    )}

                    {/* Standard Industrial Properties */}
                    <div className="space-y-1.5">
                      <label htmlFor="prop-desc" className="block text-xs font-medium text-[#94A3B8]">
                        Description
                      </label>
                      <input
                        id="prop-desc"
                        type="text"
                        value={selectedComp.description}
                        onChange={(e) => updateComponent(selectedComp.id, { description: e.target.value })}
                        className="w-full px-2.5 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label htmlFor="prop-mfg" className="block text-xs font-medium text-[#94A3B8]">
                          Manufacturer
                        </label>
                        <input
                          id="prop-mfg"
                          type="text"
                          value={selectedComp.manufacturer}
                          onChange={(e) =>
                            updateComponent(selectedComp.id, { manufacturer: e.target.value })
                          }
                          className="w-full px-2 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="prop-part" className="block text-xs font-medium text-[#94A3B8]">
                          Part Number
                        </label>
                        <input
                          id="prop-part"
                          type="text"
                          value={selectedComp.partNumber}
                          onChange={(e) =>
                            updateComponent(selectedComp.id, { partNumber: e.target.value })
                          }
                          className="w-full px-2 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs font-mono text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label htmlFor="prop-plc" className="block text-xs font-medium text-[#94A3B8]">
                          PLC I/O Address
                        </label>
                        <input
                          id="prop-plc"
                          type="text"
                          placeholder="%IX0.0 / %QX0.0"
                          value={selectedComp.plcAddress || ''}
                          onChange={(e) =>
                            updateComponent(selectedComp.id, { plcAddress: e.target.value })
                          }
                          className="w-full px-2 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs font-mono text-[#E6EDF3] placeholder:text-[#4B5563]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="prop-vfd" className="block text-xs font-medium text-[#94A3B8]">
                          VFD Parameter
                        </label>
                        <input
                          id="prop-vfd"
                          type="text"
                          placeholder="DI1-RUN"
                          value={selectedComp.vfdParam || ''}
                          onChange={(e) =>
                            updateComponent(selectedComp.id, { vfdParam: e.target.value })
                          }
                          className="w-full px-2 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs font-mono text-[#E6EDF3] placeholder:text-[#4B5563]"
                        />
                      </div>
                    </div>

                    {/* Live Cross-Ref Readout for Parent Coils */}
                    {def.isParent && xref && (
                      <div className="pt-3 border-t border-[#2A2F3A]">
                        <div className="text-xs font-semibold text-[#94A3B8] mb-1">
                          Linked Child Contacts
                        </div>
                        <div className="text-xs font-mono text-[#00E5FF] bg-[#0F1115] border border-[#2A2F3A] rounded p-2">
                          {xref.summaryText}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()
            ) : selectedWire ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2.5 border-b border-[#2A2F3A]">
                  <div>
                    <h2 className="text-sm font-semibold text-[#E6EDF3]">Wire Segment</h2>
                    <p className="text-[11px] font-mono text-[#8B949E]">
                      ({selectedWire.x1},{selectedWire.y1}) → ({selectedWire.x2},{selectedWire.y2})
                    </p>
                  </div>
                  {mode === 'EDIT' && (
                    <button
                      type="button"
                      onClick={deleteSelected}
                      className="p-1.5 rounded bg-[#222731] hover:bg-[#FF3B30]/20 text-[#94A3B8] hover:text-[#FF6B63] cursor-pointer"
                      aria-label="Delete selected wire"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="text-xs space-y-1.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-[#8B949E]">Wire Number</span>
                    <span className="text-[#00E5FF] font-semibold">
                      {selectedWire.wireNumber || 'Unnumbered'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B949E]">Net Node ID</span>
                    <span className="text-[#E6EDF3]">{selectedWire.netId || '—'}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center space-y-1.5">
                <p className="text-xs font-medium text-[#94A3B8]">No component or wire selected</p>
                <p className="text-[11px] text-[#64748B]">
                  Select any schematic symbol to inspect properties, edit part numbers, or link contacts.
                </p>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: LIVE BILL OF MATERIALS (BOM) */}
        {rightTab === 'bom' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold text-[#E6EDF3]">Bill of Materials</h2>
                <p className="text-[11px] font-mono text-[#8B949E]">
                  {bomRows.reduce((s, r) => s + r.quantity, 0)} parts · {bomRows.length} line items
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportBomCsv}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-[#222731] hover:bg-[#2B313E] border border-[#2A2F3A] text-[#00E5FF] cursor-pointer"
              >
                <Download className="w-3 h-3" />
                CSV
              </button>
            </div>

            <div className="border border-[#2A2F3A] rounded overflow-hidden">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="bg-[#14171C] text-[#8B949E] border-b border-[#2A2F3A]">
                    <th className="py-1.5 px-2 font-medium">Tags</th>
                    <th className="py-1.5 px-2 font-medium">Part / Desc</th>
                    <th className="py-1.5 px-2 font-medium text-right">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#242934]">
                  {bomRows.map((row) => (
                    <tr key={`${row.partNumber}-${row.type}`} className="hover:bg-[#1E222B]">
                      <td className="py-2 px-2 font-mono font-semibold text-[#00E5FF] align-top whitespace-nowrap">
                        {row.tags.join(', ')}
                      </td>
                      <td className="py-2 px-2 align-top">
                        <div className="text-[#E6EDF3] font-medium leading-tight">{row.type}</div>
                        <div className="text-[#8B949E] font-mono text-[10px] mt-0.5">
                          {row.manufacturer} · {row.partNumber}
                        </div>
                      </td>
                      <td className="py-2 px-2 font-mono text-right text-[#E6EDF3] align-top">
                        {row.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: CROSS-REFERENCE TABLE */}
        {rightTab === 'xref' && (
          <div className="space-y-3">
            <div>
              <h2 className="text-xs font-semibold text-[#E6EDF3]">Parent / Child Cross-Reference</h2>
              <p className="text-[11px] text-[#8B949E]">
                Click any parent coil or contact rung to jump directly to it.
              </p>
            </div>

            {crossRefs.size === 0 ? (
              <p className="text-xs text-[#64748B] py-8 text-center">
                No Parent coils placed in project.
              </p>
            ) : (
              <div className="space-y-2">
                {Array.from(crossRefs.values()).map((entry) => (
                  <div
                    key={entry.parentId}
                    className="p-2.5 rounded bg-[#13161B] border border-[#242934] space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          const targetSheet = project.sheets.find(
                            (s) => s.number === entry.parentSheetNumber
                          );
                          if (targetSheet) switchSheet(targetSheet.id);
                          selectComponent(entry.parentId);
                          setRightTab('inspector');
                        }}
                        className="font-mono text-xs font-bold text-[#00E5FF] hover:underline cursor-pointer"
                      >
                        {entry.parentTag}
                      </button>
                      <span className="font-mono text-[10px] text-[#8B949E]">
                        Sheet {entry.parentSheetNumber} · Rung {formatRungNumber(entry.parentRung)}
                      </span>
                    </div>

                    <div className="text-[11px] font-mono text-[#CBD5E1]">
                      {entry.summaryText}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: TERMINAL STRIP SCHEDULE */}
        {rightTab === 'terminals' && (
          <div className="space-y-3">
            <div>
              <h2 className="text-xs font-semibold text-[#E6EDF3]">Terminal Strip Schedule</h2>
              <p className="text-[11px] font-mono text-[#8B949E]">
                {terminalRows.length} DIN-rail terminal{terminalRows.length === 1 ? '' : 's'} mapped
              </p>
            </div>

            {terminalRows.length === 0 ? (
              <p className="text-xs text-[#64748B] py-8 text-center">
                Place Terminal Block (TB) symbols onto rungs to generate a terminal schedule.
              </p>
            ) : (
              <div className="border border-[#2A2F3A] rounded overflow-hidden">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-[#14171C] text-[#8B949E] border-b border-[#2A2F3A]">
                      <th className="py-1.5 px-2 font-medium">Term</th>
                      <th className="py-1.5 px-2 font-medium">Wire</th>
                      <th className="py-1.5 px-2 font-medium">From → To</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#242934] font-mono">
                    {terminalRows.map((row) => (
                      <tr
                        key={row.componentId}
                        onClick={() => {
                          switchSheet(row.sheetId);
                          selectComponent(row.componentId);
                        }}
                        className="hover:bg-[#1E222B] cursor-pointer"
                      >
                        <td className="py-2 px-2 font-semibold text-[#00E5FF] whitespace-nowrap">
                          {row.fullLabel}
                        </td>
                        <td className="py-2 px-2 text-[#E6EDF3]">{row.wireNumber}</td>
                        <td className="py-2 px-2 text-[#94A3B8]">
                          {row.leftDevice} → {row.rightDevice}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: ERC DIAGNOSTICS */}
        {rightTab === 'erc' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold text-[#E6EDF3]">ERC Diagnostics</h2>
                <p className="text-[11px] font-mono text-[#8B949E]">
                  {errorCount} Error(s) · {warningCount} Warning(s)
                </p>
              </div>
              <button
                type="button"
                onClick={runErcNow}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-[#222731] hover:bg-[#2B313E] border border-[#2A2F3A] text-[#E6EDF3] cursor-pointer"
              >
                <RefreshCw className="w-3 h-3 text-[#00E5FF]" />
                Re-Scan
              </button>
            </div>

            {ercDiagnostics.length === 0 ? (
              <div className="p-4 rounded bg-[#34C759]/10 border border-[#34C759]/30 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#34C759] shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-[#34C759]">All Electrical Rules Passed</div>
                  <p className="text-[11px] text-[#94A3B8] mt-0.5">
                    Zero short circuits, zero duplicate parent coils, zero orphaned contacts, and all return paths verified.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {ercDiagnostics.map((diag) => {
                  const isErr = diag.severity === 'error';
                  return (
                    <button
                      key={diag.id}
                      type="button"
                      onClick={() => focusDiagnostic(diag)}
                      className={`w-full text-left p-2.5 rounded border transition-colors cursor-pointer ${
                        isErr
                          ? 'bg-[#FF3B30]/10 border-[#FF3B30]/35 hover:border-[#FF3B30]'
                          : 'bg-[#F59E0B]/10 border-[#F59E0B]/35 hover:border-[#F59E0B]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`flex items-center gap-1.5 text-[11px] font-mono font-bold ${
                            isErr ? 'text-[#FF6B63]' : 'text-[#FBBF24]'
                          }`}
                        >
                          {isErr ? (
                            <AlertCircle className="w-3.5 h-3.5" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5" />
                          )}
                          {diag.code}
                        </span>
                        <span className="font-mono text-[10px] text-[#8B949E]">
                          Sheet {diag.sheetNumber}
                        </span>
                      </div>
                      <p className="text-xs text-[#E6EDF3] mt-1 leading-snug">{diag.message}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
