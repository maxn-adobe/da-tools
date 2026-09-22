import { PUBLISHED_BASE } from './config';
import type { RepoConfig } from '../types';

export function daEditUrl(path: string): string {
  return `https://da.live/edit#${path.replace(/\.html$/, '')}`;
}

export function publishedUrl(cfg: RepoConfig, path: string): string {
  const withoutPrefix = path.replace(cfg.scanRoot, '');
  const withoutExt = withoutPrefix.replace(/\.html$/, '');
  return `${PUBLISHED_BASE}${withoutExt}`;
}

export function kitchenSinkUrl(cfg: RepoConfig, blockName: string, tier: 'own' | 'milo'): string {
  const base = tier === 'milo' && cfg.milo ? cfg.milo.kitchenSink.base : cfg.own.kitchenSink.base;
  return `${base}/docs/library/kitchen-sink/${blockName}`;
}
