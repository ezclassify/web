import 'vitest';

declare module 'vitest' {
    export interface ProvidedContext {
        /**
         * Origin of the live demo runtime, in record mode only. Provided by
         * `demo-runtime-global-setup.ts`.
         */
        demoRuntimeOrigin?: string;
        /** What that runtime's `GET /v1/health` answered, in record mode only. */
        demoRuntimeHealth?: { engineVersion: string; openapiVersion?: string };
    }
}
