export declare const EDGE_LIMIT_CODES: ReadonlySet<string>;
export declare const EDGE_LIMIT_MESSAGES: Readonly<Record<string, string>>;
export declare const DEFAULT_EDGE_MESSAGE: string;
export declare function isEdgeLimitError(error: unknown): boolean;
export declare function edgeLimitMessage(error: unknown): string;
