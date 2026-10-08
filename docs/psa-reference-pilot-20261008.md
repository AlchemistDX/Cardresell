# PSA reference pilot — start before submission returns

Four official certificate records and eight front/back source images were
retrieved and visually checked on October 8, 2026. Each front/back label matches
the linked certificate. Source images are 1140 px wide, approximately 1900 px
high. The 380 px thumbnails were rejected in favor of the larger public images.

| Sample | Card | PSA grade | Certificate |
|---|---|---:|---|
| R01 | 1999 Base Bulbasaur #44 | 10 | [85267142](https://www.psacard.com/en-CA/cert/85267142/psa) |
| R02 | 1996 Japanese Basic Pikachu #25 | 9 | [148380808](https://www.psacard.com/cert/148380808/psa) |
| R03 | 1999 Jungle Nidoqueen holo #7, 1st Edition | 8 | [83901498](https://www.psacard.com/en-CA/cert/83901498/psa) |
| R04 | 1999 Base Mewtwo holo #10 | 6 | [107900940](https://www.psacard.com/cert/107900940/psa) |

This is a deliberately small development pilot. It is not held-out validation,
not representative of modern/full-art/Magic/sports cards, and does not justify
an accuracy percentage. All inputs remain marked **slabbed**. Cropping the label
does not turn a through-plastic image into a raw-card photograph.

## Prepared inputs

`benchmarks/psa-reference-pilot-20261008.json` records primary-source URLs,
certificate grades, original SHA-256 hashes, dimensions and reviewed crop
coordinates. The preparer validates every source before exporting any input.
It removes only the top 440 rows of each photograph: grade, certificate number,
barcode and QR are excluded on both faces. The whole card and surrounding holder
remain. Output is lossless PNG at original scale; no sharpening, upscaling,
reconstruction or invented edge photographs. Originals and photos are not
committed to the application or published as guide examples.

The model-facing `inputs.json` contains anonymous sample IDs and photo paths /
hashes. It excludes card names, expected grades, certs and source URLs. The answer
key stays in the source manifest. All four cards are development samples; once
used for adjustment, they must never count as independent validation.

Recreate locally with the pinned public URLs (Python standard library):

```sh
python - <<'PY'
import json, pathlib, urllib.request, hashlib
root = pathlib.Path('/tmp/cardresell-psa-pilot')
root.mkdir(exist_ok=True)
m = json.loads(pathlib.Path('benchmarks/psa-reference-pilot-20261008.json').read_text())
for row in m['records']:
    for side, image in row['images'].items():
        data = urllib.request.urlopen(image['url'], timeout=30).read()
        assert hashlib.sha256(data).hexdigest() == image['sha256'], 'Source changed'
        (root / (row['sample_id'] + '-' + side + '-large.jpg')).write_bytes(data)
PY
node tools/prepare-grade-reference-pilot.mjs benchmarks/psa-reference-pilot-20261008.json /tmp/cardresell-psa-pilot /tmp/cardresell-psa-pilot/blind
node tools/check-grade-reference-pilot.mjs /tmp/cardresell-psa-pilot/blind gpt-6.1-sol
```

Preparer needs the development-only `sharp` package. It is not added to the
production bundle. The prompt preflight uses `buildVisionContent` and
`requestBody` from the existing model evaluator, which reads the shipped prompt.
It uses correct PNG MIME types, passes only front/back images, and makes zero
provider requests. Model name is an explicit input; production environment
selection is not inferred from this command.

## Status and interpretation

Inputs prepared and prompt preflight passed for all four cards. **No grading
inference has run and no accuracy result exists.** OPENAI_API_KEY and
XIMILAR_API_KEY are unavailable in the current execution environment. Customer
balances and production accounts were not used. No live grading rule changed.

Current production grading rules cap a through-plastic estimate below 10. An
unreturned 10 on the PSA-10 reference is therefore partly policy-constrained,
not by itself evidence of poor visual recognition. Keep that policy visible in
results; do not remove it just to increase agreement on slab pictures. A direct
language-model evaluator also excludes the CV service and server reconciliation,
so its result must never be called the app's end-to-end result.

Next evaluation should preserve every attempted result and separate:

- Visible-defect findings, centering and clean/worn ordering on these references.
- Through-plastic limitations and policy-limited outputs.
- Repeated raw phone captures, to assess repeatability and photo-quality effects.
- Shop assessments obtained before revealing the app output.
- Future certified raw-photo results, when available.

Broaden the reference set across games, grades and printing styles, then reserve
new physical cards for an untouched test set. Existing raw phone photos and shop
feedback can guide work now; waiting for PSA returns is not a prerequisite.
