/**
 * Which browser lane a run selects, and what that lane needs running.
 *
 * Four lanes, picked by the environment so one Playwright configuration serves
 * all of them:
 *
 * - Default (`EZ_INTEGRATION_SCENARIO` unset or `cedar-valley`): the four README
 *   examples against the Cedar Valley replay, each started the way the
 *   example's README says. This is the path an integrator takes first.
 * - `golden-corpus`: the React and Angular integration hosts against the whole
 *   golden wire corpus, with both credentials on every request.
 * - `context-not-found` or `version-not-found`: the hosts against a scenario
 *   whose Context lookup is refused.
 * - `EZ_LICENSED_RUNTIME_STATUS_FILE`: the hosts against a licensed deployment.
 *
 * Kept free of runtime imports so the selection logic is testable without
 * Playwright.
 */

/**
 * The README examples and the servers each one needs.
 *
 * One replay server per example, because the replay server permits exactly one
 * browser origin. The Angular example reads its server from
 * `src/environments/environment.ts`, so it gets the README's default port; the
 * Vite examples read `VITE_EZCLASSIFY_URL`.
 */
export const EXAMPLES = [
    {
        name: 'vanilla-example',
        appPort: 5173,
        serverPort: 4011,
        dev: 'npm run dev -- --port 5173 --strictPort',
        urlVariable: 'VITE_EZCLASSIFY_URL',
    },
    {
        name: 'react-example',
        appPort: 5174,
        serverPort: 4012,
        dev: 'npm run dev -- --port 5174 --strictPort',
        urlVariable: 'VITE_EZCLASSIFY_URL',
    },
    {
        name: 'vue-example',
        appPort: 5175,
        serverPort: 4013,
        dev: 'npm run dev -- --port 5175 --strictPort',
        urlVariable: 'VITE_EZCLASSIFY_URL',
    },
    {
        name: 'angular-example',
        appPort: 4200,
        serverPort: 4010,
        dev: 'npm start',
    },
];

/**
 * The integration hosts, and how each dev server starts, from this directory.
 * Each dev server starts its own backend.
 */
export const HOSTS = [
    {
        name: 'react-host',
        appPort: 5186,
        dev: 'npx vite hosts/react --strictPort',
    },
    {
        name: 'angular-host',
        appPort: 4201,
        dev: 'npx ng serve angular-host',
    },
];

/** Scenarios whose Context lookup the replay server refuses. */
const REFUSAL_SCENARIOS = new Set(['context-not-found', 'version-not-found']);

/**
 * A server Playwright starts and waits for.
 *
 * @param {string} command Shell command.
 * @param {string | undefined} cwd Absolute working directory, or undefined for
 *   the configuration's own directory.
 * @param {string} url URL that answers once the server is up.
 * @param {Record<string, string>} [env] Extra environment.
 * @returns {import('@playwright/test').TestConfigWebServer} A Playwright
 *   `webServer` entry.
 */
export function webServer(command, cwd, url, env) {
    return {
        command,
        ...(cwd ? { cwd } : {}),
        url,
        ...(env ? { env } : {}),
        // A server left running by somebody else may be bound to another
        // origin or backend, so every lane starts its own.
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
    };
}

/**
 * The lane this environment selects.
 *
 * @param {NodeJS.ProcessEnv} env Lane selection environment.
 * @param {{ e2e: string; repository: string }} roots Absolute paths of this
 *   directory and of the repository.
 * @returns {{
 *     lane: string;
 *     testMatch: string;
 *     projects: { name: string; baseURL: string }[];
 *     webServer: import('@playwright/test').TestConfigWebServer[];
 * }}
 *   Playwright discovery settings, one project per application, and the servers
 *   the lane needs.
 * @throws {Error} If selectors conflict or name an unknown scenario.
 */
export function browserLane(env, roots) {
    const licensed = env.EZ_LICENSED_RUNTIME_STATUS_FILE;
    const scenario = env.EZ_INTEGRATION_SCENARIO;
    if (licensed && scenario) {
        throw new Error(
            'Select either a licensed deployment or a recorded integration scenario',
        );
    }
    if (!licensed && (!scenario || scenario === 'cedar-valley')) {
        return {
            lane: 'cedar-valley',
            testMatch: 'examples/document-form.spec.ts',
            projects: EXAMPLES.map((example) => ({
                name: example.name,
                baseURL: `http://localhost:${example.appPort}`,
            })),
            webServer: EXAMPLES.flatMap((example) => {
                const origin = `http://localhost:${example.appPort}`;
                const replay = `http://127.0.0.1:${example.serverPort}`;
                return [
                    webServer(
                        `npx @ezclassify/conformance-server --scenario cedar-valley --port ${example.serverPort} --cors-origin ${origin}`,
                        roots.e2e,
                        `${replay}/v1/health`,
                    ),
                    webServer(
                        example.dev,
                        `${roots.repository}/examples/${example.name}`,
                        origin,
                        example.urlVariable
                            ? { [example.urlVariable]: replay }
                            : undefined,
                    ),
                ];
            }),
        };
    }
    let lane;
    let testMatch;
    if (licensed) {
        lane = 'licensed';
        testMatch = 'hosts/licensed-deployment.spec.ts';
    } else if (scenario === 'golden-corpus') {
        lane = 'golden-corpus';
        testMatch = 'hosts/golden-corpus.spec.ts';
    } else if (REFUSAL_SCENARIOS.has(scenario)) {
        lane = scenario;
        testMatch = 'hosts/scenario-refusal.spec.ts';
    } else {
        throw new Error(`Unknown integration scenario: ${scenario}`);
    }
    return {
        lane,
        testMatch,
        projects: HOSTS.map((host) => ({
            name: host.name,
            baseURL: `http://localhost:${host.appPort}`,
        })),
        // The hosts' dev servers read the same environment and start the
        // matching backend themselves.
        webServer: HOSTS.map((host) =>
            webServer(
                `${host.dev} --port ${host.appPort}`,
                roots.e2e,
                `http://localhost:${host.appPort}`,
            ),
        ),
    };
}
