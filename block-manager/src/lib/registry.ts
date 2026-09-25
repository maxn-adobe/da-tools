import { readJson, writeJson } from '../api/daApi';
import { REGISTRY_PATH, mergeRegistry } from './config';
import type { RepoEntry } from '../types';

interface RegistryDoc { version?: number; repos?: RepoEntry[] }

// Load the shared repo registry, merged over the built-in seeds. Missing/unreadable -> seeds only.
export async function loadRegistry(): Promise<Map<string, RepoEntry>> {
  const doc = await readJson<RegistryDoc>(REGISTRY_PATH);
  const repos = doc && Array.isArray(doc.repos) ? doc.repos : null;
  return mergeRegistry(repos);
}

export async function saveRegistry(entriesById: Map<string, RepoEntry>): Promise<void> {
  await writeJson(REGISTRY_PATH, { version: 1, repos: [...entriesById.values()] });
}
