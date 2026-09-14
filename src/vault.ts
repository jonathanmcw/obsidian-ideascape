import { TFolder, normalizePath, type App, type TFile } from "obsidian";

export async function ensureFolder(app: App, folder: string): Promise<void> {
  const p = normalizePath(folder);
  if (!p || p === "/") return;
  if (!app.vault.getAbstractFileByPath(p)) await app.vault.createFolder(p);
}

/** A new file in `folder`, named `fileName` or, when that is taken, `name-2`, `name-3`… Never over an existing file. */
export async function writeUnique(app: App, folder: string, fileName: string, content: string): Promise<TFile> {
  await ensureFolder(app, folder);
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot) : ".md";
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "untitled";
  // obsidian: the vault looks paths up by exact case, but macOS and Windows disks ignore it, and create refuses
  // "Trip.md" beside "trip.md". So names are compared without case.
  const dir = normalizePath(folder);
  const parent = dir && dir !== "/" ? app.vault.getAbstractFileByPath(dir) : app.vault.getRoot();
  const names = new Set(parent instanceof TFolder ? parent.children.map(f => f.name.toLowerCase()) : []);
  for (let n = 1; ; n++) {
    const name = `${base}${n > 1 ? `-${n}` : ""}${ext}`;
    const p = normalizePath(`${folder}/${name}`);
    if (names.has(name.toLowerCase()) || app.vault.getAbstractFileByPath(p)) continue;
    try { return await app.vault.create(p, content); }
    catch (e) {
      // Taken between the look and the write (a second click, Sync): the next name. Anything else is the caller's.
      const exists = /already exists/i.test(e instanceof Error ? e.message : String(e)) || app.vault.getAbstractFileByPath(p) !== null;
      if (!exists || n >= 100) throw e;
    }
  }
}
