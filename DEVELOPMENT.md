# Developing EzClassify Web

Environment setup, the command set, repository structure, and the vendored-spec
workflow. For the contribution process (DCO sign-off, issue-first etiquette, PR
expectations), see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Prerequisites and setup

Node.js 22 or 24. At runtime everything is browser-side, but builds and tests need
Node.

Generate the development dependency lock through the native command below.
The public workspace dependencies install from npm; the private test lane uses
the separately configured development registry described below.

```sh
npm run deps:relock
npm ci
npm run build   # build all packages
npm test        # run the Vitest suite (includes conformance)
npm run lint    # lint all packages
```

Repository tooling lives at the root; each workspace declares the dependencies
needed to build and run it on its own.

The Angular library uses an Angular 20 toolchain and TypeScript 5.9 so its partial-Ivy
output links in Angular 21 and 22 applications. Ordinary strict workspace installs
keep these compiler peers separate from root tools and the Angular 22 sample.
Library builds reject a different compiler version. The sample resolves Angular
from its own dependency tree so workspace links cannot load a second runtime.
Unused Angular-eslint plugins are absent; the root ESLint 10 configuration owns
linting without installing an older ESLint solely to satisfy unused peers.

`npm run verify:pack-consume` installs the actual published APF directory and
exercises Angular 20/21/22 linking, production builds, `ng-add`, and the README
document-form browser suite against the Angular example. It also checks strict
public types and DOM mount/update/unmount for React 18/current 19 and Vue
3.3/current 3.5 from the same packed artifacts.
Install Chromium first with `npx playwright install chromium`. Compatibility
fixtures at old patch versions prove the API boundary; they are not security
recommendations. All new third-party intake still observes the seven-day gate.

## Commands

Generate the public package reference with `npm run docs`, then open
`dist/api/index.html`. It follows the reviewed entrypoints of `@ezclassify/ui`
and the Angular, React and Vue bindings. References to canonical contract types
link to their owning source in the [ezclassify/contracts](https://github.com/ezclassify/contracts) repository; documentation does not add package
exports or a runtime dependency.

`npm run docs:source` creates a separate private maintainer reference at
`dist/source-reference/index.html`. It includes maintained source modules,
private/protected class members, package build wrappers, Angular schematics,
repository scripts, example and e2e host source and the private [`libs/ui-tools/`](libs/ui-tools/)
library. Install the private lane and ui-tools dependencies using the
instructions below when generating this complete source view. Tests and compiled
schematics output are excluded. TypeDoc describes exported module declarations;
scripts without exports retain their CLI contract in their source headers. CSS,
HTML templates, shell scripts and workflow configuration remain source artifacts
rather than TypeScript API declarations.

Both commands use pinned TypeDoc 0.28.20 and TypeScript 5.9.3 through npm, with
network access needed for the first tool download. They extract declarations
without executing modules or changing generated contracts. Compiler diagnostics
are left to the native build/typecheck commands: the combined source view spans
separate framework compiler environments. Conversion/link warnings fail the docs
commands. Both outputs are ignored; keep the maintainer reference private.

| Action              | Command                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build all packages  | `npm run build`                     | Builds `@ezclassify/ui`, the framework adapters, the four README examples and the e2e hosts in order.                                                                                                                                                                                                                                                                                                 |
| Unit tests          | `npm test`                          | Vitest across [`libs/ui/`](libs/ui/), `integrations`, and `scripts`. Angular runs as its own step (`npm run test:angular`) because zone.js needs a separate config. `npm run test:verbose` for verbose output.                                                                                                                                                                                        |
| Public dependencies | `npm run check:public-dependencies` | Fails if anything in the install closure declares a package an outside contributor cannot install. Runs without a network or a `node_modules` tree.                                                                                                                                                                                                                                                   |
| Integration tests   | `npm run test:integration`          | Adapter-parity suite: one operation set run against both a local engine and `EzClassifyClient` over HTTP. Private lane, and it boots a server, so it stays out of `npm test`.                                                                                                                                                                                                                         |
| Lint                | `npm run lint`                      | ESLint over [`libs/ui/`](libs/ui/), `integrations`, `tests` and `e2e`.                                                                                                                                                                                                                                                                                                                                |
| Typecheck           | `npm run typecheck`                 | Runs each workspace's `typecheck`: the test sources of [`libs/ui/`](libs/ui/), the three framework integrations, the four README examples, the e2e hosts and specs, and top-level [`tests/`](tests/). Library sources are covered by the declaration emit in each package's build. `node scripts/typecheck-specs.mjs <workspace> --lane=auto` adds the private-lane specs in a maintainer's checkout. |
| Private lane        | `npm run lane:private`              | Installs the proprietary packages the second test lane needs. Nothing in the public build requires it. `-- --check` reports the lane without installing.                                                                                                                                                                                                                                              |

This repo is a UI library. It generates nothing from the vendored spec and has
no local-deploy targets. It is consumed by downstream applications, which own
their own deployment.

## Package notes

- [`libs/ui/`](libs/ui/)'s `npm run build:browser` produces a standalone IIFE for local demo
  and evaluation pages. It holds the UI and `@ezclassify/types` only, so a page
  supplies its own engine adapter. It is not part of `npm run build` or the
  published package: `files` ships `dist/lib` only.
  [`libs/ui/tests/browser/iife-smoke.html`](libs/ui/tests/browser/iife-smoke.html) loads that local bundle.
- `@ezclassify/angular` builds with ng-packagr into `dist/ngpkg/`, not the
  source root, so packing from the source root produces a tarball with no
  compiled code. Publish it with `npm run publish:lib` from
  [`integrations/angular/`](integrations/angular/); `npm run pack:dry` runs the same build with
  `pack --dry-run`.
- `npm run test:angular` runs the Angular suite on its own, because zone.js
  needs a separate config.

## Repository structure

This repo is organized as a one-way chain, and new code goes in the layer
that owns the behavior:

- `@ezclassify/ui` owns the primitives: low-level engine adapters, controller
  bindings, shared rendering helpers, and token-aware building blocks. Reusable
  engine/UI plumbing belongs here ([`libs/ui/`](libs/ui/)).
- Host applications own routing and chrome. The README examples, the e2e hosts
  and downstream applications decide which shared components to mount and which
  host tokens to override. Deployment wiring belongs to the host.

Dependency direction is strictly downward. Primitives never import shells.
Shells import public package entrypoints only; they do not reach into another
package's `src/`.

**The engine is upstream, and it is not installable here.** These packages are
written against an engine-compatible adapter and never construct one. Engine
behavior (parsing, validation, rollup, access) belongs to the EzClassify
runtime, and the engine reaches an application embedded in an EzClassify
deployment, not as a package anybody installs. Nothing in this repository's
install closure names it. See the two lanes below for how the tests that drive
a real engine still run.

## The two test lanes

This repository is public and its build has to work for somebody who has only
what is public. That is a stronger claim than it sounds, because a good deal of
the coverage here drives the UI with a real in-process engine over real scheme
content, and neither the engine nor that content is installable.

So there are two lanes, and which one you are in is detected rather than
configured.

**The public lane** is what a clean clone gets, and it is what CI gates on.
`npm install` from a public registry, `npm run build`, `npm test`, `npm run
lint`, `npm run typecheck`. It covers every package's own behavior, the wire
contract, the framework bindings and the gate scripts, and it builds the four
README examples and scans them for an engine. `npm run e2e` drives the examples
in a browser; CI drives the Angular example that way through
`npm run verify:pack-consume`. An outside contributor can reproduce all of it
exactly, which is the only reason it is worth gating on.

**The private lane is for authorized EzClassify maintainers only.** It adds `@ezclassify/engine`, `@ezclassify/example-schemes`,
`@ezclassify/rest-api`, and the store conformance suite out of
`@ezclassify/testing-utils`. It is the authoritative runtime integration run:

```sh
npm run lane:private          # installs the private runtime packages
npm test                      # now runs everything
npm run test:integration      # adapter parity against the real REST API
npm run lane:private -- --check   # report the lane, install nothing
```

The private [`libs/ui-tools/`](libs/ui-tools/) helper is outside the public workspace closure.
Configure npm's `@ezclassify` scope to use an authorized private development
registry before installing it. From the repository root, run:

```sh
npm install --prefix libs/ui-tools --ignore-scripts --tag=dev
npm run build --prefix libs/ui-tools
npm test --prefix libs/ui-tools
```

For an existing helper install, refresh its private dependency with
`npm update --prefix libs/ui-tools @ezclassify/testing-utils --ignore-scripts --tag=dev`.
These commands keep private dependencies in the helper's own install; they do
not add them to the public workspace manifests. Run its build and tests before
generating the complete source reference.

The store conformance specs run in EzClassify’s maintainer integration
environment. Maintainers use the internal setup instructions for that
environment; contributors can run the public lane from this repository alone.

[`vitest.private-runtime.ts`](vitest.private-runtime.ts) decides which specs belong to which lane by reading
what they import, including through a local fixture module, so a spec joins or
leaves the private lane on its own. [`scripts/typecheck-specs.mjs`](scripts/typecheck-specs.mjs) asks it the
same question, so the typecheck covers exactly the specs the public lane can
run and says how many it left out. When it excludes anything it says so on
stdout, and under GitHub Actions it also writes a run annotation and a job
summary block, because a skipped suite is otherwise invisible in a green run.

Naming the cost plainly: a regression that only a private-lane spec catches will
not turn a public pull request red. That is the price of a gate an outside
contributor can actually run, and the mitigation is that the private lane runs
before anything ships.

`npm run check:public-dependencies` is what keeps the split real. It reads the
committed manifests and fails if anything in the install closure declares a
package that is not on a public registry, so the public lane cannot quietly
acquire a private dependency.

### Examples and browser lanes

[`examples/vanilla-example/`](examples/vanilla-example/), [`examples/react-example/`](examples/react-example/), [`examples/vue-example/`](examples/vue-example/) and
[`examples/angular-example/`](examples/angular-example/) are in the public workspace. Each is the document
form from its package README, and [`scripts/readme-examples.spec.ts`](scripts/readme-examples.spec.ts) keeps the
two identical. They carry no engine, they talk to a real socket served by
`@ezclassify/conformance-server`, and `npm run check:consumer-engine-free`
proves it.

The browser lanes are one Playwright configuration in [`e2e/`](e2e/). Install Chromium
once with `npx playwright install chromium`, then:

```sh
npm run e2e                     # the four examples against the Cedar Valley replay
npm run e2e:golden-corpus       # the integration hosts against the golden wire corpus
```

The default lane starts each example and its own replay server the way the
example's README does, then drives the README path and fails on any refused
request or console error. Set `EZ_E2E_EVIDENCE_DIR` to collect its desktop and
phone screenshots in one directory. The licensed lane runs the integration
hosts against a deployment when `EZ_LICENSED_RUNTIME_STATUS_FILE` names its
status file; [`AGENTS.md`](AGENTS.md) lists what that lane needs.

## Conformance

### Cross-adapter conformance, the public half

[`libs/ui/src/store/adapter-parity-suite.ts`](libs/ui/src/store/adapter-parity-suite.ts) is the cross-framework contract that
runs in the public lane. It is one source file, reached through the
`@ezclassify/ui/adapter-parity-suite` vitest alias, and each framework runs it
against its own store: vanilla, React, Vue, and Angular. It takes the engine as
a parameter and constructs nothing, so it needs no proprietary package and an
outside contributor runs it with `npm test` like everything else.

This is what makes adapter conformance a real gate here rather than a documented
absence. A store adapter that drops a scoped category or a capture value on
publish, rollup, or capture fails in CI, on a pull request, for anybody.

### Cross-adapter conformance, the private half

The `EzClassifyStore` conformance suite in `@ezclassify/testing-utils` covers
more of the contract than the parity suite does, and it cannot come here: it
imports an engine subpath that is deliberately not a published export. Its
specs run only in the maintainer integration environment described above:

- [`libs/ui/src/store/ezclassify-store.spec.ts`](libs/ui/src/store/ezclassify-store.spec.ts)
- [`integrations/react/src/react-ezclassify-store.spec.ts`](integrations/react/src/react-ezclassify-store.spec.ts)
- [`integrations/vue/src/composables/vue-ref-store.spec.ts`](integrations/vue/src/composables/vue-ref-store.spec.ts)

### The vendored wire corpus

[`vendor/spec/`](vendor/spec/) carries the plans and fixtures of the frozen wire contract. The
engine-slice conformance runner, [`libs/ui/tests/conformance.spec.ts`](libs/ui/tests/conformance.spec.ts), drives
every applicable plan case through `EzClassifyUI` over a locally constructed
engine, so it is private lane. Server-slice plans (`ctx*` methods) run against
a live REST deployment, not here.

The same corpus is exercised in the public lane from the other side. The
integration hosts in [`e2e/hosts/`](e2e/hosts/) run against `@ezclassify/conformance-server`,
the published replay server for that corpus, over a real socket with no engine
in the loop. `npm run e2e:golden-corpus` is that lane; `npm run e2e` runs the
README examples against the Cedar Valley scenario.

[`vendor/`](vendor/) is written only by the `ezclassify-spec-bot` GitHub App, which vendors
the published contract from
[ezclassify/contracts](https://github.com/ezclassify/contracts). When the
contract changes, the spec bot opens a pull request with updated [`vendor/spec/`](vendor/spec/)
and [`vendor/SPEC.md`](vendor/SPEC.md).
Never edit anything under [`vendor/`](vendor/) by hand: push your changes without touching
it, and non-codegen pull requests do not require spec regeneration. The
`vendor-readonly` workflow enforces this on both pull requests and direct
pushes. See [`vendor/SPEC.md`](vendor/SPEC.md) for the current provenance record.
