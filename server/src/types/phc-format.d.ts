declare module '@phc/format' {
  interface PHCObject {
    id: string;
    version?: number;
    params?: Record<string, number | string>;
    salt?: Buffer;
    hash?: Buffer;
  }

  export function serialize(opts: PHCObject): string;
  export function deserialize(phcstr: string): PHCObject;
}
