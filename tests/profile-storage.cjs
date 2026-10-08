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

  console.log('Profile migration, YAML round trip, duplicate, isolation and travel dates: PASS');
}
run().catch((err) => { console.error(err); process.exitCode = 1; });
