import { useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../../store/store';
import { shortSha } from '../../util/format';
import { Dropdown } from '../common/Dropdown';
import type { RebaseAction, RebaseStep } from '../../../shared/model';

const ACTIONS: RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];
const ACTION_GROUPS = [{ items: ACTIONS.map((a) => ({ value: a, label: a })) }];

export function RebaseDialog() {
  const dialog = useStore((s) => s.rebaseDialog);
  const setSteps = useStore((s) => s.setRebaseSteps);
  const submit = useStore((s) => s.submitRebase);
  const cancel = useStore((s) => s.cancelRebase);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, cancel]);

  if (!dialog) return null;
  const steps = dialog.steps;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = steps.findIndex((s) => s.id === e.active.id);
    const to = steps.findIndex((s) => s.id === e.over!.id);
    if (from < 0 || to < 0) return;
    setSteps(arrayMove(steps, from, to));
  };

  const update = (id: number, patch: Partial<RebaseStep>) =>
    setSteps(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  return (
    <div className="modal-backdrop" onClick={cancel}>
      <div
        className="rebase-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Interactive rebase"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rebase-header">
          <div className="rebase-header-text">
            <h2>
              Rebasing {steps.length} commit{steps.length === 1 ? '' : 's'}
            </h2>
            <div className="rebase-hint">Drag to reorder · top is applied first (oldest)</div>
          </div>
          <button className="icon-button" title="Cancel" aria-label="Cancel" onClick={cancel}>
            <span className="codicon codicon-close" aria-hidden />
          </button>
        </div>
        <div className="rebase-list">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {steps.map((step) => (
                <SortableRow key={step.id} step={step} onChange={update} />
              ))}
            </SortableContext>
          </DndContext>
        </div>
        <div className="rebase-actions">
          <button className="btn-secondary" onClick={cancel}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void submit()}>
            Start Rebasing
          </button>
        </div>
      </div>
    </div>
  );
}

function SortableRow({ step, onChange }: { step: RebaseStep; onChange: (id: number, patch: Partial<RebaseStep>) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  const showMessage = step.action === 'reword' || step.action === 'squash';

  return (
    <div ref={setNodeRef} style={style} className={`rebase-row action-${step.action}`}>
      <span className="drag-handle codicon codicon-gripper" aria-label="Drag to reorder" {...attributes} {...listeners} />
      <Dropdown
        className={`action-chip action-${step.action}`}
        value={step.action}
        groups={ACTION_GROUPS}
        onSelect={(v) => {
          const action = v as RebaseAction;
          const patch: Partial<RebaseStep> = { action };
          // Prefill with the FULL original message — editing must not lose the body.
          if ((action === 'reword' || action === 'squash') && !step.message)
            patch.message = step.original ?? step.subject;
          onChange(step.id, patch);
        }}
      />
      <span className="rebase-sha">{shortSha(step.sha)}</span>
      <span className="rebase-subject">{step.subject}</span>
      {showMessage && (
        <textarea
          className="rebase-message"
          value={step.message ?? ''}
          placeholder="New commit message"
          onChange={(e) => onChange(step.id, { message: e.target.value })}
          rows={Math.min(8, Math.max(2, (step.message ?? '').split('\n').length + 1))}
        />
      )}
    </div>
  );
}
