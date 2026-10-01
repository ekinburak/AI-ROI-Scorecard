# Report rendering

`renderReport` and `render_report` produce:

- responsive standalone HTML;
- a plain-text equivalent;
- a renderer version; and
- an artifact hash covering the exact HTML, text, and renderer version.

The renderer accepts an immutable snapshot plus presentation-only options such as account display
name, locale, and title. It never recalculates value.

Runtime labels follow the snapshot's measurement state. An illustrative estimate without runtime
evidence says `Not measured` and withholds the time difference until instrumentation is connected.
Runtime remains part of the immutable audit snapshot even when a customer-facing report does not
need to display it. Pass `includeRuntime: false` in TypeScript or `include_runtime=False` in Python
to omit runtime and time-difference rows from HTML and text reports.

```ts
const artifact = renderReport(snapshot, {
  accountName: "Example team",
  includeRuntime: false,
  title: "Weekly automation value",
});
```

Labels and account names are HTML-escaped. Raw exceptions are never included because evidence
events expose only an allowlisted category and optional safe message.

Plain-text reports encode line separators, C0/C1 terminal controls, and bidirectional formatting
controls as visible `\uXXXX` sequences before each emitted line is assembled. Dynamic fields and
locale-formatted values therefore cannot add report lines or terminal direction controls. Printable
Unicode, HTML rendering, canonical snapshot JSON, source fingerprints, and snapshot hashes are
unchanged. Renderer version `2.0.0` identifies this output behavior.

The HTML includes responsive and print styles but does not generate PDF files. A browser may print
or save the page when the host wants a local PDF.

For schema-v2 reports, missing or partial runtime shows **Manual hours replaced**. Total
**Hours saved** appears only for fully measured runtime. Estimated dollar value is always
explicit; measurement of runtime does not turn baseline assumptions into realized cash savings.
