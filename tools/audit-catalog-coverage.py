#!/usr/bin/env python3
"""Read-only coverage inventory; provider response is an explicit local input."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--mtg-sets', type=Path)
parser.add_argument('--pokemon-sets', type=Path)
parser.add_argument('--as-of', default='2026-10-08')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
report = {'as_of': args.as_of, 'scope': 'local image-hash indexes, not total searchable catalog', 'indexes': {}}
for game, filename in [('pokemon', 'card-index.json'), ('mtg', 'mtg-index.json')]:
    rows = json.loads((root / filename).read_text())
    codes = {row['si'].lower() for row in rows}
    report['indexes'][game] = {'rows': len(rows), 'unique_ids': len({row['id'] for row in rows}), 'represented_sets': len(codes)}
    if game == 'pokemon' and args.pokemon_sets:
        response = json.loads(args.pokemon_sets.read_text())
        sets = response.get('data', [])
        if not sets or response.get('totalCount') != len(sets):
            raise SystemExit('Incomplete Pokémon set response; supply a complete set list.')
        eligible = [s for s in sets if s.get('releaseDate', '').replace('/', '-') <= args.as_of and s.get('total', 0) > 0]
        counts = {code: sum(row.get('si', '').lower() == code for row in rows) for code in codes}
        gaps = [{'id': s['id'], 'name': s['name'], 'provider_count': s['total'],
                 'local_count': counts.get(s['id'].lower(), 0)} for s in eligible
                if counts.get(s['id'].lower(), 0) < s['total']]
        report['pokemon_comparison'] = {
            'scope': 'Set-count gaps only; matching counts do not prove every ID or finish is covered.',
            'released_provider_sets': len(eligible), 'sets_with_count_gaps': len(gaps),
            'missing_record_count': sum(s['provider_count'] - s['local_count'] for s in gaps), 'gaps': gaps}
    if game == 'mtg' and args.mtg_sets:
        response = json.loads(args.mtg_sets.read_text())
        if response.get('has_more'):
            raise SystemExit('Incomplete provider set response; supply a complete set list.')
        types = {'core', 'expansion', 'masters', 'draft_innovation', 'commander'}
        eligible = [s for s in response['data'] if s['set_type'] in types and not s['digital']
                    and s['released_at'] <= args.as_of and s['card_count'] > 0]
        absent = [s for s in eligible if s['code'].lower() not in codes]
        report['mtg_comparison'] = {
            'types': sorted(types), 'released_physical_sets': len(eligible),
            'represented_sets': len(eligible) - len(absent), 'absent_sets': len(absent),
            'absent': [{k: s[k] for k in ['code', 'name', 'released_at', 'card_count']}
                       for s in sorted(absent, key=lambda s: s['released_at'], reverse=True)]}
print(json.dumps(report, indent=2))
