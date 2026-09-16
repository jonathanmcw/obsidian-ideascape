// obsidian: every window, popped-out ones included, gets Obsidian's DOM helpers as globals, so
// `el.win.createEl(...)` builds in the element's own window. The typings declare the globals but not
// their place on Window.
export {};

declare global {
  interface Window {
    createEl: typeof createEl;
    createFragment: typeof createFragment;
  }
}
