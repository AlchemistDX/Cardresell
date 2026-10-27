#!/usr/bin/env python3
"""Build immutable, identity-only English paper catalogs from pinned Scryfall JSONL.

Use --offline with a dated cache to reproduce a release without any network call.
The active pointer is replaced last, after all assets and audit records are ready.
"""
import argparse
import datetime
import gzip
import hashlib
import json
import os
import pathlib
import re
import tempfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
UA = 'CardResell-Catalog/1.0 (+https://www.cardresell.org)'
UUID = re.compile(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}')
SHARD_SIZE = 8500


def encoded(value, pretty=False):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode() if pretty else json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def atomic_write(path, body):
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        pathlib.Path(name).unlink(missing_ok=True)


def validate_metadata(meta):
    if not isinstance(meta, dict) or meta.get('type') != 'default_cards' or not re.fullmatch(r'https://data\.scryfall\.io/default-cards/default-cards-\d{14}\.jsonl\.gz', meta.get('jsonl_download_uri', '')):
        raise ValueError('Unsupported Scryfall bulk metadata')
    datetime.datetime.fromisoformat(meta['updated_at'])
    return meta


def source(cache, offline=False):
    cache.mkdir(parents=True, exist_ok=True)
    filename = cache / 'scryfall-default-cards.jsonl.gz'
    metadata_file = cache / 'scryfall-default-cards-meta.json'
    if filename.exists() or metadata_file.exists():
        if not filename.exists() or not metadata_file.exists():
            raise ValueError('Incomplete pinned source cache; use a fresh cache')
        return filename, validate_metadata(json.loads(metadata_file.read_text()))
    if offline:
        raise ValueError('Offline rebuild requires a complete pinned source cache')
    req = urllib.request.Request('https://api.scryfall.com/bulk-data/default-cards', headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=40) as response:
        meta = validate_metadata(json.load(response))
    fd, name = tempfile.mkstemp(prefix='.scryfall-download-', dir=cache)
    try:
        req = urllib.request.Request(meta['jsonl_download_uri'], headers={'User-Agent': UA, 'Accept': 'application/gzip'})
        with urllib.request.urlopen(req, timeout=60) as response, os.fdopen(fd, 'wb') as stream:
            while block := response.read(1024 * 1024):
                stream.write(block)
        # Check gzip CRC/trailer before publishing either cache component.
        with gzip.open(name, 'rb') as stream:
            while stream.read(1024 * 1024):
                pass
        with open(name, 'rb') as stream:
            meta['sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
        os.replace(name, filename)
        atomic_write(metadata_file, encoded(meta, True))
    finally:
        pathlib.Path(name).unlink(missing_ok=True)
    return filename, meta


def required_text(value):
    return isinstance(value, str) and bool(value.strip())


def parse_source(filename, minimum_cards=100000, minimum_sets=700):
    ids, seen, sets, rows, skipped = set(), set(), {}, [], {}
    with gzip.open(filename, 'rt', encoding='utf-8') as stream:
        for line in stream:
            if not line.strip():
                continue
            card = json.loads(line)
            if not isinstance(card, dict) or card.get('object') != 'card' or not isinstance(card.get('id'), str) or not UUID.fullmatch(card['id']) or card['id'] in seen:
                raise ValueError('Invalid or duplicate Scryfall card identity')
            seen.add(card['id'])
            if not required_text(card.get('lang')) or not isinstance(card.get('games'), list) or any(not isinstance(g, str) for g in card['games']):
                raise ValueError('Invalid language or game metadata')
            if card['lang'] != 'en' or 'paper' not in card['games']:
                skipped['nonEnglishOrNonPaper'] = skipped.get('nonEnglishOrNonPaper', 0) + 1
                continue
            uid, name, code, number = (card.get(k) for k in ('id', 'name', 'set', 'collector_number'))
            if not all(required_text(v) for v in (name, code, number, card.get('set_name'))) or not re.fullmatch(r'[a-z0-9]+', code):
                raise ValueError('Missing printing name, set or collector number')
            set_name = card['set_name']
            if code in sets and sets[code] != set_name:
                raise ValueError('Conflicting set label ' + code)
            faces = card.get('card_faces', [])
            if not isinstance(faces, list) or any(not isinstance(f, dict) or not required_text(f.get('name')) for f in faces):
                raise ValueError('Invalid face aliases')
            images = card.get('image_uris') or (faces[0].get('image_uris') if faces else {}) or {}
            if not isinstance(images, dict) or not isinstance(images.get('small', ''), str):
                raise ValueError('Invalid image metadata')
            aliases = list(dict.fromkeys(f['name'] for f in faces if f['name'] != name))
            sets[code] = set_name
            ids.add(uid)
            rows.append([uid, name, code, number, card.get('rarity', ''), images.get('small', ''), 'en', card.get('released_at', ''), False, aliases])
    if len(rows) < minimum_cards or len(sets) < minimum_sets:
        raise ValueError('Truncated Scryfall snapshot')
    rows.sort(key=lambda row: (row[1].casefold(), row[2], row[3], row[0]))
    return rows, sets, ids, skipped


def asset(root, url, prefix):
    if not isinstance(url, str) or not re.fullmatch(r'/data/catalog/' + prefix + r'\.[a-f0-9]{12}\.json', url):
        raise ValueError('Invalid immutable asset URL')
    body = (root / url.lstrip('/')).read_bytes()
    if hashlib.sha256(body).hexdigest()[:12] != url.split('.')[-2]:
        raise ValueError('Immutable asset hash mismatch: ' + url)
    return json.loads(body)


def previous_ids(root, meta):
    if not meta:
        return set()
    data = asset(root, meta['url'], 'mtg')
    if data.get('schema') != 1 or data.get('game') != 'mtg' or not isinstance(data.get('cards'), list):
        raise ValueError('Invalid previous Magic index')
    rows = list(data['cards'])
    parts = meta.get('parts', [])
    if parts:
        if data.get('parts') != parts or rows or len({p['url'] for p in parts}) != len(parts):
            raise ValueError('Invalid previous shard inventory')
        for part in parts:
            shard = asset(root, part['url'], 'mtg-part')
            if shard.get('schema') != 1 or shard.get('game') != 'mtg' or not isinstance(shard.get('cards'), list) or len(shard['cards']) != part['count']:
                raise ValueError('Incomplete previous Magic shard')
            rows.extend(shard['cards'])
    if len(rows) != meta['count'] or not isinstance(data.get('sets'), dict):
        raise ValueError('Incomplete previous Magic catalog')
    ids, represented = set(), set()
    for row in rows:
        if not isinstance(row, list) or len(row) != 10 or not isinstance(row[0], str) or not UUID.fullmatch(row[0]) or row[0] in ids or row[6] != 'en' or row[2] not in data['sets'] or not required_text(row[3]):
            raise ValueError('Invalid previous Magic identity')
        ids.add(row[0])
        represented.add(row[2])
    if len(represented) != meta['sets'] or set(data['sets']) != represented:
        raise ValueError('Invalid previous Magic set count')
    return ids


def build(root, filename, meta, allow_removals=False, expected_sha=None, minimum_cards=100000, minimum_sets=700):
    validate_metadata(meta)
    directory = root / 'data' / 'catalog'
    current, coverage_path, audit_path = (directory / name for name in ('current.json', 'coverage.json', 'magic-audit.json'))
    before = {p: p.read_bytes() if p.exists() else None for p in (current, coverage_path, audit_path)}
    old = json.loads(before[current])
    audit = json.loads(before[audit_path]) if before[audit_path] else {}
    with filename.open('rb') as stream:
        rawhash = hashlib.file_digest(stream, 'sha256').hexdigest()
    expected = [expected_sha, meta.get('sha256')]
    if audit.get('sourceDate') == meta['updated_at']:
        expected.append(audit.get('sha256'))
    if any(h and h != rawhash for h in expected):
        raise ValueError('Pinned source hash mismatch')
    rows, sets, ids, skipped = parse_source(filename, minimum_cards, minimum_sets)
    dropped = sorted(previous_ids(root, old['games'].get('mtg')) - ids)
    if dropped and not allow_removals:
        raise ValueError(f'Review {len(dropped)} removed IDs before publication')
    parts, payloads = [], {}
    for offset in range(0, len(rows), SHARD_SIZE):
        batch = rows[offset:offset + SHARD_SIZE]
        body = encoded({'schema': 1, 'game': 'mtg', 'cards': batch})
        name = 'mtg-part.' + hashlib.sha256(body).hexdigest()[:12] + '.json'
        parts.append({'url': '/data/catalog/' + name, 'count': len(batch)})
        payloads[directory / name] = body
    data = {'schema': 1, 'game': 'mtg', 'asOf': meta['updated_at'][:10], 'provider': 'Scryfall', 'sets': sets, 'cards': [], 'parts': parts}
    output = encoded(data)
    target = directory / ('mtg.' + hashlib.sha256(output).hexdigest()[:12] + '.json')
    payloads[target] = output
    new = json.loads(before[current])
    new['games']['mtg'] = {'url': '/data/catalog/' + target.name, 'count': len(rows), 'provider': 'Scryfall', 'sets': len(sets), 'nativeCount': 0, 'parts': parts}
    new['asOf'] = max(new['asOf'], meta['updated_at'][:10])
    manifest = encoded(new)
    mp = directory / ('manifest.' + hashlib.sha256(manifest).hexdigest()[:12] + '.json')
    payloads[mp] = manifest
    coverage = json.loads(before[coverage_path])
    coverage['games']['mtg'] = {'provider': 'Scryfall default_cards JSONL', 'scope': 'Every English paper printing in the dated Scryfall default_cards snapshot; no prices or identity inference.', 'searchable_records': len(rows), 'represented_sets': len(sets), 'asset_sha256': hashlib.sha256(output).hexdigest(), 'source_sha256': rawhash, 'source_updated_at': meta['updated_at'], 'excluded': skipped, 'missing_images': sum(not c[5] for c in rows), 'reviewed_removed_ids': dropped, 'parts': parts}
    report = {'game': 'mtg', 'cards': len(rows), 'sets': len(sets), 'sourceDate': meta['updated_at'], 'sourceUrl': meta['jsonl_download_uri'], 'sha256': rawhash, 'excluded': skipped, 'invalid': 0, 'catalog': target.name, 'manifest': mp.name, 'shards': len(parts), 'unpriced': True}
    # Validate every immutable destination before publishing any artifact.
    for path, body in payloads.items():
        if path.exists() and path.read_bytes() != body:
            raise ValueError('Immutable catalog collision: ' + path.name)
    for path, body in payloads.items():
        if not path.exists():
            atomic_write(path, body)
    if any((p.read_bytes() if p.exists() else None) != value for p, value in before.items()):
        raise ValueError('Catalog changed during build; retry from the new baseline')
    try:
        atomic_write(coverage_path, encoded(coverage, True))
        atomic_write(audit_path, encoded(report, True))
        atomic_write(current, manifest)
    except BaseException:
        for path in (coverage_path, audit_path):
            if before[path] is None:
                path.unlink(missing_ok=True)
            else:
                atomic_write(path, before[path])
        raise
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=pathlib.Path, required=True)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--output-root', type=pathlib.Path, default=ROOT)
    parser.add_argument('--allow-removals', action='store_true')
    parser.add_argument('--expected-source-sha256')
    args = parser.parse_args()
    filename, meta = source(args.cache, args.offline)
    print(json.dumps(build(args.output_root, filename, meta, args.allow_removals, args.expected_source_sha256), indent=2))


if __name__ == '__main__':
    main()
