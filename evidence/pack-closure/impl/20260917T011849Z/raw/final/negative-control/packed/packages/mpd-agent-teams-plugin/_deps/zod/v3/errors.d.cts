import type { ZodErrorMap } from "./ZodError.cts";
import defaultErrorMap from "./locales/en.cts";
export { defaultErrorMap };
export declare function setErrorMap(map: ZodErrorMap): void;
export declare function getErrorMap(): ZodErrorMap;
