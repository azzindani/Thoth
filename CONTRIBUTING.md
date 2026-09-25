# Contributing to Thoth

Thank you for helping. This page covers the workflow. The code standards
are in [Conventions](docs/development/conventions.md).

## Setup

Follow [Getting started › Native development](docs/getting-started.md#option-b-native-development).
You need Node.js 22 (`.nvmrc`) and PostgreSQL 16 with PostGIS. For the
collector tests, also create a disposable database:

```bash
createdb thoth_test
DATABASE_URL=postgres://thoth:thoth@localhost:5432/thoth_test npm --prefix backend run db:migrate
```

## Workflow

1. Branch from `main`. `main` must always be deployable.
2. Keep each change focused: one concern per pull request.
3. Run the quality gates locally (below) before you push.
4. Update the documentation in the same pull request:
   - add user-visible changes to `CHANGELOG.md` under **Unreleased**;
   - for a new or removed data source, update
     [Data sources](docs/reference/data-sources.md);
   - for a new or changed route, update the [API reference](docs/reference/api.md);
   - for a new environment variable, update [Configuration](docs/operations/configuration.md)
     and `backend/.env.example`;
   - for a change that needs operator action, add a note to [Upgrading](docs/operations/upgrading.md).
5. Open a pull request. CI must be green before it is merged.

### Commit messages

Use the imperative mood and describe the effect ("Retry news feeds once on
a failed connect", not "fixed stuff"). Explain *why* in the body when it is
not obvious. Keep formatting-only changes in their own commits.

## Quality gates

These are the same checks CI runs (`.github/workflows/ci.yml`):

```bash
# backend
cd backend
npm run typecheck && npm run lint && npm run test:unit
npm run test:collectors          # needs thoth_test; TRUNCATEs tables there
npm test                         # route + alive suites against a running API (API_URL)

# app
cd app
npm run typecheck && npm run lint && npm test
npm run build
npm run test:e2e                 # Playwright; needs API + app running
```

For how each suite works and what it needs, see [Testing](docs/development/testing.md).

## Where things go

| Change | Read first |
|---|---|
| New upstream data source | [Adding data sources](docs/development/adding-data-sources.md) |
| UI component or styling | [UI design system](docs/development/ui-design-system.md) |
| Database schema | [Database › Migrations](docs/architecture/database.md#migrations): add a new numbered file, never edit an applied one |
| New API route | [Architecture › API](docs/architecture/overview.md#api-backendsrcapi) and [API reference](docs/reference/api.md) |

## Pull request checklist

- [ ] Typecheck, lint and tests pass locally
- [ ] New behaviour has a test that fails without the change
- [ ] No file over 700 lines ([Conventions](docs/development/conventions.md#size-and-shape))
- [ ] UI changes checked at the desk, tablet and phone breakpoints
- [ ] Docs and `CHANGELOG.md` updated
- [ ] No secrets, keys or personal data in code, fixtures or screenshots

## Reporting bugs and security issues

- Bugs and feature requests: GitHub Issues.
- Security issues: see [SECURITY.md](SECURITY.md). Please do not file a
  public issue.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
