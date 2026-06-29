import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createClient, type CreateWorkflowDefinitionProps } from 'contentful-management';

const useColor = output.isTTY && process.env.NO_COLOR === undefined;
const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  green: wrap('32'),
  red: wrap('31'),
  yellow: wrap('33'),
  cyan: wrap('36'),
  gray: wrap('90'),
  bold: wrap('1'),
};

const tag = c.cyan('[import-workflows]');
const log = (msg: string) => console.log(`${tag} ${msg}`);
const err = (msg: string) => console.error(`${tag} ${msg}`);

const { CONTENTFUL_ACCESS_TOKEN } = process.env;

if (!CONTENTFUL_ACCESS_TOKEN) {
  err(c.red('Missing CONTENTFUL_ACCESS_TOKEN.'));
  err(c.red('Populate it in .env at the repo root, then re-run.'));
  process.exit(1);
}

if (!input.isTTY) {
  err(c.red('This script prompts for the space and environment IDs interactively.'));
  err(c.red('Re-run it in an interactive terminal.'));
  process.exit(1);
}

const rl = createInterface({ input, output });
let spaceId: string;
let environmentId: string;
try {
  spaceId = (await rl.question(`${tag} ${c.bold('Space ID')}: `)).trim();
  if (!spaceId) {
    err(c.red('Space ID is required.'));
    process.exit(1);
  }
  environmentId = (await rl.question(`${tag} ${c.bold('Environment ID')} ${c.gray('(e.g. master)')}: `)).trim();
  if (!environmentId) {
    err(c.red('Environment ID is required.'));
    process.exit(1);
  }
} finally {
  rl.close();
}

const client = createClient(
  { accessToken: CONTENTFUL_ACCESS_TOKEN },
  { type: 'plain', defaults: { spaceId, environmentId } },
);

const dir = join(process.cwd(), 'exports/workflows');

let files: string[];
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.json'));
} catch (e) {
  err(c.red(`Could not read directory ${dir}: ${(e as Error).message}`));
  process.exit(1);
}

if (files.length === 0) {
  err(c.yellow(`No .json files found in ${dir}. Nothing to import.`));
  process.exit(1);
}

log(
  `Importing ${c.bold(String(files.length))} workflow definition(s) into space=${c.bold(spaceId)} env=${c.bold(environmentId)}`,
);

let ok = 0;
let fail = 0;

for (const file of files) {
  const path = join(dir, file);
  let payload: CreateWorkflowDefinitionProps;
  try {
    payload = JSON.parse(readFileSync(path, 'utf8')) as CreateWorkflowDefinitionProps;
  } catch (e) {
    fail++;
    err(`${c.red('FAIL')} ${c.bold(file)} — invalid JSON: ${(e as Error).message}`);
    continue;
  }

  try {
    const created = await client.workflowDefinition.create({}, payload);
    log(`${c.green('OK  ')} ${c.bold(file)} -> "${created.name}" ${c.gray(`(id=${created.sys.id})`)}`);
    ok++;
  } catch (e) {
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    err(`${c.red('FAIL')} ${c.bold(file)} — ${msg}`);
    const data =
      (e as { response?: { data?: unknown } }).response?.data ??
      (e as { data?: unknown }).data;
    if (data) {
      err(c.gray(`     details: ${JSON.stringify(data, null, 2)}`));
    }
  }
}

const summary = `Done. ${c.green(`${ok} succeeded`)}, ${fail > 0 ? c.red(`${fail} failed`) : `${fail} failed`}.`;
log(summary);
process.exit(fail > 0 ? 1 : 0);
