import { expect } from 'chai';
import { describePrinterConfig, getPrinterConfigErrors, parsePrinterConfig } from './printerConfig';

describe('printerConfig', () => {
    it('accepts the values shown in the reported Admin configuration', () => {
        const printer = {
            id: 'Buero',
            label: 'BüroDrucker',
            host: '192.168.0.89',
            port: 631,
            basePath: '/ipp/print',
            ssl: false,
            verifySsl: false,
        };

        expect(getPrinterConfigErrors(printer)).to.deep.equal([]);
        expect(describePrinterConfig(printer)).to.equal(
            'id=string, label=string, host=string, port=number, basePath=string, ssl=boolean, verifySsl=boolean',
        );
    });

    it('transliterates German umlauts in printer IDs', () => {
        const parsed = parsePrinterConfig({ id: 'Büro-Übersicht', host: 'printer.local' });

        expect(parsed.errors).to.deep.equal([]);
        expect(parsed.config?.id).to.equal('Buero-Uebersicht');
    });

    it('explains invalid fields without exposing configured values', () => {
        const printer = { id: 'bad.id', host: '', port: 'ipp', basePath: 'ipp/print', ssl: 'maybe' };

        expect(getPrinterConfigErrors(printer)).to.deep.equal([
            'id must contain 1-32 letters, digits, underscores, or hyphens',
            'host is missing or is not text',
            'port must be an integer from 1 to 65535',
            'basePath must start with / and must not contain ..',
            'ssl must be true/false, 1/0, or an unchecked checkbox',
        ]);
    });

    it('normalizes Admin checkbox values from booleans, strings, and numeric flags', () => {
        const row = { id: 'Buero', host: '192.168.0.89', port: '631', ssl: 'false', verifySsl: 0 };
        const parsed = parsePrinterConfig(row);

        expect(parsed.errors).to.deep.equal([]);
        expect(parsed.config).to.include({ id: 'Buero', ssl: false, verifySsl: false });
        expect(parsePrinterConfig({ ...row, ssl: 'true', verifySsl: 1 }).config).to.include({
            ssl: true,
            verifySsl: true,
        });
    });
});
