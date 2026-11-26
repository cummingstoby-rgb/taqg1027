import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileUp,
  Hash,
  MousePointer2,
  Play,
  Plus,
  Redo2,
  ShieldAlert,
  Spline,
  Undo2,
  Upload,
  Wrench,
  Zap,
} from 'lucide-react';
import { exportEngine } from '../engines/exportEngine';
import { useEcad } from '../store/useEcadStore';

interface TopToolbarProps {
  onOpenPdfImporter: () => void;
}

function downloadBlob(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const TopToolbar: React.FC<TopToolbarProps> = ({ onOpenPdfImporter }) => {
  const {
    project,
    activeSheet,
    mode,
    tool,
    canUndo,
    canRedo,
    simulation,
    ercDiagnostics,
    setMode,
    setTool,
    undo,
    redo,
    autoNumberWires,
    runErcNow,
    addRungToActiveSheet,
    loadProject,
    showToast,
  } = useEcad();

  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);

  const errorCount = ercDiagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = ercDiagnostics.filter((d) => d.severity === 'warning').length;

  useEffect(() => {
    const closeOnOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, []);

  const baseSlug = project.metadata.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'voltgrid_project';

  const handleJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = exportEngine.importJson(String(reader.result));
        loadProject(imported, `Loaded project "${imported.metadata.title}"`);
      } catch (err) {
        showToast(`Import failed: ${err instanceof Error ? err.message : 'Invalid JSON'}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <header className="h-12 px-3 bg-[#181B20] border-b border-[#2A2F3A] flex items-center justify-between gap-3 shrink-0 z-30">
      {/* Zone 1: Brand Wordmark + Mode Segmented Switch */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
          <Zap className="w-4 h-4 text-[#00E5FF]" />
          <span className="text-sm font-bold tracking-tight text-[#E6EDF3]">VoltGrid ECAD</span>
        </div>

        <div className="h-5 w-px bg-[#2A2F3A]" aria-hidden="true" />

        {/* EDIT vs SIMULATE segmented control */}
        <div
          className="flex items-center p-0.5 bg-[#0F1115] border border-[#2A2F3A] rounded-md shrink-0"
          role="group"
          aria-label="Workspace mode"
        >
          <button
            type="button"
            onClick={() => setMode('EDIT')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'EDIT'
                ? 'bg-[#222731] text-[#00E5FF]'
                : 'text-[#8B949E] hover:text-[#E6EDF3]'
            }`}
            aria-pressed={mode === 'EDIT'}
          >
            <Wrench className="w-3.5 h-3.5" />
            EDIT
          </button>
          <button
            type="button"
            onClick={() => setMode('SIMULATE')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'SIMULATE'
                ? 'bg-[#34C759]/20 text-[#34C759]'
                : 'text-[#8B949E] hover:text-[#E6EDF3]'
            }`}
            aria-pressed={mode === 'SIMULATE'}
          >
            <Play className="w-3.5 h-3.5" />
            SIMULATE
          </button>
        </div>
      </div>

      {/* Zone 2: CAD Tools, Undo/Redo, Auto-Number, ERC */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <button
          type="button"
          onClick={() => setTool('select')}
          disabled={mode === 'SIMULATE'}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
            tool === 'select' && mode === 'EDIT'
              ? 'bg-[#00E5FF]/15 border-[#00E5FF]/50 text-[#00E5FF]'
              : 'bg-transparent border-transparent text-[#94A3B8] hover:text-[#E6EDF3] hover:bg-[#222731]'
          }`}
          aria-label="Select and move tool"
        >
          <MousePointer2 className="w-3.5 h-3.5" />
          Select
        </button>

        <button
          type="button"
          onClick={() => setTool('wire')}
          disabled={mode === 'SIMULATE'}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
            tool === 'wire' && mode === 'EDIT'
              ? 'bg-[#00E5FF]/15 border-[#00E5FF]/50 text-[#00E5FF]'
              : 'bg-transparent border-transparent text-[#94A3B8] hover:text-[#E6EDF3] hover:bg-[#222731]'
          }`}
          aria-label="Orthogonal wire drawing tool"
        >
          <Spline className="w-3.5 h-3.5" />
          Wire
        </button>

        <button
          type="button"
          onClick={addRungToActiveSheet}
          disabled={mode === 'SIMULATE'}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-[#94A3B8] hover:text-[#E6EDF3] hover:bg-[#222731] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
          aria-label="Add new wired rung"
        >
          <Plus className="w-3.5 h-3.5" />
          Rung
        </button>

        <div className="h-5 w-px bg-[#2A2F3A] mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          className="p-1.5 rounded text-[#94A3B8] hover:text-[#E6EDF3] hover:bg-[#222731] disabled:opacity-35 transition-colors cursor-pointer"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          className="p-1.5 rounded text-[#94A3B8] hover:text-[#E6EDF3] hover:bg-[#222731] disabled:opacity-35 transition-colors cursor-pointer"
          aria-label="Redo"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>

        <div className="h-5 w-px bg-[#2A2F3A] mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={autoNumberWires}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#E6EDF3] bg-[#222731] hover:bg-[#2B313E] border border-[#2A2F3A] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          aria-label="Auto-Number Wires"
        >
          <Hash className="w-3.5 h-3.5 text-[#00E5FF]" />
          Auto-Number
        </button>

        <button
          type="button"
          onClick={runErcNow}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            errorCount > 0
              ? 'bg-[#FF3B30]/15 border-[#FF3B30]/40 text-[#FF6B63]'
              : warningCount > 0
                ? 'bg-[#F59E0B]/15 border-[#F59E0B]/40 text-[#FBBF24]'
                : 'bg-[#222731] border-[#2A2F3A] text-[#E6EDF3] hover:bg-[#2B313E]'
          }`}
          aria-label="Run Electrical Rule Check"
        >
          {errorCount > 0 || warningCount > 0 ? (
            <ShieldAlert className="w-3.5 h-3.5" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-[#34C759]" />
          )}
          Run ERC
          <span className="font-mono text-[11px] opacity-80">
            {errorCount === 0 && warningCount === 0
              ? 'OK'
              : `${errorCount}E/${warningCount}W`}
          </span>
        </button>
      </div>

      {/* Zone 3: Template PDF Import, JSON Load, and Multi-Format Industrial Export */}
      <div className="flex items-center gap-2 shrink-0">
        <input
          ref={jsonInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleJsonUpload}
        />

        <button
          type="button"
          onClick={onOpenPdfImporter}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#E6EDF3] bg-[#222731] hover:bg-[#2B313E] border border-[#2A2F3A] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          aria-label="Import PDF VFD or PLC Schematic"
        >
          <FileUp className="w-3.5 h-3.5 text-[#00E5FF]" />
          Import PDF
        </button>

        <button
          type="button"
          onClick={() => jsonInputRef.current?.click()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-[#94A3B8] hover:text-[#E6EDF3] hover:bg-[#222731] border border-transparent hover:border-[#2A2F3A] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          aria-label="Load Project JSON"
        >
          <Upload className="w-3.5 h-3.5" />
          Load JSON
        </button>

        {/* Export Dropdown */}
        <div className="relative" ref={exportMenuRef}>
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            aria-expanded={exportOpen}
            aria-haspopup="menu"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#00E5FF] text-[#0F1115] hover:bg-[#33ECFF] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {exportOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-1.5 w-76 bg-[#181B20] border border-[#2A2F3A] rounded-md shadow-2xl py-1.5 z-50"
            >
              <div className="px-3 py-1 text-[11px] font-semibold text-[#8B949E]">
                Industrial Automation & Simulation (No Editing)
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const script = exportEngine.exportSimscapeMatlabScript(project);
                  downloadBlob(script, `${baseSlug}_simscape_build.m`, 'text/plain;charset=utf-8');
                  setExportOpen(false);
                  showToast('Exported Simscape Electrical direct builder (.m)');
                }}
                className="w-full px-3 py-2 text-left text-xs hover:bg-[#222731] flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="flex items-center gap-2 text-[#E6EDF3]">
                  <FileCode2 className="w-3.5 h-3.5 text-[#00E5FF]" />
                  Simscape All-Libraries Model
                </span>
                <span className="font-mono text-[10px] text-[#00E5FF]">.m</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const xml = exportEngine.exportSimulinkSimscapeXml(project);
                  downloadBlob(xml, `${baseSlug}_simulink_simscape.xml`, 'application/xml;charset=utf-8');
                  setExportOpen(false);
                  showToast('Exported Simulink / Simscape Electrical (.xml)');
                }}
                className="w-full px-3 py-2 text-left text-xs hover:bg-[#222731] flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="flex items-center gap-2 text-[#E6EDF3]">
                  <FileCode2 className="w-3.5 h-3.5 text-[#00E5FF]" />
                  Simulink / Simscape Exchange
                </span>
                <span className="font-mono text-[10px] text-[#00E5FF]">.xml</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const mdl = exportEngine.exportSimulinkMdl(project);
                  downloadBlob(mdl, `${baseSlug}_simulink.mdl`, 'text/plain;charset=utf-8');
                  setExportOpen(false);
                  showToast('Exported native Simulink control model (.mdl)');
                }}
                className="w-full px-3 py-2 text-left text-xs hover:bg-[#222731] flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="flex items-center gap-2 text-[#E6EDF3]">
                  <FileCode2 className="w-3.5 h-3.5 text-[#00E5FF]" />
                  Simulink Control Model
                </span>
                <span className="font-mono text-[10px] text-[#00E5FF]">.mdl</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const exp = exportEngine.exportCodesys(project);
                  downloadBlob(exp, `${baseSlug}_codesys.export`, 'application/xml;charset=utf-8');
                  setExportOpen(false);
                  showToast('Exported industrial CODESYS IEC 61131-3 (.export)');
                }}
                className="w-full px-3 py-2 text-left text-xs hover:bg-[#222731] flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="flex items-center gap-2 text-[#E6EDF3]">
                  <FileCode2 className="w-3.5 h-3.5 text-[#34C759]" />
                  CODESYS IEC 61131-3 Ready
                </span>
                <span className="font-mono text-[10px] text-[#34C759]">.export</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const cad = exportEngine.exportCadeSimu(activeSheet, project);
                  downloadBlob(cad, `${baseSlug}_sheet${activeSheet.number}.cad`, 'text/plain;charset=utf-8');
                  setExportOpen(false);
                  showToast('Exported CADe_SIMU schematic (.cad)');
                }}
                className="w-full px-3 py-2 text-left text-xs hover:bg-[#222731] flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="flex items-center gap-2 text-[#E6EDF3]">
                  <FileCode2 className="w-3.5 h-3.5 text-[#F59E0B]" />
                  CADe_SIMU Schematic File
                </span>
                <span className="font-mono text-[10px] text-[#F59E0B]">.cad</span>
              </button>

              <div className="my-1.5 border-t border-[#2A2F3A]" />
              <div className="px-3 py-1 text-[11px] font-semibold text-[#8B949E]">
                CAD Drawings & Project Data
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const svg = exportEngine.exportSvg(activeSheet, project, simulation);
                  downloadBlob(svg, `${baseSlug}_sheet${activeSheet.number}.svg`, 'image/svg+xml;charset=utf-8');
                  setExportOpen(false);
                  showToast('Exported vector schematic (.svg)');
                }}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-[#222731] flex items-center justify-between text-[#E6EDF3] cursor-pointer"
              >
                <span>Vector Schematic</span>
                <span className="font-mono text-[10px] text-[#94A3B8]">.svg</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const dxf = exportEngine.exportDxf(activeSheet, project);
                  downloadBlob(dxf, `${baseSlug}_sheet${activeSheet.number}.dxf`, 'application/dxf;charset=utf-8');
                  setExportOpen(false);
                  showToast('Exported 2D AutoCAD drawing (.dxf)');
                }}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-[#222731] flex items-center justify-between text-[#E6EDF3] cursor-pointer"
              >
                <span>AutoCAD 2D Drawing</span>
                <span className="font-mono text-[10px] text-[#94A3B8]">.dxf</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const csv = exportEngine.exportBomCsv(project);
                  downloadBlob(csv, `${baseSlug}_bom.csv`, 'text/csv;charset=utf-8');
                  setExportOpen(false);
                  showToast('Exported Bill of Materials (.csv)');
                }}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-[#222731] flex items-center justify-between text-[#E6EDF3] cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#94A3B8]" />
                  Bill of Materials (BOM)
                </span>
                <span className="font-mono text-[10px] text-[#94A3B8]">.csv</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const json = exportEngine.exportJson(project);
                  downloadBlob(json, `${baseSlug}.json`, 'application/json;charset=utf-8');
                  setExportOpen(false);
                  showToast('Saved VoltGrid project (.json)');
                }}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-[#222731] flex items-center justify-between text-[#E6EDF3] cursor-pointer"
              >
                <span>VoltGrid Project / Template</span>
                <span className="font-mono text-[10px] text-[#94A3B8]">.json</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
