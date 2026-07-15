// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ContextMenu } from '../../src/webview/components/common/ContextMenu';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ onAction }: { onAction: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        data-testid="row"
        onContextMenu={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        row
      </button>
      {open && (
        <ContextMenu
          x={5}
          y={5}
          items={[{ label: 'Act', action: onAction }, { divider: true }, { label: 'Other', action: () => undefined }]}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

async function mount(onAction: () => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Harness onAction={onAction} />);
  });
  const row = container.querySelector('[data-testid=row]')!;
  await act(async () => {
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5)); // let deferred listeners attach
  });
  return { root, container };
}

describe('ContextMenu', () => {
  it('opens on contextmenu and stays open', async () => {
    const { root, container } = await mount(() => undefined);
    expect(document.querySelector('.context-menu')).not.toBeNull();
    expect(document.querySelectorAll('.context-menu-item').length).toBe(2);
    expect(document.querySelectorAll('.context-menu-divider').length).toBe(1);
    root.unmount();
    container.remove();
  });

  it('fires an item action and then closes', async () => {
    const onAction = vi.fn();
    const { root, container } = await mount(onAction);
    const item = document.querySelectorAll('.context-menu-item')[0] as HTMLElement;
    await act(async () => {
      item.click();
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.context-menu')).toBeNull();
    root.unmount();
    container.remove();
  });

  it('closes on an outside mousedown', async () => {
    const { root, container } = await mount(() => undefined);
    expect(document.querySelector('.context-menu')).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('.context-menu')).toBeNull();
    root.unmount();
    container.remove();
  });
});
