/**
 * A user-facing message as data: a key of the message catalogue plus the
 * values it interpolates. Pure modules (domain rules, zod schemas, mappers)
 * return these - or just the key - instead of a sentence, so they stay free of
 * any language; a server action or a component turns them into text with the
 * active language (src/i18n/server.ts, src/i18n/client.ts).
 *
 * Keys are full paths into src/i18n/messages/es.json ("validation.operation.
 * installmentPositive"). A test checks that every key written in the source
 * exists in the catalogue.
 */
export type MessageValues = Record<string, string | number>;

export interface AppMessage {
  key: string;
  values?: MessageValues;
}

export const msg = (key: string, values?: MessageValues): AppMessage => (values ? { key, values } : { key });

export const isAppMessage = (value: unknown): value is AppMessage =>
  typeof value === "object" && value !== null && typeof (value as AppMessage).key === "string";

/** Text for a key (or message) given a translator; `translate` decides what an unknown key reads as. */
export type Translate = (key: string, values?: MessageValues) => string;

export const render = (translate: Translate, message: AppMessage | string): string =>
  typeof message === "string" ? translate(message) : translate(message.key, message.values);
