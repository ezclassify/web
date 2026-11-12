import 'vitest';

declare module 'vitest' {
    export interface ProvidedContext {
        /** Origin of the REST API the parity suite drives the client against. */
        restApiBaseUrl: string;
        /** Signed broker identity of the run's caller. */
        restApiCallerHeaders: Record<string, string>;
        /** Signed carriers for the isolated Context deployment. */
        restApiContextTokens: Record<string, string>;
    }
}
