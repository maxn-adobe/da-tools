import { enhanceAppLinks } from './shared/nav.js';

// When the homepage is embedded in the da.live app, rewrite the tool cards so clicking one
// updates the outer (shareable) da.live URL instead of only swapping the iframe. See shared/nav.js.
enhanceAppLinks();
