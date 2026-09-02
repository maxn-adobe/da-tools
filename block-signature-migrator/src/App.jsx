import { useState } from 'react';
import './App.css';
import DebugView from './components/DebugView.jsx';
import SchemaBootstrap from './components/SchemaBootstrap.jsx';
import ContentCrawl from './components/ContentCrawl.jsx';

const TABS = [
  { id: 'debug', label: 'Debug View' },
  { id: 'schema-bootstrap', label: 'Schema Bootstrap' },
  { id: 'content-crawl', label: 'Content Crawl' },
];

function App() {
  const [view, setView] = useState('debug');

  return (
    <div className={`app${view === 'schema-bootstrap' ? ' app--wide' : ''}`}>
      <header className="app-header">
        <h1>Block Signature Migrator</h1>
        <nav className="app-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`tab-btn${view === tab.id ? ' active' : ''}`}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="app-main">
        {view === 'debug' && <DebugView />}
        {view === 'schema-bootstrap' && <SchemaBootstrap />}
        {view === 'content-crawl' && <ContentCrawl />}
      </main>
    </div>
  );
}

export default App;
