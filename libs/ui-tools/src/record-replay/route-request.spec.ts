import { describe, expect, it } from 'vitest';
import { computeRecordingKey } from './hash';
import { normalizePath } from './normalize';
import { routeRequest } from './route-request';

describe('routeRequest', () => {
    it('keys a browser request by its path and query, as the fetch transport does', () => {
        const request = routeRequest(
            'http://127.0.0.1:4010/v1/ctx/demo/1.0.0/scheme?scheme=second',
            null,
        );
        expect(request).toEqual({
            path: '/v1/ctx/demo/1.0.0/scheme?scheme=second',
            body: null,
        });
        // A different query is a different recording.
        const other = routeRequest(
            'http://127.0.0.1:4010/v1/ctx/demo/1.0.0/scheme?scheme=first',
            null,
        );
        expect(
            computeRecordingKey(normalizePath(other.path), other.body),
        ).not.toBe(
            computeRecordingKey(normalizePath(request.path), request.body),
        );
    });

    it('reads a JSON body, and a body that is not JSON as none', () => {
        expect(
            routeRequest(
                'http://host/v1/ctx/demo/1.0.0/scheme/process',
                '{"input":"LOW"}',
            ).body,
        ).toEqual({ input: 'LOW' });
        expect(routeRequest('http://host/v1/x', 'not json').body).toBeNull();
    });
});
