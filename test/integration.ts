import path from 'node:path';
import { tests } from '@iobroker/testing';

tests.integration(path.resolve(__dirname, '../..'));
