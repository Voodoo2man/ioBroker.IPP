'use strict';

const http = require('node:http');
const { expect } = require('chai');
const { describe, it } = require('mocha');
const ipp = require('@sealsystems/ipp');
const { pollPrinter, _normalizeSnapshot } = require('./printerIpp');

function ippResponse(attributes) {
    return ipp.serialize({
        version: '2.0',
        statusCode: 'successful-ok',
        id: 1,
        'printer-attributes-tag': attributes,
    });
}

describe('printerIpp', () => {
    it('normalizes printer state, percentage markers, and available counters', () => {
        const snapshot = _normalizeSnapshot({
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
    });

    it('preserves zero values and represents unsupported values as null', () => {
        const snapshot = _normalizeSnapshot({
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
        let resolveRequest;
        const requestReceived = new Promise(resolve => {
            resolveRequest = resolve;
        });
        const server = http.createServer((request, response) => {
            const chunks = [];
            request.on('data', chunk => chunks.push(chunk));
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
                    }),
                );
            });
        });
        await new Promise(resolve => server.listen(0, () => resolve(undefined)));

        try {
            const address = server.address();
            if (!address || typeof address === 'string') {
                throw new Error('Test server did not bind to a TCP port');
            }
            const { port } = address;
            const result = await pollPrinter({ host: '127.0.0.1', port, basePath: '/ipp/print', timeoutMs: 2000 });
            const receivedRequest = await requestReceived;
            expect(receivedRequest.operation).to.equal('Get-Printer-Attributes');
            expect(receivedRequest['operation-attributes-tag']['printer-uri']).to.equal(
                `ipp://127.0.0.1:${port}/ipp/print`,
            );
            expect(result).to.include({ online: true, printerState: 3, status: 'Idle' });
            expect(result.counters).to.deep.equal({
                pagesCompleted: 52,
                impressionsCompleted: 60,
                mediaSheetsCompleted: 49,
            });
        } finally {
            await new Promise(resolve => server.close(() => resolve(undefined)));
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
        await new Promise(resolve => server.listen(0, () => resolve(undefined)));

        try {
            const address = server.address();
            if (!address || typeof address === 'string') {
                throw new Error('Test server did not bind to a TCP port');
            }
            const { port } = address;
            let responseFailure;
            try {
                await pollPrinter({ host: '127.0.0.1', port, timeoutMs: 2000 });
            } catch (error) {
                responseFailure = error;
            }
            expect(responseFailure).to.be.instanceOf(Error);
            let configFailure;
            try {
                await pollPrinter({ host: 'printer/path', port });
            } catch (error) {
                configFailure = error;
            }
            expect(configFailure).to.be.instanceOf(TypeError);
        } finally {
            await new Promise(resolve => server.close(() => resolve(undefined)));
        }
    });
});
