# Angular example

The document form from the [`@ezclassify/angular` README](../../integrations/angular/README.md#mark-a-document-and-its-parts),
as an app you can run. One document marking, the parts inside it, one form
store, and nothing else. No engine ships in it: every answer comes from the
EzClassify server it connects to.

## Run it against the developer runtime

The developer runtime is a free Docker image that serves the public demo
Contexts, Cedar Valley (a fictional school district's teaching policy) among
them, so you can see the form working before you have a runtime of your own.
`EZCLASSIFY_DEMO_ALLOWED_ORIGINS` is the app's exact origin. In one terminal:

```bash
docker run --rm -p 3000:8080 \
  -e EZCLASSIFY_DEMO_ALLOWED_ORIGINS=http://localhost:4200 \
  ghcr.io/ezclassify/developer-runtime
```

In another, from this directory:

```bash
npm install
npm start
```

Open `http://localhost:4200`. Focus each control, browse its picker, open the
marking popup in the title or body with Ctrl+Enter (Cmd+Enter on macOS), select
**Set document to CONFIDENTIAL**, then edit the title to `(PUBLIC) District
report card` and the body's first line to `(CONFIDENTIAL) Planning notes.` The
document marking ends at CONFIDENTIAL and covers every part. The runtime
applies the Context's real rules, so other values work too.

## Point it at your runtime

Change `ezclassifyUrl` in [`src/environments/environment.ts`](src/environments/environment.ts) to your runtime's
REST URL. Your runtime has to allow this page's origin, or serve the page from
its own origin.

A real runtime also wants credentials. Add them to `connectContext` as the
[README's Switch to your runtime section](../../integrations/angular/README.md#switch-to-your-runtime)
shows. Name your own provisioned Context if it is not `cedar-valley`.
