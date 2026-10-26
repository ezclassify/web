# <img src="assets/icon.svg" alt="" width="32"> EzClassify Web

[![CI](https://github.com/ezclassify/web/actions/workflows/ci.yml/badge.svg)](https://github.com/ezclassify/web/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40ezclassify%2Fui?label=%40ezclassify%2Fui)](https://www.npmjs.com/package/@ezclassify/ui)
[![license: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js 22 | 24](https://img.shields.io/badge/node-22%20%7C%2024-339933.svg)](package.json)

Apache-2.0 UI components and React, Vue, and Angular integrations for
EzClassify. Add marking inputs, suggestions, validation, and document banners
to an application connected to an EzClassify REST deployment.

The REST client the examples below import, `@ezclassify/rest-client`, ships from
[ezclassify/client-js](https://github.com/ezclassify/client-js) with the Java,
.NET, Python and Go clients. Install it alongside these packages.

## Boundary

This repository contains no implementation of the proprietary classification
engine and no enterprise schemes. Every package here works against an
engine-compatible adapter, and the supported way to get one is
`@ezclassify/rest-client` connected to a licensed EzClassify REST deployment. The
REST service holds the engine and the content; the browser renders what it
answers.

The engine runs inside EzClassify's runtime applications. Browser and server
applications call that deployment through a REST client.

Opening, modifying, or redistributing this UI code grants no right to use the
engine or EzClassify-maintained content. A browser does not evaluate a
commercial license or install signed enterprise bundles; it follows the backend
that serves it.

Version compatibility follows the REST client. Its spec-version accessor and
health-call compatibility warnings are documented in the
[JavaScript client guide](https://github.com/ezclassify/client-js#version-skew).

## Install

Install the UI package and the binding for your framework from npm:

```bash
npm install @ezclassify/ui @ezclassify/react @ezclassify/rest-client
```

Connect one REST client at application initialization, then share it with marking
components through your framework’s context or injection mechanism. Each feature
owns its UI bindings; the application owns the client connection.

| Package               | Integration guide                                             |
| --------------------- | ------------------------------------------------------------- |
| `@ezclassify/react`   | [React 18/19](integrations/react/README.md)                   |
| `@ezclassify/vue`     | [Vue 3.3+](integrations/vue/README.md)                        |
| `@ezclassify/angular` | [Angular 20.3.34, 21, and 22](integrations/angular/README.md) |
| `@ezclassify/ui`      | [Plain HTML, no framework](libs/ui/README.md)                 |

The framework guides show client initialization, shared-client access, actual
mounting, connection failure handling, and separate component/application
cleanup. The REST service performs policy execution and returns canonical DTOs.

## Contributing

Contributions are welcome because additional components, accessibility work,
themes, and framework integrations improve the product without exposing the
commercial engine. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull
request, and sign off your commits under the Developer Certificate of Origin
([DCO](https://github.com/ezclassify/ezclassify/blob/main/DCO.md)).

## License

[Apache License 2.0](LICENSE). The express patent grant applies to this UI work
only; separate proprietary terms govern the engine and enterprise content.
