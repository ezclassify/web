import 'vitest';

declare module 'vitest' {
    export interface ProvidedContext {
        /** Origin of the REST API the parity suite drives the client against. */
        restApiBaseUrl: string;
        /** Signed carriers for the isolated Context deployment. */
        restApiContextTokens: Record<string, string>;
    }
}
