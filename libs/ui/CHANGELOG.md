# Changelog

All notable changes to `@ezclassify/ui` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0

The first public release. The shared forms library that enhances native HTML
inputs with interactive marking components. It works over plain markup and
underlies the React, Vue, and Angular integrations. It ships components, not
policy: the engine is an adapter you provide.

Its store composes each marking from the value the page was served with and
the edits made on top of it, so a selection made while the page is still
starting is kept, and so is every served category nobody touched.
