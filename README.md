![Logo](admin/hpprinter.png)
# ioBroker.hpprinter

[![NPM version](https://img.shields.io/npm/v/iobroker.hpprinter.svg)](https://www.npmjs.com/package/iobroker.hpprinter)
[![Downloads](https://img.shields.io/npm/dm/iobroker.hpprinter.svg)](https://www.npmjs.com/package/iobroker.hpprinter)
![Number of Installations](https://iobroker.live/badges/hpprinter-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/hpprinter-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.hpprinter.png?downloads=true)](https://nodei.co/npm/iobroker.hpprinter/)

**Tests:** ![Test and Release](https://github.com/Voodoo2man/ioBroker.HPPrinter/workflows/Test%20and%20Release/badge.svg)

## ioBroker HP Printer Adapter

The adapter polls configured network printers using the Internet Printing Protocol (IPP) and publishes read-only availability, printer state, toner or ink levels, and supported page counters. It uses `Get-Printer-Attributes` over IPP/2.0; device and firmware support varies, so optional attributes may not be reported by every printer. The HP LaserJet Pro MFP M479fdn has not yet been verified against this implementation.

HP cloud integration and print-job submission or other printer control are not implemented.

## Configuration

Add one or more printers in the adapter settings. Each row contains:

| Setting | Description |
| --- | --- |
| ID | Stable object-tree identifier; use 1-32 letters, digits, underscores, or hyphens. |
| Label | Display name for the printer. |
| Host | Printer hostname or IP address. |
| Port | IPP port; defaults to `631`. |
| IPP resource path | Printer resource path; defaults to `/ipp/print`. |
| Use TLS | Use IPPS over TLS. |
| Verify TLS certificate | Validate the printer's TLS certificate; disabled by default for self-signed printer certificates. |

The polling interval defaults to 60 seconds and is limited to 10 seconds through 24 hours. The request timeout defaults to 5000 ms and is limited to 500-30000 ms. The adapter only sends the read-only `Get-Printer-Attributes` operation; it does not submit print jobs or change printer settings. Configure only printers that expose an IPP endpoint at the selected host, port, and resource path.

Invalid printer rows are skipped with a warning that identifies the invalid fields. Debug logging reports configured field names and value types without printing configured values.

When a printer is switched off or temporarily unreachable, the adapter marks it offline without a warning-level log; connection and timeout details are available at debug level. IPP protocol, TLS, and configuration errors remain warnings.

## States

Each configured printer gets a device with `status`, `supplies`, `counters`, and `details` channels. `status.online` is always present; `status.model`, `status.message`, and numeric `status.state` are published when supported. The state value is `0` (`off`) while the printer is unreachable, and returns to the reported IPP state when it reconnects. Previously read measurements remain available while offline. IPP marker levels are normalized to percentages using the reported low/high bounds and rounded to two decimal places. `pages_completed`, `impressions_completed`, and `media_sheets_completed` are created only when the printer reports them. The separate `details` channel contains optional printer information, location, job acceptance and queue count, uptime, supported formats and operations, color support, and page speeds when provided by the device. Missing values are cleared rather than replaced with zero during successful polls. Request details are not logged.

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
- (Voodoo2man) Initial Version

## License
MIT License

Copyright (c) 2026 Voodoo2man <Voodoo2man@outlook.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.