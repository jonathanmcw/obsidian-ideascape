// Slide images for the welcome window: esbuild inlines them as data URLs (see esbuild.config.mjs and test/host-bundle.ts).
declare module "*.webp" {
  const url: string;
  export default url;
}
