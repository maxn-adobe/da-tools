export function inferSchema(blockName, jsSource) {
  const pattern = inferPattern(jsSource);
  const variants = inferVariants(jsSource);
  const cells = inferCells(jsSource);
  const fields = inferFields(jsSource);
  const confidence = inferConfidence(jsSource, pattern, cells, fields);

  const schema = {
    block: blockName,
    version: 1,
    pattern,
    variants,
    _confidence: confidence,
    _notes: buildNotes(pattern, cells, fields, jsSource),
  };

  if (pattern === 'key-value') {
    schema.fields = fields;
  } else if (cells.length > 0) {
    schema.cells = cells;
  }

  return schema;
}

function inferPattern(source) {
  const isKeyValue =
    /children\[0\]\.textContent/.test(source) ||
    /readBlockConfig/.test(source) ||
    /children\[0\][\s\S]{0,40}textContent/.test(source);

  const isPositionalRows =
    /cells\[\d+\]/.test(source) &&
    /Array\.from\(block\.children\)/.test(source);

  const isPositionalColumns =
    /rows\[0\]\.children\.length/.test(source) ||
    /children\.length/.test(source) && /numCols/.test(source);

  const isSingleCell =
    !isKeyValue &&
    !isPositionalRows &&
    !isPositionalColumns &&
    /for\s*\(.*of\s+block\.children\)/.test(source);

  const detected = [isKeyValue, isPositionalRows, isPositionalColumns, isSingleCell].filter(Boolean).length;

  if (detected > 1) return 'mixed';
  if (isKeyValue) return 'key-value';
  if (isPositionalRows) return 'positional-rows';
  if (isPositionalColumns) return 'positional-columns';
  if (isSingleCell) return 'single-cell';
  return 'unknown';
}

function inferVariants(source) {
  const matches = [...source.matchAll(/classList\.contains\(['"]([^'"]+)['"]\)/g)];
  const seen = new Set();
  const variants = [];
  for (const m of matches) {
    const v = m[1];
    if (v !== 'block' && !seen.has(v)) {
      seen.add(v);
      variants.push(v);
    }
  }
  return variants;
}

function inferCells(source) {
  const indexMatches = [...source.matchAll(/cells\[(\d+)\]/g)];
  const indices = [...new Set(indexMatches.map((m) => Number(m[1])))].sort((a, b) => a - b);

  return indices.map((idx) => {
    const content = inferCellContentType(source, idx);
    return { index: idx, role: null, content, required: true };
  });
}

function inferCellContentType(source, idx) {
  // Find the ~200-char window around each cells[N] reference and check what's accessed
  const cellRef = `cells[${idx}]`;
  const pos = source.indexOf(cellRef);
  if (pos === -1) return 'unknown';

  const window = source.slice(Math.max(0, pos - 20), pos + 200);

  if (/querySelector\(['"][^'"]*img[^'"]*['"]\)|querySelectorAll\(['"][^'"]*picture[^'"]*['"]\)/.test(window)) {
    return 'image';
  }
  if (/querySelector\(['"]a['"]/.test(window)) {
    return 'link';
  }
  if (/\.innerHTML/.test(window)) {
    return 'richtext';
  }
  if (/\.textContent/.test(window)) {
    return 'text';
  }
  return 'unknown';
}

function inferFields(source) {
  // For key-value blocks: look for keys extracted via textContent and stored into a config object
  const keyMatches = [
    ...source.matchAll(/config\[['"]([^'"]+)['"]\]/g),
    ...source.matchAll(/getMetadata\(['"]([^'"]+)['"]\)/g),
  ];
  const seen = new Set();
  const fields = [];
  for (const m of keyMatches) {
    const key = m[1];
    if (!seen.has(key)) {
      seen.add(key);
      fields.push({ key, type: 'text', required: false });
    }
  }
  return fields;
}

function inferConfidence(source, pattern, cells, fields) {
  if (pattern === 'unknown' || pattern === 'mixed') return 'low';

  if (pattern === 'key-value') {
    return fields.length > 0 ? 'medium' : 'low';
  }

  if (pattern === 'positional-rows' || pattern === 'positional-columns') {
    const allTyped = cells.length > 0 && cells.every((c) => c.content !== 'unknown');
    return allTyped ? 'high' : 'medium';
  }

  if (pattern === 'single-cell') {
    return 'high';
  }

  return 'medium';
}

function buildNotes(pattern, cells, fields, source) {
  const notes = [];

  if (pattern === 'unknown') {
    notes.push('Could not detect a clear DOM access pattern. Manual review required.');
  }
  if (pattern === 'mixed') {
    notes.push('Multiple patterns detected — block likely has variant-specific schemas.');
  }

  const unknownCells = cells.filter((c) => c.content === 'unknown');
  if (unknownCells.length > 0) {
    notes.push(`Cell content type unclear for index(es): ${unknownCells.map((c) => c.index).join(', ')}.`);
  }

  if (/getMetadata\(/.test(source)) {
    notes.push('Block reads page-level metadata — some behavior is externally controlled.');
  }

  if (/\.shift\(\)|\.remove\(\)|innerHTML\s*=\s*''/.test(source)) {
    notes.push('Block consumes/removes rows during decoration — sentinel rows may exist.');
  }

  notes.push('Inferred from block.js source. Human review required before committing.');

  return notes.join(' ');
}
