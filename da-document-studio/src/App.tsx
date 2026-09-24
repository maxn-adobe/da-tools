import { useState, type ReactNode } from 'react';
import { getToken } from './api/daApi';

type Tab = 'generate' | 'manage';

// Two-tab shell (Generate | Document Manager), mirroring pdp-document-generator's App. Both tabs are
// mounted up front (only the active one is shown) so each tab's state survives switches and the
// Document Manager can pre-warm its scan. Tab bodies are placeholders in milestone 1 — GeneratorTab
// and DocumentManagerView land in milestone 3, and the generate -> manage handoff in milestone 4.
export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('generate');
  const [mountedTabs, setMountedTabs] = useState<Set<Tab>>(() => new Set<Tab>(['generate', 'manage']));

  function selectTab(tab: Tab) {
    setActiveTab(tab);
    setMountedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }

  const noToken = !getToken();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">DA Document Studio</h1>

        {noToken && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No DA token — open this tool from da.live, or set <code>VITE_DA_TOKEN</code> for local dev.
          </p>
        )}

        <div className="flex gap-1.5">
          <TabButton active={activeTab === 'generate'} onClick={() => selectTab('generate')}>
            Generate
          </TabButton>
          <TabButton active={activeTab === 'manage'} onClick={() => selectTab('manage')}>
            Document Manager
          </TabButton>
        </div>

        {mountedTabs.has('generate') && (
          <div className={activeTab === 'generate' ? 'flex flex-col gap-4' : 'hidden'}>
            <Placeholder label="Generate" />
          </div>
        )}
        {mountedTabs.has('manage') && (
          <div className={activeTab === 'manage' ? undefined : 'hidden'}>
            <Placeholder label="Document Manager" />
          </div>
        )}
      </div>
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 text-sm text-gray-500">
      {label} — coming in the next milestone.
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm font-medium cursor-pointer transition-colors ${
        active
          ? 'bg-gray-900 text-white'
          : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}
