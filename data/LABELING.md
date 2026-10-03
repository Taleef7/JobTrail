# Labeling guidelines (schema v2)

One set of rules for everyone who produces a label: the draft sampler (`ml/jobtrail_ml/sampler.py` encodes these), the human reviewer in the labeling tool (#71), and the prompts given to models. When a note is ambiguous under these rules, the reviewer rejects it rather than guessing.

**The golden rule: label what the note says, not what probably happened.** Nothing is inferred from trade knowledge ("a P-trap swap usually needs tape" → no tape unless the note says tape).

## Fields

| Field              | Rule                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobType`          | The trade of the job's **main** task, from the trade list below. `null` only when the note gives no clue at all.                                                                                                                                                                                                                                                                                                    |
| `workPerformed`    | One short **past-tense action** per distinct task, verb first: "Replaced kitchen sink P-trap". Keep the object the note names; drop filler. Work that was **not** done ("didn't get to the vent") is never listed.                                                                                                                                                                                                  |
| `issuesFound`      | Problems the note reports **finding** on site ("found", "noticed", "turned out"), as noun phrases: "Corroded shutoff valve". A problem found and then fixed is an issue found **and** its fix is work performed. The job's own task is not also an issue: "patched the drywall hole" gives no issue "Drywall hole".                                                                                                 |
| `materials`        | Things the note says were used or put in, with an amount or as supplies ("used 1 wax ring", "installed 2 door stops", "some caulk"). An item named only as the object of a task, with no number ("installed the ceiling fixture", "installed closet shelving"), is part of the work, not a material. Tools are not materials. A material the note says was **not** used ("didn't need the wax ring") is not listed. |
| `quantity`         | The number said for that material, after any self-correction ("two, no three" → 3). `null` when no number is said ("some tape"). Never 0.                                                                                                                                                                                                                                                                           |
| `unit`             | A measure or package word said with the quantity: `kit`, `box`, `roll`, `gallon`, … — singular, except length is always `feet` (never `foot`). `null` for plain counts ("3 wire nuts") and when not said.                                                                                                                                                                                                           |
| `laborMinutes`     | **Total** labor on this job, in minutes, as an integer: "an hour and a half" → 90; "an hour, plus another 20 minutes to clear the drain" → 80. `null` when the note gives no time. Drive time is not labor unless the note counts it.                                                                                                                                                                               |
| `customerApproved` | `true` only on an explicit yes ("customer signed off", "she approved it", "gave the go-ahead"); being happy or satisfied is not a yes. `false` only on an explicit no ("customer declined", "didn't sign"). `null` when the note is silent or unsure ("not sure they approved").                                                                                                                                    |
| `followUps`        | Future actions only: "Return to replace shutoff valve". Past actions are never follow-ups.                                                                                                                                                                                                                                                                                                                          |

## Trades (`jobType`)

Pick by the job's main task, even when a side task belongs to another trade.

| Trade        | Covers                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `plumbing`   | Pipes, drains, fixtures, toilets, water heaters, supply lines                                                              |
| `electrical` | Wiring, breakers, panels, outlets, switches, light fixtures                                                                |
| `hvac`       | Heating, cooling, thermostats, refrigerant, ducts, furnace filters, condensate lines                                       |
| `carpentry`  | Structural and finish woodwork: doors and jambs, decks, trim, built-in shelving                                            |
| `appliance`  | Repairing household appliances: dryers, dishwashers, refrigerators (including their vents and parts)                       |
| `cleaning`   | Cleaning as the job itself: deep cleans, carpets, degreasing, post-renovation cleanup                                      |
| `painting`   | Painting and staining, with the prep that goes with it (patching nail holes, sanding, washing)                             |
| `roofing`    | Roofs **and gutters**: shingles, flashing, vent boots, gutter cleaning and repair                                          |
| `general`    | Handyman tasks that aren't a trade specialty: mounting TVs and brackets, assembling furniture, drywall patches, door stops |

## Cases the eval tags target

| Tag                  | What the note does                                          | How to label                                                                               |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `hours-phrasing`     | States time in hours or fractions ("hour and a half")       | Convert to total minutes.                                                                  |
| `negation`           | Mentions a material, task or approval in the negative       | Negated materials and tasks are omitted; a negated approval is `false`.                    |
| `self-correction`    | Says a value, then corrects it ("two, no three")            | Use the corrected value.                                                                   |
| `multiple-materials` | Three or more materials                                     | One entry per material.                                                                    |
| `no-materials`       | No materials used                                           | `materials: []`.                                                                           |
| `supply-house-trip`  | A trip to pick up parts                                     | A work item "Picked up <part> at the supply house"; the part is a material if it was used. |
| `extra-labor`        | A second task with its own time ("another 30 minutes to …") | Its own work item; its minutes are **added** to `laborMinutes`.                            |
| `approval-absent`    | Never mentions approval                                     | `customerApproved: null`.                                                                  |

Matching is fuzzy for list items and material names (see `packages/core/SCORING.md`), so exact wording of a work item matters less than getting the right number of items, quantities, units and scalars.
