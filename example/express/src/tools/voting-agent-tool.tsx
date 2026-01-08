import { createComponentTool } from "aidk";
import z from "zod";
import { VotingAgent } from "../agents/voting-agent";

export const VotingAgentTool = createComponentTool({
  name: "voting_agent",
  description: "Run a voting consensus to answer a question with high confidence",
  component: VotingAgent,
  options: z.object({
    k: z.number().describe("Lead required to declare winner (default: 2)").optional(),
    numVoters: z.number().describe("Number of parallel voters (default: 5)").optional(),
  }),
  // Transform input: add task to options (VotingAgent expects task as a prop)
  transformInput: (input) => ({
    ...input,
    options: { ...((input.options as object) || {}), task: input.prompt },
  }),
});
