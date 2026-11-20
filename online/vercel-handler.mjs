import {createOnlineHandler} from './worker.mjs';
const handler=createOnlineHandler({assets:{}});
// Vercel discovers the two /api entrypoints. Secrets are read at request time only.
export default {fetch(request){return handler.fetch(request,process.env);}};
