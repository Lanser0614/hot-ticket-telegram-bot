import type { ClickSource } from './click-tracking.js';
import { ValidationError } from './errors.js';
import { extractTicketSearchCode, normalizeTicketLink } from './ticket.js';

export interface AffiliateConfig {
  readonly marker: string | null;
  readonly template: string;
}

const PLACEHOLDER_PATTERN = /\{([^}]+)\}/gu;
const ALLOWED_PLACEHOLDERS = new Set([
  'search_code',
  'marker',
  'sub_id',
  'sub_id1',
  'target'
]);

export function buildAffiliateLink(
  ticketLink: string,
  source: ClickSource,
  clickId: number | null,
  config: AffiliateConfig
): string {
  const target = normalizeTicketLink(ticketLink);
  if (config.marker === null) return target;
  for (const match of config.template.matchAll(PLACEHOLDER_PATTERN)) {
    const placeholder = match[1];
    if (placeholder === undefined || !ALLOWED_PLACEHOLDERS.has(placeholder)) {
      throw new ValidationError(`Неизвестный placeholder партнёрской ссылки: ${placeholder ?? ''}`);
    }
  }
  const values: Readonly<Record<string, string>> = {
    search_code: extractTicketSearchCode(target),
    marker: config.marker,
    sub_id: source,
    sub_id1: clickId === null ? '' : String(clickId),
    target
  };
  const result = config.template.replace(PLACEHOLDER_PATTERN, (_match, rawKey: string) => (
    encodeURIComponent(values[rawKey] ?? '')
  ));
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new ValidationError('Некорректный шаблон партнёрской ссылки');
  }
  if (parsed.protocol !== 'https:') {
    throw new ValidationError('Партнёрская ссылка должна использовать HTTPS');
  }
  return parsed.toString();
}
