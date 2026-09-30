/**
 * Incremental registry of classified form controls.
 * New subtrees are classified once; the whole document is scanned only at start-up (DESIGN.md §27).
 */
import type { SensitiveFieldKind } from "../shared/schema";
import { CONTROL_SELECTOR, describeControl, primarySensitiveGroup, type ClassifiedControl, type FormGroup } from "./form-scanner";
import { isSensitive } from "./field-classifier";

const MAX_CONTROLS = 1000;

export class ControlRegistry {
  private readonly controls = new Map<Element, ClassifiedControl>();
  private readonly lifecycles = new WeakMap<Element, number>();
  private nextLifecycle = 0;
  private activeControl: Element | null = null;

  /** Classifies controls in `root` (inclusive). Returns true if a new sensitive control appeared. */
  addFrom(root: Element | Document): boolean {
    this.prune();
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

  /** Attribute changes can make an initially ignored control classifiable. */
  reclassify(el: Element): void {
    if (!el.matches(CONTROL_SELECTOR)) return;
    const classified = describeControl(el as HTMLInputElement);
    if (!classified) {
      this.controls.delete(el);
      return;
    }
    if (this.controls.has(el) || this.controls.size < MAX_CONTROLS) this.controls.set(el, classified);
  }

  /** Re-reads labels and attributes of known controls (they may change after classification). */
  refresh(): void {
    for (const el of Array.from(this.controls.keys())) this.reclassify(el);
  }

  prune(): void {
    for (const el of this.controls.keys()) {
      if (!el.isConnected) this.controls.delete(el);
    }
  }

  kindOf(el: Element): SensitiveFieldKind | undefined {
    return this.controls.get(el)?.descriptor.kind;
  }

  activate(el: Element): void {
    this.activeControl = el;
  }

  selectedGroup(): FormGroup | null {
    const groups = this.groups();
    const active = groups.find(group => group.controls.some(control => control.element === this.activeControl));
    return active && active.controls.some(control => isSensitive(control.descriptor.kind))
      ? active : primarySensitiveGroup(groups);
  }

  lifecycle(group: FormGroup | null = this.selectedGroup()): number | null {
    const owner = group?.form ?? group?.controls[0]?.element;
    if (!owner) return null;
    const existing = this.lifecycles.get(owner);
    if (existing !== undefined) return existing;
    const next = ++this.nextLifecycle;
    this.lifecycles.set(owner, next);
    return next;
  }

  groups(): FormGroup[] {
    const groups = new Map<HTMLFormElement | null, ClassifiedControl[]>();
    const ordered = Array.from(this.controls.values()).sort((a, b) => {
      if (a.element === b.element) return 0;
      const order = a.element.compareDocumentPosition(b.element);
      return order & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
    });
    for (const classified of ordered) {
      const el = classified.element;
      const form = el.form ?? el.closest("form");
      const list = groups.get(form) ?? [];
      list.push(classified);
      groups.set(form, list);
    }
    return Array.from(groups, ([form, controls]) => ({ form, controls }));
  }
}
