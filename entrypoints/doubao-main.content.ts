import { installDoubaoFetchHook } from '../src/core/interceptor/fetch-hook';

// Runs in the page's MAIN world so it can override window.fetch before 豆包's
// app code captures a reference to it.
export default defineContentScript({
  matches: ['*://www.doubao.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installDoubaoFetchHook();
  },
});
