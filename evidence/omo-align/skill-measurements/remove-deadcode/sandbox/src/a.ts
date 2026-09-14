import { unusedHelper } from './b'
export function entryPoint(used: string, unusedParam: number): string {
  const unusedLocal = 42
  return used
}
const neverReferenced = 1
