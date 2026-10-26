'use strict';

const http = require('node:http');
const https = require('node:https');
const ipp = require('@sealsystems/ipp');

const MAX_RESPONSE_BYTES = 1024 * 1024;
const printerAttributes = ipp.attributes['Printer Description'];
const documentAttributes = ipp.attributes['Document Description'];
for (const name of ['pages-completed', 'impressions-completed', 'media-sheets-completed']) {
    if (!printerAttributes[name] && documentAttributes[name]) {
        printerAttributes[name] = documentAttributes[name];
    }
}
const REQUESTED_ATTRIBUTES = [
    'printer-name',
    'printer-make-and-model',
    'printer-state',
    'printer-state-message',
    'printer-state-reasons',
    'marker-names',
    'marker-levels',
    'marker-high-levels',
    'marker-low-levels',
    'marker-types',
    'pages-completed',
    'impressions-completed',
    'media-sheets-completed',
];

function asArray(value) {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function finiteNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }
    return null;
}

function normalizePrinterState(value) {
    const numericState = finiteNumber(value);
    if (numericState !== null) {
        return numericState;
    }
    return { idle: 3, processing: 4, stopped: 5 }[value] ?? null;
}

function validHost(host) {
    return typeof host === 'string' && host.trim() !== '' && !/[/?#@\s]/.test(host.trim());
}

function responseAttributes(response) {
    return response?.['printer-attributes-tag'] || response?.['unsupported-attributes-tag'] || {};
}

function normalizeSnapshot(response) {
    const attributes = responseAttributes(response);
    const printerState = normalizePrinterState(attributes['printer-state']);
    const reasons = asArray(attributes['printer-state-reasons']).filter(value => typeof value === 'string');
    const stateMessages = asArray(attributes['printer-state-message']).filter(value => typeof value === 'string');
    const markerNames = asArray(attributes['marker-names']);
    const markerLevels = asArray(attributes['marker-levels']);
    const markerHighLevels = asArray(attributes['marker-high-levels']);
    const markerLowLevels = asArray(attributes['marker-low-levels']);
    const markerTypes = asArray(attributes['marker-types']);
    const supplies = markerNames.flatMap((name, index) => {
        const level = finiteNumber(markerLevels[index]);
        const highLevel = finiteNumber(markerHighLevels[index]);
        const lowLevel = finiteNumber(markerLowLevels[index]);
        if (
            typeof name !== 'string' ||
            name.trim() === '' ||
            level === null ||
            highLevel === null ||
            lowLevel === null ||
            highLevel <= lowLevel
        ) {
            return [];
        }
        const percent = ((level - lowLevel) / (highLevel - lowLevel)) * 100;
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
            return [];
        }
        return [
            {
                description: name.trim(),
                level: percent,
                maxLevel: 100,
                unit: 14,
                markerType: markerTypes[index] ?? null,
            },
        ];
    });

    return {
        online: true,
        printerState,
        status: stateMessages[0] || reasons.join(', ') || null,
        model: typeof attributes['printer-make-and-model'] === 'string' ? attributes['printer-make-and-model'] : null,
        printerName: typeof attributes['printer-name'] === 'string' ? attributes['printer-name'] : null,
        supplies,
        counters: {
            pagesCompleted: finiteNumber(attributes['pages-completed']),
            impressionsCompleted: finiteNumber(attributes['impressions-completed']),
            mediaSheetsCompleted: finiteNumber(attributes['media-sheets-completed']),
        },
    };
}

function makeRequest(uri) {
    return ipp.serialize({
        version: '2.0',
        operation: 'Get-Printer-Attributes',
        id: 1,
        'operation-attributes-tag': {
            'attributes-charset': 'utf-8',
            'attributes-natural-language': 'en',
            'printer-uri': uri,
            'requested-attributes': REQUESTED_ATTRIBUTES,
        },
    });
}

function sendRequest(url, uri, timeoutMs, verifySsl) {
    return new Promise((resolve, reject) => {
        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.request(
            url,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/ipp',
                    accept: 'application/ipp',
                    'content-length': makeRequest(uri).length,
                },
                agent: url.protocol === 'https:' ? new https.Agent({ rejectUnauthorized: verifySsl }) : undefined,
            },
            response => {
                const chunks = [];
                let size = 0;
                response.on('data', chunk => {
                    size += chunk.length;
                    if (size > MAX_RESPONSE_BYTES) {
                        request.destroy(new Error('IPP response exceeded the size limit'));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => {
                    const statusCode = response.statusCode ?? 0;
                    if (statusCode < 200 || statusCode >= 300) {
                        reject(new Error(`IPP endpoint returned HTTP ${statusCode}`));
                        return;
                    }
                    try {
                        const parsed = ipp.parse(Buffer.concat(chunks));
                        if (!parsed || !parsed.statusCode || !String(parsed.statusCode).startsWith('successful-')) {
                            reject(new Error('Printer returned an unsuccessful IPP response'));
                            return;
                        }
                        resolve(parsed);
                    } catch {
                        reject(new Error('Printer returned an invalid IPP response'));
                    }
                });
            },
        );
        request.setTimeout(timeoutMs, () => {
            const error = /** @type {NodeJS.ErrnoException} */ (new Error('IPP request timed out'));
            error.code = 'ETIMEDOUT';
            request.destroy(error);
        });
        request.on('error', error => {
            const requestError = /** @type {NodeJS.ErrnoException} */ (error);
            reject(
                requestError.code === 'ETIMEDOUT'
                    ? new Error('Printer request timed out')
                    : new Error('Printer IPP request failed'),
            );
        });
        request.end(makeRequest(uri));
    });
}

async function pollPrinter({
    host,
    port = 631,
    basePath = '/ipp/print',
    ssl = false,
    verifySsl = false,
    timeoutMs = 5000,
}) {
    if (!validHost(host)) {
        throw new TypeError('A valid printer host is required');
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new TypeError('Printer port must be an integer between 1 and 65535');
    }
    if (
        typeof basePath !== 'string' ||
        !basePath.startsWith('/') ||
        basePath.includes('..') ||
        /[?#\s]/.test(basePath)
    ) {
        throw new TypeError('IPP base path must be an absolute path without query or fragment');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30000) {
        throw new TypeError('timeoutMs must be an integer between 500 and 30000');
    }
    const scheme = ssl ? 'https:' : 'http:';
    const endpoint = new URL(`${scheme}//${host.trim()}:${port}${basePath}`);
    const uri = `${ssl ? 'ipps:' : 'ipp:'}//${endpoint.host}${endpoint.pathname}`;
    const response = await sendRequest(endpoint, uri, timeoutMs, verifySsl);
    return normalizeSnapshot(response);
}

module.exports = { pollPrinter, _makeRequest: makeRequest, _normalizeSnapshot: normalizeSnapshot };
