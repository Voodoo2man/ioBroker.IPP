'use strict';

function stateObject(common) {
    return { type: 'state', common, native: {} };
}

async function writeState(adapter, id, common, value) {
    await adapter.setObjectNotExistsAsync(id, stateObject(common));
    await adapter.setStateAsync(id, { val: value, ack: true });
}

function validSupply(supply) {
    return (
        supply &&
        typeof supply.description === 'string' &&
        supply.description.trim() !== '' &&
        typeof supply.level === 'number' &&
        Number.isFinite(supply.level) &&
        typeof supply.maxLevel === 'number' &&
        Number.isFinite(supply.maxLevel) &&
        supply.maxLevel > 0 &&
        supply.level >= 0 &&
        supply.level <= supply.maxLevel
    );
}

function supplyStateId(printerId, supply, index) {
    const slug = supply.description
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
    return `${printerId}.supplies.${index}_${slug || 'supply'}`;
}

function getPrinterStates(adapter, printerId) {
    if (!adapter.printerStateIds) {
        adapter.printerStateIds = new Map();
    }
    if (!adapter.printerStateIds.has(printerId)) {
        adapter.printerStateIds.set(printerId, new Set());
    }
    return adapter.printerStateIds.get(printerId);
}

async function publishSnapshot(adapter, printer, result) {
    const knownStates = getPrinterStates(adapter, printer.id);
    const onlineId = `${printer.id}.status.online`;
    await adapter.setStateAsync(onlineId, { val: result.online === true, ack: true });
    if (result.online !== true) {
        await clearReadings(adapter, knownStates);
        return;
    }

    const statusValues = [
        {
            id: `${printer.id}.status.model`,
            common: { name: 'Model', type: 'string', role: 'text', read: true, write: false },
            value: typeof result.model === 'string' && result.model.trim() ? result.model.trim() : null,
        },
        {
            id: `${printer.id}.status.message`,
            common: { name: 'Status', type: 'string', role: 'text', read: true, write: false },
            value: typeof result.status === 'string' && result.status.trim() ? result.status.trim() : null,
        },
        {
            id: `${printer.id}.status.state`,
            common: {
                name: 'Printer state',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                states: { 3: 'idle', 4: 'printing', 5: 'stopped' },
            },
            value:
                typeof result.printerState === 'number' &&
                Number.isInteger(result.printerState) &&
                result.printerState >= 3 &&
                result.printerState <= 5
                    ? result.printerState
                    : null,
        },
    ];

    for (const status of statusValues) {
        if (status.value !== null || knownStates.has(status.id)) {
            await writeState(adapter, status.id, status.common, status.value);
            knownStates.add(status.id);
        }
    }

    const currentSupplyIds = new Set();
    if (Array.isArray(result.supplies)) {
        for (const [index, supply] of result.supplies.entries()) {
            if (!validSupply(supply)) {
                continue;
            }
            const id = supplyStateId(printer.id, supply, index);
            currentSupplyIds.add(id);
            knownStates.add(id);
            const common = {
                name: supply.description.trim(),
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                min: 0,
                max: supply.maxLevel,
            };
            common.unit = '%';
            await writeState(adapter, id, common, supply.level);
        }
    }

    const counterDefinitions = [
        ['pagesCompleted', 'pages_completed', 'Pages completed'],
        ['impressionsCompleted', 'impressions_completed', 'Impressions completed'],
        ['mediaSheetsCompleted', 'media_sheets_completed', 'Media sheets completed'],
    ];
    for (const [key, id, name] of counterDefinitions) {
        const stateId = `${printer.id}.counters.${id}`;
        const value =
            typeof result.counters?.[key] === 'number' &&
            Number.isInteger(result.counters[key]) &&
            result.counters[key] >= 0
                ? result.counters[key]
                : null;
        if (value !== null || knownStates.has(stateId)) {
            await writeState(
                adapter,
                stateId,
                {
                    name,
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    unit:
                        key === 'impressionsCompleted'
                            ? 'impressions'
                            : key === 'mediaSheetsCompleted'
                              ? 'sheets'
                              : 'pages',
                },
                value,
            );
            knownStates.add(stateId);
        }
    }

    for (const id of knownStates) {
        if (id.startsWith(`${printer.id}.supplies.`) && !currentSupplyIds.has(id)) {
            await adapter.setStateAsync(id, { val: null, ack: true });
        }
    }
}

async function clearReadings(adapter, knownStates) {
    for (const id of knownStates) {
        await adapter.setStateAsync(id, { val: null, ack: true });
    }
}

async function markOffline(adapter, printer) {
    await adapter.setStateAsync(`${printer.id}.status.online`, { val: false, ack: true });
    const knownStates = getPrinterStates(adapter, printer.id);
    await clearReadings(adapter, knownStates);
}

module.exports = { publishSnapshot, markOffline };
