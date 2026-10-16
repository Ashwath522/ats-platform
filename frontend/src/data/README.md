# colleges.json

A small, hand-curated list of Indian engineering institutions used by the
`CollegePicker` autocomplete and `CollegeLogo` (frontend/src/ui/CollegePicker.jsx).
It is loaded lazily (its own Vite chunk), so keep it small (target < 100 KB raw).

**Source:** compiled by hand from public information about each institution
(official names, common short names, city/state). It covers all IITs and NITs, the
IIITs, IISc/IISERs, BITS campuses, major state government colleges and popular
private and deemed universities. It is not an official AICTE/UGC list.

## Entry format (one object per line)

```json
{"id":"rvce","name":"Rashtreeya Vidyalaya College of Engineering","aliases":["RVCE","RV"],"city":"Bengaluru","state":"Karnataka","type":"Private","domain":"rvce.edu.in"}
```

| field   | rules |
|---------|-------|
| id      | stable, lowercase, `a-z0-9-`, unique. Saved on student profiles, so **never change or reuse an id**. |
| name    | official name. Must be unique after normalising (case, accents and punctuation ignored). |
| aliases | short forms people type: `IITB`, `IIT Bombay`, `NITK`, `PESU`… (optional). |
| city / state | city name as officially used (Bengaluru, Mysuru…). Old names (Bangalore, Bombay…) are matched automatically. |
| type    | one of `IIT`, `NIT`, `IIIT`, `Govt`, `Deemed`, `Private`. |
| domain  | the institution's **real official** website host (no `https://`, no path). Used only to fetch the favicon from Google's favicon service; logo files are never stored. **If you are not sure, leave it `""`** and a coloured monogram is shown instead. |

## Adding a college

1. Append a line to `colleges.json` following the format above.
2. Run `npx vitest run src/ui/__tests__/colleges.test.js` — the dataset test checks
   unique ids/names, hostname format and the IIT/NIT lists.
