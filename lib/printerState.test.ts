import { expect } from 'chai';
import { markOffline, publishSnapshot } from './printerState';

function makeAdapter(): {
    states: Map<string, unknown>;
    setObjectNotExistsAsync: () => Promise<void>;
    setStateAsync: (id: string, state: unknown) => Promise<void>;
} {
    const states = new Map<string, unknown>();
    return {
        states,
        setObjectNotExistsAsync: () => Promise.resolve(),
        setStateAsync: (id: string, state: unknown) => Promise.resolve(states.set(id, state)).then(() => undefined),
    };
}

describe('printerState', () => {
    it('publishes status and supply values as acknowledged states', async () => {
        const adapter = makeAdapter();
        await publishSnapshot(
            adapter,
            { id: 'office' },
            {
                online: true,
                status: 'printing',
                printerState: 4,
                model: 'HP Printer',
                counters: { pagesCompleted: 100, impressionsCompleted: null, mediaSheetsCompleted: null },
                supplies: [{ description: 'Black toner', level: 70, maxLevel: 100, unit: 14, markerType: 'toner' }],
                details: [
                    { id: 'printer_location', name: 'Printer location', value: 'Office' },
                    { id: 'queued_job_count', name: 'Queued jobs', value: 2 },
                ],
            },
        );
        expect(adapter.states.get('office.status.online')).to.deep.equal({ val: true, ack: true });
        expect(adapter.states.get('office.status.message')).to.deep.equal({ val: 'printing', ack: true });
        expect(adapter.states.get('office.status.state')).to.deep.equal({ val: 4, ack: true });
        expect(adapter.states.get('office.status.model')).to.deep.equal({ val: 'HP Printer', ack: true });
        expect(adapter.states.get('office.counters.pages_completed')).to.deep.equal({ val: 100, ack: true });
        expect(adapter.states.get('office.supplies.0_black_toner')).to.deep.equal({ val: 70, ack: true });
        expect(adapter.states.get('office.details.printer_location')).to.deep.equal({ val: 'Office', ack: true });
        expect(adapter.states.get('office.details.queued_job_count')).to.deep.equal({ val: 2, ack: true });
    });

    it('clears old status and supply readings when the next successful poll lacks them', async () => {
        const adapter = makeAdapter();
        const printer = { id: 'office' };
        await publishSnapshot(adapter, printer, {
            online: true,
            status: 'printing',
            printerState: 4,
            counters: { pagesCompleted: 100, impressionsCompleted: null, mediaSheetsCompleted: null },
            supplies: [{ description: 'Black toner', level: 70, maxLevel: 100, unit: 14, markerType: 'toner' }],
            details: [{ id: 'printer_location', name: 'Printer location', value: 'Office' }],
        });
        await publishSnapshot(adapter, printer, {
            online: true,
            status: null,
            printerState: null,
            counters: {},
            supplies: [],
            details: [],
        });
        expect(adapter.states.get('office.status.online')).to.deep.equal({ val: true, ack: true });
        expect(adapter.states.get('office.status.message')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.status.state')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.counters.pages_completed')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.supplies.0_black_toner')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.details.printer_location')).to.deep.equal({ val: null, ack: true });
    });

    it('clears all known readings when polling marks a printer offline', async () => {
        const adapter = makeAdapter();
        const printer = { id: 'office' };
        await publishSnapshot(adapter, printer, {
            online: true,
            status: 'idle',
            printerState: 3,
            counters: { pagesCompleted: 20, impressionsCompleted: null, mediaSheetsCompleted: null },
            supplies: [{ description: 'Black toner', level: 0, maxLevel: 100, unit: 14, markerType: 'toner' }],
        });
        await markOffline(adapter, printer);
        expect(adapter.states.get('office.status.online')).to.deep.equal({ val: false, ack: true });
        expect(adapter.states.get('office.status.message')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.status.state')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.counters.pages_completed')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.supplies.0_black_toner')).to.deep.equal({ val: null, ack: true });
    });
});
