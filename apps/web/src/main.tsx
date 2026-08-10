import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// One route, no tokens, no Base UI — see vite.config.ts.
function App() {
	return <main>proxlane</main>;
}

const el = document.getElementById('root');
if (el)
	createRoot(el).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
