# Agent Instructions

## Standards

Read [`STANDARDS.md`](./STANDARDS.md) before any feature, refactor, architectural decision, or task > 30 minutes. These engineering standards apply to you as they do to any contributor. Skip for: quick bug fixes, typos, documentation-only changes.

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) before changing shared UI ownership,
framework adapter behavior, Context usage, generated artifacts, or dependency
direction.

## The public install closure

This repository is public and it has to build for somebody who has only what is
public. [`package.json`](package.json) therefore names its workspaces one by one instead of
globbing a directory, and that list is the whole install closure:

- [`libs/ui/`](libs/ui/): the shared UI library (`@ezclassify/ui`).
- [`integrations/angular/`](integrations/angular/), [`integrations/react/`](integrations/react/), [`integrations/vue/`](integrations/vue/): the
  framework integrations.
- [`examples/vanilla-example/`](examples/vanilla-example/), [`examples/react-example/`](examples/react-example/), [`examples/vue-example/`](examples/vue-example/),
  [`examples/angular-example/`](examples/angular-example/): the README examples, described below.
- `e2e`: the browser lanes and the integration hosts they drive, described
  below.

Everything in the closure installs from a public registry. `npm run
check:public-dependencies` enforces that by reading the committed manifests: no
package in the closure may declare `@ezclassify/engine`,
`@ezclassify/example-schemes`, `@ezclassify/testing-utils`, or anything else
that is not published publicly. If a spec needs one of those, it belongs to the
private lane in [`DEVELOPMENT.md`](DEVELOPMENT.md), not in a dependency field.

The engine in particular is never a dependency of anything here, in any field,
including a dev one. It is embedded in EzClassify's own applications and is not
published as an importable library, so declaring it would break `npm install`
for every outside contributor and would advertise a package nobody can get.

The REST client is not here either. `@ezclassify/rest-client` ships from its own
repository, [ezclassify/client-js](https://github.com/ezclassify/client-js), alongside the Java, .NET, Python and Go
clients. This repository consumes it as an ordinary published dependency,
which is what an integrator does.

## Outside the closure

These directories are in the repository but are not workspaces, and a clean
clone does not install them. Each installs and runs on its own, in the private
lane.

- [`libs/ui-tools/`](libs/ui-tools/) (`@ezclassify/ui-tools`): Playwright test tooling. It has no
  consumer in this repository and it depends on `@ezclassify/testing-utils`,
  which is not on a public registry, so it can never go to npmjs.org and it can
  never join the closure above. Do not import it and do not depend on it here.

    Its consumers are first-party repositories that install it like any other
    dependency, so it does publish: `publish-mirror.yml` builds it in its own
    directory and publishes it to the development mirror alongside the closure
    packages. The committed manifest stays `private: true` and the workflow
    drops that in the runner's own checkout. The source is public; the committed `private: true` flag prevents
    accidental npmjs.org publication and is checked by the local bootstrap.
    Keep that flag in the maintained manifest.

    It installs and tests on its own, from this directory. The root vitest
    config excludes its specs because they resolve against
    `libs/ui-tools/node_modules`, which a clean clone does not have.

    A new package under [`libs/`](libs/) or [`integrations/`](integrations/) has to be published
    somewhere or it is unreachable for the repositories that declare it.
    [`scripts/mirror-coverage.spec.ts`](scripts/mirror-coverage.spec.ts) fails until the mirror workflow names it.

[`libs/ui/`](libs/ui/)'s `build:browser` target builds a standalone IIFE of the UI for local
evaluation pages. It carries no engine, is excluded from the published tarball,
and is not part of `npm run build`.

The README examples follow their own rules:

- [`examples/vanilla-example/`](examples/vanilla-example/), [`examples/react-example/`](examples/react-example/), [`examples/vue-example/`](examples/vue-example/)
  and [`examples/angular-example/`](examples/angular-example/) are each the document form from one package
  README ([`libs/ui/`](libs/ui/), then the three integrations), file for file.
  [`scripts/readme-examples.spec.ts`](scripts/readme-examples.spec.ts) fails when a README block and its example
  file differ, so change both together. Each example runs with its CLI's own
  dev command (`npm run dev` for Vite, `npm start` for `ng serve`) and connects
  to `http://127.0.0.1:4010` unless `VITE_EZCLASSIFY_URL` (Vite) or
  `src/environments/environment.ts` (Angular) says otherwise. Page styles stay
  in `src/styles.css`: page layout plus one minimal style for native `input`,
  `textarea` and `button`, the edge, padding and font the controls take from
  the field they enhance, and a focus ring like the library's. Keep that file's
  field rules identical across the four examples and never style anything
  inside a control.

    They carry NO engine (not as a dependency, not in a bundle), and
    `npm run check:consumer-engine-free` enforces it. That gate runs in CI and
    builds every example itself, so it reads the bytes a browser would rather
    than whatever happens to be left on disk.

The browser lanes live in [`e2e/`](e2e/), one Playwright configuration whose lane the
environment selects ([`e2e/lanes.mjs`](e2e/lanes.mjs)):

- Default: [`e2e/examples/document-form.spec.ts`](e2e/examples/document-form.spec.ts) drives all four examples
  through the README path against the Cedar Valley replay. Playwright starts
  one `@ezclassify/conformance-server` per example (the server permits one
  browser origin) and each example's own dev server. Any refused request or
  console error fails the run. `npm run e2e` runs it.
- `EZ_INTEGRATION_SCENARIO=golden-corpus` runs [`e2e/hosts/golden-corpus.spec.ts`](e2e/hosts/golden-corpus.spec.ts)
  against the React and Angular integration hosts in [`e2e/hosts/`](e2e/hosts/). Each host's
  dev server starts the replay for the whole golden wire corpus in its own
  process ([`e2e/hosts/backend.mjs`](e2e/hosts/backend.mjs)) and relays `/v1` to it, which fixes the
  Context to `ez-full@1.0.0` over the `ez-test` scheme.
  `npm run e2e:golden-corpus` runs it. `context-not-found` and
  `version-not-found` run [`e2e/hosts/scenario-refusal.spec.ts`](e2e/hosts/scenario-refusal.spec.ts) the same way.
- [`e2e/hosts/licensed-deployment.spec.ts`](e2e/hosts/licensed-deployment.spec.ts) is the licensed lane. It holds the
  two cases requiring a real deployment and is selected when
  `EZ_LICENSED_RUNTIME_STATUS_FILE` names its status file. The host backend
  reads the same variable to select the relay; a status file may leave
  `session.contextVersion` out to let the deployment decide. Missing required
  content variables fail discovery. Exactly one backend lane runs. This
  repository does not create that status file; whatever does also supplies the
  scheme content those cases assert against, through the `EZ_CONSUMER_*`
  variables the spec names. Do not put a marking, a scheme id, or a color from
  any deployment's scheme into the hosts.

The hosts test the integrations, not the README: keep the React and Angular
hosts identical, so a difference between them is an integration's problem.

Vite is pinned to `^8.0.0` in the Vite examples and the e2e hosts, with
compatible `@vitejs/plugin-react` and `@vitejs/plugin-vue` majors. Keep their
peer ranges aligned so a standalone example install resolves the same toolchain
as the public workspace.
