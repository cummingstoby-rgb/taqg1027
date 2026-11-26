import React, { useState } from 'react';
import { LadderCanvas } from './components/LadderCanvas';
import { LeftSidebar } from './components/LeftSidebar';
import { RightPanel } from './components/RightPanel';
import { TemplateImporterModal } from './components/TemplateImporterModal';
import { TopToolbar } from './components/TopToolbar';
import { EcadProvider, useEcad } from './store/useEcadStore';

const WorkspaceShell: React.FC = () => {
  const { toastMessage } = useEcad();
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [templateRefreshKey, setTemplateRefreshKey] = useState(0);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0F1115] text-[#E6EDF3] overflow-hidden">
      <TopToolbar onOpenPdfImporter={() => setPdfModalOpen(true)} />

      <main className="flex-1 flex min-h-0 overflow-hidden">
        <LeftSidebar
          onOpenPdfImporter={() => setPdfModalOpen(true)}
          templateRefreshKey={templateRefreshKey}
        />
        <LadderCanvas />
        <RightPanel />
      </main>

      <TemplateImporterModal
        open={pdfModalOpen}
        onClose={() => setPdfModalOpen(false)}
        onTemplateSaved={() => setTemplateRefreshKey((k) => k + 1)}
      />

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 px-3.5 py-2 rounded-md bg-[#181B20] border border-[#00E5FF]/50 text-xs font-medium text-[#E6EDF3] shadow-xl pointer-events-none"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <EcadProvider>
      <WorkspaceShell />
    </EcadProvider>
  );
}
