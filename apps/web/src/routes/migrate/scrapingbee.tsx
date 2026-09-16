import { createFileRoute } from '@tanstack/react-router';
import doc from '../../../content/migrate/scrapingbee.md?docs';
import { SymptomPage } from '../../components/symptom-page.js';
import { docHead } from '../../lib/doc-head.js';

export const Route = createFileRoute('/migrate/scrapingbee')({
	head: () => docHead(doc.title, doc.summary, '/migrate/scrapingbee'),
	component: () => <SymptomPage doc={doc} />,
});
