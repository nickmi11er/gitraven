import { createRoot } from 'react-dom/client';
import { CommitApp } from './CommitApp';
import '@vscode/codicons/dist/codicon.css';
import './styles/app.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<CommitApp />);
}
