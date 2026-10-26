# Contributing to EzClassify Web

Thanks for your interest in contributing. This page is the process contract. For
environment setup, the command set, repository structure, and the vendored-spec
workflow, see [`DEVELOPMENT.md`](DEVELOPMENT.md).

## Before You Start

1. **Sign off your commits.** This project takes contributions under the
   Developer Certificate of Origin; see the [DCO text](https://github.com/ezclassify/ezclassify/blob/main/DCO.md). `git commit -s` adds
   the `Signed-off-by` line that certifies it. There is no agreement to sign
   and nothing to send us.
2. **Fork the repository.** All contributions come through pull requests from
   forks.
3. **Open an issue first** for non-trivial changes.

## Pull Request Expectations

- **Bring tests.** New behavior needs tests; a bug fix needs a regression test
  that fails without the fix. The suite is Vitest (`npm test`).
- **Framework parity matters.** A feature added to the React integration should
  land in Vue and Angular too, or the gap gets filed as an issue in the same PR.
- **Read the standards.** Engineering standards for design, code quality,
  testing, and decision-making are in [`STANDARDS.md`](STANDARDS.md); read it
  before any significant work.

## Commit Messages

Conventional commits (`fix:`, `feat:`, `docs:`, scoped like `feat(react): ...`).

## Security

Do not open public issues for vulnerabilities. Follow
[`SECURITY.md`](SECURITY.md) for the disclosure process.

## Code of Conduct

This project follows the [Code of Conduct](https://github.com/ezclassify/ezclassify/blob/main/CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.
