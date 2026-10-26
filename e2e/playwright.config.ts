import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { browserLane } from './lanes.mjs';

// One configuration for every browser lane. The environment picks the lane
// (see lanes.mjs), and the lane names the applications to load and the servers
// they need: by default the four README examples, each beside its own Cedar
// Valley replay server, started the way the example's README says.
const lane = browserLane(process.env, {
    e2e: import.meta.dirname,
    repository: path.resolve(import.meta.dirname, '..'),
});

export default defineConfig({
    testDir: '.',
    testMatch: lane.testMatch,
    timeout: 180_000,
    expect: { timeout: 15_000 },
    retries: 0,
    workers: 1,
    reporter: 'list',
    use: {
        headless: true,
        screenshot: 'only-on-failure',
    },
    webServer: lane.webServer,
    projects: lane.projects.map((project) => ({
        name: project.name,
        use: { ...devices['Desktop Chrome'], baseURL: project.baseURL },
    })),
});
