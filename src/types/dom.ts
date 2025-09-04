import type { OpenMemoryPrompts } from "./memory";

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
    OPENMEMORY_PROMPTS: OpenMemoryPrompts;
  }
}

// Extended DOM types
export type ExtendedHTMLElement = HTMLElement & {
  _cleanupDragEvents?: () => void;
};

export type ExtendedDocument = Document & {
  __mem0FocusPrimed?: boolean;
  __mem0EnterCapture?: boolean;
  __mem0SubmitCapture?: boolean;
};

export type ExtendedElement = Element & {
  __mem0Observed?: boolean;
  nodeType?: number;
  matches?: (selector: string) => boolean;
  querySelector?: (selector: string) => Element | null;
  classList?: DOMTokenList;
};

// Modal dimensions
export type ModalDimensions = {
  width: number;
  height: number;
  memoriesPerPage: number;
};

export type ModalPosition = {
  top: number | null;
  left: number | null;
};

// MutationObserver type
export type MutableMutationObserver = MutationObserver & {
  memoryStateInterval?: number;
  debounceTimer?: number;
};
