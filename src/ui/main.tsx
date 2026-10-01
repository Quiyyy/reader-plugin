import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createReaderApi } from './api';

const root = document.getElementById('root');
if (!root) throw new Error('Reader root element is missing');
createRoot(root).render(<App api={createReaderApi()} />);
