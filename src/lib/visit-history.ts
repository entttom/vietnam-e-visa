import { parseYaml } from './yaml';

export interface VietnamVisit {
  from_date?: string;
  to_date?: string;
  purpose?: string;
}

export function parseDdMmYyyy(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parts = value.trim().split('/');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts.map(Number);
  if (!day || !month || !year) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export function oneYearBefore(refDate: Date): Date {
  const start = new Date(refDate);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return start;
}

/** Visits that overlap [refDate − 1 year, refDate] (matches e-Visa “last 01 year”). */
export function filterVisitsWithinLastYear(visits: VietnamVisit[], refDate: Date): VietnamVisit[] {
  const windowStart = oneYearBefore(refDate);
  return visits.filter((visit) => {
    const from = parseDdMmYyyy(visit.from_date);
    const to = parseDdMmYyyy(visit.to_date) ?? from;
    if (!from || !to) return false;
    return to >= windowStart && from <= refDate;
  });
}

export function getProfileReferenceDate(profile: Record<string, unknown>): Date {
  const trip = (profile.trip_information || {}) as Record<string, unknown>;
  return parseDdMmYyyy(trip.intended_entry_date) ?? new Date();
}

function quoteYaml(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function serializeVisitsBlock(visits: VietnamVisit[]): string {
  if (!visits.length) return 'vietnam_visits_last_year: []';
  const lines = ['vietnam_visits_last_year:'];
  for (const visit of visits) {
    lines.push(`  - from_date: ${quoteYaml(visit.from_date ?? '')}`);
    lines.push(`    to_date: ${quoteYaml(visit.to_date ?? '')}`);
    lines.push(`    purpose: ${quoteYaml(visit.purpose ?? 'Trip')}`);
  }
  return lines.join('\n');
}

export function replaceVisitsBlockInYaml(yaml: string, visits: VietnamVisit[]): string {
  const block = serializeVisitsBlock(visits);
  const pattern =
    /^vietnam_visits_last_year:\s*(?:\[\]|[\s\S]*?)(?=\n(?:accompanying_children|trip_expenses|[a-z_][a-z0-9_]*):)/m;

  if (pattern.test(yaml)) {
    return yaml.replace(pattern, block);
  }

  const anchor = /\n(accompanying_children:)/;
  if (anchor.test(yaml)) {
    return yaml.replace(anchor, `\n${block}\n\n$1`);
  }

  return `${yaml.trimEnd()}\n\n${block}\n`;
}

/** Append a blank trip at the end of vietnam_visits_last_year. */
export function appendVisitToYaml(yaml: string): string {
  const profile = parseYaml(yaml);
  const existing = profile.vietnam_visits_last_year;
  const visits: VietnamVisit[] = Array.isArray(existing) ? [...(existing as VietnamVisit[])] : [];
  visits.push({ from_date: '', to_date: '', purpose: 'Trip' });
  return replaceVisitsBlockInYaml(yaml, visits);
}

const LAST_VISIT_FROM_DATE = '- from_date: ""';

/** Cursor offset inside the opening quotes of the last trip's from_date field. */
export function findLastVisitFromDateCursor(yaml: string): number {
  const index = yaml.lastIndexOf(LAST_VISIT_FROM_DATE);
  if (index === -1) {
    const fallback = 'from_date: ""';
    const fallbackIndex = yaml.lastIndexOf(fallback);
    if (fallbackIndex === -1) return yaml.length;
    return fallbackIndex + 'from_date: "'.length;
  }
  return index + '- from_date: "'.length;
}
