// Angular dev-server proxy: the session endpoint and the wire relay.
//
// The Angular dev server hands this straight to Vite's `server.proxy`, so both
// hosts configure their backend with one shared module through whichever dev
// server their framework ships.
//
// Top-level await, because bringing the backend up means opening a socket and
// the Angular builder reads this module's default export without awaiting it.
import { hostBackend } from '../backend.mjs';

export default await hostBackend();
