#!/usr/bin/env node
import ansi from 'ansi';

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import { LuaTarget, transpileProject } from 'typescript-to-lua';
import { Command, program } from 'commander';
import path from 'path';
import ts from 'typescript';

const cursor = ansi(process.stdout);

type Scope = 'client' | 'server' | 'shared' | 'none';

let PREFIX = '[COMPILER]';

type ModInfo = {
  name: string | null;
  poster: string | null;
  description: string | null;
  id: string | null;
  require: string[] | null;
};

const getModInfo = (srcDir: string): ModInfo => {
  const modInfo: ModInfo = {
    id: null,
    name: null,
    poster: null,
    description: null,
    require: []
  };
  const modInfoFile = fs.readFileSync(path.join(srcDir, 'mod.info')).toString();
  const lines: string[] = modInfoFile.split('\r\n');
  console.log(lines);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.indexOf('id=') !== -1) {
      modInfo.id = line.split('=')[1].trim();
    } else if (lower.indexOf('name=') !== -1) {
      modInfo.name = line.split('=')[1].trim();
    } else if (lower.indexOf('description=') !== -1) {
      modInfo.description = line.split('=')[1].trim();
    } else if (lower.indexOf('poster=') !== -1) {
      modInfo.poster = line.split('=')[1].trim();
    } else if (lower.indexOf('require=') !== -1) {
      modInfo.require = line
        .split('=')[1]
        .trim()
        .split(',')
        .map((entry) => {
          return entry.trim();
        });
    }
  }
  if (modInfo.id == null) throw new Error('mod.info has no id.');
  if (modInfo.name == null) throw new Error('mod.info has no name.');
  if (modInfo.poster == null) throw new Error('mod.info has no poster.');
  if (modInfo.description == null)
    throw new Error('mod.info has no description.');
  return modInfo;
};

const init = (targetDir: string) => {
  const mediaFolders = [
    'sound',
    'textures',
    'models',
    'scripts',
    'client',
    'server',
    'shared'
  ];
  mediaFolders.map((mpath) => {
    fs.mkdirSync(path.join(targetDir, 'src', mpath), { recursive: true });
  });
  // TODO: Prompt for these or accept as options
  const modInfo = {
    name: 'My First Mod',
    poster: 'poster.png',
    id: 'MyFirst',
    description: 'ModDescription',
    url: 'https://theindiestone.com'
  };
  const output = Object.entries(modInfo).map(([key, v]) => `${key}=${v}`);
  fs.writeFileSync(path.join(targetDir, 'mod.info'), output.join('\r\n'));
};
const watch = (srcDir: string) => {
  PREFIX = '[WATCHER]';
  chokidar.watch('./src', { ignoreInitial: true }).on('all', (event, path) => {
    while (path.indexOf('\\') !== -1) {
      path = path.replace('\\', '/');
    }
    const pathLower = path.toLowerCase();
    if (pathLower === 'src/header.lua' || pathLower === 'src/footer.lua') {
      return;
    }
    if (event === 'add' || event === 'change') {
      if (!fs.lstatSync(path).isFile()) return;
      if (pathLower.endsWith('.lua')) {
        copyFile(path, 'media/lua' + path.substring(3));
        return;
      }
      if (pathLower.endsWith('.d.ts') || !pathLower.endsWith('.ts')) {
        return;
      }
      cursor.grey();
      console.log(`${PREFIX} - File changed: ${path}`);
      cursor.reset();
      compileProject(srcDir);
    } else if (event === 'unlink') {
      let dst = 'media/lua' + path.substring(3);
      if (dst.toLowerCase().endsWith('.ts')) {
        dst = dst.substring(0, dst.length - 2) + 'lua';
      }
      if (fs.existsSync(dst)) {
        cursor.grey();
        cursor.reset();
        fs.rmSync(dst);
        console.log(`${PREFIX} - Deleted file: ${dst}`);
      }
    } else if (event === 'unlinkDir') {
      const dst = 'media/lua' + path.substring(3);
      if (fs.existsSync(dst)) {
        cursor.grey();
        cursor.reset();
        fs.rmdirSync(dst);
        console.log(`${PREFIX} - Deleted directory: ${dst}`);
      }
    } else if (event === 'addDir') {
      const dst = 'media/lua' + path.substring(3);
      if (!fs.existsSync(dst)) {
        cursor.grey();
        console.log(`${PREFIX} - Created file: ${dst}`);
        cursor.reset();
        fs.mkdirSync(dst, { recursive: true });
      }
    }
  });
};
const main = () => {
  const program = new Command();
  program
    .command('init')
    .argument('[path]', 'Location to create the mod', '.')
    .action(init);
  program
    .command('watch')
    .argument('[path]', 'Location to create the mod', '.')
    .action(watch);
  program
    .command('build-declarations')
    .argument('[path]', 'Location to create the mod', '.')
    .action(compileProjectDeclaration);
  program
    .command('build')
    .argument('[path]', 'Location to create the mod', '.')
    .action(compileProject);
  program.parse();
  console.log('exit');
};

const getFiles = (
  srcDir: string,
  extension: string
): { [path: string]: string } => {
  const toReturn = {} as { [path: string]: string };
  const files = fs.readdirSync(srcDir);
  const ext = `.${extension.toLowerCase()}`;
  for (const file of files) {
    const path = `${srcDir}/${file}`;
    const lstat = fs.lstatSync(path);
    if (lstat.isDirectory()) {
      const dirFiles = getFiles(path, extension);
      for (const path of Object.keys(dirFiles)) {
        toReturn[path] = dirFiles[path];
      }
    } else {
      if (!file.toLowerCase().endsWith(ext)) continue;
      toReturn[path] = fs.readFileSync(path).toString();
    }
  }

  return toReturn;
};

const copyNonCompileFilesInDir = (srcDir: string, distDir: string) => {
  const files = fs.readdirSync(srcDir);
  for (const file of files) {
    if (file.toLowerCase().endsWith('.ts')) continue;
    const path = `${srcDir}/${file}`;
    const lstat = fs.lstatSync(path);
    if (lstat.isDirectory()) {
      copyNonCompileFilesInDir(path, path.replace(srcDir, distDir));
    } else {
      copyFile(path, path.replace(srcDir, distDir));
    }
  }
};

const copyFile = (source: string, destination: string) => {
  cursor.grey();
  console.log(`${PREFIX} - Copying "${source}" to "${destination}"..`);
  cursor.reset();
  checkDir(destination);
  if (
    destination.toLowerCase().endsWith('.lua') &&
    !destination.toLowerCase().endsWith('shared/zomboid.lua') &&
    !destination.toLowerCase().endsWith('shared/events.lua')
  ) {
    const lua = fs.readFileSync(source).toString();

    fs.writeFileSync(destination, lua);
  } else {
    fs.copyFileSync(source, destination);
  }
};

const compileProject = (srcDir: string) => {
  const resolvedSrcDir = path.resolve(srcDir)
  const modInfo = getModInfo(srcDir);
  const outDir = 'dist';
  cursor.brightGreen();
  process.stdout.write(`${PREFIX} - Compiling project..\n`);
  cursor.reset();
  const timeThen = new Date().getTime();
  copyNonCompileFilesInDir(
    path.join(resolvedSrcDir, 'src/client'),
    path.join(resolvedSrcDir, outDir, 'media/lua/client')
  );
  copyNonCompileFilesInDir(
    path.join(resolvedSrcDir, 'src/server'),
    path.join(resolvedSrcDir, outDir, 'media/lua/server')
  );
  copyNonCompileFilesInDir(
    path.join(resolvedSrcDir, './src/shared'),
    path.join(resolvedSrcDir, outDir, '/media/lua/shared')
  );

  // TODO: Make this process automatic, not hard-coded.
  const modulePath = path.resolve(__dirname);
  copyFile(
    path.join(modulePath, '../node_modules/@shughesuk/pipewrench/PipeWrench.lua'),
    path.join(resolvedSrcDir, outDir, 'media/lua/shared/PipeWrench.lua')
  );
  copyFile(
    path.join(
      modulePath,
      '../node_modules/@shughesuk/pipewrench-events/PipeWrench-Events.lua'
    ),
    path.join(resolvedSrcDir, outDir, './media/lua/shared/PipeWrench-Events.lua')
  );
  copyFile(
    path.join(
      modulePath,
      '../node_modules/@shughesuk/pipewrench-utils/PipeWrench-Utils.lua'
    ),
    path.join(resolvedSrcDir, outDir, './media/lua/shared/PipeWrench-Utils.lua')
  );
  copyFile(
    path.join(modulePath, '../src/lua/lualib_bundle.lua'),
    path.join(resolvedSrcDir, outDir, './media/lua/shared/lualib_bundle.lua')
  );

  // Create these temporary files so that the require paths are a certain pattern.
  const tmpFiles = [
    path.join(resolvedSrcDir, 'src/client/_.ts'),
    path.join(resolvedSrcDir, 'src/server/_.ts'),
    path.join(resolvedSrcDir, 'src/shared/_.ts')
  ];
  tmpFiles.map((fp) => {
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, '');
    }
  });
  console.log(path.join(resolvedSrcDir, 'tsconfig.json'));
  const result = transpileProject(
    path.join(resolvedSrcDir, 'tsconfig.json'),
    {
      luaTarget: LuaTarget.Lua51,
      rootDirs: [
        path.join(resolvedSrcDir,'src/shared'),
        path.join(resolvedSrcDir, 'src/client'),
        path.join(resolvedSrcDir, 'src/server')
      ],
      declaration: false,
      outDir: path.join(resolvedSrcDir, outDir)
    },
    (
      fileName: string,
      data: string,
      _writeByteOrderMark: boolean,
      _onError?: (message: string) => void
    ) => {
      console.log(fileName);
      // Ignore empty files.
      if (data.length === 0) return;

      while (fileName.indexOf('\\') !== -1)
        fileName = fileName.replace('\\', '/');
      if (fileName.endsWith('.d.ts')) {
        // Let's figure out what to do for declarations later.
        return;
      }
      const splitter = 'media/lua/shared/';
      const indexOf = fileName.indexOf('media/lua/shared/');
      if (indexOf !== -1) {
        let subFileName;
        if (fileName.endsWith('lualib_bundle.lua')) {
          subFileName = 'media/lua/shared/lualib_bundle.lua';
        } else {
          subFileName =
            'media/lua/' + fileName.substring(indexOf + splitter.length);
        }
        let lua;
        if (
          subFileName.endsWith('lualib_bundle.lua') ||
          subFileName.endsWith('PipeWrench.lua') ||
          subFileName.endsWith('PipeWrench-Events.lua')
        ) {
          lua = data;
        } else {
          let scope: Scope = 'none';
          if (subFileName.startsWith('media/lua/client')) scope = 'client';
          else if (subFileName.startsWith('media/lua/server')) scope = 'server';
          else if (subFileName.startsWith('media/lua/shared')) scope = 'shared';

          lua = fixRequire(scope, data);
          lua = applyReimportScript(lua);
        }
        checkDir(subFileName);
        fs.writeFileSync(subFileName, lua);
      }
    }
  );
  console.log(result);
  // Delete the temporary file(s).
  tmpFiles.map((fp) => {
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
    }
  });

  const timeNow = new Date().getTime();
  const timeDelta = timeNow - timeThen;
  const timeSeconds = timeDelta / 1000;

  cursor.brightGreen();
  process.stdout.write(
    `${PREFIX} - Compilation complete. Took ${timeSeconds} second(s).\n`
  );
  cursor.reset();
};

/**
 * (NOTE: This is a BETA feature!)
 *
 * Compiles all .ts files in the project to .d.ts files, grouping them together into one exported
 * `.d.ts` file in `./dist/`.
 */
const compileProjectDeclaration = (srcDir: string) => {
  const modInfo = getModInfo(srcDir);
  const fileName = `./dist/${modInfo.id}.d.ts`;

  cursor.brightGreen();
  console.log(
    `${PREFIX} - Compiling project declarations.. (file: ${fileName})`
  );
  cursor.reset();

  child_process.execSync(`npx tsc --declaration --outFile ${fileName}`);

  const clientDFiles = getFiles('./src/client', 'd.ts');
  const serverDFiles = getFiles('./src/server', 'd.ts');
  const sharedDFiles = getFiles('./src/shared', 'd.ts');

  let lines = fs.readFileSync(fileName).toString().split('\r\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    // Cut out useless declarations that are empty.
    if (line.indexOf('declare module ') !== -1 && line.indexOf('{ }') !== -1) {
      lines.splice(index--, 1);
      continue;
    } else if (line.length === 0) {
      lines.splice(index--, 1);
    }
  }

  if (
    lines.length === 0 &&
    Object.keys(clientDFiles).length === 0 &&
    Object.keys(serverDFiles).length === 0 &&
    Object.keys(sharedDFiles).length === 0
  ) {
    cursor.grey();
    console.log(`${PREFIX} - No declarations to export.`);
    cursor.reset();
    child_process.execSync(`del-cli ${fileName}`);
    return;
  }

  lines.push('');

  cursor.brightGreen();
  console.log(`${PREFIX} - Refactoring project declarations..`);
  cursor.reset();

  // Header //////////////
  lines = lines.reverse();
  lines.push('');
  lines.push('/** @noResolution @noSelfInFile */');
  lines = lines.reverse();
  // Contents //////////////
  for (const filePath of Object.keys(clientDFiles)) {
    lines.push(`/* File: ${filePath} */`);
    const fileData = clientDFiles[filePath].split('\r\n');
    for (const line of fileData) lines.push(line);
  }
  for (const filePath of Object.keys(serverDFiles)) {
    lines.push(`/* File: ${filePath} */`);
    const fileData = clientDFiles[filePath].split('\r\n');
    for (const line of fileData) lines.push(line);
  }
  for (const filePath of Object.keys(sharedDFiles)) {
    lines.push(`/* File: ${filePath} */`);
    const fileData = clientDFiles[filePath].split('\r\n');
    for (const line of fileData) lines.push(line);
  }
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    // Module declarations in d.ts file.
    if (line.indexOf('declare module "client/') !== -1) {
      line = line.replace('declare module "client/', 'declare module "');
    } else if (line.indexOf('declare module "server/') !== -1) {
      line = line.replace('declare module "server/', 'declare module "');
    } else if (line.indexOf('declare module "shared/') !== -1) {
      line = line.replace('declare module "shared/', 'declare module "');
    }
    // Imports in d.ts file.
    if (line.indexOf('from "client/') !== -1)
      line = line.replace('from "client/', 'from "');
    else if (line.indexOf('from "server/') !== -1)
      line = line.replace('from "server/', 'from "');
    else if (line.indexOf('from "shared/') !== -1)
      line = line.replace('from "shared/', 'from "');
    // Set refactored line.
    lines[index] = line;
  }

  fs.writeFileSync(fileName, lines.join('\r\n') + '\r\n');
};

const checkDir = (file: string) => {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

/**
 * A temporary workaround for no `replaceAll` function by default.
 *
 * @param string The string to transform.
 * @param target The target phrase to replace.
 * @param to The phrase to replace the target.
 * @returns The transformed string.
 */
const replaceAll = (
  string: string,
  target: string,
  to: string,
  position = 0
): string => {
  let index: number;
  let lastIndex: number = position;
  while ((index = string.indexOf(target, lastIndex)) !== -1) {
    string = string.replace(target, to);
    lastIndex = index + to.length;
    if (index > string.length) break;
  }
  return string;
};

/**
 * Transforms `require(..)` statements compiled by TSTL, replacing `.` with `/`. import paths
 * outside of the folder containers `client`, `server`, and `shared` are modified to resolve
 * properly in the PZ-Kahlua environment.
 *
 * (NOTE: Kahlua2 is an imperfect emulator for Lua 5.1)
 *
 * @param scope The original scope where the require statement came from.
 * @param lua The require statement to fix.
 * @returns The fixed require statement.
 */
const fixRequire = (scope: Scope, lua: string): string => {
  if (lua.length === 0) return '';
  const fix = (fromImport: string): string => {
    let toImport = replaceAll(fromImport, '.', '/');
    // Remove cross-references for client/server/shared.
    if (toImport.startsWith('shared/')) {
      toImport = toImport.substring('shared/'.length);
    } else if (toImport.startsWith('client/')) {
      if (scope === 'server') {
        cursor.yellow();
        console.warn(
          `${PREFIX} - Cannot reference code from src/client from src/server. ` +
            '(Code will fail when ran)'
        );
        cursor.reset();
      }
      toImport = toImport.substring('client/'.length);
    } else if (toImport.startsWith('server/')) {
      if (scope === 'client') {
        cursor.yellow();
        console.warn(
          `${PREFIX} - Cannot reference code from src/server from src/client. ` +
            '(Code will fail when ran)'
        );
        cursor.reset();
      }
      toImport = toImport.substring('server/'.length);
    }
    return toImport;
  };
  let index = -1;
  do {
    let fromImport = '';
    index = lua.indexOf('require("');
    if (index !== -1) {
      index += 9;
      // Grab the require string.
      while (index < lua.length) {
        const char = lua.charAt(index++);
        if (char === '"') break;
        fromImport += char;
      }
      const toImport = fix(fromImport);
      // Kahlua only works with '/', nor '.' in 'require(..)'.
      const from = 'require("' + fromImport + '")';
      const to = "require('" + replaceAll(toImport, '.', '/') + "')";
      lua = lua.replace(from, to);
    }
  } while (index !== -1);

  return lua;
};

/**
 * This applies a codeblock for reimporting Lua objects after PipeWrench loads. The reason for this
 * is due to not having initialized Lua objects when PipeWrench initially loads in Kahlua2. To work
 * around this problem, the assignments are detected when scanned through the compiled TSTL code and
 * then feed into the 'OnPipeWrenchBoot' event wrapper in './scripts/reimport_template.lua`.
 *
 * @param lua The code to transform & append.
 * @returns The transformed code.
 */
const applyReimportScript = (lua: string): string => {
  const assignments: string[] = [];
  const lines = lua.split('\n');

  // Look for any PipeWrench assignments.
  for (const line of lines) {
    if (
      line.indexOf('local ') === 0 &&
      line.indexOf('____PipeWrench.') !== -1
    ) {
      assignments.push(line.replace('local ', ''));
    }
  }

  // Only generate a reimport codeblock if there's anything to import.
  if (!assignments.length) return lua;

  // Take out the returns statement so we can insert before it.
  lines.pop();
  const returnLine: string = lines.pop() as string;
  lines.push('');

  // Build the reimport event.
  let compiledImports = '';
  for (const assignment of assignments) compiledImports += `${assignment}\n`;

  return `${lines.join('\n')}\n\n\n${returnLine}\n`;
};

main();
