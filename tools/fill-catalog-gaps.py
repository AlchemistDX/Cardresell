#!/usr/bin/env python3
"""Add verified printing records and raw-image hashes; never publish automatically.

Uses canonical provider IDs, every result page and unique=prints for Magic.
Existing records are immutable. Downloads/checkpoints are resumable. Metadata
and image failures are reported, never turned into invented catalog records.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image
from seed_set import phash, dhash

ROOT = Path(__file__).resolve().parents[1]
UA = 'CardResell-Catalog/1.0 (+https://cardresell.org)'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url, cache):
    path = cache / digest(url.encode())
    if path.exists():
        return path.read_bytes()
    error = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'})
            with urllib.request.urlopen(req, timeout=20) as response:
                data = response.read()
            path.write_bytes(data)
            return data
        except (OSError, urllib.error.URLError) as exc:
            error = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code not in (429, 500, 502, 503, 504):
                break
            time.sleep(min(4, 0.5 * 2 ** attempt))
    raise RuntimeError(f'{url}: {error}')


def catalog(game, sid, cutoff, cache):
    base = 'https://api.scryfall.com' if game == 'mtg' else 'https://api.pokemontcg.io/v2'
    meta = json.loads(fetch(f'{base}/sets/{sid}', cache))
    if game == 'pokemon':
        meta = meta['data']
    released = str(meta.get('released_at') or meta.get('releaseDate') or '').replace('/', '-')
    if not released or released > cutoff or meta.get('digital'):
        raise ValueError(f'{sid}: not a verified released physical set')
    cards, urls, seen_pages = [], [], set()
    page = 1
    if game == 'mtg':
        query = urllib.parse.urlencode({'q': f'set:{sid} game:paper lang:en', 'unique': 'prints',
                                      'include_extras': 'true', 'include_variations': 'true', 'order': 'set'})
        url = f'{base}/cards/search?{query}'
    else:
        url = f'{base}/cards?q=set.id:{sid}&pageSize=250&page={page}&select=id,name,number,rarity,images,set'
    while url:
        if url in seen_pages or len(seen_pages) >= 100:
            raise ValueError('Invalid catalog pagination')
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != 'https' or parsed.netloc != urllib.parse.urlparse(base).netloc:
            raise ValueError('Unexpected catalog page host')
        seen_pages.add(url)
        time.sleep(0.12)  # Scryfall requests stay below ten per second.
        data = fetch(url, cache)
        doc = json.loads(data)
        chunk = doc.get('data')
        if not isinstance(chunk, list) or not chunk:
            raise ValueError(f'{sid}: empty or malformed page')
        urls.append({'url': url, 'sha256': digest(data)})
        cards.extend(chunk)
        if game == 'mtg':
            url = doc.get('next_page') if doc.get('has_more') else None
            if doc.get('has_more') and not url:
                raise ValueError('Missing next page')
        else:
            if len(cards) >= doc['totalCount']:
                url = None
            else:
                page += 1
                url = f'{base}/cards?q=set.id:{sid}&pageSize=250&page={page}&select=id,name,number,rarity,images,set'
    if len({c['id'] for c in cards}) != len(cards):
        raise ValueError(f'{sid}: duplicate provider IDs')
    expected = doc.get('total_cards') if game == 'mtg' else doc.get('totalCount')
    if expected != len(cards):
        raise ValueError(f'{sid}: incomplete response {len(cards)}/{expected}')
    meta['_source_query_count'] = len(cards)
    meta['_excluded_future_printings'] = []
    if game == 'mtg':
        meta['_excluded_future_printings'] = [c['id'] for c in cards if not c.get('released_at') or c['released_at'] > cutoff]
        cards = [c for c in cards if c.get('released_at') and c['released_at'] <= cutoff]
    return meta, cards, urls


def record(game, sid, meta, card, cache, cutoff=None):
    actual_set = card.get('set') if game == 'mtg' else (card.get('set') or {}).get('id')
    if actual_set != sid or not card.get('name'):
        raise ValueError('Missing name or conflicting set')
    if game == 'mtg':
        if card.get('lang') != 'en' or card.get('digital') or 'paper' not in card.get('games', []):
            raise ValueError('Not an English paper printing')
        if cutoff and (not card.get('released_at') or card['released_at'] > cutoff):
            raise ValueError('Printing has not been released')
        number = card.get('collector_number')
        images = card.get('image_uris') or (card.get('card_faces') or [{}])[0].get('image_uris') or {}
        urls = [images.get('normal'), images.get('large')]
    else:
        number = card.get('number')
        urls = [(card.get('images') or {}).get('large'), (card.get('images') or {}).get('small')]
    urls = list(dict.fromkeys(u for u in urls if u and u.startswith('https://')))
    if not isinstance(number, str) or not number or not urls:
        raise ValueError('Missing printed number or source image')
    error = None
    for url in urls:
        try:
            image = fetch(url, cache)
            break
        except RuntimeError as exc:
            error = exc
    else:
        raise error
    with Image.open(io.BytesIO(image)) as im:
        if min(im.size) < 100:
            raise ValueError('Source image too small')
        im.verify()
    result = {'id': card['id'], 'n': card['name'], 's': meta['name'], 'si': sid,
              'sc': (sid.upper() if game == 'mtg' else meta.get('ptcgoCode') or sid.upper()),
              'nu': number, 'r': card.get('rarity') or '', 'p': phash(image), 'd': dhash(image),
              'i': url, 'g': game, 'lang': 'en'}
    if game == 'mtg':
        result['y'] = card['released_at'][:4]
    return result


def write_json(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')))
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pokemon', nargs='*', default=[])
    parser.add_argument('--mtg', nargs='*', default=[])
    parser.add_argument('--as-of', required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--image-workers', type=int, choices=range(1, 17), default=4)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    reports = []
    for game, sets, filename in [('pokemon', args.pokemon, 'card-index.json'), ('mtg', args.mtg, 'mtg-index.json')]:
        path = ROOT / filename
        index = json.loads(path.read_text())
        ids = {c['id'] for c in index}
        if len(ids) != len(index):
            raise ValueError('Existing index contains duplicate IDs')
        for sid in sets:
            if not re.fullmatch('[a-z0-9]+', sid):
                raise ValueError('Invalid set code')
            item = {'game': game, 'set': sid, 'added': 0, 'failed': []}
            print(f'{game}/{sid}: fetching canonical metadata and all result pages', flush=True)
            try:
                meta, cards, sources = catalog(game, sid, args.as_of, args.cache)
                item.update(name=meta['name'], provider_cards=len(cards), sources=sources,
                            source_query_count=meta['_source_query_count'],
                            excluded_future_printings=meta['_excluded_future_printings'])
                todo = [c for c in cards if c['id'] not in ids]
                item['already_present'] = len(cards) - len(todo)
                print(f'{game}/{sid}: {len(todo)} missing of {len(cards)} provider printings', flush=True)
                def build(card):
                    try:
                        return record(game, sid, meta, card, args.cache, args.as_of), None
                    except Exception as exc:
                        return None, {'id': card['id'], 'reason': str(exc)}
                with ThreadPoolExecutor(max_workers=args.image_workers) as pool:
                    for result, failure in pool.map(build, todo):
                        if failure:
                            item['failed'].append(failure)
                        else:
                            index.append(result)
                            ids.add(result['id'])
                            item['added'] += 1
                            if item['added'] % 100 == 0:
                                write_json(path, index)
                                print(f'{game}/{sid}: added {item["added"]}', flush=True)
                write_json(path, index)
                item['covered_provider_cards'] = sum(c['id'] in ids for c in cards)
            except Exception as exc:
                item['error'] = str(exc)
            reports.append(item)
            write_json(args.report, {'as_of': args.as_of, 'sets': reports})
            print(json.dumps({k: v for k, v in item.items() if k != 'sources'}), flush=True)
    return int(any(s.get('error') or s['failed'] for s in reports))


if __name__ == '__main__':
    raise SystemExit(main())
