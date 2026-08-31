# Security policy

Please report vulnerabilities with a private GitHub security advisory rather than a public issue.

Supported releases:

| Release | Supported |
| --- | --- |
| Latest `0.1.x` | Yes |
| Older previews | No |

The SDK intentionally excludes recipient selection, credentials, authentication, and email
delivery. Report renderers escape labels and account names. Host applications must still keep raw
exceptions and provider diagnostics out of public evidence fields.
