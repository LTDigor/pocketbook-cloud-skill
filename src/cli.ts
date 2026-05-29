#!/usr/bin/env node
import { config as loadDotEnv } from "dotenv";
import { loadConfig } from "./config.js";
import { createPocketBookActions } from "./actions.js";
import type { UploadFileInput } from "./pocketbookClient.js";

const COMMANDS = [
  "config",
  "status",
  "refresh-token",
  "get",
  "user",
  "list-books",
  "books-info",
  "upload-file",
  "upload-files",
  "probe-profile",
  "probe-books",
  "probe-devices",
] as const;

type Command = (typeof COMMANDS)[number];

async function main(): Promise<void> {
  loadEnvironment();
  const [command, ...args] = process.argv.slice(2);

  if (!isCommand(command)) {
    printUsage(command);
    process.exitCode = 2;
    return;
  }

  const options = parseOptions(args);
  const actions = createPocketBookActions(await loadConfig());
  const result = await runCommand(command, options, actions);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runCommand(
  command: Command,
  options: Map<string, string | boolean>,
  actions: ReturnType<typeof createPocketBookActions>,
): Promise<unknown> {
  switch (command) {
    case "config":
      return actions.config();
    case "status":
      return actions.status();
    case "refresh-token":
      return actions.refreshToken({
        refreshToken: stringOption(options, "refresh-token"),
        persist: !options.has("no-persist"),
      });
    case "get":
      return actions.get(requiredStringOption(options, "path"));
    case "user":
      return actions.user();
    case "list-books":
      return actions.listBooks({
        offset: numberOption(options, "offset", 0),
        limit: numberOption(options, "limit", 100, { min: 1, max: 500 }),
      });
    case "books-info":
      return actions.booksInfo();
    case "upload-file":
      return actions.uploadFile({
        filePath: requiredStringOption(options, "file"),
        remoteName: stringOption(options, "remote-name"),
        contentType: stringOption(options, "content-type"),
      });
    case "upload-files":
      return actions.uploadFiles(parseUploadFiles(options));
    case "probe-profile":
      return actions.probeProfile();
    case "probe-books":
      return actions.probeBooks();
    case "probe-devices":
      return actions.probeDevices();
  }
}

function parseUploadFiles(options: Map<string, string | boolean>): UploadFileInput[] {
  const rawFiles = stringOption(options, "files");
  if (rawFiles) {
    const parsed = JSON.parse(rawFiles) as UploadFileInput[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("--files must be a non-empty JSON array.");
    }
    return parsed;
  }

  const filePath = requiredStringOption(options, "file");
  return [
    {
      filePath,
      remoteName: stringOption(options, "remote-name"),
      contentType: stringOption(options, "content-type"),
    },
  ];
}

function parseOptions(args: string[]): Map<string, string | boolean> {
  const options = new Map<string, string | boolean>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const option = arg.slice(2);
    const equalsIndex = option.indexOf("=");
    const rawKey = equalsIndex >= 0 ? option.slice(0, equalsIndex) : option;
    const inlineValue = equalsIndex >= 0 ? option.slice(equalsIndex + 1) : undefined;
    if (!rawKey) {
      throw new Error(`Invalid option: ${arg}`);
    }

    if (inlineValue !== undefined) {
      options.set(rawKey, inlineValue);
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options.set(rawKey, true);
      continue;
    }

    options.set(rawKey, next);
    index += 1;
  }

  return options;
}

function requiredStringOption(options: Map<string, string | boolean>, key: string): string {
  const value = stringOption(options, key);
  if (!value) {
    throw new Error(`Missing required --${key} option.`);
  }
  return value;
}

function stringOption(options: Map<string, string | boolean>, key: string): string | undefined {
  const value = options.get(key);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberOption(
  options: Map<string, string | boolean>,
  key: string,
  fallback: number,
  bounds: { min?: number; max?: number } = {},
): number {
  const value = stringOption(options, key);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  const min = bounds.min ?? 0;
  if (!Number.isInteger(parsed) || parsed < min || (bounds.max !== undefined && parsed > bounds.max)) {
    const range = bounds.max === undefined ? `>= ${min}` : `between ${min} and ${bounds.max}`;
    throw new Error(`--${key} must be an integer ${range}.`);
  }
  return parsed;
}

function isCommand(value: string | undefined): value is Command {
  return Boolean(value) && COMMANDS.includes(value as Command);
}

function printUsage(command: string | undefined): void {
  if (command) {
    process.stderr.write(`Unknown command: ${command}\n\n`);
  }

  process.stderr.write(`Usage: pocketbook-cloud <command> [options]

Commands:
  config
  status
  refresh-token [--refresh-token TOKEN] [--no-persist]
  get --path /api/v1.0/user
  user
  list-books [--offset 0] [--limit 100]
  books-info
  upload-file --file /path/book.epub [--remote-name name.epub] [--content-type type]
  upload-files --files '[{"filePath":"/path/book.epub"}]'
  probe-profile
  probe-books
  probe-devices
`);
}

function loadEnvironment(): void {
  loadDotEnv({ quiet: true });

  if (process.env.POCKETBOOK_ENV_FILE?.trim()) {
    loadDotEnv({ path: process.env.POCKETBOOK_ENV_FILE.trim(), override: true, quiet: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
