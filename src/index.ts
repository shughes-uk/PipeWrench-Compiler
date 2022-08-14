import * as ts from "typescript";
import * as tstl from "typescript-to-lua";
import * as fs from 'fs';
import path from "path";

type Scope = 'client' | 'server' | 'shared' | 'none';
const REIMPORT_TEMPLATE = fs.readFileSync(path.join(__dirname,'../lua/reimport_template.lua')).toString();

const fixRequire = (scope: Scope, lua: string): string => {
  if (lua.length === 0) return '';
  const fix = (fromImport: string): string => {
    let toImport = fromImport.replaceAll(".","/")
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
      const to = "require('" + toImport.replaceAll( '.', '/') + "')";
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
  const reimports = REIMPORT_TEMPLATE.replace(
    '-- {IMPORTS}',
    compiledImports.substring(0, compiledImports.length - 1)
  );

  return `${lines.join('\n')}\n${reimports}\n\n${returnLine}\n`;
};

const handle_file = (file:tstl.EmitFile) => {
  if (file.code.length ===0) return;
  let scope :Scope = 'none'
  if (file.outputPath.startsWith('media/lua/client')) scope = 'client';
  else if (file.outputPath.startsWith('media/lua/server')) scope = 'server';
  else if (file.outputPath.startsWith('media/lua/shared')) scope = 'shared';
  file.code = applyReimportScript(fixRequire(scope,file.code))
}
const plugin: tstl.Plugin = {
  // beforeTransform(program, options, emitHost) {
  //   console.log(program)
  // },
  // afterPrint(
  //   program: ts.Program,
  //   options: tstl.CompilerOptions,
  //   emitHost: tstl.EmitHost,
  //   result: tstl.ProcessedFile[],
  // ) {
  //   for (const file of result) {
  //     console.log(file.code)
  //     file.code = "-- Comment added by afterPrint plugin\n" + file.code;
  //   }
  // },
  beforeEmit(program: ts.Program, options: tstl.CompilerOptions, emitHost: tstl.EmitHost, result: tstl.EmitFile[]) {
    void program;
    void options;
    void emitHost;

    result.map(handle_file)
    // for (const file of result) {
    //   file.code = "-- Comment added by beforeEmit plugin\n" + file.code;
    // }
  },
};

export default plugin;
