# Vietnam e-Visa Autofill

Local Chrome extension that fills individual Vietnam e-Visa applications for multiple travellers at `https://evisa.gov.vn/e-visa/foreigners` from locally saved YAML-backed applicant profiles.

Built with **TypeScript**, **React**, **Tailwind CSS**, and **shadcn/ui**.  
Licensed under the [MIT License](LICENSE) — free to use, modify, and share.

## Introduction

https://github.com/user-attachments/assets/b2c6c722-96b1-4644-b7ee-b675ce845e49

**[▶ Watch demo video](https://isaaclee.xyz/2026-05-27-vietnam-e-visa-autofill/vietnam-e-visa-autofiller.mp4)**

## Install (recommended — GitHub Release)

The easiest way to install without building from source:

1. Open the [Releases](https://github.com/entttom/vietnam-e-visa/releases) page
2. Download the latest **`vietnam-e-visa-v*.zip`** asset
3. Unzip the file — you should see `manifest.json`, `icons/`, `assets/`, etc. at the top level
4. Open Chrome → `chrome://extensions`
5. Enable **Developer mode** (top right)
6. Click **Load unpacked**
7. Select the **unzipped folder** (the one that contains `manifest.json`)

To update later, download the new release zip, remove the old unpacked folder, and load the new one (or replace files and click **Reload** on the extension card).

> **Version note:** Release zip names follow `package.json` version (e.g. `vietnam-e-visa-v1.0.0.zip`). Bump `"version"` in `package.json` before pushing to main to publish a new release tag. Pushes to `main` automatically build and upload the zip via GitHub Actions.

## Install from source (developers)

```bash
git clone https://github.com/entttom/vietnam-e-visa.git
cd vietnam-e-visa
pnpm install
pnpm build
```

Then in Chrome → `chrome://extensions` → **Load unpacked** → select the **`dist`** folder inside the project.

**Important:** Do not load the project root. Only the unzipped release folder or `dist/` after a build contains the compiled extension. Loading the wrong folder causes a blank popup or manifest errors.

After code changes:

```bash
pnpm build
```

Click **Reload** on the extension in `chrome://extensions`.

### Publish a new release (maintainers)

```bash
# 1. Bump version in package.json (e.g. 1.0.0 → 1.0.1)
# 2. Push to main — GitHub Actions builds the zip and creates/updates the release
git push origin main

# Or manually:
pnpm release   # builds zip + gh release create/upload
```

## Development

```bash
pnpm dev
```

Vite watches source files and hot-reloads the extension. Load **`dist`** once in Chrome; after code changes, click **Reload** on the extension card.

Source layout:

| Path | Purpose |
|------|---------|
| `src/popup/` | Extension popup (entry date + Fill Form) |
| `src/editor/` | Profile YAML editor + instructions + LLM prompt |
| `src/content/` | Content script on evisa.gov.vn |
| `src/background/` | Service worker (script injection, dev reload) |
| `src/lib/` | YAML parser, form filler, profile storage |
| `public/` | Static assets (`profile.form.yaml`, icons, demo video) |

## Manage multiple applicants

1. Open **Manage applicants** from the Chrome extension popup (or open the extension Options).
2. Click **New person** to create an empty form, or **Duplicate** to copy the current applicant.
   Duplicating retains the shared itinerary, accommodation, address and contact details but clears
   the given name, date of birth, sex, ID card and passport details.
3. Enter the person's data using the grouped **form fields**, including repeatable passport,
   visit-history, nationality and accompanying-child sections. Click **Save applicant**.
4. Select the next applicant and repeat. Each person's data is stored in a separate YAML document
   within Chrome's local extension storage.
5. **Import YAML** at the top of **Applicant profiles** accepts single-person YAML files, multiple selected YAML files, or a combined YAML backup. It **adds** profiles without overwriting existing people.
6. **Export all** saves every applicant (including each completion status) into one YAML file. The advanced section still supports single-person YAML export and importing text into the currently selected person.

**Existing installations:** The previous single `profileYaml` entry is automatically migrated
into the new list of applicants the first time this version loads. The original single-profile
storage entry remains available as a local backup.

**Privacy:** All applicant records stay in your local Chrome extension storage. Profiles,
passport numbers, names and birth dates must **never** be committed to this public repository.
Exported YAML files contain personal data; handle backups carefully.

### Multiple applicant YAML backup format

Use the YAML standard document separator `---` on its **own line**, not another occurrence of `personal_information:` to detect a person:

```yaml
---
applicant_metadata:
  label: "Applicant A"
  visa_completed: true
personal_information:
  surname: "EXAMPLE"
  given_name: "PERSON A"
passport_information:
  number: "A12345678"
---
applicant_metadata:
  label: "Applicant B"
  visa_completed: false
personal_information:
  surname: "EXAMPLE"
  given_name: "PERSON B"
passport_information:
  number: "B12345678"
```

Each YAML document is an **independent person**, using the usual complete e-Visa schema.
The example above is illustrative (other fields are omitted). The import supports
individual profiles as before, and combined multi-document YAML files.
All documents are validated before adding anyone; importing never replaces
an existing applicant. A repeated import intentionally creates additional copies.
The `applicant_metadata.visa_completed` flag defaults to `false` in older profiles
and is also set to `false` when duplicating an applicant.

The popup checkbox **Visa application done** is a user-maintained checklist,
not proof of submission, approval, or visa issuance. The checkbox can be reset.
The actual Vietnamese e-Visa website is not updated by this setting.

### Travel date

The date is stored in each person's YAML as `trip_information.intended_entry_date`
(DD/MM/YYYY), alongside the corresponding requested visa validity. The popup now:

- Offers an **Applicant** dropdown.
- Reads that applicant's **Intended entry date** directly from YAML.
- Allows changing the date with a calendar control and saves the change back to that person's YAML.
- Displays the computed visa validity range from that person's `length_of_stay_days`.

### Fill a visa application

1. Log in to [evisa.gov.vn](https://evisa.gov.vn) and open the foreigners application form.
2. Dismiss the instruction modal manually and upload passport/portrait photos yourself.
3. Open the popup, choose the **correct applicant**, and check the entry date.
4. Click **Fill Form**. The extension fills only the selected person's details.
5. Carefully review every field and complete **Next** / final submission manually.
6. Start a new application for the next person; repeat from step 3.

The photo uploads and final submission are deliberately not automated.

### Dropdown labels

The extension loads official form choices from `data/select-options.yaml`. To refresh the
reference data locally, run:

```bash
pnpm run fetch-options
```

For older YAML files, the format still follows `profile.form.yaml`; dates are DD/MM/YYYY.
If an official dropdown has changed, refresh the options and rebuild the extension.

## What is filled

- Sections 1–6: Personal, Requested, Passport, Contact, Occupation, Trip
- Section 7: Accompanying children (if listed in YAML; photo upload skipped)
- Section 8: Trip expenses and insurance
- Declaration checkbox at the bottom

## What is NOT filled

- Portrait photography upload
- Passport data page image upload
- Child portrait uploads
- Instruction modal checkboxes
- **Next** / **Cancel** buttons

## Troubleshooting

- **"Could not connect"** — Reload the extension at `chrome://extensions`, then reopen the popup on the foreigners form page
- **Select option not found** — Check the label in your profile matches the dropdown text on the site
- **Debugging** — DevTools on the e-visa tab → Console, filter by `[Vietnam e-Visa]`
- **Ward/commune fails** — Ensure `province_city` is correct; ward options load after province is selected
- **Next button still disabled** — Upload photos and verify required fields manually

## License

MIT © [Isaac Chaneel Lee](https://github.com/gssisaac). See [LICENSE](LICENSE).
