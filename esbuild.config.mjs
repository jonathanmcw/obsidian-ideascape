import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
  format: "cjs",
  jsx: "automatic",
  minify: prod,
  define: { "process.env.NODE_ENV": prod ? '"production"' : '"development"' },
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) { await ctx.rebuild(); process.exit(0); } else { await ctx.watch(); }
