# Changelog

All notable changes to `@ezclassify/angular` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0

The first public release. The Angular integration of the EzClassify forms
library. You name your connected Context once with `provideEzClassify`, and
each `ezClassify` root mounts the `@ezclassify/ui` runtime on its native form
inputs with a store of its own. It never connects a Context itself.
