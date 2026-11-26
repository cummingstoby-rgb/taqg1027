import React, { useRef, useState } from 'react';
import { CheckCircle2, FileUp, FolderOutput, X } from 'lucide-react';
import { ParsedPdfSummary, templateImporter } from '../engines/templateImporter';
import { useEcad } from '../store/useEcadStore';
import { Project } from '../types/ecad';

interface TemplateImporterModalProps {
  open: boolean;
  onClose: () => void;
  onTemplateSaved: () => void;
}

export const TemplateImporterModal: React.FC<TemplateImporterModalProps> = ({
  open,
  onClose,
  onTemplateSaved,
}) => {
  const { loadProject, showToast } = useEcad();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [specNotes, setSpecNotes] = useState('');
  const [specName, setSpecName] = useState('powerflex525_plc_vfd_control.pdf');
  const [result, setResult] = useState<{
    project: Project;
    summary: ParsedPdfSummary;
    savedFileName: string;
    savedToServer: boolean;
  } | null>(null);

  if (!open) return null;

  const handleFileSelected = async (file: File) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const imported = await templateImporter.importPdfFile(file);
      setResult(imported);
      onTemplateSaved();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to parse PDF schematic.');
    } finally {
      setBusy(false);
    }
  };

  const handleParseManualSpec = async () => {
    const text =
      specNotes.trim() ||
      'ALLEN-BRADLEY POWERFLEX 525 VFD + COMPACTLOGIX PLC 24VDC DI1 RUN DI2 REV R1A R1C %IX0.0 %IX0.1 %QX0.0 4.0 SEC';
    setBusy(true);
    setErrorMsg(null);
    try {
      const { project, summary } = templateImporter.parseSchematicText(text, specName || 'vfd_plc.pdf');
      const slug = (specName || 'vfd_plc')
        .replace(/\.pdf$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      const savedFileName = `${slug || 'parsed_vfd_plc'}.json`;
      const savedToServer = await templateImporter.saveTemplateToDirectory(savedFileName, project);
      setResult({ project, summary, savedFileName, savedToServer });
      onTemplateSaved();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate template.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-importer-title"
    >
      <div className="w-full max-w-2xl bg-[#181B20] border border-[#2A2F3A] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#2A2F3A] flex items-center justify-between">
          <div>
            <h2 id="pdf-importer-title" className="text-sm font-bold text-[#E6EDF3]">
              TemplateImporter — PDF VFD & PLC Schematic Parser
            </h2>
            <p className="text-xs text-[#8B949E] mt-0.5">
              Upload technical VFD or PLC PDF drawings to extract pinouts, I/O addresses, and save directly to /templates.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-[#8B949E] hover:text-[#E6EDF3] hover:bg-[#222731] cursor-pointer"
            aria-label="Close Template Importer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* PDF File Drop Zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFileSelected(file);
            }}
            className="border border-dashed border-[#3E4656] hover:border-[#00E5FF] rounded-md p-5 bg-[#0F1115] text-center transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileSelected(file);
                e.target.value = '';
              }}
            />
            <FileUp className="w-7 h-7 text-[#00E5FF] mx-auto mb-2" />
            <div className="text-xs font-semibold text-[#E6EDF3]">
              Drop a VFD or PLC Technical Schematic PDF here
            </div>
            <p className="text-[11px] text-[#8B949E] mt-1">
              Extracts terminal blocks (DI1/DI2/R1A-R1C), PLC tags (%IX/%QX), voltage rails, and saves into <span className="font-mono text-[#00E5FF]">/templates</span>.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 px-4 py-1.5 rounded text-xs font-semibold bg-[#00E5FF] text-[#0F1115] hover:bg-[#33ECFF] transition-colors cursor-pointer disabled:opacity-50"
            >
              {busy ? 'Parsing PDF Streams...' : 'Select PDF Drawing'}
            </button>
          </div>

          {/* Direct Spec / Drawing Text Parser */}
          <div className="pt-2 border-t border-[#2A2F3A] space-y-2.5">
            <div className="text-xs font-semibold text-[#E6EDF3]">
              Or Generate Template from VFD / PLC Drawing Specification
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label htmlFor="tpl-filename" className="block text-[11px] text-[#8B949E] mb-1">
                  Source Drawing Filename
                </label>
                <input
                  id="tpl-filename"
                  type="text"
                  value={specName}
                  onChange={(e) => setSpecName(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs font-mono text-[#E6EDF3]"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleParseManualSpec}
                  className="w-full py-1.5 px-3 rounded text-xs font-semibold bg-[#222731] hover:bg-[#2B313E] border border-[#2A2F3A] text-[#00E5FF] transition-colors cursor-pointer"
                >
                  Parse & Save to /templates
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="tpl-spec-text" className="block text-[11px] text-[#8B949E] mb-1">
                Technical Drawing Text / Pinout Spec (Optional — defaults to PowerFlex 525 + PLC 24VDC)
              </label>
              <textarea
                id="tpl-spec-text"
                rows={2}
                value={specNotes}
                onChange={(e) => setSpecNotes(e.target.value)}
                placeholder="e.g., SIEMENS SINAMICS G120 VFD + S7-1200 PLC 24VDC DI1 RUN DI2 REV %IX0.0 %IX0.1 %QX0.0 5.0s"
                className="w-full px-2.5 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs font-mono text-[#E6EDF3] placeholder:text-[#4B5563]"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded bg-[#FF3B30]/15 border border-[#FF3B30]/40 text-xs text-[#FF6B63]">
              {errorMsg}
            </div>
          )}

          {/* Extraction Results */}
          {result && (
            <div className="p-3.5 rounded bg-[#12151B] border border-[#34C759]/40 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#34C759]">
                  <CheckCircle2 className="w-4 h-4" />
                  Parsed & Saved to /templates/{result.savedFileName}
                </div>
                <span className="font-mono text-[11px] text-[#8B949E]">
                  {result.summary.sheetCount} sheet(s) · {result.summary.componentCount} devices
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] font-mono">
                <div className="p-2 rounded bg-[#0F1115] border border-[#242934]">
                  <div className="text-[#8B949E] text-[10px]">Domain</div>
                  <div className="text-[#E6EDF3] font-semibold mt-0.5">{result.summary.detectedDomain}</div>
                </div>
                <div className="p-2 rounded bg-[#0F1115] border border-[#242934]">
                  <div className="text-[#8B949E] text-[10px]">Manufacturer</div>
                  <div className="text-[#E6EDF3] font-semibold mt-0.5">{result.summary.detectedManufacturer}</div>
                </div>
                <div className="p-2 rounded bg-[#0F1115] border border-[#242934]">
                  <div className="text-[#8B949E] text-[10px]">Control Bus</div>
                  <div className="text-[#00E5FF] font-semibold mt-0.5">{result.summary.detectedVoltage}</div>
                </div>
              </div>

              <div className="text-[11px] font-mono text-[#94A3B8]">
                PLC I/O: {result.summary.plcAddresses.join(', ') || 'None'} · VFD Params:{' '}
                {result.summary.vfdParameters.join(', ') || 'None'}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <a
                  href={`/templates/${encodeURIComponent(result.savedFileName)}`}
                  download={result.savedFileName}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#222731] border border-[#2A2F3A] text-[#E6EDF3] hover:text-[#00E5FF]"
                >
                  <FolderOutput className="w-3.5 h-3.5" />
                  Download Template JSON
                </a>
                <button
                  type="button"
                  onClick={() => {
                    loadProject(
                      result.project,
                      `Loaded imported schematic "${result.project.metadata.title}"`
                    );
                    showToast(`Template saved at /templates/${result.savedFileName}`);
                    onClose();
                  }}
                  className="px-3.5 py-1.5 rounded text-xs font-semibold bg-[#00E5FF] text-[#0F1115] hover:bg-[#33ECFF] cursor-pointer"
                >
                  Open in VoltGrid Canvas
                </button>
              </div>
            </div>
          )}

          {/* Reference: Installed Simscape Libraries Mapped by ExportEngine */}
          <div className="pt-3 border-t border-[#2A2F3A] flex items-center gap-3">
            <img
              src="/assets/aistudio/image_392b086f.png"
              alt="Installed Simscape Foundation, Utilities, Driveline, and Electrical libraries"
              className="w-24 h-24 object-contain rounded border border-[#2A2F3A] bg-white p-1 shrink-0"
            />
            <div className="text-[11px] text-[#94A3B8] space-y-1">
              <div className="font-semibold text-[#E6EDF3]">
                Simscape & Industrial Export Mapping Active
              </div>
              <p>
                Templates imported here automatically bind to all installed Simscape libraries (Foundation, Utilities, Driveline, Electrical: Sources, Switches & Breakers, Electromechanical, Semiconductors & Converters, Sensors & Transducers) plus CODESYS <span className="font-mono text-[#34C759]">.export</span> and CADe_SIMU <span className="font-mono text-[#F59E0B]">.cad</span>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
