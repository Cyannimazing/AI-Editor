import { endpoint } from '@/server/security/http';
import { checkNativePreflight } from '@/server/capcut/native-preflight.mjs';

export const POST = endpoint(async request => Response.json(await checkNativePreflight(request.signal)));
