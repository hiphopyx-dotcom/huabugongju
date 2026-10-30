import {createGrokVideoHandler} from '../lib/grok-media.mjs';
const handler=createGrokVideoHandler(process.env);
export {handler as GET,handler as POST};
export const maxDuration=120;
