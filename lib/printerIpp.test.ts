import http from 'node:http';
import { expect } from 'chai';
import * as ipp from '@sealsystems/ipp';
import { normalizeSnapshot, pollPrinter } from './printerIpp';

function ippResponse(attributes: Record<string, unknown>): Buffer {
    return ipp.serialize({ version: '2.0', statusCode: 'successful-ok', id: 1, 'printer-attributes-tag': attributes });
}

async function expectRejection(
    promise: Promise<unknown>,
    expectedError: new (...args: never[]) => Error,
): Promise<void> {
    let error: unknown;
    try {
        await promise;
    } catch (caught) {
        error = caught;
    }
    expect(error).to.be.instanceOf(expectedError);
}

describe('printerIpp', () => {
    it('normalizes printer state, percentage markers, and available counters', () => {
        const snapshot = normalizeSnapshot({
            statusCode: 'successful-ok',
            'printer-attributes-tag': {
                'printer-state': 'processing',
                'printer-state-message': 'Printing',
                'printer-make-and-model': 'HP LaserJet Pro MFP M479fdn',
                'marker-names': ['Black toner'],
                'marker-levels': [25],
                'marker-high-levels': [100],
                'marker-low-levels': [0],
                'marker-types': ['toner'],
                'pages-completed': 120,
                'impressions-completed': 125,
                'media-sheets-completed': 118,
                'printer-location': 'Office',
                'printer-is-accepting-jobs': true,
                'queued-job-count': 2,
                'document-format-supported': ['application/pdf', 'image/pwg-raster'],
            },
        });

        expect(snapshot).to.include({
            online: true,
            printerState: 4,
            status: 'Printing',
            model: 'HP LaserJet Pro MFP M479fdn',
        });
        expect(snapshot.supplies).to.deep.equal([
            { description: 'Black toner', level: 25, maxLevel: 100, unit: 14, markerType: 'toner' },
        ]);
        expect(snapshot.counters).to.deep.equal({
            pagesCompleted: 120,
            impressionsCompleted: 125,
            mediaSheetsCompleted: 118,
        });
        expect(snapshot.details).to.deep.equal([
            { id: 'printer_location', name: 'Printer location', value: 'Office' },
            { id: 'printer_is_accepting_jobs', name: 'Accepting jobs', value: true },
            { id: 'queued_job_count', name: 'Queued jobs', value: 2 },
            {
                id: 'document_format_supported',
                name: 'Supported document formats',
                value: '["application/pdf","image/pwg-raster"]',
            },
        ]);
    });

    it('preserves zero values and represents unsupported values as null', () => {
        const snapshot = normalizeSnapshot({
            statusCode: 'successful-ok',
            'printer-attributes-tag': {
                'printer-state': 'idle',
                'marker-names': ['Black toner', 'Cyan toner'],
                'marker-levels': [0, 20],
                'marker-high-levels': [100, 100],
                'marker-low-levels': [0, 0],
                'pages-completed': 0,
            },
        });
        expect(snapshot.supplies[0].level).to.equal(0);
        expect(snapshot.counters).to.deep.equal({
            pagesCompleted: 0,
            impressionsCompleted: null,
            mediaSheetsCompleted: null,
        });
        expect(snapshot.status).to.equal(null);
    });

    it('sends a read-only Get-Printer-Attributes request to the configured resource', async () => {
        let resolveRequest!: (value: ipp.IppResponse) => void;
        const requestReceived = new Promise<ipp.IppResponse>(resolve => {
            resolveRequest = resolve;
        });
        const server = http.createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => chunks.push(chunk));
            request.on('end', () => {
                resolveRequest(ipp.parse(Buffer.concat(chunks)));
                response.writeHead(200, { 'content-type': 'application/ipp' });
                response.end(
                    ippResponse({
                        'printer-state': 'idle',
                        'printer-state-message': 'Idle',
                        'pages-completed': 52,
                        'impressions-completed': 60,
                        'media-sheets-completed': 49,
                        'printer-location': 'Office',
                    }),
                );
            });
        });
        await new Promise<void>(resolve => server.listen(0, resolve));

        try {
            const address = server.address();
            if (!address || typeof address === 'string') {
                throw new Error('Test server did not bind to a TCP port');
            }
            const result = await pollPrinter({
                host: '127.0.0.1',
                port: address.port,
                basePath: '/ipp/print',
                timeoutMs: 2000,
            });
            const receivedRequest = await requestReceived;
            expect(receivedRequest.operation).to.equal('Get-Printer-Attributes');
            expect((receivedRequest['operation-attributes-tag'] as Record<string, unknown>)['printer-uri']).to.equal(
                `ipp://127.0.0.1:${address.port}/ipp/print`,
            );
            expect(result).to.include({ online: true, printerState: 3, status: 'Idle' });
            expect(result.counters).to.deep.equal({
                pagesCompleted: 52,
                impressionsCompleted: 60,
                mediaSheetsCompleted: 49,
            });
            expect(result.details).to.deep.equal([
                { id: 'printer_location', name: 'Printer location', value: 'Office' },
            ]);
        } finally {
            await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
        }
    });

    it('rejects an unsuccessful IPP response and invalid endpoint configuration', async () => {
        const server = http.createServer((request, response) => {
            request.resume();
            request.on('end', () => {
                response.writeHead(200, { 'content-type': 'application/ipp' });
                response.end(ipp.serialize({ version: '2.0', statusCode: 'client-error-not-found', id: 1 }));
            });
        });
        await new Promise<void>(resolve => server.listen(0, resolve));
        try {
            const address = server.address();
            if (!address || typeof address === 'string') {
                throw new Error('Test server did not bind to a TCP port');
            }
            await expectRejection(pollPrinter({ host: '127.0.0.1', port: address.port, timeoutMs: 2000 }), Error);
            await expectRejection(pollPrinter({ host: 'printer/path', port: address.port }), TypeError);
        } finally {
            await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
        }
    });
});
