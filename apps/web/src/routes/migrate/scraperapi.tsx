import { createFileRoute } from '@tanstack/react-router';
import doc from '../../../content/migrate/scraperapi.md?docs';
import { SymptomPage } from '../../components/symptom-page.js';
import { docHead } from '../../lib/doc-head.js';

// The symptom shell, not `DocPage`, and for the same reader: someone who arrived from a search
// with a working integration and a specific question, who will leave the moment the page starts
// selling. No sidebar, no prev/next, the query shown back, the answer before the mechanism.
export const Route = createFileRoute('/migrate/scraperapi')({
	head: () => docHead(doc.title, doc.summary, '/migrate/scraperapi'),
	component: () => <SymptomPage doc={doc} />,
});
