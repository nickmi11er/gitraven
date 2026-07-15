// GIT_SEQUENCE_EDITOR: git invokes this with the git-rebase-todo path as the
// final argument. We overwrite that file with the todo derived from our plan.
import * as fs from 'node:fs';
import * as path from 'node:path';

interface PlanStep {
  id: number;
  sha: string;
  action: 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';
  hasMessage: boolean;
}
interface Plan {
  steps: PlanStep[];
  /** Already-quoted `"node" "messageEditor.cjs"` command prefix. */
  execPrefix: string;
  msgDir: string;
}

function quote(p: string): string {
  return '"' + p.replace(/\\/g, '/') + '"';
}

function main(): void {
  const planPath = process.env.DETACHED_REBASE_PLAN;
  const todoPath = process.argv[process.argv.length - 1];
  if (!planPath || !todoPath) return;

  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as Plan;
  const lines: string[] = [];
  const amend = (step: PlanStep) =>
    `exec ${plan.execPrefix} --msg ${quote(path.join(plan.msgDir, `msg-${step.id}.txt`))}`;

  for (const step of plan.steps) {
    switch (step.action) {
      case 'pick':
        lines.push(`pick ${step.sha}`);
        break;
      case 'edit':
        lines.push(`edit ${step.sha}`);
        break;
      case 'fixup':
        lines.push(`fixup ${step.sha}`);
        break;
      case 'drop':
        break; // omit the line entirely
      case 'reword':
        // pick then amend deterministically, avoiding a blocking editor.
        lines.push(`pick ${step.sha}`);
        if (step.hasMessage) lines.push(amend(step));
        break;
      case 'squash':
        lines.push(`squash ${step.sha}`);
        if (step.hasMessage) lines.push(amend(step));
        break;
    }
  }
  if (lines.length === 0) lines.push('noop');
  fs.writeFileSync(todoPath, lines.join('\n') + '\n');
}

main();
