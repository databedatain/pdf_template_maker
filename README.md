# PDF Template Maker

Turns a Credible form export into a fillable PDF whose field names match what
you type into the Export Builder.

Import the CSV, pick the questions you want, give each one a base name, arrange
the page, export. The tool writes the `_1 … _N` suffixes for you, bound to the
answer positions Credible uses.

Everything runs in the browser. No install, no build step, no server, and no
data leaves the machine — which matters, because completed forms hold PHI.

## Using it

Open `index.html` in a browser. Drag a Credible export (CSV) onto the window,
or use **Import export…**.

1. **Pick items.** The left pane lists every question and label in the export.
   Untick anything that should not appear on the PDF. Labels that are pure CSS
   are dropped automatically.
2. **Name the fields.** Select an item and type a base name — `plan_for`,
   `make_env_safer`, `barr_overcome`. Checkbox questions become
   `plan_for_1 … plan_for_5`; a text question keeps the bare name. This is the
   name you type into the Credible exporter as the rename.
3. **Arrange.** Drag items to reorder, set one to three columns per question,
   force a page break, adjust spacing. Every label is editable, and a hint can
   be split off into small grey italic after the label. Reordering answers
   inside a question changes only where they sit on the page.
4. **Export.** **Export PDF** writes the fillable form. **Name list** shows
   every field beside the untouched Credible wording, to copy or download as
   CSV. **Save layout** writes a JSON file — keep it, it is what lets you
   re-import a changed form later without renaming anything.

Re-importing an export for a form you already have a layout for merges rather
than replaces: names, wording, columns and order carry over, and the tool
reports which questions and answers Credible has added or removed since.

## The numbering rule

A field's number is the answer's position in the Credible export
(`a_ord`) — never its position on the page.

Dragging answers around, hiding some, or splitting a question into two columns
cannot change which answer a name refers to. A hidden answer keeps its number
reserved rather than letting the ones after it shift up, and the tool says so
in the checks bar. The label drawn on the page and the number in the field name
both come from the same answer record, so they cannot drift apart.

This matters: in the template that seeded this tool, two checkbox groups had
their labels rearranged during layout while the numbering stayed put, so
`plan_for_4` sat beside the answer Credible sorts fifth. That class of mistake
is not possible here.

## What the export contains

Letter (612 × 792 pt), base-14 Helvetica, no embedded fonts, uncompressed.
Checkboxes are 9 pt with a ZapfDingbats check and `/Off` + `/Yes` appearance
states. Text fields carry `/DA /Helv 8`, an optional `/MaxLen`, and a pale blue
background. `/NeedAppearances` is set so typed values render everywhere.
Radio-style questions export as independent checkboxes, one field per answer,
matching how Credible consumes them.

Page geometry and the type ramp default to the reference template's values —
26 pt margins, two columns at x 26 and x 311, 11.4 pt row pitch, 8.2 pt
question / 7.6 pt answer / 7 pt hint — all adjustable under Document settings
when nothing is selected.

## Known gaps

- **The export drops commas.** Credible's CSV has no commas in any text field;
  it leaves the surrounding spaces behind. The **commas** button restores them
  wherever a doubled space sits between two words. It is a good guess, not a
  certainty — read the result.
- **Inline HTML is flattened.** Bold, underline, links and colour spans in
  question text become plain text; `<br>` becomes a space. Colour spans marked
  `fullw` are recognised as section banners. Re-add emphasis by editing the
  wording, not by pasting HTML.
- **Text outside WinAnsi** is replaced with `?`. Curly quotes and dashes are
  fine; anything beyond Latin-1 would need an embedded font.
- **Answers flagged `is_notes`** get a checkbox only, no paired text box, the
  same as the reference template. Add a separate text question if you need one.
- `?load=<url>` auto-imports on open, but only over `http://` — a browser will
  not let a `file://` page fetch a sibling file. Drag and drop works either way.

## Development

```
node tools/selftest.js               # end-to-end checks over the sample export
node tools/verify-pdf.js out.pdf     # structural validation of a generated PDF
```

`selftest.js` covers the numbering rules, the re-import merge and name
validation, then writes a PDF. `verify-pdf.js` checks cross-reference offsets,
reference resolution, widget/annotation/field agreement, rectangles inside the
page box, appearance states and balanced content-stream operators; it passes
the reference template as well as generated output.

Neither tool rasterises the page — there is no PDF renderer in the test
container, so visual output is checked in the editor preview, which draws from
the same layout pass the PDF writer consumes.

### Layout

| File | Role |
| --- | --- |
| `js/csv.js` | CSV reader/writer |
| `js/model.js` | export rows → form → editable document; re-import merge |
| `js/metrics.js` | Helvetica width tables, wrapping, WinAnsi encoding |
| `js/layout.js` | flow layout → draw ops + field definitions in PDF units |
| `js/pdf.js` | PDF writer with AcroForm |
| `js/app.js` | editor UI |

The preview and the PDF consume the same output of `layout.js`, so there is no
second layout pass that could drift.
