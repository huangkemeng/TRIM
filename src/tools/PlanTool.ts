import { ITool, ToolDefinition, ToolResult } from './ToolInterface';

interface PlanStep {
  id: string;
  description: string;
  action: string;
  dependsOn: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
}

interface PlanData {
  goal: string;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
}

export class PlanTool implements ITool {
  private currentPlan: PlanData | null = null;

  definition: ToolDefinition = {
    name: 'plan',
    description: `Create or update a structured plan for the current task.

HOW TO USE:
1. At the START of every task, call with action="create" to define your plan
2. After completing each step, call with action="update" to mark progress
3. When all steps are done, call with action="complete" to finalize

The plan is stored in memory and can be checked for completion status.`,
    parameters: {
      action: {
        type: 'string',
        description: 'Action to perform',
        enum: ['create', 'update', 'complete'],
      },
      goal: {
        type: 'string',
        description: 'Overall task goal (required for action=create)',
      },
      steps: {
        type: 'array',
        description: 'List of plan steps (required for action=create). Each step should have: id (unique identifier), description (what to do), action (specific operation), dependsOn (array of step IDs this depends on)',
        items: {
          type: 'object',
          description: 'A plan step with id, description, action, and dependsOn fields',
        },
      },
      completedStepIds: {
        type: 'array',
        description: 'IDs of steps that are now completed (for action=update)',
        items: {
          type: 'string',
          description: 'Step ID',
        },
      },
      currentStepId: {
        type: 'string',
        description: 'ID of the step currently being worked on (for action=update)',
      },
    },
    requiredParameters: ['action'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args.action as string;

    switch (action) {
      case 'create':
        return this.createPlan(args);
      case 'update':
        return this.updatePlan(args);
      case 'complete':
        return this.completePlan();
      default:
        return {
          success: false,
          data: '',
          error: `Unknown action: "${action}". Use "create", "update", or "complete".`,
        };
    }
  }

  private createPlan(args: Record<string, unknown>): ToolResult {
    const goal = args.goal as string | undefined;
    const steps = args.steps as Array<Record<string, unknown>> | undefined;

    if (!goal) {
      return { success: false, data: '', error: 'Parameter "goal" is required for action=create.' };
    }
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return { success: false, data: '', error: 'Parameter "steps" (non-empty array) is required for action=create.' };
    }

    this.currentPlan = {
      goal,
      steps: steps.map((s, i) => ({
        id: (s.id as string) || `step-${i + 1}`,
        description: (s.description as string) || '',
        action: (s.action as string) || '',
        dependsOn: (s.dependsOn as string[]) || [],
        status: 'pending' as const,
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return {
      success: true,
      data: this.formatPlan(),
    };
  }

  private updatePlan(args: Record<string, unknown>): ToolResult {
    if (!this.currentPlan) {
      return { success: false, data: '', error: 'No plan exists. Call with action="create" first.' };
    }

    const completedStepIds = (args.completedStepIds as string[]) || [];
    const currentStepId = args.currentStepId as string | undefined;

    for (const step of this.currentPlan.steps) {
      if (completedStepIds.includes(step.id)) {
        step.status = 'completed';
      }
      if (step.id === currentStepId) {
        step.status = 'in_progress';
      }
    }

    this.currentPlan.updatedAt = Date.now();

    return {
      success: true,
      data: this.formatPlan(),
    };
  }

  private completePlan(): ToolResult {
    if (!this.currentPlan) {
      return { success: false, data: '', error: 'No plan exists.' };
    }

    for (const step of this.currentPlan.steps) {
      if (step.status === 'pending' || step.status === 'in_progress') {
        step.status = 'completed';
      }
    }

    this.currentPlan.updatedAt = Date.now();

    return {
      success: true,
      data: this.formatPlan(),
    };
  }

  /**
   * Get the current plan completion status.
   * Used by Agent.ts to verify plan completion before task_complete.
   */
  getStatus(): { completed: string[]; incomplete: string[]; total: number } {
    if (!this.currentPlan) {
      return { completed: [], incomplete: [], total: 0 };
    }
    const completed = this.currentPlan.steps
      .filter(s => s.status === 'completed')
      .map(s => s.id);
    const incomplete = this.currentPlan.steps
      .filter(s => s.status !== 'completed')
      .map(s => s.id);
    return { completed, incomplete, total: this.currentPlan.steps.length };
  }

  /**
   * Get the current plan goal.
   */
  getGoal(): string {
    return this.currentPlan?.goal || '';
  }

  /**
   * Reset the plan (called when a new task starts).
   */
  reset(): void {
    this.currentPlan = null;
  }

  private formatPlan(): string {
    if (!this.currentPlan) return 'No plan created yet.';

    const lines: string[] = [
      `## Plan: ${this.currentPlan.goal}`,
      '',
      '| # | Status | Description |',
      '|---|--------|-------------|',
    ];

    for (const step of this.currentPlan.steps) {
      const statusIcon =
        step.status === 'completed'
          ? '✅'
          : step.status === 'in_progress'
            ? '🔄'
            : step.status === 'skipped'
              ? '⏭️'
              : '⏳';
      lines.push(`| ${step.id} | ${statusIcon} ${step.status} | ${step.description} |`);
    }

    const completed = this.currentPlan.steps.filter(s => s.status === 'completed').length;
    const total = this.currentPlan.steps.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    lines.push('', `**Progress:** ${completed}/${total} steps completed (${pct}%)`);

    return lines.join('\n');
  }
}
