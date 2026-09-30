/** Toolbar popup entry. Display models and DOM/browser execution are separated. */
import { ext } from "../shared/browser";
import { mountPopup } from "./popup-view";

mountPopup(document, ext);
