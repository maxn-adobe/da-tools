import { useState } from 'react';
import { CopyIcon, CheckIcon } from './icons';

// Copies the text returned by getText() to the clipboard, flashing a check for 1.5s.
export function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      title="Copy all paths"
      style={copied ? { color: '#2d9e2d' } : undefined}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(getText()).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
