const ORG = 'adobecom';
const REPO = 'da-express-milo';
const BRANCH = 'main';
const BLOCKS_PATH = 'express/code/blocks';

const GITHUB_API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export async function listBlocks() {
  const resp = await fetch(`${GITHUB_API}/repos/${ORG}/${REPO}/contents/${BLOCKS_PATH}`);
  if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
  const items = await resp.json();
  return items
    .filter((item) => item.type === 'dir')
    .map((item) => item.name)
    .sort();
}

export async function fetchBlockJs(blockName) {
  const url = `${RAW}/${ORG}/${REPO}/${BRANCH}/${BLOCKS_PATH}/${blockName}/${blockName}.js`;
  const resp = await fetch(url);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
  return resp.text();
}
