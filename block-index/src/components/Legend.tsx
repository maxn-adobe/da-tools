import type { RepoConfig } from '../types';

export function Legend({ cfg }: { cfg: RepoConfig }) {
  return (
    <div id="legend">
      <span className="legend-own"><span className="legend-express-square">■</span> {cfg.own.label}</span>
      {cfg.milo && (
        <span className="legend-milo"><span className="legend-express-square">■</span> {cfg.milo.label}</span>
      )}
      <span className="legend-unknown"><span className="legend-express-square">■</span> unrecognized</span>
    </div>
  );
}
