/**
 * Authenticated Web route boundary for the AgentTeams plugin.
 *
 * Raw Web-server routes do NOT inherit the Connection service's browser
 * authentication fence, and these routes expose workspace team state and accept
 * plan mutations (including approve). Every route therefore runs the host's
 * own browser-request rejection first and fails closed when the Connection
 * service is missing or disposing — a partial plugin tree must never become an
 * unauthenticated read/write surface for the local machine.
 * @module dsh-agent-teams/web-routes
 */
/** Request body rejected before it could be parsed. */
export class RequestBodyError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
/**
 * Bound memory while draining oversized requests so the route can return 413.
 * @param req - the incoming request.
 * @param maxBytes - body cap; larger bodies reject with 413.
 * @returns the parsed JSON object body.
 */
export async function readJsonRequest(req, maxBytes = 1_000_000) {
    const raw = await new Promise((resolve, reject) => {
        let size = 0;
        let settled = false;
        const chunks = [];
        const finish = (error) => {
            if (settled)
                return;
            settled = true;
            req.off('data', onData);
            req.off('end', onEnd);
            req.off('aborted', onAborted);
            req.off('error', onError);
            if (error) {
                chunks.length = 0;
                // IncomingMessage may still receive data; discard it without buffering.
                req.once('error', () => { });
                req.resume();
                reject(error);
            }
            else {
                resolve(Buffer.concat(chunks).toString('utf8'));
            }
        };
        const onData = (chunk) => {
            const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += part.length;
            if (size > maxBytes)
                finish(new RequestBodyError('request body is too large', 413));
            else
                chunks.push(part);
        };
        const onEnd = () => finish();
        const onAborted = () => finish(new RequestBodyError('request body was aborted', 400));
        const onError = () => finish(new RequestBodyError('invalid request body', 400));
        req.on('data', onData);
        req.once('end', onEnd);
        req.once('aborted', onAborted);
        req.once('error', onError);
    });
    let value;
    try {
        value = raw.trim() === '' ? {} : JSON.parse(raw);
    }
    catch {
        throw new RequestBodyError('invalid JSON', 400);
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new RequestBodyError('body must be an object', 400);
    return value;
}
/**
 * Wrap one raw route host so every registered route passes the host's browser
 * authentication fence before its handler runs.
 * @param server - the raw Web-server service.
 * @param connection - resolver for the live Connection service (the gate).
 * @returns a route host with the same registration shape.
 */
export function authenticatedWebRoutes(server, connection) {
    return {
        register(route) {
            return server.register({
                ...route,
                async handler(req, res) {
                    const gate = connection();
                    // Missing/disposing Connection is an assembly failure, never an
                    // invitation to expose workspace state or accept plan mutations.
                    const rejection = gate === undefined ? 503 : gate.requestRejection(req);
                    if (rejection !== undefined) {
                        res.writeHead(rejection, {
                            'content-type': 'application/json; charset=utf-8',
                            'cache-control': 'no-store',
                        });
                        res.end(JSON.stringify({
                            error: rejection === 503 ? 'authentication unavailable'
                                : rejection === 401 ? 'unauthorized' : 'forbidden',
                        }));
                        return;
                    }
                    await route.handler(req, res);
                },
            });
        },
    };
}
