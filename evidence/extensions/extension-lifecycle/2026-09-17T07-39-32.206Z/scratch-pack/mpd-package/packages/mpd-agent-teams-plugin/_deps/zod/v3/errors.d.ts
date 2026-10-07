import type { ZodErrorMap } from "./ZodError.ts";
import defaultErrorMap from "./locales/en.ts";
export { defaultErrorMap };
export declare function setErrorMap(map: ZodErrorMap): void;
export declare function getErrorMap(): ZodErrorMap;
