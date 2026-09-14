# Standing decisions

What John has already decided, so no session escalates these again. Read this before
deciding a report "needs John". A report covered here is ordinary work: do it if it fits,
otherwise leave it open as backlog. Add a line here whenever John makes a new call.

## How to work

| Decision | Since |
|---|---|
| **Faithful to the tabletop.** Every genuine player choice is a real prompt; only purely mechanical steps auto-resolve, and each such deviation is documented in `docs/rules-spec.md`. So "this card should give me a choice" is a fix, not a question. | 2026-06-13 |
| **Rules sources.** Rulebook, FAQ, the Card Text Reference, and the Almanac (used throughout `docs/rules-spec.md`). A report citing the Almanac is a rules fix once checked against the local PDF. | established |
| **Defer to the prolific playtester on presentation.** Reporter `r-bme7eu3t-mtq2vh0m` has a clear vision for layout, battle presentation, the side panel, the hand, wording and consistency; implement their suggestions. | 2026-09-13 |
| **Event cards use the map.** Recruitment, movement, attacks and figure picks that an Event card grants go through the map interface, like die actions (report 2s3p6y0x000k6b70). | 2026-09-10 |
| **AI changes are measured, not guessed.** Shadow-AI changes pass the two-gate A/B in `docs/ai-humanlike-yardstick.md`; the Shadow AI and FP AI are each owned by an interactive session. AI strategy feedback from players is backlog for those sessions, not a question for John. | 2026-08-31, 2026-09-10 |

## Settled specifics

| Decision | Since |
|---|---|
| Corsairs of Umbar moves the Army, then gives battle (faithful move-then-battle). | 2026-09-13 |
| Every Character carries a distinctive mark on the map. | 2026-09-13 |
| The GitHub repo is public; nothing publisher-owned or secret is ever committed. | 2026-09-14 |
| Undo past a dice roll or card draw is allowed in hotseat as well as vs the AI, with the warning and a public log record. | 2026-09-14 |
| Event cards recruit to the maximum extent possible (no stopping early); a Muster die may recruit partially. | 2026-09-14 |
| Board art: the download prompt stays (legal reasons). John won't seek permission for or pay for replacement art, but would include it as an option if someone provided it. | 2026-09-10 |
| Sign-in: anonymous play stays; optional profile features are welcome but not scheduled. | 2026-09-10 |
| Hover reach rings: left as they are (players disagree). | 2026-09-10 |

## What still genuinely needs John

Flag a report for John (`~/bin/wotr-triage flag <reportId> "<question>"`) only with a
specific question, and only when it is one of these:

- a new feature or direction outside everything above;
- anything that costs money, needs his credentials or accounts, or has legal weight (art, licensing);
- reversing or overriding one of the decisions above;
- a rules question the sources above leave genuinely silent or contradictory;
- destructive or bulk data operations.

"Too big for one run", "touches files another session is editing", and "needs an A/B" are
not reasons to flag. Leave those open as backlog and say so in the run summary.
