#!/usr/bin/env python3
"""Exercise the actual importer, publication ordering, corruption and reproducibility."""
import copy
import gzip
import hashlib
import importlib.util
import json
import pathlib
import tempfile
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('magic_builder', ROOT / 'tools/build-magic-catalog.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
META = {'type': 'default_cards', 'updated_at': '2026-10-26T21:05:59.438+00:00', 'jsonl_download_uri': 'https://data.scryfall.io/default-cards/default-cards-20261026210559.jsonl.gz'}

def card(n):
    return {'object': 'card', 'id': f'00000000-0000-4000-8000-{n:012d}', 'name': 'Sol Ring', 'set': 'cmd', 'set_name': 'Commander', 'collector_number': str(n), 'lang': 'en', 'games': ['paper'], 'card_faces': [{'name': 'Alternate face'}]}

passed = 0

def check(name, fn):
    global passed
    fn()
    passed += 1
    print('PASS ' + name)


def rejects(fn):
    try:
        fn()
    except (ValueError, KeyError, EOFError, OSError, TypeError):
        return
    raise AssertionError('expected rejection')

with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp)
    directory = root / 'data/catalog'
    directory.mkdir(parents=True)
    (directory / 'current.json').write_text(json.dumps({'schema': 1, 'asOf': '2026-10-26', 'games': {}}))
    (directory / 'coverage.json').write_text(json.dumps({'games': {}}))
    filename = root / 'source.gz'
    def write_source(records):
        filename.write_bytes(gzip.compress(('\n'.join(json.dumps(c) for c in records) + '\n').encode(), mtime=0))
    def run(meta=META, **kw):
        return builder.build(root, filename, meta, minimum_cards=1, minimum_sets=1, **kw)
    def snapshot():
        return {p.name: p.read_bytes() for p in directory.iterdir() if p.is_file()}
    write_source([card(1), card(2)])
    events = []
    original_write = builder.atomic_write
    def track(path, body):
        events.append(path.name)
        original_write(path, body)
    with patch.object(builder, 'atomic_write', track):
        report = run()
    assert events[-3:] == ['coverage.json', 'magic-audit.json', 'current.json']
    check('active manifest switches after both audit records', lambda: None)
    before = snapshot()
    run()
    assert snapshot() == before
    check('two builds produce identical bytes and immutable names', lambda: None)
    check('normal production count floor rejects tiny snapshot', lambda: rejects(lambda: builder.parse_source(filename)))
    check('explicit source checksum mismatch rejected', lambda: rejects(lambda: run(expected_sha='0' * 64)))
    # Same-date cache tampering must fail before publication.
    write_source([card(1)])
    check('pinned audit hash detects changed dated source', lambda: rejects(run))
    assert snapshot() == before
    later = dict(META, updated_at='2026-10-27T00:00:00+00:00')
    check('removed identity requires review', lambda: rejects(lambda: run(later)))
    assert snapshot() == before
    run(later, allow_removals=True)
    assert json.loads((directory / 'coverage.json').read_text())['games']['mtg']['reviewed_removed_ids'] == [card(2)['id']]
    check('approved removals are explicitly recorded', lambda: None)
    # Restore the first release for corruption and write-failure checks.
    for name, body in before.items():
        (directory / name).write_bytes(body)
    write_source([card(1), card(2)])
    part = json.loads((directory / 'current.json').read_text())['games']['mtg']['parts'][0]['url'].split('/')[-1]
    original = (directory / part).read_bytes()
    (directory / part).write_bytes(original.replace(b'Sol Ring', b'Bad Ring'))
    check('previous shard checksum validated', lambda: rejects(run))
    (directory / part).write_bytes(original)
    (directory / part).unlink()
    check('missing previous shard blocks publication', lambda: rejects(run))
    (directory / part).write_bytes(original)
    before_failure = snapshot()
    def fail_pointer(path, body):
        if path.name == 'current.json':
            raise OSError('simulated publication failure')
        original_write(path, body)
    with patch.object(builder, 'atomic_write', fail_pointer):
        check('failed pointer write rolls audit records back', lambda: rejects(run))
    assert snapshot() == before_failure
    malformed = [
        ('non-card payload', lambda rows: rows[0].update(object='error')),
        ('malformed UUID', lambda rows: rows[0].update(id='-' * 36)),
        ('duplicate UUID', lambda rows: rows.append(copy.deepcopy(rows[0]))),
        ('missing set name', lambda rows: rows[0].pop('set_name')),
        ('empty collector number', lambda rows: rows[0].update(collector_number='')),
        ('numeric collector number', lambda rows: rows[0].update(collector_number=1)),
        ('invalid games metadata', lambda rows: rows[0].update(games='paper')),
        ('conflicting set labels', lambda rows: rows[1].update(set_name='Different set')),
        ('empty face alias', lambda rows: rows[0].update(card_faces=[{'name': ' '}]))]
    for name, mutate in malformed:
        rows = [card(1), card(2)]
        mutate(rows)
        write_source(rows)
        check('reject ' + name, lambda: rejects(lambda: builder.parse_source(filename, 1, 1)))
    rows = [card(1), dict(card(2), lang='ja'), dict(card(3), games=['arena'])]
    write_source(rows)
    parsed = builder.parse_source(filename, 1, 1)
    assert len(parsed[0]) == 1 and parsed[3] == {'nonEnglishOrNonPaper': 2}
    check('foreign-language and digital records are counted exclusions', lambda: None)
    filename.write_bytes(filename.read_bytes()[:-8])
    check('truncated gzip trailer rejected', lambda: rejects(lambda: builder.parse_source(filename, 1, 1)))
    cache = root / 'cache'
    cache.mkdir()
    (cache / 'scryfall-default-cards.jsonl.gz').write_bytes(b'incomplete')
    check('incomplete cache rejected', lambda: rejects(lambda: builder.source(cache, True)))
    write_source([card(1)])
    (cache / 'scryfall-default-cards.jsonl.gz').write_bytes(filename.read_bytes())
    (cache / 'scryfall-default-cards-meta.json').write_text(json.dumps(META))
    with patch.object(builder.urllib.request, 'urlopen', side_effect=AssertionError('unexpected network')):
        builder.source(cache, True)
    check('pinned cache rebuild makes no network requests', lambda: None)
    rows = [card(n) for n in range(1, 8502)]
    write_source(rows)
    run(later)
    manifest = json.loads((directory / 'current.json').read_text())
    assert [p['count'] for p in manifest['games']['mtg']['parts']] == [8500, 1]
    check('sharding obeys the 8500-record bound', lambda: None)

# Validate the full release when its assets are present.
directory = ROOT / 'data/catalog'
if directory.exists():
    manifest = json.loads((directory / 'current.json').read_text())
    meta = manifest['games']['mtg']
    identities = builder.previous_ids(ROOT, meta)
    assert len(meta['parts']) == 13 and len(identities) == meta['count'] == 107402
    assert meta['sets'] == 967
    audit = json.loads((directory / 'magic-audit.json').read_text())
    assert audit['catalog'] == meta['url'].split('/')[-1]
    assert (directory / audit['manifest']).read_bytes() == (directory / 'current.json').read_bytes()
    check('release contains 13 complete hashed shards and 107402 unique printings', lambda: None)
print(f'magic-build-invariants: {passed} passed, 0 failed -- SUITE COMPLETE, exit=0')
