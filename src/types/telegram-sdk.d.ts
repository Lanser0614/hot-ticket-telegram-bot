declare module 'sdk/db' {
  export interface SqlFragment {
    readonly sql: string;
  }

  export interface Column<T = unknown> {
    primaryKey(options?: { autoIncrement?: boolean }): this;
    notNull(): this;
    unique(): this;
    default(value: T | SqlFragment): this;
  }

  export interface Constraint {
    readonly name: string;
  }

  export interface ConstraintBuilder {
    on(...columns: readonly Column[]): Constraint;
  }

  export type Table<TColumns extends Record<string, Column>> = TColumns & {
    readonly $name: string;
  };

  export function table<TColumns extends Record<string, Column>>(
    name: string,
    columns: TColumns,
    extras?: (columns: TColumns) => Readonly<Record<string, Constraint>>
  ): Table<TColumns>;

  export function integer(
    name: string,
    options?: { mode?: 'timestamp' | 'timestamp_ms' | 'boolean' }
  ): Column<number | Date | boolean>;
  export function text(name: string, options?: { mode?: 'json' }): Column<string | null>;
  export function boolean(name: string): Column<boolean>;
  export function json(name: string): Column<unknown>;
  export function index(name: string): ConstraintBuilder;
  export function unique(name: string): ConstraintBuilder;
  export function sql(strings: TemplateStringsArray, ...values: readonly unknown[]): SqlFragment;
}

declare module 'sdk' {
  export interface SdkDatabase {
    run(query: string, parameters?: Readonly<Record<string, unknown>>): Promise<unknown>;
    all(
      query: string,
      parameters?: Readonly<Record<string, unknown>>
    ): Promise<readonly Readonly<Record<string, unknown>>[]>;
    get(
      query: string,
      parameters?: Readonly<Record<string, unknown>>
    ): Promise<Readonly<Record<string, unknown>> | null>;
  }

  export interface TelegramApi {
    sendMessage(parameters: Readonly<Record<string, unknown>>): Promise<unknown>;
    answerCallbackQuery(parameters: Readonly<Record<string, unknown>>): Promise<unknown>;
  }

  export interface SdkHeaders {
    get(name: string): string | null;
    has(name: string): boolean;
    keys(): IterableIterator<string>;
    entries(): IterableIterator<[string, string]>;
  }

  export interface SdkResponse {
    readonly status: number;
    readonly statusText: string;
    readonly ok: boolean;
    readonly url: string;
    readonly headers: SdkHeaders;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }

  export type SdkFetch = (
    url: string,
    init?: {
      method?: string;
      headers?: Readonly<Record<string, string>>;
      body?: string;
    }
  ) => Promise<SdkResponse>;

  export const api: TelegramApi;
  export const db: SdkDatabase;
  export const fetch: SdkFetch;
}

declare module 'sdk/api' {
  export { api } from 'sdk';
}

declare module 'sdk/fetch' {
  export { fetch } from 'sdk';
}
