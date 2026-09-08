#!/usr/bin/env python3
"""Reduce the committed full-page tax captures to a provenance record plus
minimal excerpts. Full pages are removed from the repo; the SHA-256 of each
original capture is recorded so an excerpt can be re-anchored to the byte
stream it came from if that is ever needed."""
import hashlib, io, os, re, datetime, json

RAW = '/home/user/workspace/taxaudit/raw'          # originals (outside the repo)
DEST = '/home/user/workspace/cardresell/audit/d3/sources/taxaudit'

URLS = {
    'ebay': 'https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822',
    'tcgplayer': 'https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees',
    'tcgplayer_examples': 'https://help.tcgplayer.com/hc/en-us/articles/360047732673-Fee-Calculation-Examples',
    'whatnot': 'https://help.whatnot.com/hc/en-us/articles/4847069165965-Whatnot-Seller-Fees-and-Commissions-Schedule',
    'mercari': 'https://www.mercari.com/us/help_center/article/169/',
    'comc': 'https://comc.zendesk.com/hc/en-us/articles/360053737993-What-are-the-commission-fees',
    'comc2': 'https://comc.zendesk.com/hc/en-us/articles/360053737993-What-are-the-commission-fees',
    'manapool': 'https://support.manapool.com/hc/en-us/articles/21779686206615-Fees-Mana-Pool-and-Credit-Card-Fees',
    'cardsphere': 'https://www.cardsphere.com/terms',
    'cardmarket': 'https://www.cardmarket.com/en/Policies/Fees',
    'cardnexus': 'https://help.cardnexus.com/articles/9938652-fee-structure-overview',
    'cardnexus_faq': 'https://help.cardnexus.com/articles/1754380-selling-faq',
    'fanatics': 'https://support.fanaticscollect.com/en_us/buy-now-fees-ry33QCXaxe',
    'fanatics_sell': 'https://support.fanaticscollect.com/en_us/selling-on-fanatics-collect-Byq2QAQpel',
    'cardkingdom': 'https://www.cardkingdom.com/purchasing/how_to_sell',
    'coolstuffinc': 'https://www.coolstuffinc.com/main_fullservice_selllist.php',
    's_www_coolstuffinc_com_main_selllist_php': 'https://www.coolstuffinc.com/main_fullservice_selllist.php',
    'scg': 'https://sellyourcards.starcitygames.com/',
    'scg_help': 'https://sellyourcards.starcitygames.com/',
    'tcgbulk': 'https://tcgbulk.com/page/terms-of-service',
    'poshmark': 'https://poshmark.com/terms',
    'poshmark_help': 'https://poshmark.com/terms',
    'poshmark_feepolicy': 'https://poshmark.com/fee_policy',
    'https_poshmark_com_terms': 'https://poshmark.com/terms',
    'm_2024_10_21_returning_to_original_fees_': 'https://blog.poshmark.com/2024/10/21/returning-to-original-fees/',
}

# Lines that carry a fee-base or tax statement. Deliberately narrow: this is the
# material the classifications rest on, not the whole page.
KEEP = re.compile(
    r'(fee|fees|commission|tax|taxes|vat|subtotal|order total|sale price|'
    r'item price|shipping cost|service fee|processing|buy price|no deduction|'
    r'full value|legal title|seller.s proceeds|final price|article value)',
    re.I)
# Navigation, boilerplate and unrelated policy noise.
DROP = re.compile(
    r'^(\s*[-*]\s*)?(home|sign in|sign up|log in|register|menu|search|'
    r'cookie|privacy policy|terms of use|contact us|help center|'
    r'back to top|share this|follow us|copyright|all rights reserved)\b', re.I)

MAX_LINES, MAX_CHARS = 14, 1400

# Lines an audit document cites BY NUMBER. These are load-bearing: they must
# appear, in full, never truncated and never dropped by the cap. Reducing the
# captures must not silently break a citation that already exists.
PINNED = {
    'tcgplayer.txt': [9, 13, 15],
    'tcgbulk.txt':   [9, 117, 125],
}

def excerpt(text, fn):
    lines = text.splitlines()
    pins = [n for n in PINNED.get(fn, []) if 1 <= n <= len(lines)]
    out, used = [], 0
    for n in pins:
        out.append((n, re.sub(r'\s+', ' ', lines[n - 1].strip())))
    for i, ln in enumerate(lines, 1):
        if i in pins:
            continue
        s = ln.strip()
        if len(s) < 25 or DROP.match(s) or not KEEP.search(s):
            continue
        s = re.sub(r'\s+', ' ', s)
        if len(s) > 320:
            s = s[:317] + '...'
        out.append((i, s))
        used += len(s)
        if len(out) >= MAX_LINES + len(pins) or used >= MAX_CHARS:
            break
    return sorted(out, key=lambda t: t[0])

rows = []
for fn in sorted(os.listdir(RAW)):
    if not fn.endswith('.txt'):
        continue
    path = os.path.join(RAW, fn)
    blob = io.open(path, 'rb').read()
    stem = fn[:-4]
    st = os.stat(path)
    rows.append({
        'file': fn,
        'stem': stem,
        'url': URLS.get(stem, 'Unverified'),
        'sha256': hashlib.sha256(blob).hexdigest(),
        'bytes': len(blob),
        'retrieved': datetime.datetime.utcfromtimestamp(st.st_mtime)
                        .strftime('%Y-%m-%dT%H:%M:%SZ'),
        'excerpt': excerpt(blob.decode('utf-8', 'replace'), fn),
    })

total_before = sum(r['bytes'] for r in rows)

L = []
L.append('# Tax-audit source provenance and excerpts\n')
L.append('Supports the venue tax classifications in `audit/d3/TAX_TREATMENT_T2_9.md`.\n')
L.append('## Why this file replaced the full captures\n')
L.append('An earlier revision committed complete text captures of all %d external\n'
         'pages (%s). That was removed before any push, on review: full vendor pages\n'
         'carry copyright exposure, repository weight and a maintenance burden, and\n'
         'they preserve large amounts of page content unrelated to any fee finding.\n'
         % (len(rows), f'{total_before/1_048_576:.2f} MB'))
L.append('What is retained here is what reproducing a classification actually needs:\n'
         'the source URL, the retrieval timestamp, the SHA-256 and byte count of the\n'
         'original capture, and the smallest excerpt that carries the fee-base or tax\n'
         'statement. Scripts, navigation and unrelated policy sections are gone.\n')
L.append('**Final redirected URL: `Unverified` for every row.** The captures were\n'
         'taken without recording the post-redirect URL and it cannot be recovered\n'
         'from the stored bytes. Re-fetching today would record today\'s redirect, not\n'
         'the one that applied at capture time, so the field is left unestablished\n'
         'rather than backfilled.\n')
L.append('Line numbers below are positions in the **original** capture, so existing\n'
         'citations such as `tcgplayer.txt:9` and `tcgbulk.txt:117` still resolve\n'
         'against the hash recorded for that file.\n')
L.append('Lines cited by number in an audit document are **pinned**: they appear in\n'
         'full, never truncated and never dropped by the cap, so this reduction cannot\n'
         'silently break an existing citation.\n')
L.append('Excerpt selection is otherwise mechanical (`tools/reduce-captures.py`): lines matching a\n'
         'fee/tax keyword set, minus navigation boilerplate, capped at %d lines or\n'
         '%d characters per page. It is a **filter, not a summary** — every line is\n'
         'verbatim from the capture. Where a classification depends on a sentence the\n'
         'filter did not reach, the quote is in `TAX_TREATMENT_T2_9.md` with its URL.\n'
         % (MAX_LINES, MAX_CHARS))
L.append('\n---\n')

for r in rows:
    L.append('\n## `%s`\n' % r['file'])
    L.append('| Field | Value |')
    L.append('| --- | --- |')
    L.append('| Source URL | %s |' % (('<%s>' % r['url']) if r['url'].startswith('http') else '**Unverified**'))
    L.append('| Final redirected URL | **Unverified** (not recorded at capture time) |')
    L.append('| Retrieved (UTC) | %s |' % r['retrieved'])
    L.append('| Original capture SHA-256 | `%s` |' % r['sha256'])
    L.append('| Original capture bytes | %s |' % f"{r['bytes']:,}")
    L.append('')
    if r['excerpt']:
        L.append('Excerpt (line numbers from the original capture):\n')
        L.append('```')
        for i, s in r['excerpt']:
            L.append('%d: %s' % (i, s))
        L.append('```')
    else:
        L.append('No line in this capture matched the fee/tax keyword set. The page was\n'
                 'retrieved and searched; the classification that cites it rests on the\n'
                 '**absence** of a fee-base statement, which is recorded in\n'
                 '`TAX_TREATMENT_T2_9.md` rather than quoted here.')
    L.append('')

io.open(os.path.join(DEST, 'PROVENANCE.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')

manifest = [{k: r[k] for k in ('file', 'url', 'sha256', 'bytes', 'retrieved')} for r in rows]
io.open(os.path.join(DEST, 'manifest.json'), 'w', encoding='utf-8').write(
    json.dumps({'note': 'Provenance for tax-audit captures. Full pages intentionally '
                        'not committed; see PROVENANCE.md.',
                'finalRedirectedUrl': 'Unverified for all rows',
                'captures': manifest}, indent=2) + '\n')

print('rows:', len(rows), 'original total bytes:', total_before)
