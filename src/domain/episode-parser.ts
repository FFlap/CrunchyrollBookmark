import type { EpisodeBookmark } from './types';

const WATCH_PATH = /^\/watch\/([A-Z0-9]+)\/([^/?#]+)/i;
const SERIES_PATH = /^\/series\/([A-Z0-9]+)\/([^/?#]+)/i;
const EPISODE_HEADING = /^E([A-Z0-9.-]+)\s*-\s*(.+)$/i;
const SEASON_TITLE = /\bSeason\s+([A-Z0-9.-]+)/i;

interface StructuredEpisode {
  episodeNumber?: string;
  episodeTitle?: string;
  season?: string;
  seriesTitle?: string;
  seriesUrl?: string;
  watchUrl?: string;
}

function normalizeSeasonName(
  name: unknown,
  seasonNumber: unknown,
  seriesName: unknown,
) {
  if (typeof name === 'string' && name.trim()) {
    const normalizedName = name.trim();
    const numberedName = /^Season\s+(.+)$/i.exec(normalizedName)?.[1];
    if (numberedName) return numberedName.trim();

    const normalizedSeriesName =
      typeof seriesName === 'string' ? seriesName.trim() : '';
    const numericSeason =
      typeof seasonNumber === 'number'
        ? seasonNumber
        : typeof seasonNumber === 'string' && seasonNumber.trim() !== ''
          ? Number(seasonNumber)
          : Number.NaN;
    if (numericSeason === 0) return normalizedName;

    const isSeriesDerivedVariant =
      normalizedSeriesName && normalizedName.startsWith(normalizedSeriesName);

    if (!isSeriesDerivedVariant) return normalizedName;
  }
  if (typeof seasonNumber === 'number' || typeof seasonNumber === 'string') {
    return String(seasonNumber);
  }
  return undefined;
}

function parseStructuredEpisode(document: Document): StructuredEpisode | null {
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  )) {
    try {
      const data: unknown = JSON.parse(script.textContent ?? '');
      const entries = Array.isArray(data) ? data : [data];
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        if (record['@type'] !== 'TVEpisode') continue;
        const season =
          record.partOfSeason && typeof record.partOfSeason === 'object'
            ? (record.partOfSeason as Record<string, unknown>)
            : {};
        const series =
          record.partOfSeries && typeof record.partOfSeries === 'object'
            ? (record.partOfSeries as Record<string, unknown>)
            : {};
        const structuredName =
          typeof record.name === 'string' ? record.name.trim() : '';
        const nameAfterSeparator = /\|\s*(.+)$/.exec(structuredName)?.[1]?.trim();
        const episodeFromName =
          nameAfterSeparator
            ? /^E[A-Z0-9.-]+\s*-\s*(.+)$/i.exec(nameAfterSeparator)?.[1] ??
              nameAfterSeparator
            : undefined;

        return {
          episodeNumber:
            typeof record.episodeNumber === 'number' ||
            typeof record.episodeNumber === 'string'
              ? String(record.episodeNumber)
              : undefined,
          episodeTitle: episodeFromName?.trim(),
          season: normalizeSeasonName(
            season.name,
            season.seasonNumber,
            series.name,
          ),
          seriesTitle:
            typeof series.name === 'string' ? series.name.trim() : undefined,
          seriesUrl:
            typeof series['@id'] === 'string' ? series['@id'] : undefined,
          watchUrl: typeof record.url === 'string' ? record.url : undefined,
        };
      }
    } catch {
      // Ignore unrelated or temporarily incomplete structured-data scripts.
    }
  }
  return null;
}

function parseSeasonCategory(title: string, episodeTitle: string) {
  const numberedSeason = SEASON_TITLE.exec(title)?.[1];
  if (numberedSeason) return numberedSeason;

  const suffix = `${episodeTitle} - Watch on Crunchyroll`;
  if (!title.endsWith(suffix)) return null;
  return title.slice(0, -suffix.length).trim() || null;
}

export function parseWatchPath(pathname: string) {
  const match = WATCH_PATH.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return { episodeId: match[1], slug: match[2] };
}

export function parseEpisodePage(
  document: Document,
  url: URL,
  updatedAt = Date.now(),
): EpisodeBookmark | null {
  const watch = parseWatchPath(url.pathname);
  if (!watch) return null;

  const parsedStructured = parseStructuredEpisode(document);
  if (
    parsedStructured?.watchUrl &&
    new URL(parsedStructured.watchUrl, url.origin).pathname !== url.pathname
  ) {
    return null;
  }
  const structured = parsedStructured;
  const seriesLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
    (link) => SERIES_PATH.test(new URL(link.href, url.origin).pathname),
  );
  const heading = document.querySelector<HTMLHeadingElement>('h1');
  const episode = EPISODE_HEADING.exec(heading?.textContent?.trim() ?? '');
  const episodeNumber = structured?.episodeNumber ?? episode?.[1];
  const episodeTitle = structured?.episodeTitle ?? episode?.[2]?.trim();
  const season = structured?.season ?? (episodeTitle
    ? parseSeasonCategory(document.title, episodeTitle)
    : null);

  const structuredSeriesUrl = structured?.seriesUrl
    ? new URL(structured.seriesUrl, url.origin)
    : null;
  const seriesUrl =
    structuredSeriesUrl ??
    (seriesLink
      ? new URL(seriesLink.getAttribute('href') ?? seriesLink.href, url.origin)
      : null);
  if (!seriesUrl || !episodeNumber || !episodeTitle || !season) return null;
  const series = SERIES_PATH.exec(seriesUrl.pathname);
  const seriesTitle = structured?.seriesTitle ?? seriesLink?.textContent?.trim();
  if (!series?.[1] || !seriesTitle) return null;

  const structuredWatchUrl = structured?.watchUrl
    ? new URL(structured.watchUrl, url.origin)
    : url;

  return {
    seriesId: series[1],
    seriesTitle,
    seriesUrl: `${seriesUrl.origin}${seriesUrl.pathname}`,
    seasonNumber: season,
    episodeNumber,
    episodeTitle,
    episodeId: watch.episodeId,
    watchUrl: `${structuredWatchUrl.origin}${structuredWatchUrl.pathname}`,
    updatedAt,
  };
}
