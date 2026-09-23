export declare const STROOP_DECIMALS = 7;
export declare const STROOPS_PER_UNIT: bigint;
export declare function parseStroops(value: unknown): bigint | null;
export declare function formatStroops(stroops: bigint): string;
export declare function canonicalAmount(value: unknown): string | null;
export declare function amountsEqual(expected: unknown, actual: unknown): boolean;
