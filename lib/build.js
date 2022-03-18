/* eslint-disable import/no-extraneous-dependencies */
const typescript = require("typescript");
const esbuild = require("esbuild");
const path = require("path");
const TsconfigPaths = require("tsconfig-paths");
const filesystem = require("tsconfig-paths/lib/filesystem");

const pwd = process.cwd();
const tsConfigFileName = typescript.findConfigFile("./", typescript.sys.fileExists);

if (!tsConfigFileName) {
  throw new Error("没有找到配置文件");
}
const { config, error } = typescript.readConfigFile(tsConfigFileName, typescript.sys.readFile);

if (error) {
  throw error;
}

const tsConfig = typescript.parseJsonConfigFileContent(config, typescript.sys, pwd);

const importAnalyze = {};
const matchPath = TsconfigPaths.createMatchPathAsync(
  tsConfig.options.baseUrl,
  tsConfig.options.paths
);
const matchCache = {};
function matchPathPromise(requestModule) {
  return new Promise((resolve, reject) => {
    if (matchCache[requestModule]) return resolve(matchCache[requestModule]);
    return matchPath(
      requestModule,
      filesystem.readJsonFromDiskAsync,
      filesystem.fileExistsAsync,
      ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'],
      (err, realPath) => {
        if (err) reject(err);
        resolve(matchCache[requestModule] = realPath);
      }
    );
  });
}

const analyzePlugin = {
  name: 'import-analyze',
  setup(build) {
    build.onResolve({ filter: /./ }, async (args) => {
      const rpath = path.relative(pwd, args.importer);
      importAnalyze[rpath] = importAnalyze[rpath] || {
        imports: {},
      };
      importAnalyze[rpath].imports[args.path] = await matchPathPromise(args.path);
    });
  },
};

const buildPlugin = {
  name: 'build-plugin',
  setup(build) {
    build.onLoad({ filter: /\.tsx?/ }, async (args) => {
      let content = typescript.sys.readFile(args.path);
      const rpath = path.relative(pwd, args.path);
      const i = importAnalyze[rpath]?.imports || {};
      Object.keys(i).forEach((p) => {
        if (!i[p]) return;
        content = content.replace(p, `./${path.relative(path.dirname(args.path), i[p])}`);
      });
      if (/\/\/ +transpileModule = On/.test(content)) {
        content = typescript.transpileModule(content, config).outputText;
      }
      return {
        contents: content,
        loader: "tsx"
      };
    });
  },
};

(async () => {
  await esbuild.build({
    entryPoints: [...tsConfig.fileNames],
    write: false,
    bundle: true,
    outdir: tsConfig.options.outDir,
    platform: 'node',
    format: 'cjs',
    external: ["./node_modules/*"],
    plugins: [analyzePlugin],
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.css', '.json']
  });
  await esbuild.build({
    entryPoints: [...tsConfig.fileNames],
    outdir: tsConfig.options.outDir,
    platform: 'node',
    format: 'cjs',
    sourcemap: tsConfig.options.sourceMap ? tsConfig.options.inlineSourceMap ? 'inline' : 'external' : false,
    plugins: [buildPlugin],
  });
})();
