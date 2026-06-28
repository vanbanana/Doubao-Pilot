import { startContentBridge } from '../src/core/agent/content-bridge';
import { startDomCleanup } from '../src/core/ui/dom-cleanup';

// Runs in the ISOLATED world: has access to chrome.* APIs and bridges between
// the MAIN-world fetch hook and the background tool executors.
export default defineContentScript({
  matches: ['*://www.doubao.com/*'],
  runAt: 'document_start',
  main() {
    startContentBridge();
    startDomCleanup();
  },
});
