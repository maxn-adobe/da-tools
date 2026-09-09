import { getToken } from './da';
import DocumentManagerView from './components/DocumentManagerView';

// The DA Document Manager: point at a DA folder, scan every document under it, and
// preview/publish/unpublish/delete them. General-purpose (team-agnostic) — spine columns only.
export default function App() {
  const hasToken = Boolean(getToken());

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold">DA Document Manager</h1>
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${
              hasToken ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${hasToken ? 'bg-green-500' : 'bg-gray-400'}`} />
            {hasToken ? 'DA token connected' : 'No DA token — open in da.live, or set VITE_DA_TOKEN'}
          </span>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-6">
        <DocumentManagerView />
      </main>
    </div>
  );
}
