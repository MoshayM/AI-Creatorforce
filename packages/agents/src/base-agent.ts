import { callAI, callAIStructured, type AIMessage, type AICallOptions } from '@cf/shared';
import { z } from 'zod';

export interface AgentContext {
  jobId: string;
  projectId: string;
  userId: string;
}

export abstract class BaseAgent<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly systemPrompt: string;

  abstract run(input: TInput, ctx: AgentContext): Promise<TOutput>;

  protected async callAI(messages: AIMessage[], opts?: AICallOptions) {
    return callAI(messages, { ...opts, systemPrompt: this.systemPrompt });
  }

  protected async callStructured<T>(
    messages: AIMessage[],
    schema: z.ZodSchema<T>,
    opts?: AICallOptions,
  ): Promise<T> {
    return callAIStructured(messages, schema, { ...opts, systemPrompt: this.systemPrompt });
  }
}
