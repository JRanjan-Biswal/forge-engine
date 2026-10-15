export interface InitOptions {
    name?: string;
    /** Re-create state.json even if the project is already initialised (the ledger is kept). */
    force?: boolean;
}
export interface InitResult {
    root: string;
    created: string[];
    alreadyInitialized: boolean;
}
export declare function initProject(rootInput: string, options?: InitOptions): InitResult;
