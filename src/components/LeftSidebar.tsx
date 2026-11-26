import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus2,
  FileText,
  FileUp,
  FolderKanban,
  Layers,
  Search,
  Trash2,
} from 'lucide-react';
import { BUILTIN_TEMPLATES } from '../data/demoCircuits';
import { SYMBOL_CATALOG, SYMBOL_CATEGORIES } from '../data/symbolCatalog';
import { TemplateCatalogItem, templateImporter } from '../engines/templateImporter';
import { useEcad } from '../store/useEcadStore';
import { SymbolCategory } from '../types/ecad';
import { SymbolGlyph } from './SymbolSvg';

interface LeftSidebarProps {
  onOpenPdfImporter: () => void;
  templateRefreshKey: number;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  onOpenPdfImporter,
  templateRefreshKey,
}) => {
  const {
    project,
    activeSheet,
    placingSymbol,
    tool,
    startPlacingSymbol,
    switchSheet,
    addSheet,
    deleteSheet,
    loadProject,
    showToast,
  } = useEcad();

  const [activeTab, setActiveTab] = useState<'symbols' | 'project'>('symbols');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});
  const [diskTemplates, setDiskTemplates] = useState<TemplateCatalogItem[]>([]);

  useEffect(() => {
    let active = true;
    templateImporter.listSavedTemplates().then((items) => {
      if (active) setDiskTemplates(items);
    });
    return () => {
      active = false;
    };
  }, [templateRefreshKey]);

  const filteredByCategory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const map = new Map<SymbolCategory, typeof SYMBOL_CATALOG>();
    for (const cat of SYMBOL_CATEGORIES) {
      const matches = SYMBOL_CATALOG.filter(
        (sym) =>
          sym.category === cat &&
          (!q ||
            sym.name.toLowerCase().includes(q) ||
            sym.shortLabel.toLowerCase().includes(q) ||
            sym.defaultDescription.toLowerCase().includes(q))
      );
      if (matches.length > 0) map.set(cat, matches);
    }
    return map;
  }, [searchQuery]);

  const templatesList: TemplateCatalogItem[] = useMemo(() => {
    if (diskTemplates.length > 0) return diskTemplates;
    return BUILTIN_TEMPLATES.map((t) => {
      const p = t.factory();
      return {
        id: t.id,
        fileName: t.fileName,
        title: p.metadata.title,
        category: t.category,
        description: p.metadata.description,
        sheetCount: p.sheets.length,
        componentCount: p.sheets.reduce((s, sh) => s + sh.components.length, 0),
        source: 'builtin' as const,
      };
    });
  }, [diskTemplates]);

  const handleLoadTemplate = async (item: TemplateCatalogItem) => {
    try {
      if (item.source === 'disk') {
        const proj = await templateImporter.loadTemplateFromDirectory(item.fileName);
        loadProject(proj, `Loaded template "${proj.metadata.title}"`);
      } else {
        const found = BUILTIN_TEMPLATES.find((b) => b.fileName === item.fileName);
        if (found) {
          const proj = found.factory();
          loadProject(proj, `Loaded template "${proj.metadata.title}"`);
        }
      }
    } catch (err) {
      showToast(`Could not load template: ${err instanceof Error ? err.message : 'Error'}`);
    }
  };

  return (
    <aside
      className="w-[272px] shrink-0 bg-[#181B20] border-r border-[#2A2F3A] flex flex-col overflow-hidden"
      aria-label="Symbol library and project explorer"
    >
      {/* Left Panel Mode Tabs */}
      <div className="flex border-b border-[#2A2F3A] bg-[#14171C] shrink-0" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'symbols'}
          onClick={() => setActiveTab('symbols')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'symbols'
              ? 'border-[#00E5FF] text-[#00E5FF] bg-[#181B20]'
              : 'border-transparent text-[#8B949E] hover:text-[#E6EDF3]'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          Symbols
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'project'}
          onClick={() => setActiveTab('project')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'project'
              ? 'border-[#00E5FF] text-[#00E5FF] bg-[#181B20]'
              : 'border-transparent text-[#8B949E] hover:text-[#E6EDF3]'
          }`}
        >
          <FolderKanban className="w-3.5 h-3.5" />
          Templates
        </button>
      </div>

      {/* Tab 1: Searchable JIC/IEC Industrial Symbol Library */}
      {activeTab === 'symbols' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-2.5 border-b border-[#2A2F3A]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search JIC / IEC symbols..."
                aria-label="Search symbol library"
                className="w-full pl-8 pr-2.5 py-1.5 bg-[#0F1115] border border-[#2A2F3A] rounded text-xs text-[#E6EDF3] placeholder:text-[#64748B] focus:outline-none focus:border-[#00E5FF]"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-[#8B949E]">
              Click a symbol or drag onto any rung to auto-break wire.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {Array.from(filteredByCategory.entries()).map(([cat, symbols]) => {
              const collapsed = Boolean(collapsedCats[cat]);
              return (
                <div key={cat}>
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedCats((prev) => ({ ...prev, [cat]: !prev[cat] }))
                    }
                    className="w-full flex items-center justify-between px-1.5 py-1 text-xs font-semibold text-[#94A3B8] hover:text-[#E6EDF3] cursor-pointer"
                    aria-expanded={!collapsed}
                  >
                    <span>{cat}</span>
                    {collapsed ? (
                      <ChevronRight className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {!collapsed && (
                    <div className="grid grid-cols-2 gap-1.5 mt-1">
                      {symbols.map((sym) => {
                        const isActive = tool === 'place' && placingSymbol === sym.type;
                        return (
                          <button
                            key={sym.type}
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/voltgrid-symbol', sym.type);
                            }}
                            onClick={() => startPlacingSymbol(sym.type)}
                            className={`flex flex-col items-center p-2 rounded border text-center transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-[#00E5FF]/15 border-[#00E5FF] text-[#00E5FF]'
                                : 'bg-[#13161B] border-[#242934] hover:border-[#3E4656] text-[#E6EDF3]'
                            }`}
                            title={sym.defaultDescription}
                          >
                            <svg width={56} height={32} viewBox="-26 -18 52 36">
                              <SymbolGlyph
                                type={sym.type}
                                stroke={isActive ? '#00E5FF' : '#CBD5E1'}
                                tag={sym.shortLabel}
                                pilotColor={sym.defaultColor}
                              />
                            </svg>
                            <span className="text-[11px] font-medium leading-tight mt-0.5 line-clamp-1">
                              {sym.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredByCategory.size === 0 && (
              <div className="py-8 text-center text-xs text-[#64748B]">
                No matching symbols found.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Tab 2: Multi-Sheet Project Tree + /templates VFD & PLC Library */
        <div className="flex-1 overflow-y-auto p-3 space-y-5">
          {/* Active Project Sheets */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold text-[#E6EDF3]">Schematic Sheets</h2>
              <button
                type="button"
                onClick={() => addSheet()}
                className="flex items-center gap-1 text-[11px] text-[#00E5FF] hover:underline cursor-pointer"
                aria-label="Add new schematic sheet"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                Add Sheet
              </button>
            </div>

            <div className="text-[11px] text-[#8B949E] mb-2 truncate" title={project.metadata.title}>
              {project.metadata.title} · <span className="font-mono">{project.metadata.projectNumber}</span>
            </div>

            <div className="space-y-1">
              {project.sheets.map((sheet) => {
                const isActive = sheet.id === activeSheet.id;
                return (
                  <div
                    key={sheet.id}
                    className={`flex items-center justify-between px-2.5 py-2 rounded border transition-colors ${
                      isActive
                        ? 'bg-[#00E5FF]/10 border-[#00E5FF]/40 text-[#E6EDF3]'
                        : 'bg-[#13161B] border-[#242934] text-[#94A3B8] hover:border-[#3E4656]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => switchSheet(sheet.id)}
                      className="flex-1 text-left flex items-center gap-2 min-w-0 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0 text-[#00E5FF]" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">
                          <span className="font-mono text-[#00E5FF] mr-1">0{sheet.number}</span>
                          {sheet.name}
                        </div>
                        <div className="text-[10px] text-[#64748B] font-mono">
                          {sheet.voltageLabel} · {sheet.components.length} dev
                        </div>
                      </div>
                    </button>
                    {project.sheets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => deleteSheet(sheet.id)}
                        className="p-1 text-[#64748B] hover:text-[#FF3B30] cursor-pointer"
                        aria-label={`Delete sheet ${sheet.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Industrial VFD & PLC Template Directory (/templates) */}
          <section className="pt-3 border-t border-[#2A2F3A]">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold text-[#E6EDF3]">Templates (/templates)</h2>
              <button
                type="button"
                onClick={onOpenPdfImporter}
                className="flex items-center gap-1 text-[11px] text-[#00E5FF] hover:underline cursor-pointer"
              >
                <FileUp className="w-3.5 h-3.5" />
                PDF Import
              </button>
            </div>
            <p className="text-[11px] text-[#8B949E] mb-2.5">
              VFD, PLC, and Motor Control schematics ready to load or download.
            </p>

            <div className="space-y-2">
              {templatesList.map((tpl) => (
                <div
                  key={tpl.fileName}
                  className="p-2.5 rounded bg-[#13161B] border border-[#242934] hover:border-[#3E4656] transition-colors"
                >
                  <div className="text-xs font-semibold text-[#E6EDF3] leading-snug">
                    {tpl.title}
                  </div>
                  <div className="mt-1 text-[10px] font-mono text-[#8B949E]">
                    {tpl.category} · {tpl.sheetCount}S · {tpl.componentCount} dev
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleLoadTemplate(tpl)}
                      className="flex-1 py-1 px-2 rounded text-[11px] font-medium bg-[#222731] hover:bg-[#00E5FF]/20 text-[#E6EDF3] hover:text-[#00E5FF] border border-[#2A2F3A] transition-colors cursor-pointer"
                    >
                      Load into App
                    </button>
                    <a
                      href={`/templates/${encodeURIComponent(tpl.fileName)}`}
                      download={tpl.fileName}
                      className="p-1.5 rounded bg-[#181B20] border border-[#2A2F3A] text-[#94A3B8] hover:text-[#00E5FF] transition-colors"
                      title={`Download ${tpl.fileName}`}
                      aria-label={`Download template ${tpl.fileName}`}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </aside>
  );
};
