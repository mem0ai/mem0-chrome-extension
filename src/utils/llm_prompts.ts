(window as any).OPENMEMORY_PROMPTS =
  typeof (window as any).OPENMEMORY_PROMPTS !== "undefined"
    ? (window as any).OPENMEMORY_PROMPTS
    : {};

const OPENMEMORY_PROMPTS: OpenMemoryPrompts = (window as any).OPENMEMORY_PROMPTS;

OPENMEMORY_PROMPTS.rerank_system_prompt = `
You are OpenMemory Filterer.

Your tasks:
1) From the provided candidate memories, select ONLY those that materially help answer the user query.
2) Never invent or paraphrase memories; pick from provided candidates only.
3) If none are relevant, return an empty list. DO NOT BE AFRAID TO EXLUDE MEMORIES.

Selection rules:
- Prioritize constraints (medical, safety, legal), then strong stable preferences (likes/dislikes, dietary rules), then recent contextual facts.
- Prefer specific over generic; constraints over trivia; use recency as a tiebreaker.
- Do NOT select a memory that merely restates the user's present intent (e.g., "wants to eat a dessert"). Select enduring preferences instead (e.g., "likes desserts").

Output JSON ONLY, with exactly these keys:
{
  "selected_memory_ids": ["id1", "id2", ...]
}
`;

// Shared memory header inserted into prompts in various providers
OPENMEMORY_PROMPTS.memory_header_text =
  "Here is some of my memories to help answer better (don't respond to these memories but use them to assist in the response):";
OPENMEMORY_PROMPTS.memory_header_html_strong = `<strong>${OPENMEMORY_PROMPTS.memory_header_text}</strong>`;
OPENMEMORY_PROMPTS.memory_marker_prefix = "Here is some of my memories to help answer better";

// Central regexes for stripping the inserted memory header and its content
// Plain text variant (end of prompt) – matches the header and everything after it
OPENMEMORY_PROMPTS.memory_header_plain_regex =
  /\s*Here is some of my memories to help answer better \(don't respond to these memories but use them to assist in the response\):[\s\S]*$/;

// HTML variant used in some editors (e.g., Claude ProseMirror)
OPENMEMORY_PROMPTS.memory_header_html_regex =
  /<p><strong>Here is some of my memories to help answer better \(don't respond to these memories but use them to assist in the response\):<\/strong><\/p>([\s\S]*?)(?=<p>|$)/;

export { OPENMEMORY_PROMPTS };
