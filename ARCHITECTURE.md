# Architecture Ownership

## Sources of truth

EzClassify Runtime defines engine and Context behavior. The wire contract and
canonical types come from the [ezclassify/contracts](https://github.com/ezclassify/contracts)
repository and reach this repository two ways: the published `@ezclassify/types` package, and the protected [`vendor/spec/`](vendor/spec/)
mirror. [`libs/ui/`](libs/ui/) owns shared framework-neutral UI behavior and its internal
component architecture is documented in
[`libs/ui/ARCHITECTURE.md`](libs/ui/ARCHITECTURE.md). Public package exports and
their committed public-surface tests define this repository's supported surface.

## Generated code

[`vendor/spec/`](vendor/spec/) and [`vendor/SPEC.md`](vendor/SPEC.md) are written only by the spec bot.
Build output, declarations, and example and e2e host artifacts are
derived and must remain reproducible from committed sources.

This repository does not generate engine DTOs. It consumes canonical TypeScript
types from the `@ezclassify/types` package and keeps its vendored mirror fresh as a cross-surface
contract.

## Handwritten seams

[`libs/ui/`](libs/ui/) owns shared marked-input, autocomplete, guide-review, result
presentation, navigation, and interaction behavior. Angular, React, and Vue
packages own language-native lifecycle, reactivity, and component bindings over
those shared primitives and a caller-supplied canonical Context.

Framework adapters may expose thin ergonomic methods that delegate once to a
canonical Context operation. Formatting, filtering, grouping, and selection UI
state are web responsibilities when they do not change the canonical DTO.

## Forbidden ownership

Do not recreate Scheme, Guide, Access, or Context composition in a framework
adapter. Do not split one loaded Context into per-guide Contexts, promote a
lexical nomination into an accepted fact, synthesize provenance, or maintain a
framework-specific policy algorithm.

Do not import the engine's `src/`, `internal/`, or filesystem layout. Browser
builds use only supported package exports and public browser shims.

## Required gates

- full tests, type checks, lint, and formatting
- UI, integration, public-surface, and framework adapter tests
- all library, IIFE, example and e2e host builds
- behavior tests for nomination-only guide scans and canonical Context delegation
  (`guide-helper.spec.ts` and framework public-API tests)
- protected spec-mirror freshness before a coordinated release

A behavior added to more than one framework package first belongs in [`libs/ui/`](libs/ui/)
or another shared package unless the behavior is inherently framework-specific.
