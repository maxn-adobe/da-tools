import type { RowResult } from '../types';

export function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0">
      <path d="M6.22 8.72a.75.75 0 0 0 1.06 1.06l5.22-5.22v1.69a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-.75-.75h-3.5a.75.75 0 0 0 0 1.5h1.69L6.22 8.72Z" />
      <path d="M3.5 6.75c0-.69.56-1.25 1.25-1.25H7A.75.75 0 0 0 7 4H4.75A2.75 2.75 0 0 0 2 6.75v4.5A2.75 2.75 0 0 0 4.75 14h4.5A2.75 2.75 0 0 0 12 11.25V9a.75.75 0 0 0-1.5 0v2.25c0 .69-.56 1.25-1.25 1.25h-4.5c-.69 0-1.25-.56-1.25-1.25v-4.5Z" />
    </svg>
  );
}

export function PreviewPill({ result, onPreview }: { result: RowResult; onPreview: () => void }) {
  const { stage, previewUrl } = result;
  if (stage === 'previewing') return <span className="text-indigo-500 font-medium">Previewing…</span>;
  if (previewUrl) {
    return (
      <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 font-medium hover:underline inline-flex items-center gap-1">
        ✓ aem.page
        <ExternalLinkIcon />
      </a>
    );
  }
  if (stage === 'draft') {
    return (
      <button type="button" onClick={onPreview}
        className="text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors cursor-pointer">
        Preview
      </button>
    );
  }
  return <span className="text-gray-300">—</span>;
}

export function PublishPill({
  result,
  onPublish,
  onUnpublish,
}: {
  result: RowResult;
  onPublish: () => void;
  onUnpublish: () => void;
}) {
  const { stage, liveUrl } = result;
  if (stage === 'publishing') return <span className="text-green-500 font-medium">Publishing…</span>;
  if (stage === 'unpublishing') return <span className="text-orange-500 font-medium">Unpublishing…</span>;
  if (stage === 'unpublished') {
    return (
      <button type="button" onClick={onPublish}
        className="text-xs text-green-600 hover:text-green-800 font-medium transition-colors cursor-pointer">
        Publish
      </button>
    );
  }
  if (liveUrl) {
    return (
      <div className="flex items-center gap-2 whitespace-nowrap">
        <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-green-700 font-medium hover:underline inline-flex items-center gap-1">
          ✓ aem.live
          <ExternalLinkIcon />
        </a>
        <button type="button" onClick={onUnpublish}
          className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors cursor-pointer">
          Unpublish
        </button>
      </div>
    );
  }
  if (stage === 'previewed') {
    return (
      <button type="button" onClick={onPublish}
        className="text-xs text-green-600 hover:text-green-800 font-medium transition-colors cursor-pointer">
        Publish
      </button>
    );
  }
  return <span className="text-gray-300">—</span>;
}

export function DeleteButton({ result, onDelete }: { result: RowResult; onDelete: () => void }) {
  const { stage, error } = result;
  if (stage === 'deleting') return <span className="text-red-500 font-medium">Deleting…</span>;
  if (stage === 'error') {
    const codeMatch = error?.match(/(\d{3})/);
    const code = codeMatch?.[1];
    const label = code === '403' ? 'Access Denied'
      : code === '404' ? 'Not Found'
      : code === '500' ? 'Server Error'
      : 'Error';
    const display = code ? `${label} (${code})` : 'Error';
    return <span className="text-red-600 font-medium cursor-help" title={error}>{display}</span>;
  }
  return (
    <button type="button" onClick={onDelete}
      className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors cursor-pointer">
      Delete
    </button>
  );
}
