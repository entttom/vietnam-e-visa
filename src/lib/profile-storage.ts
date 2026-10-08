import { addDaysIso, isoToDdMmYyyy } from './shared';
import { parseYaml, stringifyYaml, type VisaProfile } from './yaml';

export const STORAGE_KEY_PROFILE_YAML = 'profileYaml'; // legacy single-profile backup
export const STORAGE_KEY_ENTRY_DATE = 'lastEntryDate'; // legacy popup preference
export const STORAGE_KEY_STAY_DAYS = 'profileStayDays'; // legacy popup preference
export const STORAGE_KEY_PROFILES = 'visaProfilesV2';
export const STORAGE_KEY_ACTIVE_PROFILE = 'activeVisaProfileId';

export const PROFILE_BLANK_TEMPLATE_FILE = 'profile.form.yaml';
export const PROFILE_EXAMPLE_FILE = 'profile.example.yaml';

export interface StoredProfile {
  id: string;
  label: string;
  yaml: string;
}

async function blankYaml(): Promise<string> {
  const response = await fetch(chrome.runtime.getURL(PROFILE_BLANK_TEMPLATE_FILE));
  if (!response.ok) throw new Error('Could not load the blank profile template.');
  return response.text();
}

function newId(): string {
  return crypto.randomUUID();
}

/** On first use, migrate the old single YAML profile without deleting its backup. */
export async function loadProfiles(): Promise<StoredProfile[]> {
  const stored = await chrome.storage.local.get([STORAGE_KEY_PROFILES, STORAGE_KEY_PROFILE_YAML]);
  const existing = stored[STORAGE_KEY_PROFILES];
  if (Array.isArray(existing) && existing.length) {
    return existing as StoredProfile[];
  }

  const legacy = stored[STORAGE_KEY_PROFILE_YAML];
  const yaml = typeof legacy === 'string' && legacy.trim() ? legacy : await blankYaml();
  const profiles: StoredProfile[] = [{ id: newId(), label: 'Applicant 1', yaml }];
  await chrome.storage.local.set({
    [STORAGE_KEY_PROFILES]: profiles,
    [STORAGE_KEY_ACTIVE_PROFILE]: profiles[0].id,
  });
  return profiles;
}

export function getProfileLabel(profile: StoredProfile): string {
  try {
    const data = parseYaml(profile.yaml).personal_information as Record<string, unknown> | undefined;
    const surname = String(data?.surname || '').trim();
    const givenName = String(data?.given_name || '').trim();
    if (surname && givenName) return surname + ', ' + givenName;
  } catch {
    // Keep the custom label when parsing a profile fails.
  }
  return profile.label;
}

export async function loadActiveProfileId(): Promise<string> {
  const profiles = await loadProfiles();
  const saved = await chrome.storage.local.get(STORAGE_KEY_ACTIVE_PROFILE);
  const id = saved[STORAGE_KEY_ACTIVE_PROFILE];
  return profiles.some((profile) => profile.id === id) ? id : profiles[0].id;
}

export async function setActiveProfileId(id: string): Promise<void> {
  if (!(await loadProfiles()).some((profile) => profile.id === id)) {
    throw new Error('Applicant not found.');
  }
  await chrome.storage.local.set({ [STORAGE_KEY_ACTIVE_PROFILE]: id });
}

export async function loadProfileYaml(profileId?: string): Promise<string> {
  const profiles = await loadProfiles();
  const id = profileId || (await loadActiveProfileId());
  const profile = profiles.find((item) => item.id === id);
  if (!profile) throw new Error('Selected applicant no longer exists.');
  return profile.yaml;
}

export async function saveProfileYaml(yaml: string, profileId?: string): Promise<void> {
  parseYaml(yaml);
  const profiles = await loadProfiles();
  const id = profileId || (await loadActiveProfileId());
  const index = profiles.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('Selected applicant no longer exists.');
  profiles[index] = { ...profiles[index], yaml };
  await chrome.storage.local.set({ [STORAGE_KEY_PROFILES]: profiles });
}

export async function createProfile(yaml?: string, label = 'New applicant'): Promise<StoredProfile> {
  const profiles = await loadProfiles();
  const profile = { id: newId(), label, yaml: yaml ?? (await blankYaml()) };
  parseYaml(profile.yaml);
  await chrome.storage.local.set({
    [STORAGE_KEY_PROFILES]: [...profiles, profile],
    [STORAGE_KEY_ACTIVE_PROFILE]: profile.id,
  });
  return profile;
}

export async function duplicateProfile(sourceYaml: string): Promise<StoredProfile> {
  const data = parseYaml(sourceYaml);
  const personal = (data.personal_information || {}) as Record<string, unknown>;
  const passport = (data.passport_information || {}) as Record<string, unknown>;

  // Keep shared addresses, dates, contact details and itinerary. Explicitly blank
  // identity and passport fields so the copy is not accidentally submitted as the source.
  for (const field of ['given_name', 'date_of_birth', 'identity_card']) personal[field] = '';
  for (const field of ['number', 'date_of_issue', 'expiry_date', 'issuing_authority']) passport[field] = '';
  personal.sex = '';
  personal.used_other_passports = false;
  personal.used_passports = [];
  passport.other_valid_passports = false;
  passport.other_passports = [];
  data.personal_information = personal;
  data.passport_information = passport;
  return createProfile(stringifyYaml(data), 'New applicant (copy)');
}

export async function deleteProfile(profileId: string): Promise<void> {
  const profiles = await loadProfiles();
  const remaining = profiles.filter((profile) => profile.id !== profileId);
  if (remaining.length === profiles.length) throw new Error('Applicant not found.');
  if (remaining.length === 0) throw new Error('Keep at least one applicant. Create another before deleting this one.');
  await chrome.storage.local.set({
    [STORAGE_KEY_PROFILES]: remaining,
    [STORAGE_KEY_ACTIVE_PROFILE]: remaining[0].id,
  });
}

export function getProfileEntryDate(yaml: string): string {
  const profile = parseYaml(yaml);
  const trip = (profile.trip_information || {}) as Record<string, unknown>;
  const requested = (profile.requested_information || {}) as Record<string, unknown>;
  const date = String(trip.intended_entry_date || requested.valid_from || '');
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (!match) return '';
  const iso = match[3] + '-' + match[2] + '-' + match[1];
  const test = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(test.valueOf()) && test.toISOString().startsWith(iso) ? iso : '';
}

export function parseStayDaysFromYaml(yaml: string): number | null {
  const trip = (parseYaml(yaml).trip_information || {}) as Record<string, unknown>;
  const parsed = Number(trip.length_of_stay_days);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Updating the date from the popup persists it back into this applicant's YAML. */
export function withEntryDate(yaml: string, entryIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryIso)) throw new Error('Invalid entry date.');
  const profile: VisaProfile = parseYaml(yaml);
  const trip = (profile.trip_information || {}) as Record<string, unknown>;
  const requested = (profile.requested_information || {}) as Record<string, unknown>;
  const stayDays = parseStayDaysFromYaml(yaml) ?? 90;
  trip.intended_entry_date = isoToDdMmYyyy(entryIso);
  requested.valid_from = isoToDdMmYyyy(entryIso);
  requested.valid_to = isoToDdMmYyyy(addDaysIso(entryIso, stayDays - 1));
  profile.trip_information = trip;
  profile.requested_information = requested;
  return stringifyYaml(profile);
}

export function downloadProfileYaml(yaml: string, filename = 'profile.yaml'): void {
  const blob = new Blob([yaml], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
