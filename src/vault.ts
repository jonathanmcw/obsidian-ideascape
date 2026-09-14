import { TFolder, normalizePath, type App, type TAbstractFile, type TFile } from "obsidian";

// obsidian: the vault looks paths up by exact case, but macOS and Windows disks ignore it, and create refuses
// "Trip.md" beside "trip.md". So a path the plugin chose (the maps folder setting, the tour's name) is matched
// against the vault's tree one segment at a time, the exact name first: a disk that keeps case can hold both.
function child(folder: TFolder, name: string): TAbstractFile | undefined {
  const lower = name.toLowerCase();
  return folder.children.find(c => c.name === name) ?? folder.children.find(c => c.name.toLowerCase() === lower);
}

/** The file or folder at `path` as the vault spells it, whatever case `path` is in. */
export function findPath(app: App, path: string): TAbstractFile | null {
  const p = normalizePath(path);
  let at: TAbstractFile = app.vault.getRoot();
  if (!p || p === "/") return at;
  for (const name of p.split("/")) {
    const next = at instanceof TFolder ? child(at, name) : undefined;
    if (!next) return null;
    at = next;
  }
  return at;
}

/** The folder at `folder`, found whatever its case, with whatever part of it is missing made inside the part that is there. */
export async function ensureFolder(app: App, folder: string): Promise<TFolder> {
  const p = normalizePath(folder);
  let at = app.vault.getRoot();
  if (!p || p === "/") return at;
  const names = p.split("/");
  for (const [i, name] of names.entries()) {
    const next = child(at, name);
    if (next instanceof TFolder) { at = next; continue; }
    if (next) throw new Error(`“${next.path}” is a file, not a folder.`);
    return app.vault.createFolder(normalizePath([at.path, ...names.slice(i)].join("/")));
  }
  return at;
}

/** A new file in `folder`, named `fileName` or, when that is taken, `name-2`, `name-3`… Never over an existing file. */
export async function writeUnique(app: App, folder: string, fileName: string, content: string): Promise<TFile> {
  const parent = await ensureFolder(app, folder);
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot) : ".md";
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "untitled";
  // Names are compared without case (see above).
  const names = new Set(parent.children.map(f => f.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = `${base}${n > 1 ? `-${n}` : ""}${ext}`;
    const p = normalizePath(`${parent.path}/${name}`);
    if (names.has(name.toLowerCase()) || app.vault.getAbstractFileByPath(p)) continue;
    try { return await app.vault.create(p, content); }
    catch (e) {
      // Taken between the look and the write (a second click, Sync): the next name. Anything else is the caller's.
      const exists = /already exists/i.test(e instanceof Error ? e.message : String(e)) || app.vault.getAbstractFileByPath(p) !== null;
      if (!exists || n >= 100) throw e;
    }
  }
}
