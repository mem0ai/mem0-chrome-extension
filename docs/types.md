# Types Documentation

This section contains TypeScript type definitions for the Mem0 Chrome Extension. The types are organized into several files based on their functionality.

## Overview

### `types/api.ts`
Defines types for API interactions:
- `MessageRole` - Enum for message roles (User, Assistant)
- `ApiMessage` - Message structure with role and content
- `ApiMemoryRequest` - Request payload for memory API calls
- `MemorySearchResponse` - Array of memory search results
- `LoginData` - User authentication data structure
- `DEFAULT_USER_ID` - Default user ID constant
- `SOURCE` - Extension source identifier

### `types/browser.ts`
Browser-specific type definitions:
- `OnCommittedDetails` - Web navigation event details
- `JsonPrimitive` - JSON primitive value types
- `JsonValue` - Recursive JSON value type
- `JsonObject` - JSON object structure
- `HistoryStateData` - Browser history state data
- `HistoryUrl` - Browser history URL type

### `types/dom.ts`
DOM-related type extensions and global declarations:
- `ExtendedHTMLElement` - Extended HTML element with cleanup methods
- `ExtendedDocument` - Extended document with mem0-specific properties
- `ExtendedElement` - Extended element with additional properties
- `ModalDimensions` - Modal size and pagination settings
- `ModalPosition` - Modal positioning coordinates
- `MutableMutationObserver` - Extended mutation observer with timers
- Global interface extensions for `Element`, `CSSStyleDeclaration`, and `Window`

### `types/memory.ts`
Core memory-related types:
- `MemoryItem` - Individual memory structure with id, text, and categories
- `Memory` - Simplified memory structure
- `MemorySearchItem` - Search result item from API
- `MemoriesResponse` - API response wrapper for memories
- `OpenMemoryPrompts` - Prompt templates and regex patterns
- `OptionalApiParams` - Optional parameters for API calls (org_id, project_id)

### `types/messages.ts`
Message passing between extension components:
- `ToastVariant` - Enum for toast notification types (SUCCESS, ERROR)
- `MessageType` - Enum for different message types
- `SidebarAction` - Enum for sidebar actions (TOGGLE_SIDEBAR, OPEN_POPUP, etc.)
- `SelectionContextPayload` - Payload for selection context messages
- `SelectionContextResponse` - Response structure for selection context
- `GetSelectionContextMessage` - Message type for getting selection context
- `ToastMessage` - Toast notification message structure
- `SelectionContextMessage` - Union type for selection context messages
- `SendResponse` - Response callback type
- Various sidebar action message types

### `types/organizations.ts`
Organization and project management:
- `Organization` - Organization structure with org_id and name
- `Project` - Project structure with project_id and name

### `types/providers.ts`
AI provider definitions:
- `Provider` - Enum for supported AI providers
- `Category` - Enum for memory categories (BOOKMARK, NAVIGATION, SEARCH)

### `types/settings.ts`
User settings and preferences:
- `UserSettings` - User preference structure with API keys, memory settings, and thresholds
- `SidebarSettings` - Sidebar-specific settings with organization and project info
- `Settings` - Legacy settings structure for compatibility

### `types/storage.ts`
Chrome storage key definitions:
- `StorageKey` - Enum for all storage keys used in the extension
- `StorageItems` - Type mapping for storage values (required fields)
- `StorageData` - Type mapping for storage values (optional fields)
