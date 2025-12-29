import { 
  Section,  
  Logger,
  Paragraph,
  comState,
  computed,
  Model,
  COM,
  TickState
} from 'aidk';

import { aisdk, openai, vertex } from '../models/models';

import { UserContextComponent } from '../components';
import { SlidingWindowTimeline } from '../components/timeline/sliding-window.function';
import { CalculatorTool, ScratchpadTool, TodoListTool } from '../tools';

type ReasoningOptions = {
  enabled: boolean;
  effort: 'low' | 'medium' | 'high';
};

/**
 * TaskAssistantAgent - Main agent component for task management.
 * 
 * Composes:
 * - OpenAI model for generation
 * - Timeline for conversation history (loaded from persistence + new messages)
 * - Instructions section for model guidance
 * - TodoListTool for task management
 * - CalculatorTool for calculations
 */
export class TaskAssistantAgent {
  private log = Logger.for(this);

  private useGoogle = comState<boolean>('useGoogle', process.env['USE_GOOGLE_MODEL'] === 'true');
  private openaiModel = comState<string>('openaiModel', process.env['OPENAI_MODEL'] || 'gpt-4o-mini');
  private googleModel = comState<string>('googleModel', process.env['GOOGLE_MODEL'] || 'gemini-2.5-flash');
  private reasoning = comState<ReasoningOptions>('reasoning', { enabled: true, effort: 'low' });
  private model = computed(() =>
    this.useGoogle() ? vertex(this.googleModel()) : openai.chat(this.openaiModel())
  );
  private executionModel = computed(() => aisdk({
    model: this.model(),
    providerOptions: this.getModelProviderOptions({
      reasoning: this.reasoning()
    })
  }));

  async render(com: COM, state: TickState) {
    return (
      <>
        <Model model={this.executionModel()} />
        
        {/* Agent-level instructions only - tool-specific instructions and context come from the tools themselves */}
        <Section
          id="instructions"
          title="Instructions"
          audience="model"
        >
          <Paragraph>You are a <strong>helpful</strong> assistant with access to tools.</Paragraph>
          <Paragraph>When asked to perform actions, use the appropriate tool immediately. Do NOT describe what you would or will do - you MUST call the tool.</Paragraph>
          <Paragraph>Be concise and helpful.</Paragraph>
        </Section>

        <UserContextComponent />

        {/* Render conversation history */}
        <SlidingWindowTimeline windowSize={20 + state.tick} />

        {/* Tools */}
        <TodoListTool />
        <ScratchpadTool />
        <CalculatorTool />
      </>
    );
  }

  private getModelProviderOptions({ reasoning }: {reasoning: ReasoningOptions} = { reasoning: {enabled: false, effort: 'low'} }) {
    return {
      google: {
        thinkingConfig: {
          includeThoughts: reasoning.enabled,
          thinkingBudget: reasoning.effort === 'low' ? 1024 : reasoning.effort === 'medium' ? 2048 : 4096,
        },
      },
      openai: {
        ...(reasoning.enabled ? { reasoningEffort: reasoning.effort } : {})
      },
    };
  }
}
