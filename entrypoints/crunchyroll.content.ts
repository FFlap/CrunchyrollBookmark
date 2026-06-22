import { parseEpisodePage, parseWatchPath } from '../src/domain/episode-parser';
import { persistDetectedEpisode } from '../src/domain/tracking';

export default defineContentScript({
  matches: ['https://www.crunchyroll.com/*'],
  runAt: 'document_idle',
  main() {
    document.documentElement.dataset.crunchyrollBookmark = 'loaded';
    let lastSentEpisodeId: string | null = null;
    let lastObservedUrl = location.href;
    let inspectionTimer: ReturnType<typeof setTimeout> | undefined;
    let saveInFlight = false;
    let inspectAgain = false;

    const inspect = async () => {
      if (saveInFlight) {
        inspectAgain = true;
        return;
      }
      if (!parseWatchPath(location.pathname)) {
        lastSentEpisodeId = null;
        return;
      }

      const bookmark = parseEpisodePage(document, new URL(location.href));
      if (bookmark && bookmark.episodeId !== lastSentEpisodeId) {
        saveInFlight = true;
        document.documentElement.dataset.crunchyrollBookmark = 'saving';
        try {
          await persistDetectedEpisode(browser.storage.local, bookmark);
          lastSentEpisodeId = bookmark.episodeId;
          document.documentElement.dataset.crunchyrollBookmark = 'tracked';
        } catch (error: unknown) {
          document.documentElement.dataset.crunchyrollBookmark = 'error';
          console.error('[Crunchyroll Bookmark] Failed to save episode', error);
        } finally {
          saveInFlight = false;
          if (inspectAgain) {
            inspectAgain = false;
            scheduleInspect(0);
          }
        }
        return;
      }

      if (!bookmark) {
        document.documentElement.dataset.crunchyrollBookmark = 'waiting';
      }
    };

    const scheduleInspect = (delay = 100) => {
      clearTimeout(inspectionTimer);
      inspectionTimer = setTimeout(() => void inspect(), delay);
    };

    const handleNavigation = () => {
      lastSentEpisodeId = null;
      scheduleInspect(0);
    };

    for (const methodName of ['pushState', 'replaceState'] as const) {
      const original = history[methodName];
      history[methodName] = function (...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event('crunchyroll-bookmark:navigation'));
        return result;
      };
    }

    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('crunchyroll-bookmark:navigation', handleNavigation);

    const observer = new MutationObserver(() => {
      if (parseWatchPath(location.pathname)) scheduleInspect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.setInterval(() => {
      if (location.href !== lastObservedUrl) {
        lastObservedUrl = location.href;
        handleNavigation();
        return;
      }
      if (parseWatchPath(location.pathname)) scheduleInspect(0);
    }, 1000);

    scheduleInspect(0);
  },
});
