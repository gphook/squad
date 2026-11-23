import { describe, it, expect, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import EditableText from "../src/components/EditableText.svelte";
import PickList from "../src/components/PickList.svelte";
import { reactive } from "./reactive.svelte.ts";

let cleanup: (() => void)[] = [];
afterEach(() => { for (const c of cleanup) c(); cleanup = []; document.body.innerHTML = ""; });

function render<P extends Record<string, unknown>>(Component: never, props: P) {
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(Component, { target, props });
  cleanup.push(() => unmount(app));
  flushSync();
  return target;
}
const key = (el: Element, k: string) => {
  const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  flushSync();
  return ev;
};

describe("EditableText", () => {
  function setup(initial: string, placeholder?: string) {
    const props = reactive({ value: initial, label: "Activity name", ...(placeholder ? { placeholder } : {}) });
    const target = render(EditableText as never, props);
    return { target, get value() { return props.value; } };
  }

  it("shows the text, edits on click and keeps the edit on Enter without submitting", () => {
    const t = setup("Shaders");
    expect(t.target.textContent).toContain("Shaders");
    (t.target.querySelector("button") as HTMLButtonElement).click();
    flushSync();
    const input = t.target.querySelector("input")!;
    expect(input.value).toBe("Shaders");
    input.value = "UI shaders";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const ev = key(input, "Enter");
    expect(ev.defaultPrevented).toBe(true);
    expect(t.value).toBe("UI shaders");
    expect(t.target.querySelector("input")).toBeNull();
    expect(t.target.textContent).toContain("UI shaders");
  });

  it("gives keyboard focus back to the label after Enter or Escape", async () => {
    const t = setup("Shaders");
    for (const k of ["Enter", "Escape"]) {
      (t.target.querySelector("button") as HTMLButtonElement).click();
      flushSync();
      key(t.target.querySelector("input")!, k);
      await new Promise((r) => setTimeout(r, 0));
      expect(document.activeElement, k).toBe(t.target.querySelector("button"));
    }
  });

  it("restores the old text on Escape, without letting the key reach the dialog", () => {
    const t = setup("Shaders");
    let reached = false;
    document.body.addEventListener("keydown", () => (reached = true));
    (t.target.querySelector("button") as HTMLButtonElement).click();
    flushSync();
    const input = t.target.querySelector("input")!;
    input.value = "oops";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    key(input, "Escape");
    expect(t.value).toBe("Shaders");
    expect(t.target.textContent).toContain("Shaders");
    expect(reached).toBe(false);
  });

  it("shows the placeholder when empty", () => {
    expect(setup("", "Add a description").target.textContent).toContain("Add a description");
  });
});

describe("PickList", () => {
  const options = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id${i}`, name: `mate-${i}` }));
  function setup(n: number, initial: string[] = []) {
    const props = reactive({ selected: initial, options: options(n), label: "Reviewed by" });
    const target = render(PickList as never, props);
    return { target, get selected() { return props.selected; } };
  }
  const open = (t: HTMLElement) => { (t.querySelector("button") as HTMLButtonElement).click(); flushSync(); };

  it("reads as a comma list and ticks reviewers in a dropdown", () => {
    const t = setup(3);
    expect(t.target.textContent).toContain("Reviewed by: nobody");
    open(t.target);
    const boxes = t.target.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    expect(boxes).toHaveLength(3);
    boxes[2].click();
    boxes[0].click();
    flushSync();
    expect(t.selected).toEqual(["id2", "id0"]);
    expect(t.target.textContent).toContain("Reviewed by: mate-2, mate-0");
  });

  it("adds a filter only when there are more than 6 to choose from", () => {
    const six = setup(6);
    open(six.target);
    expect(six.target.querySelector("input[type=search]")).toBeNull();
    const seven = setup(7);
    open(seven.target);
    const filter = seven.target.querySelector<HTMLInputElement>("input[type=search]")!;
    filter.value = "mate-6";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(seven.target.querySelectorAll("input[type=checkbox]")).toHaveLength(1);
  });

  it("puts the keyboard in the dropdown when it opens: the filter, else the first box", async () => {
    const seven = setup(7);
    open(seven.target);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(seven.target.querySelector("input[type=search]"));
    const three = setup(3);
    open(three.target);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(three.target.querySelector("input[type=checkbox]"));
  });

  it("never lets Enter in the dropdown submit the form around it", () => {
    const t = setup(7);
    open(t.target);
    expect(key(t.target.querySelector("input[type=search]")!, "Enter").defaultPrevented).toBe(true);
    expect(key(t.target.querySelector("input[type=checkbox]")!, "Enter").defaultPrevented).toBe(true);
  });

  it("gives focus back to the summary when Escape closes the dropdown", async () => {
    const t = setup(3);
    open(t.target);
    key(t.target.querySelector("input[type=checkbox]")!, "Escape");
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(t.target.querySelector("button.summary"));
  });

  it("closes on Escape and on a click outside", () => {
    const t = setup(3);
    open(t.target);
    key(t.target.querySelector("input[type=checkbox]")!, "Escape");
    expect(t.target.querySelector("input[type=checkbox]")).toBeNull();
    open(t.target);
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    flushSync();
    expect(t.target.querySelector("input[type=checkbox]")).toBeNull();
  });
});
