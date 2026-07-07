# Milestones with celebration (`milestoneStatus` / `newMilestones` / `milestonesSeen`)

## Context

Celebrate wealth milestones — 10/25/50/75/100% of the FIRE target, the first
100 000 zł in the portfolio, half the mortgage paid, mortgage paid off, family loan
paid off — the moment a check-in save crosses one. The celebration reuses the
existing motivation modal layer: the post-check-in modal (`Mot.checkinModal`) gains
an optional 🏆 banner block; there is no new screen, no new modal, no new file.

The authoritative design is **Feature 1 of `plans/E-reports-engagement.md`**
(§0 decisions, §1 feature spec, §5 migration, §6 tests — all decisions are made
there; do not re-derive them). This doc extracts that feature as a **standalone
release** and adapts Plan E's stale numbering to the current tree (Plan E predates
the v1.14/v1.15 retirement releases, which consumed schema versions 3–4 and test
groups F27–F29). Ships as **v1.16.0, committed in Polish**. The other Plan E
features (note field, annual report, CSV export, backup nudge) are **not** built now.

## Adaptations vs Plan E (the only deltas — everything else is verbatim)

| Plan E said | This tree needs |
|---|---|
| Batch C prerequisite (`note` field, schema 2→3) | **None** — the `note` field only mattered for CSV; milestones have no dependency on it |
| `SCHEMA_VERSION` 3 → 4, migration `case 3:` | `SCHEMA_VERSION` **4 → 5**, migration **`case 4:`** (v4 = expense freeze, already shipped) |
| Tests under F27 (+ migration under F30d) | **All milestone tests under F30** — F27/F28 are consumed by the retirement features, F29 by `charts.js` |
| Wave conventions: no version bump, no commit, `docs/features/E.md` | Standalone release checklist: bump to **v1.16.0** in three places, Polish commit, push. No `docs/features/` (this file is the doc) |

## Locked semantics (Plan E §0 + §1.1 — do not "fix" these)

- **Crossing, not state.** A milestone celebrates only when its status flips
  `false → true` between the derived snapshots immediately before and after a
  check-in save. Wealth that already satisfies a threshold — at onboarding, after
  an assumptions edit, or via growth-only months between check-ins — is silently
  `true` in the before-snapshot and never celebrates. This is deliberate (no fake
  fanfare for wealth that pre-dates the measurement); no seeding of
  `milestonesSeen` at onboarding is needed.
- **Once ever.** Celebrated keys are persisted in `state.ui.milestonesSeen`; a
  correction that dips the portfolio below a threshold and a later re-cross stays
  silent. This is the **only** reason the field exists — the crossing diff alone
  would re-celebrate re-crosses.
- **Keys are a schema.** They live in exported `MILESTONES_ORDER` and in users'
  persisted state — never rename them.
- **`fi100` is a portfolio milestone** (`portfolio ≥ fireTargetAt`), intentionally
  NOT gated on debts — it mirrors the FI% ring (`fiStats.fiPct`). The full FIRE
  condition (target + mortgage 0 + family 0) stays exclusive to `projectFire`.
- **`port100k` uses the portfolio bucket** (the one that counts toward FIRE), not
  cash+portfolio — consistent with every other portfolio milestone.
- **`mortgageHalf`** uses `debt.paidPct ≥ 0.5` (already computed by
  `replayLoanCore`, nominal-principal basis — the natural contract framing).
  `mortgageDone`/`familyDone` require `started`; a plan with no mortgage (or a
  never-enabled family loan) yields `EMPTY_LOAN().started === false` and can
  never fire.
- **Detection runs only in the `#ci-save` path** (new entries AND edits — an edit
  can legitimately push a threshold). Entry deletion and assumption edits never
  celebrate and never un-see.
- **One modal, not two chained**: the highest-priority crossed key becomes the
  headline; additional keys crossed in the same save are listed as a muted
  „A do tego: …" line inside the same banner.

## Step 1 — `js/engine.js` (pure detection)

New section banner `// ── Kamienie milowe ─────` after the streak section
(`computeStreak`, ~line 431). Code verbatim from Plan E §1.1:

```js
// Priority order, most significant first. The FIRST crossed key becomes the
// modal headline; the rest are listed as extra lines. Keys are persisted in
// state.ui.milestonesSeen — never rename them (they are a schema).
export const MILESTONES_ORDER = [
  'fi100', 'mortgageDone', 'familyDone', 'fi75', 'fi50',
  'mortgageHalf', 'fi25', 'port100k', 'fi10',
];

// Boolean status of every milestone given the derived pipeline results.
// Pure reader — takes replay results as params (same style as fiStats).
export function milestoneStatus(state, balances, debt, family, uptoYm) {
  const target = fireTargetAt(state, uptoYm);
  const p = balances.portfolio;
  const pct = q => target > 0 && p >= q * target - EPS;
  return {
    fi10: pct(0.10), fi25: pct(0.25), fi50: pct(0.50), fi75: pct(0.75), fi100: pct(1.0),
    port100k: p >= 100000 - EPS,
    mortgageHalf: debt.started && debt.paidPct >= 0.5,
    mortgageDone: debt.started && debt.balanceNominal <= EPS,
    familyDone: family.started && family.balanceNominal <= EPS,
  };
}

// Crossing = false→true between two status snapshots, minus already-seen keys.
// Returns keys in MILESTONES_ORDER (priority) order. Tolerates seen == null.
export function newMilestones(before, after, seen = []) {
  const s = seen || [];
  return MILESTONES_ORDER.filter(k => after[k] && !before[k] && !s.includes(k));
}
```

Comments in the shipped code should be Polish (match the file); the English
comments above are the spec of what they must say.

Also in `engine.js`:

- **`createState`**: add `milestonesSeen: []` to the `ui` literal (after
  `lastExportAt: null`) and bump the hardcoded `version: 4` → `version: 5`
  (must equal `storage.SCHEMA_VERSION`; the existing F27f sync test enforces it).

Do NOT touch `fireTargetAt`, the replay functions, `projectFire`, or
`recomputeDerived` — `milestoneStatus` is a pure reader over the pipeline's
existing outputs (`derived.balances/debt/family/uptoYm`); nothing new is cached
on `state.derived`.

## Step 2 — `js/storage.js`

1. `export const SCHEMA_VERSION = 5;`
2. In `migrate`, replace `case 4: break;` with (match the v3→v4 block style):

   ```js
   case 4: {
     // v4 → v5: lista obejrzanych kamieni milowych.
     cur.ui = cur.ui || {};
     if (!Array.isArray(cur.ui.milestonesSeen)) cur.ui.milestonesSeen = [];
     cur.version = 5;
   }
   // fall-through
   case 5:
     break;
   ```

3. `validateState`: **no addition** (Plan E §5.4 — `milestonesSeen` is not
   load-critical: `newMilestones` tolerates `null` and migration re-normalizes
   non-arrays on every load; `validateState` guards only what would crash the
   replay pipeline).
4. Export/import need no change: `importPreview` already runs `migrate`, so old
   JSON backups gain `milestonesSeen: []` on import; newer-version data is
   rejected as before.

## Step 3 — `js/coach.js` (Polish copy + seeded selection)

Add the `MILESTONE_MSGS` map and `milestoneMessage(key, seed)` below the
`DECISION` block, reusing the existing `pickSeeded`. **Copy the block verbatim
from `plans/E-reports-engagement.md` §1.2 (lines 95–138)** — the Polish copy
there is the locked deliverable (2 variants per key, tone matching the existing
message library). The locked titles:

| key | title |
|---|---|
| `fi10` | 10% celu FIRE |
| `fi25` | Ćwierć celu FIRE |
| `fi50` | Połowa celu FIRE |
| `fi75` | 75% celu FIRE |
| `fi100` | Cel FIRE osiągnięty! |
| `port100k` | Pierwsze 100 000 zł |
| `mortgageHalf` | Połowa kredytu spłacona |
| `mortgageDone` | Kredyt spłacony! |
| `familyDone` | Dług rodzinny spłacony! |

`milestoneMessage` returns `{ title, text } | null` for an unknown key (UI then
skips the block). Note the existing `MILESTONES` const in `coach.js` is the
**streak** milestones (3/6/12 months) — unrelated; don't touch it, don't reuse
its name.

## Step 4 — `js/motivation.js` (modal extension, pure builder)

Extend `checkinModal` backward-compatibly; the milestone block renders between
the badge and the coach message, reusing the existing `.banner.success.small`
classes (**no `styles.css` change, no `index.html` change**):

```js
// milestone: null | { title, text, extraTitles: string[] }
export function checkinModal({ verdict, message, milestone = null }) {
  const ms = milestone ? `<div class="banner success small">🏆 <b>${esc(milestone.title)}</b><br>${esc(milestone.text)}${
    milestone.extraTitles && milestone.extraTitles.length
      ? `<br><span class="muted">A do tego: ${milestone.extraTitles.map(esc).join(' · ')}</span>` : ''
  }</div>` : '';
  return `<div class="modal-emoji">${verdictEmoji(verdict)}</div>
    <div class="badge v-${verdict}">${esc(verdictLabel(verdict))}</div>
    ${ms}
    <div class="modal-msg">${esc(message)}</div>
    <button class="btn primary wide" data-close-modal>Dalej 🔥</button>`;
}
```

Touch up the module header comment: the check-in modal path now *does* ride a
`persist()` in `ui.js` (the seen-set travels with the entry save) — the „nic nie
zapisujemy" note applies to the „Dzisiejsza decyzja" calculators, not this modal.

## Step 5 — `js/ui.js` glue (`#ci-save` handler in `renderCheckin`, ~line 894)

Snapshot before the mutation, diff after, record **before** `persist()` so the
seen-set rides the same save as the entry. Anchor on the existing `prevFireYm`
snapshot (~line 905) and the existing `persist(); … showModal(…)` tail
(~lines 920–925), which becomes:

```js
const prevFireYm = state.derived.projection.reached ? state.derived.projection.fireYm : null;
// … wasFirst / prevEntry stay as-is …
const d0 = state.derived;
const msBefore = E.milestoneStatus(state, d0.balances, d0.debt, d0.family, d0.uptoYm);
let entry;
try {
  entry = E.applyCheckIn(state, { /* unchanged */ });
} catch (err) { /* unchanged */ }
const d1 = state.derived;                        // applyCheckIn ran recomputeDerived
const msAfter = E.milestoneStatus(state, d1.balances, d1.debt, d1.family, d1.uptoYm);
const crossed = E.newMilestones(msBefore, msAfter, state.ui.milestonesSeen);
if (crossed.length) state.ui.milestonesSeen = [...(state.ui.milestonesSeen || []), ...crossed];
persist();
renderCheckinResult(entry, { prevFireYm, wasFirst, prevEntry });
const seed = Math.floor(Math.random() * 1e6);
const ms = crossed.length ? milestoneMessage(crossed[0], seed) : null;
showModal(Mot.checkinModal({
  verdict: entry.verdict,
  message: checkinCelebration(entry.verdict, seed),
  milestone: ms ? { ...ms, extraTitles: crossed.slice(1).map(k => milestoneMessage(k, seed).title) } : null,
}));
```

(The seed, currently inlined in the `checkinCelebration` call, is hoisted to a
`const` shared by both selectors.) Add `milestoneMessage` to the existing
`coach.js` import line. **No other `ui.js` change** — deletion (`#ci-delete`)
and the Plan screens stay milestone-free by design.

## Step 6 — tests (run `node tests/run-tests.js` after; green before any UI work)

New group **F30 — kamienie milowe** (F27/F28 = retirement, F29 = charts; F30 is
the next free group). Fixture `FIX.F30` in `tests/fixtures.js` (Polish header
comment): `{ thresholds: [0.10, 0.25, 0.50, 0.75, 1.0], port100k: 100000 }` plus
a mortgage-crossing variant reusing the F3 loan (1 100 000 zł @ 7% / 15 lat).
Test content per Plan E §6 „F27 — milestones", renumbered:

- **F30a `milestoneStatus` — progi FI%**: compute `target =
  E.fireTargetAt(st, uptoYm)` in-test (don't hardcode — the target is moving);
  balances stub with `portfolio` just below `0.10·target` → `fi10 === false`;
  at `0.10·target − EPS/2` → `true` (EPS tolerance); `0.25·target` →
  `fi25 true, fi50 false`; at `target` → all five `true`. `port100k` at
  `99999.99` false / `100000` true. Zero-expense state (`target === 0`) → every
  `fiXX` false, no division blowup.
- **F30b `newMilestones` — crossing + seen + priorytet**: before `{fi10:true,…}`
  / after `{fi10:true, fi25:true, port100k:true}` → `['fi25','port100k']`
  (priority order asserted per `MILESTONES_ORDER`); with `seen=['fi25']` →
  `['port100k']`; `seen=null` safe; `before[k]===true` never returned.
- **F30c kredytowe kamienie przez replay**: housePlan state; entries with
  `overpayment` large enough that `replayDebt` crosses `paidPct ≥ 0.5` in month
  M → status flips `mortgageHalf` between `uptoYm = M−1` and `M`; a final
  overpayment zeroing the balance flips `mortgageDone`; family-loan mirror flips
  `familyDone` at `endMonth`. No-mortgage state → `mortgageHalf`/`mortgageDone`/
  `familyDone` all false at any balance.
- **F30d integracja check-in**: full flow on state copies — derived before,
  `applyCheckIn` with a big-earn entry, derived after, `newMilestones` returns
  the crossed key; repeat the same crossing with the key in `seen` → empty array.
- **F30e `milestoneMessage`**: for every key in `MILESTONES_ORDER` and every
  seed `0..variants.length−1` — non-empty `title`/`text`, variants unique per
  key; seed modulo; negative seed safe; unknown key → `null` (F25 selector
  pattern).
- **F30f migracja v4→v5**: hand-built v4 state without `ui.milestonesSeen` →
  `migrate` → `version === 5` and `milestonesSeen` is `[]`; `milestonesSeen:
  'oops'` (non-array) → normalized to `[]`; a v1 state chains 1→…→5 in one pass
  (all backfills present); an existing non-empty array survives untouched;
  `version: 6` rejected by `validateState`; `.bak` round-trip unaffected.
  F27f (`createState().version === SCHEMA_VERSION`) self-updates — confirm it
  passes with 5.

**Touch-up**: existing storage tests that assert `version === 4` after migration
(added by the freeze release) must move to 5 — extend them rather than duplicating.

**`CLAUDE.md`**: update the test-count line, append an F30 sentence to the
fixture-coverage paragraph, and add `milestonesSeen` to the persisted-state
shape snippet (`ui: { theme, …, lastExportAt, milestonesSeen }`).

## Step 7 — release (standalone, per CLAUDE.md checklist)

No new app files → **no `PRECACHE` change**, no `index.html`/`styles.css`
change. Bump the version in all three places: `sw.js`
`CACHE = 'fire-v1.16.0'`, `index.html` footer `FIRE Companion v1.16.0`,
`js/ui.js` `APP_VERSION = '1.16.0'`. Commit in Polish, e.g.:
`feat: kamienie milowe z celebracją — 10/25/50/75/100% celu, pierwsze 100 tys., połowa kredytu (v1.16.0)`,
then push.

## Verification

1. `node tests/run-tests.js` → exit 0; all 141 pre-existing tests unchanged
   (milestones add pure readers — no existing number may move).
2. App run via preview (`.claude/launch.json` → `fire-app`, port 8123):
   - **Crossing**: profile with `portfolioStart` just below 100 000, save a
     check-in with a surplus that crosses → one modal: verdict badge, 🏆 banner
     „Pierwsze 100 000 zł" + variant text, coach message, single „Dalej 🔥"
     button. Re-open and re-save the same entry → **no** repeat celebration.
   - **Multi-cross**: an entry (or `balanceOverride`) jumping from below 10% to
     above 25% of the target → headline is the highest-priority key, the rest in
     „A do tego: …".
   - **Pre-existing wealth**: fresh onboarding with portfolio already above
     several thresholds → first check-in celebrates **nothing**.
   - **Mortgage**: with an active loan, an `overpayment` pushing `paidPct` past
     0.5 → „Połowa kredytu spłacona" celebrates once.
   - **Persistence**: export JSON → `version: 5`, `milestonesSeen` lists the
     celebrated keys; with v4 data in localStorage, reload → no errors, field
     backfilled to `[]`.
   - **Themes**: the 🏆 banner (`.banner.success.small`) is legible in light and
     dark.
3. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`) — app loads, no absolute-path 404s.

## Deviations from `plans/E-reports-engagement.md` (record for the later batch)

- Schema landed as **v4→v5** (Plan E §5 assumed v3→v4); the annual-report/CSV/
  nudge batch must renumber its remaining migration steps from v5.
- Milestone tests landed as **F30a–f** (Plan E §6 reserved F27a–e + F30d);
  Plan E's F28 (annual report), F29 (CSV) and F30a–c (nudge/.bak) letters are
  stale — the later batch takes fresh groups from F31.
- Shipped standalone as v1.16.0 with the release checklist (Plan E's wave
  conventions — no bump, no commit, `docs/features/E.md` — do not apply; this
  file is the feature doc).
- No batch-C `note` prerequisite — irrelevant to milestones.
