import { TaskAssistantAgent } from "./task-assistant";
import { VerifiedAnswerAgent, VotingAgent } from "./voting-agent";

export const agents: Record<string, any> = {
  "task-assistant": TaskAssistantAgent,
  "verified-answer": VerifiedAnswerAgent,
};

export { TaskAssistantAgent, VerifiedAnswerAgent, VotingAgent };
