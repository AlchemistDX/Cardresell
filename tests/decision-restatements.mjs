/* Do restatements of a decision still agree with the decision record?
 *
 * WHY THIS EXISTS. On 2026-09-08 `audit/ROTATION_RUNBOOK.md` asserted that no
 * owner decision on `94dc777` had been recorded, and cited
 * `audit/DECISION_94dc777.md` in the same sentence -- a file that opens with
 * "Decision: Option A -- keep the history", decided 2026-09-06. The false claim
 * was inherited from `CARDRESELL_PLAN_AND_ROADMAP.md` §8.2, which was accurate
 * when written and went stale that day.
 *
 * The structural asymmetry: the corpus keeps ONE authority per fact and MANY
 * restatements of it, and restatements are not re-read when the authority
 * changes. A summary is where a fact goes to stop being checkable. This suite
 * makes the one machine-checkable part of that checkable: any document that
 * cites a DECISION_ record must not, in the same breath, describe the question
 * as open.
 *
 * It does NOT verify that a restatement summarises the decision correctly --
 * that needs a reader. It catches the specific drift that actually happened:
 * a decided question restated as undecided.
 */
import { completionGuard } from './_complete.mjs';
const { finish: _finish } = completionGuard('decision-restatements');

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; }
  else { fail++; console.log(`FAIL  ${name}\n      ${detail ?? ''}`); }
};

const AUDIT = 'audit';
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : (e.name.endsWith('.md') ? [join(d, e.name)] : []));
const docs = walk(AUDIT);
const records = docs.filter((f) => /DECISION_[^/]+\.md$/.test(f));

check('the corpus has decision records to check against', records.length >= 5, `${records.length}`);

/* A record must state its own verdict where a reader lands, not bury it. */
const verdicts = new Map();
for (const rec of records) {
  const head = readFileSync(rec, 'utf8').split('\n').slice(0, 40).join('\n');
  const m = head.match(/^#{1,3}\s*Decision[:\s].+$/m) || head.match(/^\*\*Decision(?:\s|:).+$/m);
  check(`${rec} states its verdict in the first 40 lines`, !!m, m ? '' : 'no "Decision:" heading found');
  /* The corpus convention is `**Date:**`, not `**Decided:**`. The first version
   * of this check required "Decided:" and flagged four records that were fine;
   * that was my naming assumption, not a corpus gap, so the check widened
   * rather than the records changing. Any of the three tokens satisfies it -- a
   * decision record must be datable, by whatever word. */
  const dated = /\*\*(?:Date|Decided|Recorded):?\*\*/.test(head) || /^(?:Date|Decided|Recorded):/m.test(head);
  check(`${rec} carries a date a reader can check staleness against`, dated,
    dated ? '' : 'no Date: / Decided: / Recorded: line in the first 40 lines');
  if (m) verdicts.set(rec, m[0]);
}

/* The drift itself: a doc citing a record while calling the question open. */
const OPEN = /(no owner decision|has not been recorded|have not been recorded|has not been made|no decision (?:has been )?(?:made|recorded|found)|was found\b[^.]*decision|still (?:un)?decided|remains undecided|undecided)/i;
for (const doc of docs) {
  const body = readFileSync(doc, 'utf8');
  for (const rec of records) {
    const base = rec.split('/').pop();
    if (!body.includes(base) || doc === rec) continue;
    // Sentence-level: only flag when the open-language sits in the same
    // sentence as the citation, so a doc may still list unrelated open items.
    const paras = body.split(/\n\n+/);
    for (const para of paras) {
      if (!para.includes(base)) continue;
      /* Exempt at PARAGRAPH scope, not sentence scope. A correction note
       * necessarily quotes the false claim it is retracting, and the marker
       * that makes it a retraction ("this previously read...", "propagated",
       * "corrected") often sits in a neighbouring sentence. Sentence-scoped
       * exemption flagged this file's own §5 on the first run. */
      if (/previously read|previously said|previously asserted|first version of this section|propagated|corrected|retract|WAS:/i.test(para)) continue;
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
      if (!s.includes(base)) continue;
      check(`${doc} does not restate ${base} as undecided`, !OPEN.test(s), s.replace(/\s+/g, ' ').slice(0, 220));
      }
    }
  }
}

console.log(`\ndecision-restatements: ${pass} passed, ${fail} failed`);
_finish(pass, fail);

_finish(pass, fail);
