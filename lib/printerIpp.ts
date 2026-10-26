import http from 'node:http';
import https from 'node:https';
import * as ipp from '@sealsystems/ipp';

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
    'printer-info',
    'printer-location',
    'printer-more-info',
    'printer-is-accepting-jobs',
    'queued-job-count',
    'printer-up-time',
    'printer-current-time',
    'operations-supported',
    'document-format-supported',
    'color-supported',
    'pages-per-minute',
    'pages-per-minute-color',
    'uri-authentication-supported',
    'uri-security-supported',
];

const DETAIL_ATTRIBUTES = [
    ['printer-info', 'Printer information'],
    ['printer-location', 'Printer location'],
    ['printer-more-info', 'More information URL'],
    ['printer-is-accepting-jobs', 'Accepting jobs'],
    ['queued-job-count', 'Queued jobs'],
    ['printer-up-time', 'Uptime'],
    ['printer-current-time', 'Printer time'],
    ['operations-supported', 'Supported operations'],
    ['document-format-supported', 'Supported document formats'],
    ['color-supported', 'Color printing supported'],
    ['pages-per-minute', 'Pages per minute'],
    ['pages-per-minute-color', 'Color pages per minute'],
    ['uri-authentication-supported', 'Supported URI authentication'],
    ['uri-security-supported', 'Supported URI security'],
] as const;

export interface PrinterEndpoint {
    host: string;
    port?: number | string;
    basePath?: string;
    ssl?: boolean;
    verifySsl?: boolean;
    timeoutMs?: number;
}

export interface PrinterSupply {
    description: string;
    level: number;
    maxLevel: number;
    unit: number;
    markerType: unknown;
}

export interface PrinterSnapshot {
    online: boolean;
    printerState: number | null;
    status: string | null;
    model: string | null;
    printerName: string | null;
    supplies: PrinterSupply[];
    counters: {
        pagesCompleted: number | null;
        impressionsCompleted: number | null;
        mediaSheetsCompleted: number | null;
    };
    details: Array<{ id: string; name: string; value: string | number | boolean }>;
}

function asArray(value: unknown): unknown[] {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function finiteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }
    return null;
}

function normalizePrinterState(value: unknown): number | null {
    const numericState = finiteNumber(value);
    if (numericState !== null) {
        return numericState;
    }
    if (value === 'idle') {
        return 3;
    }
    if (value === 'processing') {
        return 4;
    }
    if (value === 'stopped') {
        return 5;
    }
    return null;
}

function validHost(host: string): boolean {
    return host.trim() !== '' && !/[/?#@\s]/.test(host.trim());
}

function responseAttributes(response: ipp.IppResponse): Record<string, unknown> {
    const attributes = response['printer-attributes-tag'] ?? response['unsupported-attributes-tag'];
    return attributes && typeof attributes === 'object' ? (attributes as Record<string, unknown>) : {};
}

export function normalizeSnapshot(response: ipp.IppResponse): PrinterSnapshot {
    const attributes = responseAttributes(response);
    const reasons = asArray(attributes['printer-state-reasons']).filter(
        (value): value is string => typeof value === 'string',
    );
    const stateMessages = asArray(attributes['printer-state-message']).filter(
        (value): value is string => typeof value === 'string',
    );
    const markerNames = asArray(attributes['marker-names']);
    const markerLevels = asArray(attributes['marker-levels']);
    const markerHighLevels = asArray(attributes['marker-high-levels']);
    const markerLowLevels = asArray(attributes['marker-low-levels']);
    const markerTypes = asArray(attributes['marker-types']);
    const supplies = markerNames.flatMap((name, index): PrinterSupply[] => {
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
    const details = DETAIL_ATTRIBUTES.flatMap(([attribute, name]) => {
        const value = attributes[attribute];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return [{ id: attribute.replace(/-/g, '_'), name, value }];
        }
        if (
            Array.isArray(value) &&
            value.length > 0 &&
            value.every(item => ['string', 'number', 'boolean'].includes(typeof item))
        ) {
            return [{ id: attribute.replace(/-/g, '_'), name, value: JSON.stringify(value) }];
        }
        return [];
    });

    return {
        online: true,
        printerState: normalizePrinterState(attributes['printer-state']),
        status: stateMessages[0] || reasons.join(', ') || null,
        model: typeof attributes['printer-make-and-model'] === 'string' ? attributes['printer-make-and-model'] : null,
        printerName: typeof attributes['printer-name'] === 'string' ? attributes['printer-name'] : null,
        supplies,
        counters: {
            pagesCompleted: finiteNumber(attributes['pages-completed']),
            impressionsCompleted: finiteNumber(attributes['impressions-completed']),
            mediaSheetsCompleted: finiteNumber(attributes['media-sheets-completed']),
        },
        details,
    };
}

function makeRequest(uri: string): Buffer {
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

function sendRequest(url: URL, uri: string, timeoutMs: number, verifySsl: boolean): Promise<ipp.IppResponse> {
    return new Promise((resolve, reject) => {
        const transport = url.protocol === 'https:' ? https : http;
        const requestBody = makeRequest(uri);
        const request = transport.request(
            url,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/ipp',
                    accept: 'application/ipp',
                    'content-length': requestBody.length,
                },
                agent: url.protocol === 'https:' ? new https.Agent({ rejectUnauthorized: verifySsl }) : undefined,
            },
            response => {
                const chunks: Buffer[] = [];
                let size = 0;
                response.on('data', (chunk: Buffer) => {
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
                        if (!parsed.statusCode || !String(parsed.statusCode).startsWith('successful-')) {
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
            const error = new Error('IPP request timed out') as NodeJS.ErrnoException;
            error.code = 'ETIMEDOUT';
            request.destroy(error);
        });
        request.on('error', (error: NodeJS.ErrnoException) => {
            reject(
                error.code === 'ETIMEDOUT'
                    ? new Error('Printer request timed out')
                    : new Error('Printer IPP request failed'),
            );
        });
        request.end(requestBody);
    });
}

export async function pollPrinter({
    host,
    port = 631,
    basePath = '/ipp/print',
    ssl = false,
    verifySsl = false,
    timeoutMs = 5000,
}: PrinterEndpoint): Promise<PrinterSnapshot> {
    const numericPort = Number(port);
    if (!validHost(host)) {
        throw new TypeError('A valid printer host is required');
    }
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
        throw new TypeError('Printer port must be an integer between 1 and 65535');
    }
    if (!basePath.startsWith('/') || basePath.includes('..') || /[?#\s]/.test(basePath)) {
        throw new TypeError('IPP base path must be an absolute path without query or fragment');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30000) {
        throw new TypeError('timeoutMs must be an integer between 500 and 30000');
    }
    const endpoint = new URL(`${ssl ? 'https:' : 'http:'}//${host.trim()}:${numericPort}${basePath}`);
    const uri = `${ssl ? 'ipps:' : 'ipp:'}//${endpoint.host}${endpoint.pathname}`;
    return normalizeSnapshot(await sendRequest(endpoint, uri, timeoutMs, verifySsl));
}
