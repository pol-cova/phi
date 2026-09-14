import ts from 'typescript';

export function compileTypeScript(source) {
  const result = ts.transpileModule(source, {
    fileName: 'solution.ts',
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length) {
    const details = ts.formatDiagnostics(errors, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => '.',
      getNewLine: () => '\n',
    });
    throw new Error(`TypeScript compilation failed:\n${details}`);
  }
  return result.outputText;
}

export function submissionSource(problem, source) {
  if (problem.platform !== 'codeforces' || problem.language !== 'typescript') return { problem, source };
  return {
    problem: { ...problem, language: 'javascript', file: 'solution.js' },
    source: compileTypeScript(source),
  };
}
