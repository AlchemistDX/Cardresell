"""Offline importer guards. No vendor calls or customer credits."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
spec = importlib.util.spec_from_file_location('fill_catalog', Path(__file__).resolve().parents[1] / 'tools/fill-catalog-gaps.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ImportGuards(unittest.TestCase):
    def setUp(self):
        self.card = {'id': 'fixture', 'name': 'Test Card', 'set': 'abc', 'lang': 'en',
                     'games': ['paper'], 'collector_number': '007a', 'released_at': '2020-01-01',
                     'image_uris': {'normal': 'https://cards.scryfall.io/fixture.jpg'}}
        self.meta = {'name': 'Fixture', 'released_at': '2020-01-01'}
        from PIL import Image
        buf = io.BytesIO()
        Image.new('RGB', (200, 300), (100, 120, 140)).save(buf, 'PNG')
        self.image = buf.getvalue()

    def test_printed_number_and_existing_source_preserved(self):
        with patch.object(m, 'fetch', return_value=self.image):
            row = m.record('mtg', 'abc', self.meta, self.card, None)
        self.assertEqual(row['nu'], '007a')
        self.assertEqual(row['id'], 'fixture')
        self.assertEqual(row['i'], self.card['image_uris']['normal'])
        self.assertEqual(row['p'], m.phash(self.image))
        self.assertEqual(row['d'], m.dhash(self.image))

    def test_wrong_printing_and_nonphysical_rejected(self):
        for change in [{'set': 'xyz'}, {'lang': 'ja'}, {'digital': True}, {'games': ['arena']},
                       {'collector_number': ''}, {'image_uris': {}}, {'name': ''}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                m.record('mtg', 'abc', self.meta, {**self.card, **change}, None)

    def test_corrupt_source_rejected(self):
        with patch.object(m, 'fetch', return_value=b'not an image'), self.assertRaises(Exception):
            m.record('mtg', 'abc', self.meta, self.card, None)

    def test_future_printing_in_an_older_set_is_rejected(self):
        with self.assertRaises(ValueError):
            m.record('mtg', 'abc', self.meta, {**self.card, 'released_at':'2099-01-01'}, None, '2026-10-08')

    def test_all_printing_pages_required(self):
        docs = [self.meta, {'data': [self.card], 'total_cards': 2, 'has_more': True,
                'next_page': 'https://api.scryfall.com/cards/search?page=2'},
                {'data': [{**self.card, 'id': 'second'}], 'total_cards': 2, 'has_more': False}]
        with patch.object(m, 'fetch', side_effect=[json.dumps(x).encode() for x in docs]) as get, patch.object(m.time, 'sleep'):
            _, cards, sources = m.catalog('mtg', 'abc', '2026-10-08', None)
        self.assertEqual(len(cards), 2)
        self.assertIn('unique=prints', get.call_args_list[1].args[0])
        self.assertEqual(len(sources), 2)

    def test_bad_pagination_rejected(self):
        for page in [{'data': [self.card], 'total_cards': 2, 'has_more': False},
                     {'data': [self.card], 'total_cards': 2, 'has_more': True},
                     {'data': [self.card], 'total_cards': 2, 'has_more': True,
                      'next_page': 'https://wrong.example/cards'},
                     {'data': [self.card, self.card], 'total_cards': 2, 'has_more': False}]:
            with self.subTest(page=page), patch.object(m, 'fetch', side_effect=[json.dumps(x).encode() for x in [self.meta, page]]), patch.object(m.time, 'sleep'), self.assertRaises(ValueError):
                m.catalog('mtg', 'abc', '2026-10-08', None)

    def test_future_sets_rejected(self):
        with patch.object(m, 'fetch', return_value=json.dumps({**self.meta, 'released_at': '2099-01-01'}).encode()), self.assertRaises(ValueError):
            m.catalog('mtg', 'abc', '2026-10-08', None)

    def test_catalog_reports_and_excludes_future_variants(self):
        future = {**self.card, 'id':'future', 'released_at':'2099-01-01'}
        docs = [self.meta, {'data':[self.card,future], 'total_cards':2, 'has_more':False}]
        with patch.object(m, 'fetch', side_effect=[json.dumps(x).encode() for x in docs]), patch.object(m.time, 'sleep'):
            meta, cards, _ = m.catalog('mtg', 'abc', '2026-10-08', None)
        self.assertEqual([c['id'] for c in cards], ['fixture'])
        self.assertEqual(meta['_source_query_count'], 2)
        self.assertEqual(meta['_excluded_future_printings'], ['future'])


if __name__ == '__main__':
    unittest.main()
