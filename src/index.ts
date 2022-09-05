import * as ts from 'typescript';
import * as tstl from 'typescript-to-lua';
import * as fs from 'fs-extra';
import path from 'path';
import { existsSync, writeFileSync } from 'fs';
import Ajv, { JSONSchemaType } from 'ajv';
import { PipeWrenchConfigSchema, PipeWrenchConfig } from "./config"
const ajv = new Ajv();
type Scope = 'client' | 'server' | 'shared' | 'none';
const REIMPORT_TEMPLATE = fs
  .readFileSync(path.join(__dirname, '../lua/reimport_template.lua'))
  .toString();

const fixRequire = (scope: Scope, lua: string): string => {
  if (lua.length === 0) return '';
  const fix = (fromImport: string): string => {
    let toImport = fromImport.replaceAll('.', '/');
    // Remove cross-references for client/server/shared.
    if (toImport.startsWith('shared/')) {
      toImport = toImport.substring('shared/'.length);
    } else if (toImport.startsWith('client/')) {
      if (scope === 'server') {
        console.warn(
          `Cannot reference code from src/client from src/server. ` +
          '(Code will fail when ran)'
        );
      }
      toImport = toImport.substring('client/'.length);
    } else if (toImport.startsWith('server/')) {
      if (scope === 'client') {
        console.warn(
          `Cannot reference code from src/server from src/client. ` +
          '(Code will fail when ran)'
        );
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
      const to = "require('" + toImport.replaceAll('.', '/') + "')";
      lua = lua.replace(from, to);
    }
  } while (index !== -1);

  return lua;
};

const applyReimportScript = (lua: string): string => {
  const assignments: string[] = [];
  const lines = lua.split('\n');

  // Look for any PipeWrench assignments.
  for (const line of lines) {
    if (
      line.indexOf('local ') === 0 &&
      line.indexOf('____pipewrench.') !== -1
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
  const reimports = REIMPORT_TEMPLATE.replace(
    '-- {IMPORTS}',
    compiledImports.substring(0, compiledImports.length - 1)
  );

  return `${lines.join('\n')}\n${reimports}\n\n${returnLine}\n`;
};

const handleFile = (file: tstl.EmitFile) => {
  if (file.code.length === 0) return;
  let scope: Scope = 'none';
  const fp = path.parse(file.outputPath);
  if (fp.dir.indexOf('client')) scope = 'client';
  else if (fp.dir.indexOf('server')) scope = 'server';
  else if (fp.dir.indexOf('shared')) scope = 'shared';
  const split = fp.dir.split('lua_modules');
  const isLuaModule = split.length > 1;
  if (fp.name === 'lualib_bundle') {
    file.outputPath = path.join(fp.dir, 'shared/lualib_bundle.lua');
  }
  if (isLuaModule) {
    file.outputPath = path.join(
      split[0],
      'shared',
      ...split.slice(1),
      fp.base
    );
  }
  file.code = applyReimportScript(fixRequire(scope, file.code));
};
const copyMake = (src: string, dest: string) => {
  fs.ensureDirSync(dest);
  fs.copySync(src, dest, { recursive: true });
};

class PipeWrenchPlugin implements tstl.Plugin {
  config: PipeWrenchConfig;
  constructor() {
    const validateConfig = ajv.compile(PipeWrenchConfigSchema);

    const rawdata = fs.readFileSync('./pipewrench.json');
    const rawConfig = JSON.parse(rawdata.toString());
    if (validateConfig(rawConfig)) {
      this.config = rawConfig;
      console.log('Configuration:', this.config);
    } else {
      console.error(validateConfig.errors);
      throw 'Error parsing pipewrench.json';
    }
  }
  public beforeTransform(
    program: ts.Program,
    options: tstl.CompilerOptions,
    emitHost: tstl.EmitHost
  ) {
    if (!options.outDir) {
      throw 'Must specify outDir in tsconfig.json';
    }
    return;
  }

  beforeEmit(
    program: ts.Program,
    options: tstl.CompilerOptions,
    emitHost: tstl.EmitHost,
    result: tstl.EmitFile[]
  ) {
    if (options.outDir) {
      const modSubDir = path.join(options.outDir, this.config.modInfo.id);
      if (existsSync(this.config.modelsDir))
        copyMake(
          this.config.modelsDir,
          path.join(modSubDir, 'media', 'models')
        );
      if (existsSync(this.config.texturesDir))
        copyMake(
          this.config.texturesDir,
          path.join(modSubDir, 'media', 'textures')
        );
      if (existsSync(this.config.soundDir))
        copyMake(this.config.soundDir, path.join(modSubDir, 'media', 'sound'));
      if (existsSync(this.config.scriptsDir))
        copyMake(
          this.config.scriptsDir,
          path.join(modSubDir, 'media', 'scripts')
        );
      const modInfoArray = Object.entries(this.config.modInfo).map(
        ([key, value]) => {
          return `${key}=${value}`;
        }
      );
      writeFileSync(path.join(modSubDir, 'mod.info'), modInfoArray.join('\n'));
      result.map((file) => {
        const { outDir } = options;
        if (outDir) {
          file.outputPath = path.join(
            modSubDir,
            path.relative(outDir, file.outputPath)
          );
          handleFile(file);
        }
      });
    }
  }
}

const plugin = new PipeWrenchPlugin();
export default plugin;
