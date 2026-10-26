# Engineering Standards

Design, code quality, testing, and decision-making rules for this project. All contributors follow these.

---

## Design

- **Readability first; performance when it matters.** If a less-readable path has significant performance gains, take it, but document why with a comment explaining the tradeoff.
- **Purist design over quick fixes.** Invest in correct abstractions upfront. Architectural debt that compounds should be prevented, not queued.
- **Interfaces over concrete types.** Depend on interfaces and abstractions, never concrete classes. Factories accept implementations; they don't construct them across layers.
- **Own the blast radius of your changes.** When you change something, know the full ripple and address it in the same PR. Don't leave broken dependents "to fix later" without an explicit decision to do so.

## Code Quality

- **JSDoc on all exports.** Every exported function, class, type, and interface gets JSDoc for purpose and contract; not a description of what the code does. Format for doc generators (TypeDoc, PlantUML, etc.).

- **Comments explain WHY, not WHAT.** Only comment when the next developer might not understand why you didn't do the obvious thing. Explain constraints, workarounds, hidden dependencies; not logic flow.

- **Zero trust at public boundaries.** Validate all inputs on public API and external API responses. Trust internal calls between private methods. Fail fast with clear errors at boundaries.
- **TypeScript strictness.** No `any` in source (tests may use file-level eslint-disable). Remove unused imports. Prefix intentionally unused params with `_`. Use `const` for non-reassigned variables.
- **No inline CSS.** Use CSS modules or classes. Exception: CSS custom property injection, `style={{ '--var': value } as React.CSSProperties}`.
- **`rem` for all sizing.** Not `px`.

## Testing

- **Order: Contract → Tests → Implementation.** Write JSDoc first, tests second, implementation third. Tests are specs, not afterthoughts.
- **One responsibility per method.** Single purpose, clear `@param`/`@returns`, no side effects unless that's the method's entire point.
- **Test behavior, not coverage percentages.** Each test verifies a specific path: happy path, bad path, or defensive guard. Skip tests that add no value.
- **Separate test types strictly.**
    - **Unit:** import from source files; test functions in isolation
    - **Integration:** import from public package API only; use real classes, no mocks of internal modules
    - **E2e:** run against real browsers (Playwright) or real servers
- **Bug fixes require regression tests.** Every fix needs a test that fails before the fix and passes after. No exceptions.

## Decision-Making

- **Consumer compatibility survives tooling upgrades.** Modernizing build or
  development tools must not raise consumer framework peers. Support the oldest
  upstream-maintained framework line and the current line through real packed
  consumer builds and behavior tests. Record actual API/compiler constraints and
  upstream support-policy ambiguity instead of inventing an EOL floor. Review
  minimum changes with compatibility evidence.
  Angular partial-Ivy is built on the oldest supported compiler line (20),
  with packed linking/build/behavior checks on 20, 21 and 22. React's 18 API floor
  comes from `useSyncExternalStore`; Vue's 3.3 public type floor includes
  `SlotsType`. These are our tested API contracts, not official upstream EOL
  cutoffs: React backports security fixes across affected majors, and Vue does
  not publish a minor-version LTS matrix. The packed lane checks React 18/current 19
  and Vue 3.3/current 3.5 without recommending old patch versions for deployment.
  See [Angular library compatibility](https://angular.dev/tools/libraries/creating-libraries#ensuring-library-version-compatibility),
  [React versioning](https://react.dev/community/versioning-policy) and
  [Vue security policy](https://github.com/vuejs/core/security/policy).

- **Stable contracts, incremental changes.** Preserve published API compatibility. Prefer incremental, reversible changes and follow semantic versioning for breaking changes.
- **Inline small debt, backlog large debt.** Found debt under 30 min effort: fix inline. Larger refactors, dependency upgrades, or architectural changes: log to backlog, don't auto-execute.
- **Don't let tasks balloon.** If you discover work that significantly exceeds the original scope, stop, log it, and stay on scope. Surface it for explicit prioritization.
