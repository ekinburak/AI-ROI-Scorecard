# Changesets

Add a Changeset for user-visible SDK changes:

```bash
pnpm changeset
```

The release pull request synchronizes the npm and Python versions. Package publication happens
from a signed version tag after both registries' trusted publishers are configured.
