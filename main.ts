import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';
import { describePrinterConfig, parsePrinterConfig, type PrinterConfig } from './lib/printerConfig';
import { isPrinterUnavailableError, pollPrinter } from './lib/printerIpp';
import { markOffline, publishSnapshot } from './lib/printerState';

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_INTERVAL_SECONDS = 10;
const MAX_INTERVAL_SECONDS = 86400;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 30000;

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

class Ipp extends Adapter {
    private pollTimer: ioBroker.Interval | null = null;
    private polling = false;
    private unloading = false;
    private printers: PrinterConfig[] = [];
    private timeoutMs = DEFAULT_TIMEOUT_MS;

    constructor(options: Partial<AdapterOptions> = {}) {
        super({ ...options, name: 'ipp' });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        const configuredPrinters: unknown = this.config.printers;
        const printerIds = new Set<string>();
        if (!Array.isArray(configuredPrinters)) {
            this.log.warn(`Printer configuration must be a table/array; received ${typeof configuredPrinters}`);
        }
        this.printers = (Array.isArray(configuredPrinters) ? configuredPrinters : []).flatMap((printer, index) => {
            const parsed = parsePrinterConfig(printer);
            if (parsed.config && printerIds.has(parsed.config.id)) {
                parsed.errors.push('id duplicates another configured printer');
                delete parsed.config;
            }
            if (!parsed.config) {
                this.log.warn(`Ignoring printer row ${index + 1}: ${parsed.errors.join('; ')}`);
                this.log.debug(`Printer row ${index + 1} fields: ${describePrinterConfig(printer)}`);
                return [];
            }
            printerIds.add(parsed.config.id);
            this.log.debug(`Accepted printer row ${index + 1}: ${describePrinterConfig(printer)}`);
            return [parsed.config];
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
            const timer = this.setInterval(() => void this.pollPrinters(), intervalSeconds * 1000);
            if (timer) {
                this.pollTimer = timer;
            }
        }
    }

    private async createPrinterObjects(printer: PrinterConfig): Promise<void> {
        const channelId = `${printer.id}.status`;
        for (const legacyChannel of ['info', 'status', 'supplies', 'counters']) {
            const legacyId = `${printer.id}.details.${legacyChannel}`;
            const legacyObject = await this.getObjectAsync(legacyId);
            if (legacyObject?.type === 'channel') {
                await this.delObjectAsync(legacyId, { recursive: true });
            }
        }
        await this.setObjectNotExistsAsync(printer.id, {
            type: 'device',
            common: { name: printer.label || printer.id },
            native: {},
        });
        for (const [id, name] of [
            [channelId, 'Status'],
            [`${printer.id}.supplies`, 'Supplies'],
            [`${printer.id}.counters`, 'Counters'],
            [`${printer.id}.details`, 'Printer details'],
        ]) {
            await this.setObjectNotExistsAsync(id, { type: 'channel', common: { name }, native: {} });
        }
        await this.setObjectNotExistsAsync(`${channelId}.online`, {
            type: 'state',
            common: { name: 'Online', type: 'boolean', role: 'indicator', read: true, write: false },
            native: {},
        });
    }

    private async pollPrinters(): Promise<void> {
        if (this.polling || this.unloading) {
            return;
        }
        this.polling = true;
        try {
            for (const printer of this.printers) {
                if (this.unloading) {
                    break;
                }
                await this.pollOnePrinter(printer);
            }
        } finally {
            this.polling = false;
        }
    }

    private async pollOnePrinter(printer: PrinterConfig): Promise<void> {
        try {
            const result = await pollPrinter({
                host: printer.host.trim(),
                port: boundedNumber(printer.port, 631, 1, 65535),
                basePath: printer.basePath || '/ipp/print',
                ssl: printer.ssl === true,
                verifySsl: printer.verifySsl === true,
                timeoutMs: this.timeoutMs,
            });
            if (!this.unloading) {
                await publishSnapshot(this, printer, result);
            }
        } catch (error) {
            if (!this.unloading) {
                try {
                    await markOffline(this, printer);
                } catch {
                    this.log.warn(`Could not update availability for configured printer ${printer.id}`);
                }
                const message = error instanceof Error ? error.message : String(error);
                const logMessage = `Polling configured printer ${printer.id} failed: ${message}`;
                if (isPrinterUnavailableError(error)) {
                    this.log.debug(logMessage);
                } else {
                    this.log.warn(logMessage);
                }
            }
        }
    }

    private onUnload(callback: () => void): void {
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

if (require.main === module) {
    new Ipp();
} else {
    module.exports = (options?: Partial<AdapterOptions>): Ipp => new Ipp(options);
}
