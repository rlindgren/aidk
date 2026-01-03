# Voting Consensus Example

Multi-agent coordination with consensus voting for reliable outputs.

Inspired by [MAKER: Solving Million-Token Tasks with Zero Errors](https://arxiv.org/abs/2511.09030).

## The Concept

Single LLM calls have persistent error rates. For tasks requiring many steps, errors compound exponentially. The solution:

1. **Decompose** tasks into smallest possible subtasks
2. **Run multiple agents** in parallel on each subtask
3. **Vote** - accept answers only when one leads by k votes
4. **Filter** suspicious outputs (too long, wrong format, etc.)

This achieves near-zero error rates even for million-step tasks.

---

## Basic Voting Agent

Run multiple solvers in parallel, wait for consensus:

```tsx
import { Component, comState, Fork, Section, Paragraph, System, User, input } from 'aidk';
import { Model } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';

interface VotingAgentProps {
  task: string;
  k?: number;         // Lead required to win (default: 2)
  numVoters?: number; // Number of parallel voters (default: 5)
}

class VotingAgent extends Component<VotingAgentProps> {
  k = input<number>(2);
  task = input<string>();
  numVoters = input(5);

  private votes = comState('votes', new Map<string, number>());
  private winner = comState<string | null>('winner', null);

  private recordVote(answer: string) {
    if (this.isRedFlagged(answer)) return;

    this.votes.update(v => {
      const newMap = new Map(v);
      newMap.set(answer, (newMap.get(answer) || 0) + 1);
      return newMap;
    });

    this.checkConsensus();
  }

  private checkConsensus() {
    const voteMap = this.votes();

    let maxVotes = 0, maxAnswer = '', secondMax = 0;
    for (const [answer, count] of voteMap) {
      if (count > maxVotes) {
        secondMax = maxVotes;
        maxVotes = count;
        maxAnswer = answer;
      } else if (count > secondMax) {
        secondMax = count;
      }
    }

    if (maxVotes - secondMax >= this.k()) {
      this.winner.set(maxAnswer);
    }
  }

  private isRedFlagged(answer: string): boolean {
    if (answer.length > 10000) return true;   // Too long
    if (answer.trim() === '') return true;     // Empty
    if (answer.includes('I cannot')) return true; // Refusal
    return false;
  }

  render() {
    // Already have consensus - return the answer
    if (this.winner()) {
      return (
        <Section title="Result">
          <Paragraph>{this.winner()}</Paragraph>
        </Section>
      );
    }

    // Spawn all voters in parallel, wait for all to complete
    return (
      <>
        {Array.from({ length: this.numVoters() }, (_, i) => (
          <Fork
            key={`voter-${i}`}
            waitUntilComplete={true}
            onComplete={(result) => this.recordVote(result)}
          >
            <TaskSolver task={this.task()} solverId={i} />
          </Fork>
        ))}
      </>
    );
  }
}

// Individual solver - each gets slightly different temperature for diversity
class TaskSolver extends Component<{ task: string; solverId: number }> {
  solverId = input<number>(1);
  task = input<string>();

  render() {
    return (
      <>
        <Model
          model={openai('gpt-5.2-mini')}
          temperature={0.7 + (this.solverId() * 0.1)}
        />
        <System>
          Answer concisely and precisely. Give ONLY the final answer.
        </System>
        <User>{this.task()}</User>
      </>
    );
  }
}
```

---

## Hierarchical Decomposition

For complex tasks, decompose into subtasks with voting at each level:

```tsx
import { Component, comState, Fork } from 'aidk';

class DecomposeAndSolve extends Component<{ task: string }> {
  task = input<string>();

  private subtasks = comState<string[]>('subtasks', []);
  private results = comState<Map<string, string>>('results', new Map());
  private phase = comState<'decompose' | 'solve' | 'combine'>('phase', 'decompose');

  render() {
    switch (this.phase()) {
      case 'decompose':
        return (
          <Fork
            waitUntilComplete={true}
            onComplete={(subtasks: string[]) => {
              this.subtasks.set(subtasks.length === 1 ? [this.task()] : subtasks);
              this.phase.set('solve');
            }}
          >
            <TaskDecomposer task={this.task()} />
          </Fork>
        );

      case 'solve':
        return (
          <>
            {this.subtasks().map((subtask, i) => (
              <Fork
                key={`subtask-${i}`}
                waitUntilComplete={true}
                onComplete={(answer) => {
                  this.results.update(r => new Map(r).set(subtask, answer));
                  if (this.results().size === this.subtasks().length) {
                    this.phase.set('combine');
                  }
                }}
              >
                <VotingAgent task={subtask} k={2} numVoters={3} />
              </Fork>
            ))}
          </>
        );

      case 'combine':
        return (
          <Fork waitUntilComplete={true}>
            <ResultCombiner task={this.task()} results={this.results()} />
          </Fork>
        );
    }
  }
}

class TaskDecomposer extends Component<{ task: string }> {
  task = input<string>();

  render() {
    return (
      <>
        <Model model={openai('gpt-5.2')} />
        <System>
          Break this task into the smallest independent subtasks.
          Return a JSON array of strings. If atomic, return single-element array.
        </System>
        <User>{this.task()}</User>
      </>
    );
  }
}

class ResultCombiner extends Component<{ task: string; results: Map<string, string> }> {
  task = input<string>();
  results = input<Map<string, string>>(new Map());

  render() {
    const resultText = [...this.results().entries()]
      .map(([task, result]) => `- ${task}: ${result}`)
      .join('\n');

    return (
      <>
        <Model model={openai('gpt-5.2')} />
        <System>Combine subtask results into a final answer.</System>
        <User>
          Original task: {this.task()}

          Subtask results:
          {resultText}
        </User>
      </>
    );
  }
}
```

---

## Early Termination (First-to-k-Ahead)

The paper's key insight: don't wait for all voters. Stop when one answer leads by k:

```tsx
class FirstToKAhead extends Component<{ task: string; k?: number; maxVoters?: number }> {
  task = input<string>();
  k = input(2);
  maxVoters = input(10);

  private votes = comState<Map<string, number>>('votes', new Map());
  private spawned = comState('spawned', 0);
  private winner = comState<string | null>('winner', null);

  render() {
    if (this.winner()) {
      return <Section title="Consensus"><Paragraph>{this.winner()}</Paragraph></Section>;
    }

    // Spawn voters in batches of 2 until we get consensus or hit max
    const toSpawn = Math.min(this.spawned() + 2, this.maxVoters()) - this.spawned();

    return (
      <>
        {Array.from({ length: toSpawn }, (_, i) => {
          const voterId = this.spawned() + i;
          this.spawned.set(voterId + 1);

          return (
            <Fork
              key={`voter-${voterId}`}
              waitUntilComplete={false} // Don't block - check consensus as results come in
              onComplete={(answer) => {
                if (this.winner()) return;

                this.votes.update(v => new Map(v).set(answer, (v.get(answer) || 0) + 1));

                // Check for k-ahead winner
                const voteMap = this.votes();
                let max = 0, second = 0, maxAns = '';
                for (const [ans, count] of voteMap) {
                  if (count > max) { second = max; max = count; maxAns = ans; }
                  else if (count > second) { second = count; }
                }
                if (max - second >= this.k()) this.winner.set(maxAns);
              }}
            >
              <TaskSolver task={this.task()} solverId={voterId} />
            </Fork>
          );
        })}
      </>
    );
  }
}
```

---

## Key Patterns

1. **Fork with `waitUntilComplete`** - Control whether to block or fire-and-forget
2. **Signals for coordination** - Track votes across parallel forks via `comState`
3. **Red-flagging** - Filter suspicious outputs before counting
4. **Early termination** - Stop when k-ahead consensus reached, don't waste tokens

---

## When to Use

- **High-stakes tasks** where errors are costly
- **Factual questions** with verifiable answers
- **Code generation** where correctness matters
- **Multi-step reasoning** that compounds errors

For creative or subjective tasks, single-agent approaches are usually better.

---

## References

- [MAKER Paper (arXiv)](https://arxiv.org/abs/2511.09030) - The research this is based on
- [Fork/Spawn Guide](/docs/guides/fork-spawn) - Parallel execution in AIDK
- [Multi-Agent Example](/examples/multi-agent) - Simpler coordination patterns
