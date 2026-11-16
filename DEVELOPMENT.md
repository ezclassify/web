# Developing EzClassify Web

Environment setup, the command set, repository structure, and the vendored-spec
workflow. For the contribution process (DCO sign-off, issue-first etiquette, PR
expectations), see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Prerequisites and setup

Node.js 22 or 24. At runtime everything is browser-side, but builds and tests need
Node.

Generate the development dependency lock through the native command below.
The public workspace dependencies install from npm.

```sh
npm run deps:relock
npm ci
npm run build   # build all packages
npm test        # run the Vitest suite (replays the demo runtime)
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
exercises Angular 20/21/22 linking, production builds and the README
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
private/protected class members, package build wrappers,
repository scripts, example and e2e host source and the [`libs/ui-tools/`](libs/ui-tools/)
library. Install the ui-tools dependencies using the instructions below when
generating this complete source view. Tests are
excluded. TypeDoc describes exported module declarations;
scripts without exports retain their CLI contract in their source headers. CSS,
HTML templates, shell scripts and workflow configuration remain source artifacts
rather than TypeScript API declarations.

Both commands use pinned TypeDoc 0.28.20 and TypeScript 5.9.3 through npm, with
network access needed for the first tool download. They extract declarations
without executing modules or changing generated contracts. Compiler diagnostics
are left to the native build/typecheck commands: the combined source view spans
separate framework compiler environments. Conversion/link warnings fail the docs
commands. Both outputs are ignored; keep the maintainer reference private.

| Action              | Command                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build all packages  | `npm run build`                     | Builds `@ezclassify/ui`, the framework adapters, the four README examples and the e2e hosts in order.                                                                                                                                                                                                                                                                                                                                           |
| Tests               | `npm test`                          | Vitest across [`libs/ui/`](libs/ui/), `integrations`, `scripts` and the integration tier, one project after another, including Angular (`npm run test:angular`, its own config because zone.js needs one). Runtime answers replay from committed recordings, so nothing is started. `npm run test:verbose` for verbose output. Vitest uses all but one core; `VITEST_MAX_WORKERS` caps the workers in every project when the machine is shared. |
| Integration tier    | `npm run test:integration`          | The UI store and the Context-bound scheme adapter driven through `@ezclassify/rest-client` against the demo runtime's recordings, plus the record and replay harness's own specs. Part of `npm test`.                                                                                                                                                                                                                                           |
| Public dependencies | `npm run check:public-dependencies` | Fails if anything in the install closure declares a package an outside contributor cannot install. Runs without a network or a `node_modules` tree.                                                                                                                                                                                                                                                                                             |
| Lint                | `npm run lint`                      | ESLint over [`libs/ui/`](libs/ui/), `integrations`, `tests` and `e2e`.                                                                                                                                                                                                                                                                                                                                                                          |
| Typecheck           | `npm run typecheck`                 | Runs each workspace's `typecheck`: the test sources of [`libs/ui/`](libs/ui/), the three framework integrations, the four README examples, the e2e hosts and specs, and top-level [`tests/`](tests/). Library sources are covered by the declaration emit in each package's build.                                                                                                                                                              |
| Record              | `npm run record`                    | Maintainer lane. Records every spec's demo runtime traffic afresh against a local demo runtime. See below.                                                                                                                                                                                                                                                                                                                                      |
| Recording freshness | `npm run check:recordings`          | Maintainer lane. Records afresh and fails if the result differs from the committed recordings.                                                                                                                                                                                                                                                                                                                                                  |

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
install closure names it. See "Engine behavior in tests" below for how the
tests that need engine answers get them.

## Engine behavior in tests

This repository is public and its build has to work for somebody who has only
what is public. Most of the behavioral coverage here drives the UI against real
engine answers over real scheme content, and the engine is not installable. So
engine behavior reaches this repository one way only: as committed recordings
of the wire traffic of the demo runtime, the runtime the website Playground
uses. No spec, fixture or test helper imports an engine, and
`npm run check:spec-imports`
([`scripts/check-spec-imports.mjs`](scripts/check-spec-imports.mjs)) fails on any source under the spec roots that
imports `@ezclassify/engine` or `@ezclassify/engine-wasm`. It reads source text only, so CI runs it first,
before anything is installed.

**What a clean clone runs, and what CI gates on**, is everything. `npm run
deps:relock` and `npm ci` against a public registry, `npm run build`, `npm
test`, `npm run lint`, `npm run typecheck`. A spec that needs runtime answers
gets a client from [`test-support/demo-runtime.ts`](test-support/demo-runtime.ts):

```ts
import { connectDemoContext } from '../../test-support/demo-runtime';

const client = await connectDemoContext({ contextId: 'cedar-valley' });
const draft = await connectDemoContext({ draft: { scheme: schemeYaml } });
```

The client is an ordinary `EzClassifyClient`. In the public lane its requests
are answered from the spec file's recordings, `__recordings__/<spec file
name>.json` beside the spec, and nothing is started. A request with no
recording fails the spec file, listing every unrecorded request, even when the
code under test caught the error. A spec file with no recordings fails on its
first connection. Nothing is skipped. A changed request or fixture is a new
request, because a recording is keyed by the request, so it fails the same way
until it is recorded.

The runtime answers over the wire, so the UI paints its answers when they land,
not during the call that asked. A spec that reads the page after an action
awaits `demoRuntimeSettled()` from the same module: it resolves once no request
of the spec file is in flight and none has started for two turns of the event
loop, and it fails rather than hangs when code keeps sending.

Prefer the built-in demo Contexts (Cedar Valley is built in as `cedar-valley`,
`cedar-valley-protection` and `cedar-valley-handling`). A fixture of this
repository goes through the demo runtime's draft door with `{ draft }`. A draft
must come from this repository: one read from a content checkout could not be
keyed in a clone that does not have it.

**Recording is the maintainer lane.** It needs the `engine`, `orchestration`
and content checkouts beside this repository, and a Rust toolchain:

```sh
npm run record              # delete every recordings file and record afresh
npm run check:recordings    # the same, then fail if anything differs from Git
EZCLASSIFY_RECORD=1 npx vitest run <spec>   # record one spec file's traffic
```

With `EZCLASSIFY_RECORD=1`, each test project's global setup
([`test-support/demo-runtime-global-setup.ts`](test-support/demo-runtime-global-setup.ts)) assembles the website demo set
with orchestration's `assemble-demo-contexts.mjs`, builds
`ezclassify-demo-runtime` the way the hosted demo runtime image does (the
`release` profile, `--locked`, with the `provide` feature; `CARGO_BUILD_JOBS=4`),
starts it on a loopback port and waits a bounded time for it to answer. Each
pin builds in a directory of its own under the engine checkout's
`target/web-recordings/pin-<commit>/`, holding the extracted source and a Cargo
target directory that no other pin uses, so a recording never links crates
compiled from another pin and moving the pin compiles from nothing. A build is
reused while the engine pin, those build settings and the assembled demo set
are unchanged, so only the first project of a run compiles. Old
`pin-*` directories and `runtime-*` builds are caches; delete any you no longer
need.
Every request then goes to that runtime unless the spec file's recordings
already hold it, and the recordings file is rewritten at the end of the file.
UI code sends requests whose timing depends on how fast answers arrive, so `npm
run record` runs the suite in record mode until a pass adds nothing, which is a
pass at replay speed, and then replays it once keeping only the answers the
replay used (`EZCLASSIFY_PRUNE_RECORDINGS=1`), and a second time to prove a
replay uses the same answers each time. A failed run puts back the recordings
files it started with. A live answer that says the runtime was busy or failed
(`429` or `5xx`) is never recorded: it fails the spec file instead. To record
one spec file by hand, delete its recordings file, record it twice and then
prune it with one replay.

Recordings have to be reproducible from this repository, so the checkouts they
are made from are pinned in `test-support`:

- [`runtime.pin`](test-support/runtime.pin): the runtime commit the demo runtime is built from. The setup
  extracts that commit's source from the runtime checkout with `git archive`,
  so the checkout's own branch and edits do not reach a recording.
- [`community-content.pin`](test-support/community-content.pin) and [`enterprise-content.pin`](test-support/enterprise-content.pin): recording
  refuses a checkout whose `scheme-folder` differs from its pin, committed,
  edited or untracked.
- [`orchestration.pin`](test-support/orchestration.pin): the same, for the assembly script and every
  module it imports, `manifests/demo-contexts.yaml`, and the `package.json` and
  `package-lock.json` that fix the packages the script imports.

Moving a pin and re-recording is one change. `check:recordings` is the
freshness check: recording from nothing against the pinned engine and content
must reproduce the committed files byte for byte, so a changed answer, a new
request or a request no spec sends any more all fail it.
[`.github/workflows/recordings.yml`](.github/workflows/recordings.yml) runs it in the official repository on
demand, so run it after changing a spec, a fixture, the UI code a spec drives,
the harness, the test configuration, the root manifest, a recording or a pin;
a fork has nothing to run there.

The [`libs/ui-tools/`](libs/ui-tools/) helper is outside the public workspace closure. Its
record and replay core needs nothing it installs, so the harness imports that
source directly. To work on the rest of it, from the repository root:

```sh
npm install --prefix libs/ui-tools --ignore-scripts
npm run build --prefix libs/ui-tools
npm test --prefix libs/ui-tools
```

These keep its dependencies in its own install; they do not add them to the
public workspace manifests. Run its build and tests before generating the
complete source reference.

`npm run check:public-dependencies` keeps the closure public. It reads the
committed manifests and fails if anything in the install closure declares a
package that is not on a public registry.

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

### Cross-adapter conformance

[`libs/ui/src/store/adapter-parity-suite.ts`](libs/ui/src/store/adapter-parity-suite.ts) is the cross-framework contract. It
is one source file, reached through the `@ezclassify/ui/adapter-parity-suite`
vitest alias, and each framework runs it against its own store: vanilla, React,
Vue, and Angular. It takes the engine as a parameter and constructs nothing.

The `EzClassifyStore` conformance suite,
[`test-support/store-conformance.ts`](test-support/store-conformance.ts), covers more of the store contract
over a pass-through engine, and the same four stores run it. A store adapter
that drops a scoped category or a capture value on publish, rollup, or capture
fails in CI, on a pull request, for anybody.

### The vendored wire corpus

[`vendor/spec/`](vendor/spec/) carries the plans and fixtures of the frozen wire contract. The
engine-slice conformance runner, [`libs/ui/tests/conformance.spec.ts`](libs/ui/tests/conformance.spec.ts), drives
every applicable plan case through `EzClassifyUI` against the demo runtime's
recordings. Server-slice plans (`ctx*` methods) run against a live REST
deployment, not here.

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
it, and non-codegen pull requests do not require spec regeneration. Code review
enforces this through the `vendor/spec/` owners rule. See [`vendor/SPEC.md`](vendor/SPEC.md) for the current provenance record.
