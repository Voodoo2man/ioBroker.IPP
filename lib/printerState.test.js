'use strict';

const { expect } = require('chai');
const { describe, it } = require('mocha');
const { publishSnapshot, markOffline } = require('./printerState');

function makeAdapter() {
    const states = new Map();
    return {
        states,
        setObjectNotExistsAsync: async () => {},
        setStateAsync: async (id, state) => states.set(id, state),
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
                supplies: [{ description: 'Black toner', level: 70, maxLevel: 100, unit: 14 }],
            },
        );

        expect(adapter.states.get('office.status.online')).to.deep.equal({ val: true, ack: true });
        expect(adapter.states.get('office.status.message')).to.deep.equal({ val: 'printing', ack: true });
        expect(adapter.states.get('office.status.state')).to.deep.equal({ val: 4, ack: true });
        expect(adapter.states.get('office.status.model')).to.deep.equal({ val: 'HP Printer', ack: true });
        expect(adapter.states.get('office.counters.pages_completed')).to.deep.equal({ val: 100, ack: true });
        expect(adapter.states.get('office.supplies.0_black_toner')).to.deep.equal({ val: 70, ack: true });
    });

    it('clears old status and supply readings when the next successful poll lacks them', async () => {
        const adapter = makeAdapter();
        const printer = { id: 'office' };
        await publishSnapshot(adapter, printer, {
            online: true,
            status: 'printing',
            printerState: 4,
            counters: { pagesCompleted: 100, impressionsCompleted: null, mediaSheetsCompleted: null },
            supplies: [{ description: 'Black toner', level: 70, maxLevel: 100, unit: 14 }],
        });

        await publishSnapshot(adapter, printer, {
            online: true,
            status: null,
            printerState: null,
            counters: {},
            supplies: [],
        });

        expect(adapter.states.get('office.status.online')).to.deep.equal({ val: true, ack: true });
        expect(adapter.states.get('office.status.message')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.status.state')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.counters.pages_completed')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.supplies.0_black_toner')).to.deep.equal({ val: null, ack: true });
    });

    it('clears all known readings when polling marks a printer offline', async () => {
        const adapter = makeAdapter();
        const printer = { id: 'office' };
        await publishSnapshot(adapter, printer, {
            online: true,
            status: 'idle',
            printerState: 3,
            counters: { pagesCompleted: 20 },
            supplies: [{ description: 'Black toner', level: 0, maxLevel: 100, unit: 14 }],
        });

        await markOffline(adapter, printer);

        expect(adapter.states.get('office.status.online')).to.deep.equal({ val: false, ack: true });
        expect(adapter.states.get('office.status.message')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.status.state')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.counters.pages_completed')).to.deep.equal({ val: null, ack: true });
        expect(adapter.states.get('office.supplies.0_black_toner')).to.deep.equal({ val: null, ack: true });
    });
});
