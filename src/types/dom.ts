// Global interfaces for DOM extensions
declare global {
  interface Element {
    value?: string;
    disabled?: boolean;
    dataset: DOMStringMap;
    style: CSSStyleDeclaration;
  }
  interface CSSStyleDeclaration {
    msOverflowStyle?: string;
  }
  interface Window {
    mem0Initialized?: boolean;
    mem0KeyboardListenersAdded?: boolean;
    mem0ButtonAdded?: boolean;
  }
}

/** Extended HTML element with cleanup methods */
export type ExtendedHTMLElement = HTMLElement & {
  _cleanupDragEvents?: () => void;
};

/** Extended document with mem0-specific properties */
export type ExtendedDocument = Document & {
  __mem0FocusPrimed?: boolean;
  __mem0EnterCapture?: boolean;
  __mem0SubmitCapture?: boolean;
};

/** Extended element with additional properties */
export type ExtendedElement = Element & {
  __mem0Observed?: boolean;
  nodeType?: number;
  matches?: (selector: string) => boolean;
  querySelector?: (selector: string) => Element | null;
  classList?: DOMTokenList;
};

/** Modal size and pagination settings */
export type ModalDimensions = {
  width: number;
  height: number;
  memoriesPerPage: number;
};

/** Modal positioning coordinates */
export type ModalPosition = {
  top: number | null;
  left: number | null;
};

/** Extended mutation observer with timers */
export type MutableMutationObserver = MutationObserver & {
  memoryStateInterval?: number;
  debounceTimer?: number;
};
