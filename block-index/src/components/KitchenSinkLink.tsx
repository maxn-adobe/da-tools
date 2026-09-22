import { BookIcon } from './icons';

// A book icon linking to a block's kitchen-sink docs, or a disabled icon when there's no page.
export function KitchenSinkLink({ href }: { href: string | null }) {
  if (!href) {
    return <span className="ks-btn disabled" title="No kitchen-sink page"><BookIcon /></span>;
  }
  return (
    <a
      className="ks-btn"
      title="View kitchen-sink docs"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      <BookIcon />
    </a>
  );
}
