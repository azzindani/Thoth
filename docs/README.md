# Thoth documentation

Pages are grouped by what you are trying to do.

## Getting started

- [Getting started](getting-started.md): run Thoth locally, with Docker
  Compose or natively, and check that it works.

## Architecture

- [Overview](architecture/overview.md): components, data flow, freshness
  model, intelligence pass, frontend and trust boundaries.
- [Database](architecture/database.md): schema, migrations and retention.

## Operations

- [Deployment](operations/deployment.md): production install, reverse
  proxy, scheduled jobs and go-live checklist.
- [Configuration](operations/configuration.md): every environment variable
  for the API, worker and app.
- [Monitoring](operations/monitoring.md): health probes, logs, metrics,
  alerts, retention and one-off collector runs.
- [Backup & restore](operations/backup-and-restore.md): nightly dumps,
  restore drills and disaster recovery.
- [Upgrading](operations/upgrading.md): upgrade procedure and
  version-specific notes.
- [Troubleshooting](operations/troubleshooting.md): known failure modes and
  how to diagnose them.

## Reference

- [API](reference/api.md): REST and SSE endpoints.
- [Data sources](reference/data-sources.md): upstream catalog, polling
  cadence, licences and optional keys.

## Development

- [Contributing](../CONTRIBUTING.md): workflow, quality gates and pull
  requests.
- [Conventions](development/conventions.md): the code standards every
  change is reviewed against.
- [Testing](development/testing.md): test suites and how to run them.
- [Adding data sources](development/adding-data-sources.md): how to write a
  new collector, and the source maintenance routine.
- [UI design system](development/ui-design-system.md): visual language,
  breakpoints and UI primitives.

## Planning

- [Roadmap](roadmap.md): planned and open work.
- [Changelog](../CHANGELOG.md): notable changes by release.
- [Proposals](proposals/): designs that are not built yet.
