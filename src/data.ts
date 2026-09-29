import { loadDataset } from "./ontology";

const raw = import.meta.glob("/data/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const files = Object.fromEntries(Object.entries(raw).map(([path, text]) => [path.replace(/^\//, ""), text]));

export const { dataset, errors } = loadDataset(files);
