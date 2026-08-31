# Calculation rules

All money uses integer minor units represented as decimal strings on the wire. Durations are
integer milliseconds or minutes. Floating-point arithmetic is never used for value calculations.

For each completed line item:

```text
manual minutes = successful units × approved minutes per unit
estimated value = round_half_up(manual minutes × hourly value minor / 60)
```

Rounding occurs per line item before line values are summed. This makes the result stable when
workflows have different policies and prevents the report renderer from changing financial math.

When a positive same-period service cost is present:

```text
net value = estimated value − service cost
ROI basis points = round_half_up(net value × 10,000 / service cost)
value/cost basis points = round_half_up(estimated value × 10,000 / service cost)
```

Negative net value and ROI remain visible. When cost is missing or zero, net value, ROI, and the
value-to-cost multiple are omitted because the ratio has no meaningful denominator.

Time difference is manual duration minus AI active runtime. It may be negative if automation took
longer. AI active runtime includes failed retries; it excludes queue delay, backoff, callback
latency, and human-review waiting.

One scorecard uses one currency and one minor-unit scale. Currency conversion is outside the SDK.
