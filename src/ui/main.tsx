import React from 'react';
import { createRoot } from 'react-dom/client';
import { Workspace } from './Workspace';
import { createReaderApi } from './api';

const root = document.getElementById('root');
if (!root) throw new Error('Reader root element is missing');
createRoot(root).render(<Workspace api={createReaderApi()} />);
