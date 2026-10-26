# Security Policy

## Supported Versions

| Version | Status             | Security Patches | End of Life |
| ------- | ------------------ | ---------------- | ----------- |
| 1.x     | Active development | Yes              | None        |

Only the latest patch release within each supported major version receives security updates. This policy covers every package published from this repository: `@ezclassify/ui`, `@ezclassify/react`, `@ezclassify/vue`, and `@ezclassify/angular`.

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Email **security@ezclassify.com** with the following information:

- Description of the vulnerability and its potential impact.
- Steps to reproduce the issue, including proof-of-concept if possible.
- Affected packages, versions, and configurations.
- Any suggested remediation, if available.

You will receive an acknowledgment within **48 hours**. We follow a **90-day coordinated disclosure** window from the date of the initial report.

## What Is a Security Issue

A security issue is a defect that could be exploited to compromise confidentiality, integrity, or availability. For the UI packages, examples include:

- Cross-site scripting through marking strings, scheme content, or suggestion labels rendered into the DOM.
- Arbitrary code injection through crafted server responses rendered into the DOM.
- Prototype pollution or object injection while reading a server response or configuration.
- Denial of service through crafted input that causes excessive resource consumption in the browser.
- A compromised or tampered package distribution path.

The following are **not** security issues and should be filed as regular bugs:

- Ordinary classification, rollup, or scoring defects with no suspected security impact; report them on the [central EzClassify tracker](https://github.com/ezclassify/ezclassify/issues).
- Performance regressions that do not involve unbounded resource consumption.
- Visual or layout issues in components or framework integrations.
- Missing validation that does not lead to exploitable behavior.
- Documentation errors.

Report suspected unauthorized disclosure, incorrect access decisions, or lowered
markings that could expose protected data privately to security@ezclassify.com.
If you are unsure whether something qualifies, use that address and we will
triage it.

## Response Timeline

| Stage                  | Timeline                         |
| ---------------------- | -------------------------------- |
| Acknowledgment         | Within 48 hours                  |
| Initial assessment     | Within 5 business days           |
| Patch development      | Within 30 days for critical/high |
| Coordinated disclosure | 90 days from initial report      |

If a fix is available before the 90-day deadline, we disclose upon release. If a fix is delayed, we negotiate an extended timeline with the reporter.

## Security Update Process

1. Reporter submits vulnerability through email.
2. We acknowledge receipt and assign a tracking identifier.
3. We assess severity using CVSS v3.1 scoring.
4. We develop and test a patch on a private branch.
5. We issue a CVE (if applicable) and publish a GitHub Security Advisory.
6. We release a patch version and notify downstream users via the advisory.
7. The advisory and CHANGELOG entry are published simultaneously with the fix.

## Security Scanning

- **Automated updates**: Dependabot monitors npm and GitHub Actions dependencies weekly and opens pull requests for known vulnerabilities.
- **Dependency auditing**: run `npm audit` locally before opening a pull request that adds or bumps dependencies.
- **Release verification**: npm releases are published only by the central release automation. npmjs.org signs every package version it publishes, and `npm audit signatures` checks after install that the files you received are the ones the registry published.

## Contact

For non-vulnerability security questions, reach us at security@ezclassify.com.
