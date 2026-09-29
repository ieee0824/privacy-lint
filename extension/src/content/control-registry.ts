/**
 * Incremental registry of classified form controls.
 * New subtrees are classified once; the whole document is scanned only at start-up (DESIGN.md §27).
 */
import type { SensitiveFieldKind } from "../shared/schema";
import { CONTROL_SELECTOR, describeControl, type ClassifiedControl, type FormGroup } from "./form-scanner";
import { isSensitive } from "./field-classifier";

const MAX_CONTROLS = 1000;

export class ControlRegistry {
  private readonly controls = new Map<Element, ClassifiedControl>();

  /** Classifies controls in `root` (inclusive). Returns true if a new sensitive control appeared. */
  addFrom(root: Element | Document): boolean {
    let foundSensitive = false;
    const candidates: Element[] = [];
    if (root instanceof Element && root.matches(CONTROL_SELECTOR)) candidates.push(root);
    candidates.push(...Array.from(root.querySelectorAll(CONTROL_SELECTOR)));

    for (const el of candidates) {
      if (this.controls.has(el) || this.controls.size >= MAX_CONTROLS) continue;
      const classified = describeControl(el as HTMLInputElement);
      if (!classified) continue;
      this.controls.set(el, classified);
      if (isSensitive(classified.descriptor.kind)) foundSensitive = true;
    }
    return foundSensitive;
  }

  prune(): void {
    for (const el of this.controls.keys()) {
      if (!el.isConnected) this.controls.delete(el);
    }
  }

  kindOf(el: Element): SensitiveFieldKind | undefined {
    return this.controls.get(el)?.descriptor.kind;
  }

  groups(): FormGroup[] {
    const groups = new Map<HTMLFormElement | null, ClassifiedControl[]>();
    for (const classified of this.controls.values()) {
      const el = classified.element;
      const form = el.form ?? el.closest("form");
      const list = groups.get(form) ?? [];
      list.push(classified);
      groups.set(form, list);
    }
    return Array.from(groups, ([form, controls]) => ({ form, controls }));
  }
}
