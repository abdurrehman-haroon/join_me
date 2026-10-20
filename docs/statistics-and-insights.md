# Statistics and user insights

Recorded: 2026-10-15. Status: discussion proposals, not approved implementation scope. The user requested preserving these ideas for later review. Discuss schema first, then frontend mechanics, before implementation.

Current implementation (2026-10-19): personal joined/hosted totals, sports, top grounds, linked activity history, weekly/monthly goals, signup milestones and monthly recap are implemented in You → Your activity, with month/all-time selection scoped to the server-owned demo user. See plan.md for counting/tracking rules. The inventory below preserves the broader proposals; attendance, recaps and other later features remain deferred.

## Purpose

Understand how people find games, organise them and come back to play again. Show a small, useful subset of insights to users; use most of the data internally to improve the app. Performance statistics are outside this discussion.

The main product question is: **are we helping students get a game together?** Opens and taps help explain the journey, but do not establish that a game happened.

## Feature ideas

“Start” is a suggested first-version priority, not an implementation commitment. “Later” needs more data or another feature. A dash means no user-facing display is proposed.

| Area | Insight or feature | What the user sees | What we learn internally | Priority |
|---|---|---|---|---|
| Personal activity | Participation summary | Games joined and hosted, with weekly/monthly totals | How much participation the app generates | Start |
| Personal activity | Activity history | A timeline of joining, hosting and cancellations | How people move through the app over time | Start |
| Personal activity | Sport breakdown | Their football/cricket activity | Which sports lead to participation and repeat use | Start |
| Personal activity | Favourite places | Grounds they join or host at most | Which places develop an active community | Start |
| Personal activity | Usual playing times | Their most common game days and times | When demand is strongest | Later |
| Personal activity | Repeat participation | Number of weeks in which they joined a game | Whether participation becomes a habit | Later |
| Personal activity | People played with | Familiar players and repeat teammates | Whether the app builds lasting groups | Later; needs attendance |
| Discovery | Browsing-to-joining journey | — | How many people browse, open an event and then join | Start |
| Discovery | Sport filter usage | — | What people look for, compared with what they actually join | Start |
| Discovery | Place interest | Upcoming events at a selected ground | Which grounds attract views but little participation | Start |
| Discovery | Empty results | A clear “No upcoming games” state | Where, when and for which sports demand goes unmet | Start |
| Discovery | Full-game interest | A clear full status | How often full games prevent participation | Start |
| Discovery | Discovery source | — | Whether joins come from the map, place lists, shared links or another entry point | Start for existing entry points |
| Discovery | Time to first useful action | — | How long new users take to find, join or create a game | Start |
| Discovery | Unsuccessful visits | — | How often someone browses and leaves without finding a suitable game | Start |
| Hosting | Signup summary | Current participants, capacity and remaining spots | How well games attract enough players | Start |
| Hosting | Time to first signup | First signup timing on their event | How quickly hosts get a response | Start |
| Hosting | Time to fill | When their event became full | Which sports, grounds and times fill fastest | Start |
| Hosting | Event views and joins | Potentially a simple interest summary | Whether an event receives little exposure or fails to convert interest | Start internally |
| Hosting | Creation funnel | — | Where users abandon event creation | Start |
| Hosting | Advance notice | — | How far ahead games are created and how that affects signups | Start |
| Hosting | Editing patterns | Updated event details | Whether hosts frequently change start time or capacity | Start |
| Hosting | Cancellation patterns | Their cancelled events | How often games are cancelled and how close to kickoff | Start |
| Hosting | Cancellation reasons | An optional reason when cancelling | Whether games fail because of low turnout, venue issues, weather or changed plans | Later; needs a reason field |
| Hosting | Repeat hosts | Their hosting history | Whether organising is spread across users or depends on a few people | Start |
| Participation | Join and leave patterns | Current membership status | How often people leave and how close to kickoff | Start |
| Participation | Joining lead time | — | Whether people prefer planning ahead or joining at the last minute | Start |
| Participation | Capacity mismatch | — | Whether hosts consistently choose capacities that are too large or too small | Start |
| Participation | Waitlist demand | A place on a waitlist | How much participation is lost when games fill up | Later; needs waitlists |
| Game outcomes | Did the game happen? | A quick post-game confirmation | How many organised events actually take place | Later; high value |
| Game outcomes | Attendance | Confirmed games played | Difference between signups and actual attendance | Later; needs confirmation |
| Game outcomes | Enough players to play | A simple host response after the game | Whether signups translate into viable games | Later |
| Game outcomes | Game experience | Optional “Would you join again?” feedback | Whether completed games leave users satisfied | Later |
| Coordination | Chat adoption | Event chat | Whether participants use the app to coordinate | Start |
| Coordination | Messages before kickoff | — | Whether games with coordination are more likely to happen | Start; outcome comparison later |
| Coordination | Unanswered questions | — | Whether participants struggle to get a response | Later; needs a clear definition |
| Returning use | First-to-second participation | Personal activity history | Whether a first join leads to another join | Start |
| Returning use | Weekly/monthly active participants | — | How many people actually join or host, beyond opening the app | Start |
| Returning use | Return after cancellation | — | Whether a cancelled game discourages future participation | Start |
| Returning use | Participant-to-host journey | Their first hosted game | Whether players eventually become organisers | Start |
| Community | Active grounds | Places with upcoming games | Where activity is growing or fading | Start internally |
| Community | Supply versus interest | Eventually, suggestions for hosting opportunities | Where many people look but few games are created | Later |
| Community | Newcomer participation | Potentially a welcoming first-game flow | Whether new people can get into games or activity stays within existing groups | Later |
| Community | Repeat groups | Easier ways to organise with familiar players | Whether stable groups form around sports, places and hosts | Later |
| App usefulness | Reasons people cannot join | Clear full/closed states; optional feedback later | Whether timing, capacity, location or another issue blocks participation | Start with observable reasons |
| App usefulness | Feature adoption | — | Which features people use and whether they support joining or hosting | Start |
| App usefulness | Sharing effectiveness | Shared event links, when introduced | Whether sharing brings people into games | Later; needs sharing |
| App usefulness | Notification usefulness | Relevant reminders, when introduced | Whether reminders help attendance or cause people to opt out | Later; notifications deferred |

## Suggested activity events and journeys

The current proposed activities schema, enum catalogue and validated JSON contracts are in [activities.md](activities.md). Future features must assess tracking needs under [ai.md](ai.md); implementation remains separate from this discussion.

Keep the initial activity log focused on meaningful actions:

- Discovery: app session started, sport filter selected, place opened, event details viewed and empty results shown.
- Joining: join attempted, joined successfully, join rejected because full/closed, and left an event.
- Hosting: creation form opened, event created, event edited and event cancelled.
- Coordination: chat opened and message sent, without copying message content into analytics.
- Returning use: returned after joining or hosting, then joined or hosted again. Derive these patterns from activity history where possible.

The initial journeys to analyse are **browse → view event → join** and **start creating → publish → get participants**. Example questions include whether cricket attracts interest but has too few available games, and whether event viewers leave because games are already full.

## Definitions

| Term | What it should mean |
|---|---|
| Game joined | A successful signup; distinguish hosting because the host is automatically a participant |
| Currently joined | Membership exists now |
| Join history | Successful joins and leaves over time, including memberships later removed |
| Past event | Its start time has passed; this does not establish that it happened |
| Game played | Attendance has been confirmed |
| Active user | Someone who uses the app during a defined period |
| Active participant | Someone who joins or hosts during that period |
| Successful game | A game confirmed to have happened with enough players; the exact definition needs agreement |

Joined does not mean attended. An elapsed start time or completed status alone does not prove attendance. Until confirmation exists, use labels such as “games joined” and “past events.” Browsing without joining is an observable journey, but the reason for leaving remains an inference unless the user supplies it.

## Data sources and boundaries

| Data | Proposed approach |
|---|---|
| Events, hosts, current participants and places | Calculate from existing application records, which remain the source of truth |
| Views, filters, empty results and creation abandonment | Record as activity events |
| Joins, leaves, edits and cancellations over time | Preserve successful actions so later changes do not erase history |
| Attendance, cancellation reasons and satisfaction | Ask explicitly through small optional flows |
| Message content, precise GPS and personal names | Keep out of analytics; use references and action counts |
| Individual user insights | Require reliable individual identity; the current shared demo user cannot distinguish people |
| Development and demo activity | Keep separate from real usage so testing does not inflate results |

A separate activity log is proposed for behaviour existing records do not preserve. The current membership table can show who is joined now, but cannot fully explain earlier joins and leaves. Sport, place/event references, action and time should cover most initial questions. No specific schema, analytics provider or tracking implementation has been approved.

## Suggested first version

User-facing: a modest **Your activity** section in the You tab, showing joined/hosted totals, sport breakdown and activity history, plus signup counts for hosts. Placement and frontend mechanics remain undecided; insights attached to hosted games are another option discussed.

Internal: prioritise discovery-to-join conversion, unmet demand, hosting success, cancellations, join/leave history and repeat participation.

Suggested next step after those foundations: lightweight post-game confirmation, to learn whether the app produces actual games. Reliable individual identity is a prerequisite for meaningful per-person reporting. Sign-in, waitlists, sharing, notifications and attendance flows remain separate scope decisions.
