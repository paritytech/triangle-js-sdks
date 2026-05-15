import { createHostApi } from '@novasamatech/host-api';

import { sandboxTransport } from './sandboxTransport.js';

export const hostApi = createHostApi(sandboxTransport);
