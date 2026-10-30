import {createGrokVideoHandler} from '../lib/grok-media.mjs';
import {withCors} from '../lib/security.mjs';
const route=withCors(createGrokVideoHandler(process.env));
export {route as GET,route as POST,route as OPTIONS};
export const maxDuration=120;
