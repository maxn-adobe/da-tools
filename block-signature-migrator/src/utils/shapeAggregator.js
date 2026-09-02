export function aggregateShapes(crawlResults) {
  const map = new Map();

  for (const { path, blocks } of crawlResults) {
    for (const block of blocks) {
      const key = block.variant ? `${block.name} ${block.variant}` : block.name;
      if (!map.has(key)) {
        map.set(key, { name: block.name, variant: block.variant ?? null, docs: new Set(), rowShapes: [] });
      }
      const entry = map.get(key);
      entry.docs.add(path);
      entry.rowShapes.push(block.rows.map((row) => row.length));
    }
  }

  return [...map.entries()]
    .map(([key, { name, variant, docs, rowShapes }]) => ({
      key,
      name,
      variant,
      docCount: docs.size,
      docs: [...docs],
      rowShapes,
      modalShape: computeModalShape(rowShapes),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function computeModalShape(rowShapes) {
  if (!rowShapes.length) return [];
  const counts = new Map();
  for (const shape of rowShapes) {
    const k = JSON.stringify(shape);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let bestKey = null;
  let bestCount = 0;
  for (const [k, count] of counts) {
    if (count > bestCount) { bestCount = count; bestKey = k; }
  }
  return JSON.parse(bestKey);
}
