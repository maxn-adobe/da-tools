// DA source HTML stores blocks as classed <div> elements (not tables).
// Structure: main > div (section) > div.block-name[.variant] (block) > div (row) > div (cell)

export function parseBlockNameAndVariant(classes) {
  const parts = classes.filter((c) => c !== 'block');
  if (!parts.length) return { name: '', variant: null };
  return {
    name: parts[0],
    variant: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

export function parseDocument(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const main = doc.querySelector('main') ?? doc.body;

  const sections = [];
  const blocks = [];

  for (const sectionEl of main.children) {
    if (sectionEl.tagName !== 'DIV') continue;
    const sectionIndex = sections.length;
    const sectionBlocks = [];

    for (const child of sectionEl.children) {
      if (child.tagName !== 'DIV' || !child.classList.length) continue;
      const block = parseBlockDiv(child, sectionIndex);
      if (block) sectionBlocks.push(block);
    }

    sections.push({ index: sectionIndex, blocks: sectionBlocks });
    blocks.push(...sectionBlocks);
  }

  return { blocks, sections };
}

function parseBlockDiv(div, sectionIndex) {
  const classes = [...div.classList];
  const rawName = classes.join(' ');
  const { name, variant } = parseBlockNameAndVariant(classes);
  if (!name) return null;

  const rows = [...div.children]
    .filter((row) => row.tagName === 'DIV')
    .map((row) =>
      [...row.children]
        .filter((cell) => cell.tagName === 'DIV')
        .map((cell) => ({ html: cell.innerHTML.trim() })),
    );

  return { name, variant, rawName, rows, sectionIndex };
}
