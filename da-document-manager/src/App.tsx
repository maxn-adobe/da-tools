import { getToken } from './da';

// Hello-world scaffold. This will grow into a DA document manager (point at a DA folder, list its
// documents, and preview/publish/unpublish/delete them) modeled on the Document Manager in
// pdp-document-generator. For now it just confirms the app renders and the DA token handshake works.
export default function App() {
  const hasToken = Boolean(getToken());

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold">DA Document Manager</h1>
      <p className="text-gray-600">Hello world — scaffolding for the DA Document Manager tool.</p>
      <span
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${
          hasToken ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${hasToken ? 'bg-green-500' : 'bg-gray-400'}`} />
        {hasToken ? 'DA token connected' : 'No DA token — open in da.live, or set VITE_DA_TOKEN'}
      </span>
    </div>
  );
}
