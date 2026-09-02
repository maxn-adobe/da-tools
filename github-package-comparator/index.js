import decorate from './github-package-comparator.js';
import { enhanceAppLinks } from '../shared/nav.js';

// Update the "All Tools" back-link to the outer da.live URL when embedded (see shared/nav.js).
enhanceAppLinks();

// The original EDS block exported `decorate(block)` and was auto-invoked by the AEM runtime.
// Standalone, we call it ourselves with the shell's container element.
decorate(document.getElementById('app'));
