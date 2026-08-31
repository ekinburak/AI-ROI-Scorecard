# Report rendering

`renderReport` and `render_report` produce:

- responsive standalone HTML;
- a plain-text equivalent;
- a renderer version; and
- an artifact hash covering the exact HTML, text, and renderer version.

The renderer accepts an immutable snapshot plus presentation-only options such as account display
name, locale, and title. It never recalculates value.

```ts
const artifact = renderReport(snapshot, {
  accountName: "Example team",
  title: "Weekly automation value",
});
```

Labels and account names are HTML-escaped. Raw exceptions are never included because evidence
events expose only an allowlisted category and optional safe message.

The HTML includes responsive and print styles but does not generate PDF files. A browser may print
or save the page when the host wants a local PDF.
