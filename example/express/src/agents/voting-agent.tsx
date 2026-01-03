import {
  Component,
  comState,
  Fork,
  System,
  User,
  input,
  Model,
  COM,
  TickState,
  Assistant,
  Complete,
  Text,
  Json,
  isTextBlock,
  isUserMessage,
  isAssistantMessage,
  Section,
} from "aidk";
import { aisdk, openai } from "../models/models";

/**
 * TaskSolver - Individual solver that answers a question.
 * Each solver gets slightly different temperature for diversity.
 */
class TaskSolver extends Component<{ task: string; solverId: number; modelName?: string }> {
  task = input<string>();
  solverId = input<number>(0);
  modelName = input<string>(process.env["OPENAI_MODEL"] || "gpt-4o-mini");

  render() {
    // Vary temperature slightly for diversity (0.7, 0.8, 0.9, etc.)
    const temperature = 0.7 + this.solverId() * 0.1;

    return (
      <>
        <Model model={aisdk({ model: openai.chat(this.modelName()) })} temperature={temperature} maxTokens={50} />
        <Section id="instructions" audience="model" title="Instructions">
          Answer in 1-5 words ONLY. Be as succinct as possible. No explanation. Examples: "Canberra" or "206" or "Neil Armstrong"
          or "No".
        </Section>
        {/* or render directly as a system message */}
        {/* <System>
          Answer in 1-5 words only. No explanation. Examples: "Canberra" or "206" or "Neil Armstrong" or "No".</Text>
        </System> */}
        <User>{this.task()}</User>
      </>
    );
  }
}

/**
 * VotingAgent - Runs multiple solvers in parallel and returns consensus answer.
 *
 * Based on MAKER paper: https://arxiv.org/abs/2511.09030
 *
 * @param task - The question/task to solve
 * @param k - Lead required to declare winner (default: 2)
 * @param numVoters - Number of parallel voters (default: 5)
 */
interface VotingAgentProps {
  task: string;
  k?: number;
  numVoters?: number;
}

export class VotingAgent extends Component<VotingAgentProps> {
  task = input<string>();
  k = input<number>(2);
  numVoters = input<number>(5);

  private votes = comState("votes", new Map<string, number>());
  private originalAnswers = comState("originalAnswers", new Map<string, string>()); // normalized -> original
  private winner = comState<string | null>("winner", null);
  private votesRecorded = comState("votesRecorded", 0);

  private recordVote(answer: string) {
    console.log("[VotingAgent] recordVote called with:", answer);

    // Always increment vote count (even for red-flagged answers)
    this.votesRecorded.update((n) => n + 1);
    console.log(`[VotingAgent] Votes recorded: ${this.votesRecorded()}/${this.numVoters()}`);

    // Red-flag suspicious outputs
    if (this.isRedFlagged(answer)) {
      console.log("[VotingAgent] Answer red-flagged, skipping");
      this.checkConsensus(); // Still check - might need fallback
      return;
    }

    // Extract the key answer - for numeric questions, extract the first number mentioned
    const normalized = this.normalizeAnswer(answer);
    console.log("[VotingAgent] Normalized answer:", normalized);

    this.votes.update((v) => {
      const newMap = new Map(v);
      newMap.set(normalized, (newMap.get(normalized) || 0) + 1);
      console.log("[VotingAgent] Updated votes:", [...newMap.entries()]);
      return newMap;
    });

    // Store the original answer (first one wins - it's the cleanest usually)
    this.originalAnswers.update((m) => {
      if (!m.has(normalized)) {
        const newMap = new Map(m);
        newMap.set(normalized, answer.trim());
        return newMap;
      }
      return m;
    });

    this.checkConsensus();
  }

  /**
   * Normalize answer to extract the key value for comparison.
   * Handles: numbers, yes/no, proper nouns, short answers.
   */
  private normalizeAnswer(answer: string): string {
    const trimmed = answer.trim().toLowerCase();
    const originalTrimmed = answer.trim();

    // 1. Yes/No answers (handle various phrasings)
    if (/\b(yes|correct|true|affirmative)\b/.test(trimmed) && !/\bno\b/.test(trimmed)) {
      return "yes";
    }
    if (/\b(no|incorrect|false|not visible|cannot|isn'?t|wasn'?t|aren'?t|weren'?t)\b/.test(trimmed)) {
      return "no";
    }

    // 2. Extract proper nouns FIRST (prioritize names/places over numbers)
    // Pattern: Look for capitalized multi-word names (e.g., "Neil Armstrong", "Canberra")
    const properNounMatch = originalTrimmed.match(
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g,
    );
    if (properNounMatch) {
      // Filter out common sentence starters and pick the most likely answer
      const filtered = properNounMatch.filter(
        (noun) => !["The", "It", "This", "That", "Yes", "No", "I", "A", "An", "He", "She", "They", "We", "As", "On", "In", "At", "By", "For", "His", "Her", "Who", "What", "When", "Where", "How", "Why"].includes(noun),
      );
      if (filtered.length > 0) {
        // Return the first proper noun (most likely the answer)
        return filtered[0].toLowerCase();
      }
    }

    // 3. Numbers with optional units (e.g., "206 bones", "42", "3.14 meters")
    const numberMatch = trimmed.match(
      /\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:bones?|years?|meters?|m|km|miles?|kg|lbs?|pounds?|degrees?|°|%|percent|celsius|fahrenheit)?\b/i,
    );
    if (numberMatch) {
      return numberMatch[1].replace(/,/g, ""); // Remove commas from numbers
    }

    // 4. Fallback: first word (for single-word answers)
    const firstWord = originalTrimmed.split(/[\s,.!?]/)[0];
    if (firstWord && firstWord.length <= 30) {
      return firstWord.toLowerCase();
    }

    return trimmed.slice(0, 50).toLowerCase();
  }

  private checkConsensus() {
    const voteMap = this.votes();
    const totalRecorded = this.votesRecorded();
    const numVoters = this.numVoters();

    let maxVotes = 0,
      maxAnswer = "",
      secondMax = 0;
    for (const [answer, count] of voteMap) {
      if (count > maxVotes) {
        secondMax = maxVotes;
        maxVotes = count;
        maxAnswer = answer;
      } else if (count > secondMax) {
        secondMax = count;
      }
    }

    // Check if leader is k-ahead
    console.log(
      `[VotingAgent] Checking consensus: maxVotes=${maxVotes}, secondMax=${secondMax}, k=${this.k()}, maxAnswer="${maxAnswer}", recorded=${totalRecorded}/${numVoters}`,
    );

    if (maxVotes - secondMax >= this.k()) {
      console.log("[VotingAgent] Consensus reached (k-ahead)! Winner:", maxAnswer);
      this.winner.set(maxAnswer);
      return;
    }

    // Fallback: if all votes are in, pick plurality winner
    if (totalRecorded >= numVoters && maxAnswer) {
      console.log("[VotingAgent] All votes in, picking plurality winner:", maxAnswer);
      this.winner.set(maxAnswer);
    }
  }

  private isRedFlagged(answer: string): boolean {
    if (answer.length > 10000) return true; // Too long
    if (answer.trim() === "") return true; // Empty
    if (answer.includes("I cannot")) return true; // Refusal
    if (answer.includes("I'm not able")) return true; // Refusal variant
    return false;
  }

  /**
   * Extract text answer from Fork execution result
   */
  private extractAnswer(result: any): string {
    // Result is the execution output which contains timeline
    if (!result) return "";

    // If result has timeline, get last assistant message
    const timeline = result.timeline || result;
    if (Array.isArray(timeline)) {
      const lastAssistant = timeline
        .filter((e) => isAssistantMessage(e.message))
        .at(-1);

      if (lastAssistant) {
        const content = lastAssistant.message?.content || lastAssistant.content;
        if (Array.isArray(content)) {
          return content
            .filter(isTextBlock)
            .map((b) => b.text)
            .join(" ");
        }
        if (typeof content === "string") return content;
      }
    }

    // Fallback: try to stringify if it's already a string-like value
    if (typeof result === "string") return result;

    return "";
  }

  render(_com: COM, _state: TickState) {
    // Already have consensus - emit assistant message and stop
    if (this.winner()) {
      const winnerKey = this.winner()!;
      console.log("[VotingAgent] Rendering winner:", winnerKey);
      console.log("[VotingAgent] Current votes map:", [...this.votes().entries()]);

      const voteCount = this.votes().get(winnerKey) || 0;
      const totalVotes = [...this.votes().values()].reduce((a, b) => a + b, 0);
      console.log(`[VotingAgent] voteCount=${voteCount}, totalVotes=${totalVotes}`);

      // Get the original answer text (not the normalized key)
      const displayAnswer = this.originalAnswers().get(winnerKey) || winnerKey;

      // Complete stops the tick loop and emits the final answer
      return (
        <Complete reason="Consensus reached">
          <Assistant>
            <Text>Final answer: {displayAnswer}</Text>
            <Json data={{ answer: displayAnswer, voteCount, totalVotes, confidence: voteCount / totalVotes }} />
          </Assistant>
        </Complete>
      );
    }

    // Spawn all voters in parallel, wait for all to complete
    // NO MODEL HERE - only the Fork children (TaskSolvers) need models
    // Adding a model here would trigger an unwanted model call
    return (
      <>
        {Array.from({ length: this.numVoters() }, (_, i) => (
          <Fork
            key={`voter-${i}`}
            waitUntilComplete={true}
            onComplete={(result) => this.recordVote(this.extractAnswer(result))}
          >
            <TaskSolver task={this.task()} solverId={i} />
          </Fork>
        ))}
      </>
    );
  }
}

/**
 * VerifiedAnswerAgent - Agent that uses voting consensus for high-confidence answers.
 *
 * Usage: Send a factual question, get a verified answer with vote count.
 */
export class VerifiedAnswerAgent {
  render(com: COM, _state: TickState) {
    // Get the user's question from the input (not the output timeline)
    const userInput = com.getUserInput();

    // Debug: Log the input structure
    console.log("[VerifiedAnswerAgent] userInput:", JSON.stringify(userInput, null, 2));

    const lastUserMessage = userInput?.timeline
      ?.filter((e) => isUserMessage(e.message))
      .at(-1);

    console.log("[VerifiedAnswerAgent] lastUserMessage:", JSON.stringify(lastUserMessage, null, 2));

    const question =
      lastUserMessage?.message?.content
        ?.filter(isTextBlock)
        .map((b) => b.text)
        .join(" ") || "";

    console.log("[VerifiedAnswerAgent] question:", question);

    if (!question) {
      // No question yet - emit assistant message asking for question
      return <Complete reason="No question">
        <Assistant>Please ask a question to get a verified answer.</Assistant>
      </Complete>;
    }

    // Delegate to VotingAgent - NO MODEL HERE
    // The VotingAgent's Fork children (TaskSolvers) have their own models
    // Adding a model here would cause an unwanted model call before voting completes
    return <VotingAgent task={question} k={2} numVoters={5} />;
  }
}
