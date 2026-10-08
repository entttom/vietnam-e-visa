const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = function loadTypeScript(module, fileName) {
  const source = fs.readFileSync(fileName, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName,
  }).outputText;
  module._compile(output, fileName);
};

const state = {};
global.chrome = {
  runtime: { getURL: (file) => 'test-extension://' + file },
  storage: {
    local: {
      async get(keys) {
        const names = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || state);
        return Object.fromEntries(names.map((key) => [key, state[key]]));
      },
      async set(values) { Object.assign(state, values); },
    },
  },
};
global.fetch = async (url) => ({
  ok: true,
  text: async () => fs.readFileSync(path.join(__dirname, '..', 'public', url.split('://')[1]), 'utf8'),
});
global.crypto = require('node:crypto').webcrypto;

const { parseYaml, stringifyYaml } = require('../src/lib/yaml.ts');
const {
  loadProfiles, saveProfileYaml, loadProfileYaml, createProfile, duplicateProfile,
  getProfileEntryDate, withEntryDate, parseStayDaysFromYaml, deleteProfile, setActiveProfileId,
  isVisaCompleted, withVisaCompleted, exportProfileYaml, exportProfilesYaml, parseProfilesYaml, importProfilesYaml,
} = require('../src/lib/profile-storage.ts');

async function run() {
  const sample = {
    personal_information: { surname: 'TEST', given_name: 'ONE', date_of_birth: '12/05/1988', sex: 'Female' },
    passport_information: { number: 'A0001234', date_of_issue: '12/03/2023' },
    trip_information: { intended_entry_date: '10/01/2027', length_of_stay_days: '20', residential_address: 'Hotel: "Test" #1' },
    requested_information: { entry_type: 'single' },
    accompanying_children: [{ full_name: 'CHILD ONE', sex: 'Female', date_of_birth: '12/01/2021' }],
    vietnam_visits_last_year: [
      { from_date: '01/01/2026', to_date: '02/01/2026', purpose: 'Holiday' },
    ],
    personal_flags: ['Long text: with a colon', 'quoted "text"', 'hash # symbol'],
  };
  const yaml = stringifyYaml(sample);
  assert.deepEqual(parseYaml(yaml), sample, 'YAML round trip with arrays and special characters');

  state.profileYaml = yaml; // existing installations migrate the single-profile record
  let list = await loadProfiles();
  assert.equal(list.length, 1);
  assert.equal(list[0].yaml, yaml, 'Original YAML is migrated intact');
  assert.equal(state.profileYaml, yaml, 'Legacy profile remains as backup');
  const originalId = list[0].id;

  assert.equal(getProfileEntryDate(yaml), '2027-01-10');
  assert.equal(parseStayDaysFromYaml(yaml), 20);
  const shifted = withEntryDate(yaml, '2027-01-12');
  const updated = parseYaml(shifted);
  assert.equal(updated.trip_information.intended_entry_date, '12/01/2027');
  assert.equal(updated.requested_information.valid_to, '31/01/2027');

  const second = await duplicateProfile(yaml);
  list = await loadProfiles();
  assert.equal(list.length, 2);
  assert.equal(parseYaml(second.yaml).personal_information.surname, 'TEST');
  assert.equal(parseYaml(second.yaml).personal_information.given_name, '');
  assert.equal(parseYaml(second.yaml).passport_information.number, '');
  assert.deepEqual(parseYaml(second.yaml).accompanying_children, []);
  assert.equal(parseYaml(second.yaml).trip_information.residential_address, 'Hotel: "Test" #1');

  await saveProfileYaml(shifted, second.id);
  assert.equal(await loadProfileYaml(originalId), yaml, 'Editing one person does not overwrite another');
  assert.equal(await loadProfileYaml(second.id), shifted);
  await setActiveProfileId(originalId);
  assert.equal(await loadProfileYaml(), yaml, 'Active person selects the default YAML');

  const blank = await createProfile();
  assert.equal((await loadProfiles()).length, 3);
  assert.equal(parseYaml(blank.yaml).personal_information.surname, '');
  await deleteProfile(second.id);
  assert.equal((await loadProfiles()).length, 2);

  assert.equal(isVisaCompleted(yaml), false, 'Old profiles without a flag default to not done');
  const done = withVisaCompleted(yaml, true);
  assert.equal(isVisaCompleted(done), true);
  assert.equal(parseYaml(done).passport_information.number, 'A0001234');
  assert.equal(isVisaCompleted(withVisaCompleted(done, false)), false);
  await saveProfileYaml(done, originalId);

  const freshDuplicate = await duplicateProfile(done);
  assert.equal(isVisaCompleted(freshDuplicate.yaml), false, 'Duplicating a completed visa resets its checklist');
  await deleteProfile(freshDuplicate.id);

  const backup = exportProfilesYaml(await loadProfiles());
  assert.equal((backup.match(/^---$/gm) || []).length, 2, 'One YAML document per applicant');
  assert.equal(parseProfilesYaml(backup).length, 2);
  assert.equal(isVisaCompleted(exportProfileYaml({ id: 'test', label: 'Saved label', yaml: done })), true);
  const backupContents = parseProfilesYaml(backup);
  assert.equal(backupContents[0].applicant_metadata.visa_completed, true);
  assert.equal(backupContents[0].applicant_metadata.label, 'Applicant 1');

  const importResult = await importProfilesYaml(backup);
  assert.equal(importResult.length, 2);
  assert.equal((await loadProfiles()).length, 4, 'Import appends and preserves existing profiles');
  assert.equal(isVisaCompleted(importResult[0].yaml), true, 'Completion survives export/import');
  assert.equal((await loadProfiles())[0].id, originalId, 'Old profile not overwritten');
  assert.equal(importResult[0].label, 'Applicant 1', 'Original internal label survives backup');

  // Neither a nested key nor a quoted substring is a document boundary.
  const extra = { ...sample, occupation: { occupation_info: 'Text mentioning personal_information: in a value' } };
  const customYaml = stringifyYaml(extra);
  const mixed = customYaml + '\n---\n' + stringifyYaml({ ...extra, personal_information: { surname: 'SECOND' }, applicant_metadata: { visa_completed: false } });
  assert.equal(parseProfilesYaml(mixed).length, 2);

  const previous = (await loadProfiles()).length;
  await assert.rejects(
    () => importProfilesYaml(backup + '\n---\npassport_information:\n  number: "MISSING_PERSONAL"'),
    /Applicant 3/,
  );
  assert.equal((await loadProfiles()).length, previous, 'Invalid batch leaves storage unchanged');
  assert.equal(parseProfilesYaml('\uFEFF' + backup).length, 2, 'UTF-8 BOM is supported');
  console.log('Profile migration, YAML multi-document import/export, atomic rollback and completion flags: PASS');
}
run().catch((err) => { console.error(err); process.exitCode = 1; });
