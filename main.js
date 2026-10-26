'use strict';

const utils = require('@iobroker/adapter-core');
const { pollPrinter } = require('./lib/printerIpp');
const { publishSnapshot, markOffline } = require('./lib/printerState');

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_INTERVAL_SECONDS = 10;
const MAX_INTERVAL_SECONDS = 86400;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 30000;
function boundedNumber(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function validId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value);
}

function validPrinter(printer) {
    return (
        printer &&
        typeof printer === 'object' &&
        validId(printer.id) &&
        typeof printer.host === 'string' &&
        printer.host.trim().length > 0 &&
        (printer.port === undefined ||
            printer.port === '' ||
            (Number.isInteger(Number(printer.port)) && Number(printer.port) >= 1 && Number(printer.port) <= 65535)) &&
        (printer.basePath === undefined ||
            (typeof printer.basePath === 'string' &&
                printer.basePath.startsWith('/') &&
                !printer.basePath.includes('..'))) &&
        (printer.ssl === undefined || typeof printer.ssl === 'boolean') &&
        (printer.verifySsl === undefined || typeof printer.verifySsl === 'boolean')
    );
}

class Hpprinter extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
     */
    constructor(options) {
        super({
            ...options,
            name: 'hpprinter',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.pollTimer = null;
        this.polling = false;
        this.unloading = false;
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        const configuredPrinters = Array.isArray(this.config.printers) ? this.config.printers : [];
        const printerIds = new Set();
        this.printers = configuredPrinters.filter(printer => {
            if (!validPrinter(printer) || printerIds.has(printer.id)) {
                this.log.warn('Ignoring printer configuration with invalid or duplicate ID or IPP endpoint');
                return false;
            }
            printerIds.add(printer.id);
            return true;
        });

        if (this.printers.length === 0) {
            this.log.info('No valid printers configured');
            return;
        }

        for (const printer of this.printers) {
            await this.createPrinterObjects(printer);
        }

        const intervalSeconds = boundedNumber(
            this.config.intervalSeconds,
            DEFAULT_INTERVAL_SECONDS,
            MIN_INTERVAL_SECONDS,
            MAX_INTERVAL_SECONDS,
        );
        this.timeoutMs = boundedNumber(this.config.timeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
        await this.pollPrinters();
        if (!this.unloading) {
            this.pollTimer = this.setInterval(() => void this.pollPrinters(), intervalSeconds * 1000);
        }
    }

    async createPrinterObjects(printer) {
        const deviceId = printer.id;
        const channelId = `${printer.id}.status`;
        await this.setObjectNotExistsAsync(deviceId, {
            type: 'device',
            common: { name: printer.label || printer.id },
            native: {},
        });
        await this.setObjectNotExistsAsync(channelId, {
            type: 'channel',
            common: { name: 'Status' },
            native: {},
        });
        await this.setObjectNotExistsAsync(`${printer.id}.supplies`, {
            type: 'channel',
            common: { name: 'Supplies' },
            native: {},
        });
        await this.setObjectNotExistsAsync(`${printer.id}.counters`, {
            type: 'channel',
            common: { name: 'Counters' },
            native: {},
        });
        await this.setObjectNotExistsAsync(`${channelId}.online`, {
            type: 'state',
            common: { name: 'Online', type: 'boolean', role: 'indicator', read: true, write: false },
            native: {},
        });
    }

    async ensureState(id, common) {
        await this.setObjectNotExistsAsync(id, { type: 'state', common, native: {} });
    }

    async pollPrinters() {
        if (this.polling || this.unloading) {
            return;
        }
        this.polling = true;
        try {
            for (const printer of this.printers || []) {
                if (this.unloading) {
                    break;
                }
                await this.pollOnePrinter(printer);
            }
        } finally {
            this.polling = false;
        }
    }

    async pollOnePrinter(printer) {
        try {
            const result = await pollPrinter({
                host: printer.host.trim(),
                port: boundedNumber(printer.port, 631, 1, 65535),
                basePath: typeof printer.basePath === 'string' && printer.basePath ? printer.basePath : '/ipp/print',
                ssl: printer.ssl === true,
                verifySsl: printer.verifySsl === true,
                timeoutMs: this.timeoutMs,
            });
            if (this.unloading) {
                return;
            }
            await publishSnapshot(this, printer, result || {});
        } catch {
            if (!this.unloading) {
                try {
                    await markOffline(this, printer);
                } catch {
                    this.log.warn(`Could not update availability for configured printer ${printer.id}`);
                }
                this.log.warn(`Polling configured printer ${printer.id} failed`);
            }
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param {() => void} callback - Callback function
     */
    onUnload(callback) {
        this.unloading = true;
        if (this.pollTimer) {
            try {
                this.clearInterval(this.pollTimer);
            } catch {
                this.log.warn('Failed to clear printer polling timer during unload');
            } finally {
                this.pollTimer = null;
            }
        }
        callback();
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
     */
    module.exports = options => new Hpprinter(options);
} else {
    // otherwise start the instance directly
    new Hpprinter();
}
