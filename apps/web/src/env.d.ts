declare const __BUILD__: {
  sha: string;
  branch: string;
  env: string;
  builtAt: string;
};

declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "*.jsonl?raw" {
  const content: string;
  export default content;
}
