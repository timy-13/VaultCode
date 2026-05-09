export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
}

const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    name: "worker",
    description: "General execution agent for focused implementation tasks.",
    systemPrompt: "You are the worker sub-agent. Work only on the delegated task, use tools if needed, and return a concise result for the parent agent.",
  },
  {
    name: "explorer",
    description: "Codebase exploration agent for locating files, behaviors, and dependencies.",
    systemPrompt: "You are the explorer sub-agent. Investigate the delegated question, use search-oriented tools when useful, and return concise findings for the parent agent.",
  },
  {
    name: "reviewer",
    description: "Focused review agent for bugs, risks, regressions, and missing tests.",
    systemPrompt: "You are the reviewer sub-agent. Review the delegated change or area for correctness risks, regressions, and missing tests, then return concise findings for the parent agent.",
  },
  {
    name: "general",
    description: "Flexible agent for mixed research and implementation tasks.",
    systemPrompt: "You are the general sub-agent. Complete the delegated task carefully, use tools as needed, and return a concise result for the parent agent.",
  },
];

export function listAgentDefinitions(): AgentDefinition[] {
  return [...AGENT_DEFINITIONS];
}

export function resolveAgentDefinition(agentType: string | undefined): AgentDefinition {
  const normalized = agentType?.trim() || "worker";
  const definition = AGENT_DEFINITIONS.find((candidate) => candidate.name === normalized);
  if (!definition) {
    throw new Error(`Unknown agent type: ${normalized}. Available types: ${AGENT_DEFINITIONS.map((agent) => agent.name).join(", ")}`);
  }

  return definition;
}
