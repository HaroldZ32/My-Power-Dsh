// The service id the verification law publishes and every consumer resolves.
//
// It lives in its own module so the ROW and the GUARD can both import it without either one pulling the
// other in: `mpd-verify-plugin`'s index registers the tools and publishes the service, while
// `mpd-roles-plugin`'s verify-guard resolves the service and calls the pure decisions in `law.ts`. A
// single spelling of the id is what keeps those two halves pointing at the same object.

/** The cordis service id the law publishes (`ctx.get("mpdVerify")`). */
export const VERIFY_SERVICE = "mpdVerify"
